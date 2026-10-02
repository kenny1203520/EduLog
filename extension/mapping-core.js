// Source labels are rules, never source IDs. Unknown labels remain admission-specific.
export function courseIdentity(row) {
  if (row.source_course_id) return `id:${row.source_course_id}`
  const label = (row.sourceCourseLabel || '').trim().replace(/\s+/g, ' ')
  return label ? `label:${label}` : `missing:${row.source_id}`
}
export function admissionIdentity(row) { return JSON.stringify([row.student_source_id || null,courseIdentity(row)]) }
export function groupCourses(records) {
  const groups = new Map()
  for (const row of records.filter(r => r.kind === 'enrollment')) {
    const key = courseIdentity(row)
    if (!groups.has(key)) groups.set(key, { key, label: row.sourceCourseLabel || '課程尚未辨識', sourceId: row.source_course_id || null, rows: [] })
    groups.get(key).rows.push(row)
  }
  return [...groups.values()]
}
export function rankCandidates(rows, name, label = r => r.name) {
  const exact = value => String(value || '').trim() === String(name || '').trim()
  return [...rows].sort((a,b) => Number(exact(label(b))) - Number(exact(label(a))) || String(label(a)).localeCompare(String(label(b)), 'zh-Hant') || a.id.localeCompare(b.id))
}
export function mergeRecords(existing, incoming) {
  const records = new Map(existing.map(r => [`${r.kind}:${r.source_id}`, r]))
  for (const row of incoming) {
    const key = `${row.kind}:${row.source_id}`, old = records.get(key)
    if (!old) records.set(key,row)
    else records.set(key, { ...old, ...Object.fromEntries(Object.entries(row).filter(([,v]) => v != null && v !== '')), data: { ...old.data, ...row.data } })
  }
  return [...records.values()]
}
