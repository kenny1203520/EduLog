// This module is imported only by the trusted extension service worker.
let database
let opening
let generation = 0
const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
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
    const open = indexedDB.open('edulog-integration-work', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('work', { keyPath: 'id' })
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
    open.onerror = () => reject(open.error || new Error('本機工作資料庫無法開啟。'))
  })
  try { return await opening } finally { opening = null }
}
async function transaction(mode, operation) {
  let tx
  try { tx = (await db()).transaction('work', mode) }
  catch (error) {
    if (error?.name !== 'InvalidStateError' && error?.name !== 'TransactionInactiveError') throw error
    const stale = database
    if (stale) invalidate(stale.connection, stale.generation)
    // Retry only before a transaction exists. A write that has started must
    // be resolved through its idempotency checkpoint, never replayed here.
    tx = (await db(true)).transaction('work', mode)
  }
  const complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error || new Error('本機工作資料庫交易失敗。')) })
  try { const result = await operation(tx.objectStore('work')); await complete; return result }
  catch (error) { try { tx.abort() } catch { /* It may have already completed. */ } await complete.catch(() => {}); throw error }
}
export const workStore = {
  async purge() {
    const rows = await transaction('readonly', store => request(store.getAll()))
    const expired = rows.filter(row => row.expiresAt <= Date.now())
    if (expired.length) await transaction('readwrite', store => Promise.all(expired.map(row => request(store.delete(row.id)))))
  },
  async get(id, binding) {
    const row = await transaction('readonly', store => request(store.get(id)))
    if (!row || row.instance !== binding.instance || row.userId !== binding.userId || row.expiresAt <= Date.now()) return null
    return row
  },
  async put(row, binding) {
    if (!row || typeof row.id !== 'string' || row.id.length > 80 || JSON.stringify(row).length > 4_000_000) throw new Error('工作資料格式或大小不正確。')
    const value = { ...row, ...binding, updatedAt: Date.now(), expiresAt: Math.min(row.expiresAt || Infinity, Date.now() + 7 * 86400000) }
    if (['complete', 'cancelled'].includes(value.status)) { delete value.snapshot; delete value.batches; delete value.history; delete value.sourceRosterEntries; delete value.sourceEvidence; delete value.form; delete value.report; delete value.prefill; delete value.uiState; delete value.mappingView; delete value.reconciliation; delete value.skippedAdmissions }
    if (['complete','cancelled'].includes(value.status)) {
      value.historyBindings=value.historyBindings?.map(b=>({historyId:b.historyId,status:b.status,result:b.result,occurrence:{id:b.occurrence.id,class_session_id:b.occurrence.class_session_id,class_name:b.occurrence.class_name,occurrence_date:b.occurrence.occurrence_date}}))
      delete value.historyUI
    }
    if (value.status === 'pending_confirmation') { delete value.form; delete value.prefill }
    return transaction('readwrite', async store => {
      const current = await request(store.get(value.id))
      if (current && (current.instance !== binding.instance || current.userId !== binding.userId)) throw new Error('工作不屬於此實例或使用者。')
      if (current && (current.revision || 0) > (value.revision || 0)) return current
      value.expiresAt = Math.min(value.expiresAt, current?.expiresAt || Infinity)
      await request(store.put(value)); return value
    })
  },
  async list(binding) {
    const rows = await transaction('readonly', store => request(store.getAll()))
    const expired = rows.filter(row => row.expiresAt <= Date.now())
    if (expired.length) await transaction('readwrite', store => Promise.all(expired.map(row => request(store.delete(row.id)))))
    return rows.filter(row => row.expiresAt > Date.now() && row.instance === binding.instance && row.userId === binding.userId)
  },
}
