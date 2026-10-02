export const labels = { student: '學生', course: '課程', class_session: '班級', enrollment: '報名', occurrence: '課次', report: '報告', added: '新增', updated: '更新', unchanged: '無變更', conflict: '保留 EduLog', needs: '需處理' }
export function splitBatches(rows, limit = 180000) {
  const batches = []; let current = []
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength
  const groups = [], used = new Set()
  for (const row of rows) {
    if (used.has(row)) continue
    const enrollment = row.record?.kind === 'student' ? rows.find(r => r.record?.kind === 'enrollment' && r.record.data.student_id === row.target_id) : null
    const group = enrollment ? [row, enrollment] : [row]; group.forEach(r => used.add(r)); groups.push(group)
  }
  for (const group of groups) {
    if (bytes(group) > limit - 100) throw new Error('單筆資料或學生／報名組合超過請求大小限制，請縮短文字。')
    if (current.length + group.length > 50 || bytes([...current, ...group]) > limit) { batches.push({ key: crypto.randomUUID(), rows: current }); current = [] }
    current.push(...group)
  }
  if (current.length) batches.push({ key: crypto.randomUUID(), rows: current })
  return batches
}
export function plainText(value, doc = document) {
  if (typeof value !== 'string') return ''
  if (!/<\/?[a-z][^>]*>/i.test(value)) return value
  const template = doc.createElement('template'); template.innerHTML = value
  template.content.querySelectorAll('script,style').forEach(n => n.remove())
  template.content.querySelectorAll('p,div,li,h1,h2,h3,br').forEach(n => n.append(doc.createTextNode('\n')))
  return template.content.textContent.replace(/\n{3,}/g, '\n\n').trim()
}
export function suggestedValue(field, report) {
  const value = report[field.key]
  if (field.type === 'text') return typeof value === 'string' ? value : ''
  if (field.key === 'attendance_status') return field.options.find(o => o.label === ({ present: '出席', absent: '不出席' })[value])?.value || ''
  // Rating conversion is only used when the native option is present. The user
  // still reviews it before applying; lesson IDs never match by label alone.
  if (['class_participation', 'classroom_behavior'].includes(field.key) && Number.isFinite(value)) return field.options.find(o => Number(o.value) === value * 2 && /^[1-9]$|^10$/.test(o.value))?.value || ''
  return ''
}
