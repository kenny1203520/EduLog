import '../shared/field-mappings.js'
export const labels = { student: '學生', course: '課程', class_session: '班級', enrollment: '報名', occurrence: '課次', history_report: '歷史報告', report: '課次報告', added: '新增', updated: '更新', unchanged: '無變更', conflict: '保留 EduLog', needs: '需處理' }
/** Start a new reconciliation without altering the committed job or its keys. */
export function retryHistoryWork(previous) {
  const next=structuredClone(previous)
  for(const key of ['jobId','batches','batchCount','appliedBatchKeys','batchSummaries','serverImportSummary','historyBindings','historySummary','needs','blockedRows','rosterChecks','rosterVerification','rosterCheckError','revision','updatedAt'])delete next[key]
  Object.assign(next,{id:crypto.randomUUID(),parentWorkId:previous.id,status:'collected',done:0,previewDirty:true})
  if(next.history)next.history={paths:next.snapshot.admissionPaths||next.history.paths,next:0}
  return next
}
const rowIdentity = row => row.record?.kind && row.source_id != null ? `${row.record.kind}:${row.source_id}` : null
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort((left, right) => left.localeCompare(right, 'en')).map(key => [key, item[key]])) : item)
function duplicateError(row) {
  const error = new Error(`${labels[row.record.kind] || row.record.kind}來源 ID ${row.source_id} 有不同內容，請補讀來源並核對此筆後重新產生差異。`)
  error.code = 'SOURCE_ID_CONFLICT'
  return error
}
export function validateBatches(batches) {
  const seen = new Set()
  for (const batch of batches) for (const row of batch.rows) {
    const identity = rowIdentity(row)
    if (identity && seen.has(identity)) {
      const error = new Error(`${labels[row.record.kind] || row.record.kind}來源 ID ${row.source_id} 在匯入批次中重複。未寫入的工作可重新產生差異；已有寫入檢查點時請先核對續傳狀態。`)
      error.code = 'DUPLICATE_SOURCE_IDS'; throw error
    }
    if (identity) seen.add(identity)
  }
}
/** Project local batch state onto the strict import API contract. */
export function importBatchRequest(batch) {
  if (!batch || typeof batch.key !== 'string' || !Array.isArray(batch.rows)) {
    const error = new Error('匯入批次資料不完整，請重新核對工作草稿。')
    error.code = 'IMPORT_BATCH_INVALID'
    throw error
  }
  const request = { key: batch.key, rows: batch.rows }
  if (batch.dependencies !== undefined) request.dependencies = batch.dependencies
  return request
}
export function splitBatches(rows, limit = 180000) {
  const batches = []; let current = []
  const bytes = value => new TextEncoder().encode(JSON.stringify({ key: '00000000-0000-4000-8000-000000000000', rows: value })).byteLength
  const unique = [], identities = new Map()
  for (const row of rows) {
    const identity = rowIdentity(row), previous = identity && identities.get(identity)
    if (previous) { if (canonical(previous) !== canonical(row)) throw duplicateError(row); continue }
    unique.push(row); if (identity) identities.set(identity, row)
  }
  // Reserve dependencies before walking source order: an earlier admission must
  // not be emitted and then reused when its student appears later.
  const membership = new Map(), students = new Map()
  for (const row of unique) if (row.record?.kind === 'student' && row.target_id) {
    if (!students.has(row.target_id)) students.set(row.target_id, [])
    students.get(row.target_id).push(row)
  }
  for (const [target, members] of students) {
    const enrollment = unique.find(row => row.record?.kind === 'enrollment' && row.record.data.student_id === target)
    const group = enrollment ? [...members, enrollment] : members
    group.forEach(row => membership.set(row, group))
  }
  const groups = [], used = new Set()
  for (const row of unique) {
    const group = membership.get(row) || [row]
    if (used.has(group[0])) continue
    group.forEach(member => used.add(member)); groups.push(group)
  }
  for (const group of groups) {
    if (group.length > 50 || bytes(group) > limit) throw new Error('單筆資料或學生／報名組合超過批次筆數或請求大小限制，請縮短文字或核對對應。')
    if (current.length + group.length > 50 || bytes([...current, ...group]) > limit) { batches.push({ key: crypto.randomUUID(), rows: current }); current = [] }
    current.push(...group)
  }
  if (current.length) batches.push({ key: crypto.randomUUID(), rows: current })
  validateBatches(batches)
  return batches
}
export function workspaceErrorMessage(error) {
  if (error.code === 'SOURCE_PATH_CONTRACT_UNSUPPORTED') return globalThis.edulogUi?.t('error.reportPagePathServerUpgrade') || '伺服器尚未接受報告頁來源路徑。草稿、批次與檢查點已保留；請更新 API 並套用 migration 1000140，再重新預覽。'
  if (error.code === 'WORK_CONFLICT') return globalThis.edulogUi?.t('error.workConflict') || '工作已在其他分頁更新；目前草稿保留，請重新載入後核對。'
  if (error.code === 'WORK_DATA_INVALID') return globalThis.edulogUi?.t('error.workDataInvalid') || error.message
  if (error.code === 'WORK_STORAGE_FULL') return globalThis.edulogUi?.t('error.workStorageFull') || error.message
  if (error.code === 'WORK_DATA_CORRUPT') return globalThis.edulogUi?.t('error.workDataCorrupt') || error.message
  if (error.code === 'WORK_SAVE_FAILED') return globalThis.edulogUi?.t('error.workSaveFailed') || error.message
  if (error.code === 'WORK_OWNER_MISMATCH') return globalThis.edulogUi?.t('error.workOwnerMismatch') || error.message
  if (error.code === 'IMPORT_DEPENDENCIES_UNAVAILABLE') return globalThis.edulogUi?.t('error.importDependenciesUnavailable') || '目前連線的 EduLog 尚不能安全核對跨批次報名關係。請重新檢查連線後重試；待處理資料仍保留。'
  if (error.code === 'VERSION_CONFLICT') return '對應或目標已變更。請按「重新檢查對應記憶」，核對後再確認。'
  if (error.code === 'VALIDATION_FAILED') {
    const details = Object.values(error.fields || {}).flat()
    if (details.includes('Duplicate source IDs')) return '匯入資料含有重複來源 ID。請重新產生差異；目前輸入與對應仍保留。'
    return '送出的資料未通過驗證。請核對目前資料後重試；詳細原因可在診斷中查看。'
  }
  return error.message || '無法完成操作。'
}
export function isUnsupportedReportEvidencePathValidation(error, rows = []) {
  if (error?.code !== 'VALIDATION_FAILED') return false
  const supportedPath = /^\/(?:dt_admissions\/\d+(?:\/reports\/\d+\/edit)?|courses\/dt\/\d+(?:\/lesson_reports|\/lesson-reports)?)$/
  return Object.keys(error.fields || {}).some(key => {
    const match = /^rows\.(\d+)\.record\.data\.source_evidence\.(\d+)\.source_path$/.exec(key)
    if (!match) return false
    const path = rows[Number(match[1])]?.record?.data?.source_evidence?.[Number(match[2])]?.source_path
    return typeof path === 'string' && supportedPath.test(path)
  })
}
export function plainText(value, doc = document) {
  if (typeof value !== 'string') return ''
  if (!/<\/?[a-z][^>]*>/i.test(value)) return value
  const template = doc.createElement('template'); template.innerHTML = value
  template.content.querySelectorAll('script,style').forEach(n => n.remove())
  template.content.querySelectorAll('p,div,li,h1,h2,h3,br').forEach(n => n.append(doc.createTextNode('\n')))
  return template.content.textContent.replace(/\n{3,}/g, '\n\n').trim()
}
export function suggestedValue(field, report, rules = []) {
  return globalThis.edulogFieldMappings.suggest(field,report,rules)
}
