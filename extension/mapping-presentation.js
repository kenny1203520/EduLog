export const enrollmentStatuses = { regular: '正式', trial: '試聽', completed: '已完成', dropped: '已退選' }
export const statusLabel = value => enrollmentStatuses[value] || '未辨識狀態'
export const shortId = value => String(value || '').slice(0, 8)
export function displayDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '日期未提供'
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? '日期未提供' : new Intl.DateTimeFormat('zh-TW', { timeZone: 'UTC' }).format(date)
}
export const enrollmentLabel = row => `${statusLabel(row.status)} · ${displayDate(row.start_date)} · #${shortId(row.id)}`
export function frontendUrl(settingsUrl, route) {
  try {
    const url = new URL(settingsUrl)
    if (url.username || url.password || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null
    if (!/\/dashboard\/settings\/?$/.test(url.pathname) || !/^\/dashboard\/(student\/[a-f0-9-]+|reports\/[a-f0-9-]+|classrooms\/session\/[a-f0-9-]+)$/.test(route)) return null
    url.pathname = url.pathname.replace(/\/dashboard\/settings\/?$/, '') + route
    url.search = ''; url.hash = ''
    return url.href
  } catch { return null }
}
export function sourceUrl(origin, value) {
  try {
    const url = new URL(value, origin)
    if (url.origin !== origin || url.username || url.password || !/^\/dt_admissions\/\d+(?:\/reports\/\d+)?$/.test(url.pathname)) return null
    url.search = ''; url.hash = ''; return url.href
  } catch { return null }
}
export function sourceName(row) {
  return row.sourceStudentName || row.sourceEvidence?.flatMap(e => e.fields || []).find(f => f.key === 'student_name' && f.text)?.text || `來源報名 #${row.source_id}`
}
export function mergeEvidence(...collections) {
  const entries = new Map()
  for (const e of collections.flat().filter(Boolean)) {
    const key = `${e.sourcePath}:${e.table}:${e.row}`
    const old = entries.get(key)
    entries.set(key, { ...old, ...e, fields: [...new Map([...(old?.fields || []), ...(e.fields || [])].map(f => [f.key, f])).values()] })
  }
  return [...entries.values()]
}
export function scheduleLabel(session = {}) {
  const rules = session.schedule_rules?.length ? session.schedule_rules : session.class_session_schedule_rules?.length ? session.class_session_schedule_rules : session.day_of_week != null && session.start_time && session.end_time ? [{ schedule_kind: 'weekly', ...session }] : []
  const days = ['週日','週一','週二','週三','週四','週五','週六']
  return rules.map(r => {
    const time = r.start_time && r.end_time ? `${r.start_time.slice(0,5)}–${r.end_time.slice(0,5)}` : '時間未提供'
    return `${r.schedule_kind === 'weekly' ? days[r.day_of_week] || '星期未提供' : r.schedule_kind === 'monthly' ? `每月 ${r.day_of_month} 日` : displayDate(r.occurrence_date)} ${time}`
  }).join('、') || '尚未設定時段'
}
export const sessionLabel = session => `${session.name} · ${scheduleLabel(session)} · #${shortId(session.id)}`
export function enrollmentDifferences(enrollment, { student, course, session }) {
  return [enrollment.student_id !== student && '學生不一致', enrollment.class_session_id !== session && '班級不一致', enrollment.course_id !== course && '課程不一致'].filter(Boolean)
}
export function legacyCourse(row, snapshot) {
  return snapshot.extractionVersion !== 2 && (row.sourceEvidence?.some(e => e.fields?.some(f => f.key === 'course_name' && f.label === '年級')) || /^(?:[一二三四五六七八九十]+年級|[國高小大][一二三四五六])$/.test(row.sourceCourseLabel || ''))
}
export function reportMatchesReconciliation(details, { occurrenceId, date, sessionId }) {
  if (!details || details.error || details.next_cursor) return false
  const transfers = (details.transfers || []).filter(t => !t.cancelled_at)
  if (transfers.some(t => !t.source_date || !t.target_date)) return false
  if (transfers.some(t => t.source_occurrence_id === occurrenceId || t.source_date === date && t.source_class_session_id === sessionId)) return false
  const target = transfers.find(t => t.target_occurrence_id === occurrenceId)
  return !target || target.is_effective_target && target.target_date === date && target.target_class_session_id === sessionId
}
