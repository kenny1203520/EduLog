// This module is imported only by the trusted extension service worker.
let database
const request = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
async function db() {
  if (!database) database = new Promise((resolve, reject) => {
    const open = indexedDB.open('edulog-integration-work', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('work', { keyPath: 'id' })
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  return database
}
async function transaction(mode, operation) {
  const tx = (await db()).transaction('work', mode), complete = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error) })
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
    if (['complete', 'cancelled'].includes(value.status)) { delete value.snapshot; delete value.batches; delete value.form; delete value.report; delete value.prefill; delete value.uiState; delete value.mappingView; delete value.reconciliation; delete value.skippedAdmissions }
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
