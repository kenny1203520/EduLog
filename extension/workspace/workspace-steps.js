// Three-step import presentation (讀取 → 確認 → 完成). Layout and copy only:
// the data comes from the existing plan, mapping and outcome code.

// Lucide icons (ISC), same paths as docs/design/prototype.
const ICONS = {
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'chev-down': '<path d="m6 9 6 6 6-6"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
}
export function icon(doc, name, className = '') {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', `icon ${className}`.trim())
  svg.innerHTML = ICONS[name] || ''
  return svg
}
/** Replace `[data-icon]` placeholders in static markup with inline SVG. */
export function hydrateIcons(root) {
  for (const slot of root.querySelectorAll('[data-icon]')) { if (!slot.querySelector('svg')) slot.prepend(icon(root.ownerDocument || root, slot.dataset.icon)) }
}

export const entries = {
  'work.connected': ['已連線', 'Connected'],
  'work.stepCompact': ['步驟 {step} / 3 · {label}', 'Step {step} of 3 · {label}'],
  'work.readTitle': ['讀取本班資料', 'Read this class'],
  'work.readHelp': ['從目前分頁讀取學生、報告與出席紀錄，不會修改原站。', 'Reads students, reports and attendance from the current tab. The source site is not changed.'],
  'work.pickTitle': ['選擇要同步的班級', 'Choose a class to sync'],
  'work.pickHelp': ['目前分頁不是班級頁，從我的班級挑一班。', 'The current tab is not a class page. Pick one of your classes.'],
  'work.classList': ['我的班級', 'My classes'],
  'work.classEmpty': ['尚未找到班級。請在原站開啟任一班級頁（/courses/dt/…）後重新整理此頁。', 'No classes found. Open a class page (/courses/dt/…) on the source site, then reload this page.'],
  'work.classId': ['原站班級 #{id}', 'Source class #{id}'],
  'work.classOpen': ['分頁已開啟', 'Tab open'],
  'work.classCurrent': ['目前分頁', 'Current tab'],
  'work.classSynced': ['上次同步 {date}', 'Last synced {date}'],
  'work.classNever': ['尚未同步', 'Not synced yet'],
  'work.classStudents': ['{count} 位學生', '{count} students'],
  'work.readClass': ['讀取 {name}', 'Read {name}'],
  'work.readThis': ['讀取本班資料', 'Read this class'],
  'work.advanced': ['進階設定', 'Advanced settings'],
  'work.confirmTitle': ['確認 {count} 個例外', 'Confirm {count} exceptions'],
  'work.confirmClear': ['沒有需要確認的例外', 'No exceptions to confirm'],
  'work.confirmHelp': ['{name} · 其他資料已自動配對，只需處理下列項目。', '{name} · Everything else was matched automatically. Only the items below need you.'],
  'work.confirmProgress': ['已處理 {done} / {total}', '{done} of {total} handled'],
  'work.confirmNext': ['下一個待確認', 'Next to confirm'],
  'work.autoMatched': ['已自動配對 {count} 筆（報告 {reports}、出席 {attendance}）', '{count} matched automatically ({reports} reports, {attendance} attendance)'],
  'work.autoMore': ['… 還有 {count} 筆', '… {count} more'],
  'work.expand': ['展開', 'Expand'], 'work.collapse': ['收合', 'Collapse'],
  'work.matched': ['已配對', 'Matched'], 'work.historyOnly': ['先存歷史', 'History only'], 'work.attendanceOnly': ['出席證據', 'Attendance'],
  'work.group.class': ['班級不明', 'Class unknown'],
  'work.group.classHelp': ['無法確認這份報告屬於哪個班級。', 'Could not tell which class this report belongs to.'],
  'work.group.occurrence': ['配對不到課堂', 'No matching lesson'],
  'work.group.occurrenceHelp': ['原站日期在 EduLog 沒有唯一對應的課堂。', 'The source date has no single matching lesson in EduLog.'],
  'work.group.both': ['兩邊都改過', 'Changed on both sides'],
  'work.group.bothHelp': ['上次同步後，原站與 EduLog 都有修改。', 'Both the source and EduLog changed since the last sync.'],
  'work.group.student': ['學生未對應', 'Student not matched'],
  'work.group.studentHelp': ['原站學生在 EduLog 找不到對應的報名。', 'The source student has no matching EduLog enrollment.'],
  'work.group.other': ['其他待確認', 'Other items'],
  'work.group.otherHelp': ['日期、欄位或來源內容需要確認。', 'A date, field or source value needs checking.'],
  'work.enrollmentMeta': ['原站報名 #{id}', 'Source enrollment #{id}'],
  'work.enrollmentReports': ['{count} 份報告等待對應', '{count} reports waiting'],
  'work.resolve': ['處理', 'Resolve'],
  'work.detailHeading': ['逐筆處理', 'Item details'],
  'work.backRead': ['上一步', 'Back'],
  'work.backReview': ['返回例外', 'Back to exceptions'],
  'work.reviewSummary': ['檢查同步內容', 'Review changes'],
  'work.summaryTitle': ['確認並同步', 'Confirm and sync'],
  'work.doneTitle': ['同步完成', 'Sync complete'],
  'work.donePartial': ['同步完成，仍有待處理項目', 'Synced; some items still need attention'],
  'work.progressTitle': ['同步進度', 'Sync progress'],
  'work.viewInEdulog': ['在 EduLog 檢視', 'View in EduLog'],
  'work.returnSourceSite': ['回到原站', 'Back to source site'],
}

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

