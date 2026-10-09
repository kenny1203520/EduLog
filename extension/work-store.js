// This module is imported only by the trusted extension service worker.
const DATABASE_NAME = 'edulog-integration-work'
const DATABASE_VERSION = 2
const PAYLOAD_CHUNK_BYTES = 512 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
let database
let opening
let generation = 0
const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
const workRange = id => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])

function failure(code, message, cause) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.code = code
  if (cause?.name) error.fields = { storage: [cause.name] }
  return error
}

function storageFailure(error) {
  if (['WORK_DATA_INVALID', 'WORK_DATA_CORRUPT', 'WORK_STORAGE_FULL', 'WORK_SAVE_FAILED'].includes(error?.code)) return error
  if (error?.name === 'QuotaExceededError') return failure('WORK_STORAGE_FULL', '此瀏覽器的工作儲存空間不足。請移除不需要的本機工作草稿後重試。', error)
  if (error?.name === 'DataCloneError' || error?.name === 'DataError') return failure('WORK_DATA_INVALID', '工作資料格式無效，草稿尚未變更。', error)
  return failure('WORK_SAVE_FAILED', '本機草稿保存失敗；先前保存的內容仍保留。請重試。', error)
}

function invalidate(connection, version) {
  if (database?.connection !== connection || (version !== undefined && database.generation !== version)) return
  database = null
  generation++
}

async function db(force = false) {
  if (force && database) { const current = database; database = null; generation++; try { current.connection.close() } catch { /* Already closed. */ } }
  if (database && !database.invalid) return database.connection
  if (opening) return opening
  const currentGeneration = generation
  opening = new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    open.onupgradeneeded = () => {
      const connection = open.result
      if (!connection.objectStoreNames.contains('work')) connection.createObjectStore('work', { keyPath: 'id' })
      if (!connection.objectStoreNames.contains('payloads')) connection.createObjectStore('payloads', { keyPath: ['workId', 'part'] })
    }
    open.onblocked = () => { /* A stale worker connection will close on versionchange. */ }
    open.onsuccess = () => {
      const connection = open.result
      const entry = { connection, generation: currentGeneration, invalid: false }
      const close = () => { entry.invalid = true; invalidate(connection, currentGeneration) }
      connection.onclose = close
      connection.onversionchange = () => { close(); try { connection.close() } catch { /* Already closed. */ } }
      database = entry
      resolve(connection)
    }
    open.onerror = () => reject(open.error || new Error('無法開啟本機工作資料庫。'))
  })
  try { return await opening } finally { opening = null }
}

async function transaction(names, mode, operation) {
  const stores = Array.isArray(names) ? names : [names]
  let tx
  try { tx = (await db()).transaction(stores, mode) }
  catch (error) {
    if (error?.name !== 'InvalidStateError' && error?.name !== 'TransactionInactiveError') throw storageFailure(error)
    const stale = database
    if (stale) invalidate(stale.connection, stale.generation)
    // Retry only before a transaction exists. A write that has started must
    // be resolved through its idempotency checkpoint, never replayed here.
    try { tx = (await db(true)).transaction(stores, mode) } catch (retryError) { throw storageFailure(retryError) }
  }
  const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || new Error('本機工作資料庫交易失敗。')) })
  const objects = Object.fromEntries(stores.map(name => [name, tx.objectStore(name)]))
  try { const result = await operation(objects); await complete; return result }
  catch (error) { try { tx.abort() } catch { /* It may have already completed. */ } await complete.catch(() => {}); throw storageFailure(error) }
}

function headerOf(row, byteLength, chunkCount) {
  return { id: row.id, instance: row.instance, userId: row.userId, revision: row.revision, updatedAt: row.updatedAt, expiresAt: row.expiresAt, __edulogPayload: { byteLength, chunkCount } }
}

async function decodePayload(header, rows) {
  const meta = header.__edulogPayload
  if (!meta || !Number.isSafeInteger(meta.chunkCount) || meta.chunkCount < 1 || !Number.isSafeInteger(meta.byteLength) || meta.byteLength < 0 || rows.length !== meta.chunkCount) {
    throw failure('WORK_DATA_CORRUPT', '本機草稿分段不完整；保留其他工作並重新讀取此班級。')
  }
  const ordered = [...rows].sort((a, b) => a.part - b.part)
  const bytes = new Uint8Array(meta.byteLength)
  let offset = 0
  for (let index = 0; index < ordered.length; index++) {
    const chunk = ordered[index]
    if (chunk.workId !== header.id || chunk.part !== index || !(chunk.data instanceof ArrayBuffer) || offset + chunk.data.byteLength > bytes.length) {
      throw failure('WORK_DATA_CORRUPT', '本機草稿分段無法驗證；保留其他工作並重新讀取此班級。')
    }
    bytes.set(new Uint8Array(chunk.data), offset)
    offset += chunk.data.byteLength
  }
  if (offset !== bytes.length) throw failure('WORK_DATA_CORRUPT', '本機草稿分段長度不一致；保留其他工作並重新讀取此班級。')
  let value
  try { value = JSON.parse(decoder.decode(bytes)) } catch (error) { throw failure('WORK_DATA_CORRUPT', '本機草稿內容無法還原；保留其他工作並重新讀取此班級。', error) }
  if (!value || value.id !== header.id || value.instance !== header.instance || value.userId !== header.userId) throw failure('WORK_DATA_CORRUPT', '本機草稿識別資料不一致；保留其他工作並重新讀取此班級。')
  return value
}

