// Pure view models for the import steps. No DOM; tested in tests/workspace-steps.test.mjs.

const pad = value => String(value).padStart(2, '0')
export function shortDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : `${date.getMonth() + 1}/${pad(date.getDate())}` }

/**
 * "My classes": open class-page tabs plus classes this browser synced before.
 * One entry per source class id; the current tab's class first.
 */
export function classEntries({ tabs = [], works = [], currentTabId = null } = {}) {
  const byId = new Map()
  const entry = id => byId.get(id) || byId.set(id, { classId: id, path: `/courses/dt/${id}`, title: '', tabId: null, current: false, lastSync: 0, students: 0 }).get(id)
  for (const tab of tabs) {
    const id = String(tab.path || '').match(/^\/courses\/dt\/(\d+)$/)?.[1]
    if (!id) continue
    const row = entry(id)
    if (!row.tabId || tab.id === currentTabId) row.tabId = tab.id
    if (tab.id === currentTabId) row.current = true
    row.title ||= String(tab.title || '').trim()
  }
  for (const work of works) {
    if (work?.type !== 'import') continue
    const id = String(work.sourceClassId || work.snapshot?.classId || '')
    if (!/^\d+$/.test(id)) continue
    const row = entry(id)
    if (!row.title || !row.tabId) row.title = String(work.sourceTitle || work.title || row.title || '').trim()
    const students = (work.snapshot?.records || []).filter(record => record.kind === 'enrollment').length
    if (students) row.students = Math.max(row.students, students)
    if (['complete', 'partial_complete'].includes(work.status)) row.lastSync = Math.max(row.lastSync, Number(work.updatedAt) || 0)
  }
  return [...byId.values()].sort((a, b) => Number(b.current) - Number(a.current) || Number(Boolean(b.tabId)) - Number(Boolean(a.tabId)) || b.lastSync - a.lastSync || a.title.localeCompare(b.title) || a.classId.localeCompare(b.classId))
}

// Fixed order and wording (MASTER §8): 班級不明、配對不到課堂、兩邊都改過、學生未對應、缺少資料; "other" last.
export const GROUPS = ['class', 'occurrence', 'both', 'student', 'missing', 'other']
const GROUP_TONE = { class: 'warn', occurrence: 'warn', both: 'notice', student: 'warn', missing: 'danger', other: 'warn' }
const GROUP_OF = { class: 'class', 'class-other': 'class', 'occurrence-mismatch': 'occurrence', occurrence: 'occurrence', 'same-occurrence': 'occurrence', 'both-changed': 'both', conflict: 'both', 'merge-clear': 'both', enrollment: 'student' }
const AUTO = new Set(['bind', 'linked', 'history'])

/**
 * Only the items that need a decision, grouped by kind. Everything else is counted as
 * automatically matched.
 * - `items`: history plan entries (category 'needs' are exceptions).
 * - `enrollments`: [{ row, valid, skipped, missing: ['start'|'status'|'course'|'studentId'] }].
 * - `classTarget`: { needed, missing } when the source class has no EduLog class yet.
 * - `shown`: keys listed earlier in this work; they stay listed (as resolved) so rows
 *   do not jump away while the teacher is working.
 */
export function exceptionModel({ items = [], enrollments = [], classTarget = null, shown = new Set() } = {}) {
  const groups = Object.fromEntries(GROUPS.map(kind => [kind, []])), waiting = new Map()
  const pendingEnrollments = new Set(enrollments.filter(e => !e.valid && !e.skipped).map(e => e.row.source_id))
  if (classTarget && (classTarget.needed || shown.has('class-target'))) groups.class.push({ key: 'class-target', kind: 'class-target', group: 'class', tone: classTarget.needed ? (classTarget.missing?.length ? 'danger' : 'warn') : 'ok', resolved: !classTarget.needed, missing: classTarget.missing || [] })
  for (const item of items) {
    if (item.category !== 'needs') continue
    const code = item.issues?.[0]?.code || '', kind = GROUP_OF[code] || 'other', record = item.record || {}
    // Reports of an unmatched student wait for that student and are not listed twice.
    if (kind === 'student' && pendingEnrollments.has(record.enrollment_source_id)) { waiting.set(record.enrollment_source_id, (waiting.get(record.enrollment_source_id) || 0) + 1); continue }
    groups[kind].push({ key: item.key, kind: 'report', group: kind, tone: GROUP_TONE[kind], item, name: record.sourceStudentName || item.target?.name || '', date: record.date || record.dateRaw || '', course: item.target?.courseName || record.sourceCourseLabel || '', reason: item.reason || '' })
  }
  for (const entry of enrollments) {
    const key = `enrollment:${entry.row.source_id}`
    if (entry.valid && !shown.has(key)) continue
    if (entry.skipped && !shown.has(key)) continue
    const missing = entry.valid ? [] : entry.missing || []
    const group = missing.length || entry.wasMissing ? 'missing' : 'student'
    groups[group].push({ key, kind: 'enrollment', group, sourceId: entry.row.source_id, row: entry.row, missing, resolved: entry.valid, skipped: entry.skipped, tone: entry.skipped ? 'neutral' : entry.valid ? 'ok' : missing.length ? 'danger' : 'warn', reports: waiting.get(entry.row.source_id) || 0, name: entry.row.sourceStudentName || '' })
  }
  const list = GROUPS.flatMap(kind => groups[kind])
  const open = list.filter(item => !item.resolved && !item.skipped)
  const auto = items.filter(item => AUTO.has(item.category)), attendance = items.filter(item => item.attendanceEvidence)
  const autoStudents = enrollments.filter(e => e.valid && !shown.has(`enrollment:${e.row.source_id}`)).length
  return {
    groups: GROUPS.map(kind => ({ kind, tone: !groups[kind].some(i => !i.resolved && !i.skipped) ? 'ok' : GROUP_TONE[kind], items: groups[kind], open: groups[kind].filter(i => !i.resolved && !i.skipped).length })).filter(group => group.items.length),
    list, total: open.length,
    blocking: open.filter(item => item.kind !== 'report').length,
    missing: open.filter(item => item.group === 'missing' || item.missing?.length).length,
    auto: { students: autoStudents, reports: auto.length, attendance: attendance.length, total: autoStudents + auto.length + attendance.length, rows: [...auto, ...attendance] },
  }
}