const GROUPS = ['class', 'occurrence', 'both', 'student', 'other']
const GROUP_OF = { class: 'class', 'class-other': 'class', 'occurrence-mismatch': 'occurrence', occurrence: 'occurrence', 'same-occurrence': 'occurrence', 'both-changed': 'both', conflict: 'both', 'merge-clear': 'both', enrollment: 'student' }
const AUTO = new Set(['bind', 'linked', 'history'])

/** Exceptions grouped by kind, plus the auto-matched remainder. */
export function exceptionModel({ items = [], enrollments = [] } = {}) {
  const groups = Object.fromEntries(GROUPS.map(kind => [kind, []])), waiting = new Map()
  for (const item of items) {
    if (item.category !== 'needs') continue
    const code = item.issues?.[0]?.code || '', kind = GROUP_OF[code] || 'other', record = item.record || {}
    // Reports of an unmatched student wait for that student and are not listed twice.
    if (kind === 'student' && enrollments.some(row => row.source_id === record.enrollment_source_id)) { waiting.set(record.enrollment_source_id, (waiting.get(record.enrollment_source_id) || 0) + 1); continue }
    groups[kind].push({ key: item.key, kind: 'report', group: kind, name: record.sourceStudentName || item.target?.name || '', meta: [record.date || record.dateRaw, item.target?.courseName || record.sourceCourseLabel].filter(Boolean).join(' · '), reason: item.reason || '' })
  }
  for (const row of enrollments) groups.student.push({ key: `enrollment:${row.source_id}`, kind: 'enrollment', group: 'student', sourceId: row.source_id, name: row.sourceStudentName || '', meta: '', reports: waiting.get(row.source_id) || 0, reason: '' })
  const auto = items.filter(item => AUTO.has(item.category)), attendance = items.filter(item => item.attendanceEvidence)
  const list = GROUPS.flatMap(kind => groups[kind])
  return { groups: GROUPS.map(kind => ({ kind, items: groups[kind] })).filter(group => group.items.length), list, total: list.length, auto: { reports: auto.length, attendance: attendance.length, rows: [...auto, ...attendance] } }
}

function el(doc, tag, className, text) { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node }
function say(node, key, params = {}) { const ui = globalThis.edulogUi; if (ui) ui.text(node, key, params); else node.textContent = entries[key]?.[0]?.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '') ?? key; return node }

/** Radio list of classes; `onPick(entry)` fires on change. */
export function renderClassList(host, list, { selected, onPick }) {
  const doc = host.ownerDocument
  host.replaceChildren()
  if (!list.length) { host.append(say(el(doc, 'li', 'row class-empty'), 'work.classEmpty')); return }
  for (const item of list) {
    const row = el(doc, 'li', 'row radio-row'), label = el(doc, 'label', 'row-main check'), input = el(doc, 'input'), text = el(doc, 'span'), title = el(doc, 'span', 'row-title', item.title || ''), meta = el(doc, 'span', 'row-meta')
    if (!item.title) say(title, 'work.classId', { id: item.classId })
    input.type = 'radio'; input.name = 'source-class'; input.value = item.classId; input.checked = item.classId === selected
    row.dataset.classId = item.classId; row.dataset.selected = String(input.checked)
    const parts = [say(el(doc, 'span'), 'work.classId', { id: item.classId })]
    if (item.students) parts.push(say(el(doc, 'span'), 'work.classStudents', { count: item.students }))
    if (item.tabId && !item.current) parts.push(say(el(doc, 'span'), 'work.classOpen'))
    parts.forEach((part, index) => { if (index) meta.append(' · '); meta.append(part) })
    text.append(title, meta); label.append(input, text)
    const tag = el(doc, 'span', `tag ${item.current ? 'tag-info' : item.lastSync ? 'tag-ok' : 'tag-neutral'}`)
    if (item.current) say(tag, 'work.classCurrent'); else if (item.lastSync) say(tag, 'work.classSynced', { date: shortDate(item.lastSync) }); else say(tag, 'work.classNever')
    input.addEventListener('change', () => { if (input.checked) onPick(item) })
    row.append(label, tag); host.append(row)
  }
}