function chunksFor(id, bytes) {
  const chunks = []
  for (let offset = 0, part = 0; offset < bytes.length; offset += PAYLOAD_CHUNK_BYTES, part++) {
    chunks.push({ workId: id, part, data: bytes.slice(offset, Math.min(offset + PAYLOAD_CHUNK_BYTES, bytes.length)).buffer })
  }
  if (!chunks.length) chunks.push({ workId: id, part: 0, data: new ArrayBuffer(0) })
  return chunks
}

function removePayload(payloads, id) {
  return request(payloads.getAll(workRange(id))).then(rows => Promise.all(rows.map(row => request(payloads.delete([id, row.part])))))
}

export const workStore = {
  async purge() {
    return transaction(['work', 'payloads'], 'readwrite', async stores => {
      const rows = await request(stores.work.getAll())
      const expired = rows.filter(row => row.expiresAt <= Date.now())
      for (const row of expired) { await removePayload(stores.payloads, row.id); await request(stores.work.delete(row.id)) }
      return expired.length
    })
  },
  async get(id, binding) {
    return transaction(['work', 'payloads'], 'readonly', async stores => {
      const header = await request(stores.work.get(id))
      if (!header || header.instance !== binding.instance || header.userId !== binding.userId || header.expiresAt <= Date.now()) return null
      if (!header.__edulogPayload) return header // Version 1 inline row; migrated on the next successful put.
      const rows = await request(stores.payloads.getAll(workRange(id)))
      return decodePayload(header, rows)
    })
  },
  async delete(id, binding) {
    return transaction(['work', 'payloads'], 'readwrite', async stores => {
      const header = await request(stores.work.get(id))
      if (!header) return false
      if (header.instance !== binding.instance || header.userId !== binding.userId) throw failure('WORK_OWNER_MISMATCH', '這份工作屬於其他 EduLog 實例或使用者。')
      await removePayload(stores.payloads, id)
      await request(stores.work.delete(id))
      return true
    })
  },
  async put(row, binding) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !row.id || row.id.length > 80 || !binding || typeof binding.instance !== 'string' || typeof binding.userId !== 'string') {
      throw failure('WORK_DATA_INVALID', '工作資料格式無效；本機草稿尚未變更。')
    }
    let serialized
    try { serialized = JSON.stringify(row) } catch (error) { throw failure('WORK_DATA_INVALID', '工作資料無法序列化；本機草稿尚未變更。', error) }
    if (typeof serialized !== 'string') throw failure('WORK_DATA_INVALID', '工作資料格式無效；本機草稿尚未變更。')
    let value
    try { value = JSON.parse(serialized) } catch (error) { throw failure('WORK_DATA_INVALID', '工作資料格式無效；本機草稿尚未變更。', error) }
    Object.assign(value, binding, { updatedAt: Date.now(), expiresAt: Math.min(row.expiresAt || Infinity, Date.now() + 7 * 86400000) })
    if (['complete', 'cancelled'].includes(value.status)) { delete value.snapshot; delete value.batches; delete value.history; delete value.sourceRosterEntries; delete value.sourceEvidence; delete value.form; delete value.report; delete value.prefill; delete value.uiState; delete value.mappingView; delete value.reconciliation; delete value.skippedAdmissions }
    if (['complete','cancelled'].includes(value.status)) {
      value.historyBindings=value.historyBindings?.map(b=>({historyId:b.historyId,status:b.status,result:b.result,occurrence:{id:b.occurrence.id,class_session_id:b.occurrence.class_session_id,class_name:b.occurrence.class_name,occurrence_date:b.occurrence.occurrence_date}}))
      delete value.historyUI
    }
    if (value.status === 'pending_confirmation') { delete value.form; delete value.prefill }
    const bytes = encoder.encode(JSON.stringify(value)), chunks = chunksFor(value.id, bytes)
    const header = headerOf(value, bytes.byteLength, chunks.length)
    return transaction(['work', 'payloads'], 'readwrite', async stores => {
      const current = await request(stores.work.get(value.id))
      if (current && (current.instance !== binding.instance || current.userId !== binding.userId)) throw failure('WORK_OWNER_MISMATCH', '這份工作屬於其他 EduLog 實例或使用者。')
      if (current && (current.revision || 0) > (value.revision || 0)) {
        if (!current.__edulogPayload) return current
        return decodePayload(current, await request(stores.payloads.getAll(workRange(value.id))))
      }
      value.expiresAt = Math.min(value.expiresAt, current?.expiresAt || Infinity)
      header.expiresAt = value.expiresAt
      await removePayload(stores.payloads, value.id)
      for (const chunk of chunks) await request(stores.payloads.put(chunk))
      await request(stores.work.put(header))
      return value
    })
  },
  async list(binding) {
    return transaction(['work', 'payloads'], 'readwrite', async stores => {
      const rows = await request(stores.work.getAll()), payloadRows = await request(stores.payloads.getAll())
      const byWork = new Map()
      for (const row of payloadRows) { const group = byWork.get(row.workId) || []; group.push(row); byWork.set(row.workId, group) }
      const result = []
      for (const header of rows) {
        if (header.expiresAt <= Date.now()) { await removePayload(stores.payloads, header.id); await request(stores.work.delete(header.id)); continue }
        if (header.instance !== binding.instance || header.userId !== binding.userId) continue
        result.push(header.__edulogPayload ? await decodePayload(header, byWork.get(header.id) || []) : header)
      }
      return result
    })
  },
}
