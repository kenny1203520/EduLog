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
    if (!/\/dashboard\/settings\/?$/.test(url.pathname) || !/^\/dashboard\/(student\/[a-f0-9-]+|reports\/[a-f0-9-]+)$/.test(route)) return null
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