/** The 確認 summary: grouped exceptions with next-issue navigation. */
export function renderConfirmOverview(host, model, { className = '', handled = 0, autoOpen = false, onToggleAuto, onResolve, autoLabel }) {
  const doc = host.ownerDocument
  host.replaceChildren()
  const head = el(doc, 'div', 'panel-head'), titles = el(doc, 'div'), h2 = el(doc, 'h2'), sub = el(doc, 'p', 'sub')
  if (model.total) say(h2, 'work.confirmTitle', { count: model.total }); else say(h2, 'work.confirmClear')
  say(sub, 'work.confirmHelp', { name: className })
  titles.append(h2, sub); head.append(titles)
  if (model.total) {
    const nav = el(doc, 'div', 'issue-nav'), progress = el(doc, 'span'), next = el(doc, 'button', 'btn btn-secondary btn-sm')
    say(progress, 'work.confirmProgress', { done: handled, total: handled + model.total })
    next.type = 'button'; next.id = 'confirm-next'; next.append(say(el(doc, 'span'), 'work.confirmNext'), icon(doc, 'chev-down'))
    next.addEventListener('click', () => { const rows = [...host.querySelectorAll('[data-exception-key]')], index = rows.findIndex(row => row.dataset.current === 'true'), target = rows[(index + 1) % rows.length]; if (!target) return; rows.forEach(row => { row.dataset.current = String(row === target) }); target.scrollIntoView({ block: 'center' }); target.querySelector('button')?.focus({ preventScroll: true }) })
    nav.append(progress, next); head.append(nav)
  }
  host.append(head)
  const total = model.auto.reports + model.auto.attendance
  const line = el(doc, 'div', 'summary-line'), lineText = el(doc, 'span')
  say(lineText, 'work.autoMatched', { count: total, reports: model.auto.reports, attendance: model.auto.attendance })
  line.append(icon(doc, 'check-circle'), lineText)
  if (total) {
    const toggle = el(doc, 'button', 'btn btn-ghost btn-sm'); toggle.type = 'button'; toggle.id = 'auto-matched-toggle'; toggle.setAttribute('aria-expanded', String(autoOpen))
    toggle.append(say(el(doc, 'span'), autoOpen ? 'work.collapse' : 'work.expand'), icon(doc, 'chev-down', autoOpen ? 'flip' : ''))
    toggle.addEventListener('click', () => onToggleAuto(!autoOpen)); line.append(toggle)
  }
  host.append(line)
  if (autoOpen && total) {
    const list = el(doc, 'ul', 'list auto-list'), limit = 20
    for (const item of model.auto.rows.slice(0, limit)) {
      const row = el(doc, 'li', 'row'), main = el(doc, 'div', 'row-main'), record = item.record || {}
      main.append(el(doc, 'div', 'row-title', record.sourceStudentName || item.target?.name || ''), el(doc, 'div', 'row-meta', [record.date || record.dateRaw, item.target?.courseName || record.sourceCourseLabel].filter(Boolean).join(' · ')))
      const tag = el(doc, 'span', `tag ${item.attendanceEvidence ? 'tag-neutral' : 'tag-ok'}`); say(tag, autoLabel(item))
      row.append(main, tag); list.append(row)
    }
    if (model.auto.rows.length > limit) list.append(say(el(doc, 'li', 'row row-meta'), 'work.autoMore', { count: model.auto.rows.length - limit }))
    host.append(list)
  }
  for (const group of model.groups) {
    const box = el(doc, 'div', 'group'), headRow = el(doc, 'div', 'group-head'), why = el(doc, 'span', 'gh-sub'), count = el(doc, 'span', 'count', String(group.items.length))
    box.dataset.group = group.kind
    headRow.append(el(doc, 'span', `dot dot-${group.kind === 'both' ? 'notice' : 'warn'}`), say(el(doc, 'span'), `work.group.${group.kind}`), why, count)
    say(why, `work.group.${group.kind}Help`)
    const list = el(doc, 'ul', 'list')
    for (const item of group.items) {
      const row = el(doc, 'li', 'row'), main = el(doc, 'div', 'row-main'), title = el(doc, 'div', 'row-title', item.name), meta = el(doc, 'div', 'row-meta')
      row.dataset.bar = group.kind === 'both' ? 'notice' : 'warn'; row.dataset.exceptionKey = item.key
      if (!item.name) say(title, 'work.enrollmentMeta', { id: item.sourceId || '' })
      if (item.kind === 'enrollment') { say(meta, item.reports ? 'work.enrollmentReports' : 'work.enrollmentMeta', item.reports ? { count: item.reports } : { id: item.sourceId }) }
      else meta.textContent = [item.meta, item.reason].filter(Boolean).join(' · ')
      main.append(title, meta)
      const actions = el(doc, 'div', 'row-actions'), resolve = el(doc, 'button', 'btn btn-secondary btn-sm'); resolve.type = 'button'
      say(resolve, 'work.resolve'); resolve.addEventListener('click', () => onResolve(item)); actions.append(resolve)
      row.append(main, actions); list.append(row)
    }
    box.append(headRow, list); host.append(box)
  }
}
