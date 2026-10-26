// Step 2 確認: only the exceptions, grouped by kind, each decided inline
// (對應既有 / 新建). Decisions are written into the mapping controller's own
// controls (ids in the 進階 drawer), so validation and saving stay in
// mapping-controller.js / workspace.js.
import { h, list, icon } from '../../shared/render.js'
import { say, tr } from './strings.js'
import { exceptionModel } from './model.js'
import { openDrawer, closeDrawer, isDrawerOpen } from './drawer.js'

const $ = id => document.getElementById(id)
const options = select => [...(select?.options || [])]
const hasOption = (select, value) => options(select).some(option => option.value === value)

/** Set a controller control and fire the events its listeners expect. */
export function setControl(node, value) {
  if (!node) return
  if (node.type === 'checkbox') node.checked = Boolean(value); else node.value = value
  node.dispatchEvent(new Event('input', { bubbles: true }))
  node.dispatchEvent(new Event('change', { bubbles: true }))
}

function mirror(source, { key, placeholder, skip = [], rename = {}, label, onChange, invalid = false, ctl }) {
  const select = h('select', { class: ['select', invalid && 'input-danger'], dataset: { ctl } })
  if (label) say(select, label, {}, 'aria-label')
  if (placeholder) select.append(say(h('option', { value: '' }), placeholder))
  for (const option of options(source)) {
    if (!option.value || skip.includes(option.value)) continue
    const copy = h('option', { value: option.value }, option.textContent)
    if (rename[option.value]) say(copy, rename[option.value])
    select.append(copy)
  }
  select.value = hasOption(select, source?.value) ? source.value : ''
  select.addEventListener('change', () => onChange(select.value))
  void key
  return select
}

function seg(choice, { mapKey = 'ws.mapExisting', newKey = 'ws.createNew', onMap, onNew, newDisabled = false, newTitle = '', mapDisabled = false }) {
  const group = h('div', { class: 'seg', role: 'group' })
  say(group, 'ws.choice', {}, 'aria-label')
  const map = h('button', { type: 'button', 'aria-pressed': String(choice === 'map'), disabled: mapDisabled, dataset: { ctl: 'seg-map' }, onclick: onMap }, icon('link'), say(h('span'), mapKey))
  const create = h('button', { type: 'button', 'aria-pressed': String(choice === 'new'), disabled: newDisabled, title: newTitle || null, dataset: { ctl: 'seg-new' }, onclick: onNew }, icon('plus'), say(h('span'), newKey))
  group.append(map, create)
  return group
}

// Changing the student, course or enrollment clears the controller's review box. A new
// enrollment chosen here is the teacher's explicit confirmation, so it is ticked again.
function keepReview(id) { if ($(`enrollment-${id}`)?.value === 'new' && !$(`review-${id}`)?.checked) setControl($(`review-${id}`), true) }
const err = (key, params, id) => h('p', { class: 'err', id }, icon('circle-alert'), say(h('span'), key, params))
const errText = (text, id) => h('p', { class: 'err', id }, icon('circle-alert'), h('span', {}, text))

export function createConfirmView(hooks) {
  const shownByWork = new Map(), missingByWork = new Map()
  let autoOpen = false, selected = '', frame = 0, model = null

  const work = () => hooks.work()
  const controller = () => hooks.controller()
  const records = () => work()?.snapshot?.records || []
  const enrollmentRows = () => records().filter(row => row.kind === 'enrollment')
  const studentSelect = row => controller().studentSelect(row)
  const nameOf = row => row.sourceStudentName || records().find(x => x.kind === 'student' && x.source_id === row.student_source_id)?.data?.name || ''
  const firstLesson = row => records().filter(x => x.kind === 'report' && x.enrollment_source_id === row.source_id && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '')).map(x => x.date).sort()[0] || ''
  const nextOccurrence = () => {
    const session = $('class-session')?.value, today = new Date().toISOString().slice(0, 10)
    const dates = (hooks.context()?.occurrences || []).filter(o => o.class_session_id === session).map(o => o.occurrence_date).filter(Boolean).sort()
    return dates.find(date => date >= today) || dates.at(-1) || ''
  }
  const shown = () => { const id = work()?.id; if (!shownByWork.has(id)) shownByWork.set(id, new Set()); return shownByWork.get(id) }
  const missingSeen = () => { const id = work()?.id; if (!missingByWork.has(id)) missingByWork.set(id, new Set()); return missingByWork.get(id) }

  function choiceOf(row) {
    if ((work()?.skippedAdmissions || []).includes(row.source_id)) return 'skip'
    const student = studentSelect(row)?.value
    if (student === 'new') return 'new'
    if (student) return 'map'
    return $(`enrollment-${row.source_id}`)?.dataset.inlineChoice || ''
  }

  function enrollmentEntry(row) {
    const id = row.source_id, skipped = (work()?.skippedAdmissions || []).includes(id)
    let valid = false
    try { valid = !skipped && controller().validateRow(row, true) } catch { valid = false }
    const missing = []
    const choice = choiceOf(row)
    if (!skipped && !valid) {
      if (!$(`start-${id}`)?.value) missing.push('start')
      if (!$(`status-${id}`)?.value) missing.push('status')
      if (choice && !$(`enrollment-course-${id}`)?.value) missing.push('course')
      if (choice === 'new' && !row.student_source_id) missing.push('studentId')
    }
    if (missing.length) missingSeen().add(id)
    return { row, valid, skipped, missing, choice, wasMissing: missingSeen().has(id) }
  }

  function classTarget() {
    const session = $('class-session')?.value || ''
    if (session && session !== 'new') return { needed: false }
    if (session === 'new') {
      const missing = ['session-name', 'session-start', 'session-day', 'session-from', 'session-to'].filter(id => !$(id)?.value)
      if (!missing.length && $('session-from').value < $('session-to').value) return { needed: false, creating: true }
      return { needed: true, missing: missing.length ? missing : ['session-to'], creating: true }
    }
    return { needed: true, missing: [] }
  }

  function compute() {
    if (!work()?.snapshot) return null
    const enrollments = enrollmentRows().map(enrollmentEntry)
    const target = classTarget()
    const next = exceptionModel({ items: hooks.plan(), enrollments, classTarget: target, shown: shown() })
    for (const item of next.list) { shown().add(item.key); if (item.kind === 'enrollment') item.name = nameOf(item.row) }
    next.enrollments = enrollments; next.target = target
    return next
  }

  /* ---------- Rows ---------- */
  function rowShell(item, title, meta, body, { detail = true } = {}) {
    const node = h('div', { class: 'ex', 'data-tone': item.tone, 'data-exception-key': item.key, 'aria-selected': selected === item.key ? 'true' : null })
    const head = h('div', { class: 'ex-top' }, h('div', { class: 'row-main' }, title, meta))
    if (item.resolved) head.append(say(h('span', { class: 'tag tag-ok' }), 'ws.resolved'))
    if (item.skipped) head.append(say(h('span', { class: 'tag tag-neutral' }), 'ws.skipped'))
    if (detail) {
      const button = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { ctl: 'detail' }, onclick: () => hooks.openDetail(item) }, say(h('span'), item.kind === 'report' ? 'ws.resolveReport' : 'ws.details'), icon('chev-right'))
      say(button, 'ws.detailsFor', { name: item.name || '' }, 'aria-label')
      head.append(button)
    }
    node.append(head, ...body.filter(Boolean))
    return node
  }

  function prefillLine(row, entry, { creating }) {
    const id = row.source_id, statusSource = $(`status-${id}`), startSource = $(`start-${id}`), courseSource = $(`enrollment-course-${id}`)
    const line = h('div', { class: 'prefill' }, say(h('span'), 'ws.newEnrollment'))
    const status = mirror(statusSource, { placeholder: 'ws.status', label: 'ws.status', ctl: 'status', invalid: entry.missing.includes('status'), onChange: value => { setControl(statusSource, value); hooks.changed() } })
    line.append(h('label', {}, say(h('span'), 'ws.status'), status))
    const start = h('input', { type: 'date', class: ['input', entry.missing.includes('start') && 'input-danger'], value: startSource?.value || '', dataset: { ctl: 'start' }, 'aria-invalid': entry.missing.includes('start') ? 'true' : null, 'aria-describedby': entry.missing.includes('start') ? `ex-err-${id}` : null })
    start.addEventListener('change', () => { setControl(startSource, start.value); hooks.changed() })
    line.append(h('label', {}, say(h('span'), 'ws.startDate'), start))
    if (entry.missing.includes('course') || !courseSource?.value) {
      const course = mirror(courseSource, { placeholder: 'ws.pickCourse', label: 'ws.courseLabel', ctl: 'course', invalid: entry.missing.includes('course'), onChange: value => { setControl(courseSource, value); keepReview(id); hooks.changed() } })
      line.append(h('label', {}, say(h('span'), 'ws.courseLabel'), course))
    }
    if (entry.missing.includes('start')) {
      const suggestion = firstLesson(row) || nextOccurrence()
      if (suggestion) line.append(h('button', { type: 'button', class: 'btn btn-soft btn-sm', dataset: { ctl: 'fix-start' }, onclick: () => { setControl(startSource, suggestion); hooks.changed() } }, icon('calendar'), say(h('span'), 'ws.useDate', { date: suggestion })))
    } else if (missingSeen().has(id)) line.append(h('span', { class: 'tag tag-ok' }, icon('check'), say(h('span'), 'ws.fixed')))
    else line.append(say(h('span', { class: 'tag tag-neutral' }), 'ws.autoRemember'))
    return line
  }

  function createEnrollment(row) {
    const id = row.source_id, student = studentSelect(row), enrollment = $(`enrollment-${id}`), course = $(`enrollment-course-${id}`)
    if (row.student_source_id && hasOption(student, 'new')) setControl(student, 'new')
    else if (!student?.value) { hooks.notice(tr('ws.missingStudentId'), true); return }
    const fallback = controller().courseFor(row)
    if (!course.value && fallback && hasOption(course, fallback)) setControl(course, fallback)
    if (hasOption(enrollment, 'new')) setControl(enrollment, 'new')
    if (!$(`status-${id}`).value) setControl($(`status-${id}`), 'regular')
    if (!$(`start-${id}`).value) { const date = firstLesson(row); if (date) setControl($(`start-${id}`), date) }
    setControl($(`review-${id}`), true)
    hooks.changed()
  }

  function mapEnrollment(row) {
    const id = row.source_id, student = studentSelect(row), enrollment = $(`enrollment-${id}`)
    if (student?.value === 'new') setControl(student, '')
    enrollment.dataset.inlineChoice = 'map'
    if (options(student).filter(option => option.value && option.value !== 'new').length === 0) hooks.queryStudents(row)
    hooks.changed()
  }

  function enrollmentRow(item, entry) {
    const row = item.row, id = row.source_id, choice = entry.choice
    const title = h('span', { class: 'row-name' }, h('span', { 'data-source-raw': '' }, nameOf(row) || `${tr('ws.detail.enrollment')} #${id}`))
    const metaParts = [row.sourceCourseLabel, row.data?.start_date && `${tr('ws.detail.start')} ${row.data.start_date}`, firstLesson(row) && `${tr('ws.metaFirst')} ${firstLesson(row).slice(5).replace('-', '/')}`].filter(Boolean)
    const meta = h('span', { class: 'row-meta', 'data-source-raw': '' }, metaParts.join(' · '))
    if (item.skipped) return rowShell(item, title, meta, [h('div', { class: 'ex-choice' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { hooks.restore(row); } }, icon('rotate'), say(h('span'), 'ws.restore')))])
    const session = $('class-session')?.value
    const student = studentSelect(row), enrollment = $(`enrollment-${id}`)
    const canNew = Boolean(row.student_source_id && hasOption(student, 'new') || student?.value === 'new')
    const body = []
    const choiceRow = h('div', { class: 'ex-choice' }, seg(choice, {
      onMap: () => mapEnrollment(row), onNew: () => createEnrollment(row),
      newDisabled: !canNew, newTitle: !row.student_source_id ? tr('ws.missingStudentId') : !session ? tr('ws.needClassFirst') : '',
      mapDisabled: !session,
    }))
    if (!session) choiceRow.append(say(h('span', { class: 'caption' }), 'ws.needClassFirst'))
    body.push(choiceRow)
    if (choice === 'map') {
      choiceRow.append(mirror(student, { placeholder: 'ws.pickStudent', skip: ['new'], label: 'ws.studentLabel', ctl: 'student', onChange: value => { setControl(student, value); hooks.changed() } }))
      if (student?.value) {
        const enrollmentChoices = options(enrollment).filter(option => option.value)
        if (enrollmentChoices.length) choiceRow.append(mirror(enrollment, { placeholder: 'ws.pickEnrollment', label: 'ws.enrollmentLabel', ctl: 'enrollment', rename: { new: 'ws.newEnrollmentOption' }, onChange: value => { setControl(enrollment, value); if (value === 'new') setControl($(`review-${id}`), true); hooks.changed() } }))
        const query = $(`more-enrollments-${id}`)
        if (query && !query.disabled) choiceRow.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { ctl: 'query' }, onclick: () => { query.click(); hooks.changed() } }, icon('search'), say(h('span'), 'ws.queryEnrollments')))
        if (!entry.valid && enrollment?.value) choiceRow.append(h('button', { type: 'button', class: 'btn btn-secondary btn-sm', dataset: { ctl: 'confirm' }, onclick: () => hooks.confirmAdmission(row) }, icon('check'), say(h('span'), 'ws.confirmMatch')))
        else if (entry.valid) choiceRow.append(h('span', { class: 'tag tag-ok' }, icon('check'), say(h('span'), 'ws.matchConfirmed')))
      } else choiceRow.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', dataset: { ctl: 'query-students' }, onclick: () => hooks.queryStudents(row) }, icon('search'), say(h('span'), 'ws.queryStudents')))
      if (enrollment?.value === 'new') body.push(prefillLine(row, entry, { creating: false }))
    }
    if (choice === 'new') body.push(prefillLine(row, entry, { creating: true }))
    if (!choice && entry.missing.length) body.push(prefillLine(row, entry, { creating: true }))
    for (const missing of entry.missing) body.push(err(`ws.missing${missing[0].toUpperCase()}${missing.slice(1)}`, {}, missing === 'start' ? `ex-err-${id}` : undefined))
    const message = $(`mapping-error-${id}`)?.textContent?.trim()
    if (choice && !entry.valid && !entry.missing.length && message) body.push(errText(message))
    return rowShell(item, title, meta, body)
  }

  function reportRow(item) {
    const title = h('span', { class: 'row-name' }, h('span', { 'data-source-raw': '' }, item.name || item.key))
    const meta = h('span', { class: 'row-meta', 'data-source-raw': '' }, [item.date, item.course].filter(Boolean).join(' · '))
    const reason = item.reason ? h('p', { class: 'ex-reason caption' }, icon('alert'), h('span', {}, item.reason)) : null
    return rowShell(item, title, meta, [reason])
  }

  function classRow(item, target) {
    const sourceTitle = work()?.snapshot?.title || ''
    const title = h('span', { class: 'row-name' }, h('span', { 'data-source-raw': '' }, sourceTitle), say(h('span', { class: 'tag tag-neutral' }), 'ws.classSource', { id: work()?.snapshot?.classId || '' }))
    const sessionSelect = $('class-session'), classroom = $('classroom')
    const choice = sessionSelect?.value === 'new' ? 'new' : sessionSelect?.value ? 'map' : $('class-session')?.dataset.inlineChoice || ''
    const choiceRow = h('div', { class: 'ex-choice' }, seg(choice, {
      onMap: () => { if (sessionSelect.value === 'new') setControl(sessionSelect, ''); sessionSelect.dataset.inlineChoice = 'map'; hooks.changed() },
      onNew: () => { if (hasOption(sessionSelect, 'new')) setControl(sessionSelect, 'new'); else hooks.openAdvanced('classes'); hooks.changed() },
      newDisabled: Boolean(classroom?.value) && !hasOption(sessionSelect, 'new'),
    }))
    const body = [choiceRow]
    if (choice !== 'new' || !classroom?.value) choiceRow.append(mirror(classroom, { placeholder: 'ws.pickClassroom', label: 'ws.classroomLabel', ctl: 'classroom', onChange: value => { setControl(classroom, value); hooks.changed() } }))
    if (choice === 'map' || (choice === '' && classroom?.value)) choiceRow.append(mirror(sessionSelect, { placeholder: 'ws.pickSession', skip: ['new'], label: 'ws.sessionLabel', ctl: 'session', onChange: value => { setControl(sessionSelect, value); hooks.changed() } }))
    if (choice === 'new') {
      body.push(h('div', { class: 'prefill' }, say(h('span'), 'ws.newClass', { name: $('session-name')?.value || sourceTitle })))
      if (target.missing?.length) body.push(h('div', { class: 'ex-choice' }, err('ws.newClassMissing'), h('button', { type: 'button', class: 'btn btn-soft btn-sm', onclick: () => hooks.openAdvanced('classes') }, icon('calendar'), say(h('span'), 'ws.fillSchedule'))))
    }
    return rowShell({ ...item, name: sourceTitle }, title, null, body, { detail: false })
  }

  /* ---------- Panels ---------- */
  function renderAuto(next) {
    const panel = $('auto-panel')
    const total = next.auto.total
    const button = h('button', { type: 'button', class: 'auto-line', id: 'auto-matched-toggle', 'aria-expanded': String(autoOpen), disabled: !total, onclick: () => { autoOpen = !autoOpen; render() } },
      icon('check-circle'), say(h('span'), 'ws.autoLine', { count: total }),
      say(h('span', { class: 'caption' }), 'ws.autoParts', { students: next.auto.students, reports: next.auto.reports, attendance: next.auto.attendance }),
      total ? icon('chev-down', 'chev') : null)
    const children = [button]
    if (autoOpen && total) {
      const rows = h('div', { class: 'rows auto-list' })
      const validRows = next.enrollments.filter(e => e.valid && !shown().has(`enrollment:${e.row.source_id}`)).map(e => ({ name: e.row.sourceStudentName, meta: e.row.sourceCourseLabel, tag: 'ws.autoMatched', tone: 'ok' }))
      const reportRows = next.auto.rows.map(item => ({ name: item.record?.sourceStudentName || item.target?.name || '', meta: [item.record?.date || item.record?.dateRaw, item.target?.courseName || item.record?.sourceCourseLabel].filter(Boolean).join(' · '), tag: item.attendanceEvidence ? 'ws.autoAttendance' : item.category === 'history' ? 'ws.autoHistory' : 'ws.autoMatched', tone: item.attendanceEvidence ? 'neutral' : 'ok' }))
      const all = [...validRows, ...reportRows], limit = 20
      for (const entry of all.slice(0, limit)) rows.append(h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('span', { class: 'row-name', 'data-source-raw': '' }, entry.name || '—'), h('span', { class: 'row-meta', 'data-source-raw': '' }, entry.meta || '')), h('span', { class: `tag tag-${entry.tone}` }, icon('check'), say(h('span'), entry.tag))))
      if (all.length > limit) rows.append(h('div', { class: 'row' }, say(h('span', { class: 'caption' }), 'ws.autoMore', { count: all.length - limit })))
      children.push(rows)
    }
    panel.replaceChildren(...children)
    panel.hidden = !total
  }

  function groupHead(group) {
    const head = h('div', { class: 'group-head', 'data-group': group.kind },
      h('span', { class: `dot dot-${group.tone}` }),
      say(h('span'), `ws.group.${group.kind}`),
      h('span', { class: 'count' }, String(group.items.length)),
      say(h('span', { class: 'hint' }), group.kind === 'missing' && !group.open ? 'ws.group.missingDone' : `ws.group.${group.kind}Help`),
      h('span', { class: 'spacer' }))
    const creatable = group.items.filter(item => item.kind === 'enrollment' && !item.resolved && !item.skipped && item.row.student_source_id && hasOption(studentSelect(item.row), 'new') && choiceOf(item.row) !== 'new')
    if (['student', 'missing'].includes(group.kind) && creatable.length > 1) head.append(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-batch': 'new', onclick: () => { for (const item of creatable) createEnrollment(item.row) } }, icon('user-plus'), say(h('span'), 'ws.allNew')))
    return head
  }

  function signature(item, entry) {
    if (item.kind === 'report') return JSON.stringify([item.key, item.tone, item.reason, item.name, selected === item.key])
    if (item.kind === 'class-target') return JSON.stringify([item.tone, ...['classroom', 'class-session', 'session-name', 'session-day', 'session-from', 'session-to', 'session-start'].map(id => [$(id)?.value, options($(id)).length]), $('class-session')?.dataset.inlineChoice])
    const id = item.sourceId, student = studentSelect(item.row), enrollment = $(`enrollment-${id}`)
    return JSON.stringify([item.tone, item.group, entry?.choice, entry?.missing, entry?.valid, entry?.skipped, student?.value, options(student).map(o => o.value), enrollment?.value, options(enrollment).map(o => o.value), ...['start', 'status', 'enrollment-course', 'review'].map(prefix => { const node = $(`${prefix}-${id}`); return node?.type === 'checkbox' ? node.checked : node?.value }), options($(`enrollment-course-${id}`)).length, $(`mapping-error-${id}`)?.textContent, $(`more-enrollments-${id}`)?.disabled, $('class-session')?.value, selected === item.key, item.reports])
  }

  function renderExceptions(next) {
    const panel = $('exceptions')
    let head = panel.querySelector(':scope > .panel-head'), body = panel.querySelector(':scope > .ex-list')
    if (!head) {
      head = h('div', { class: 'panel-head' }, say(h('h2', { id: 'exceptions-title' }), 'ws.needsTitle'), h('span', { class: 'count', id: 'exceptions-count' }), say(h('p'), 'ws.needsHelp'))
      body = h('div', { class: 'ex-list' })
      panel.replaceChildren(head, body)
    }
    $('exceptions-count').textContent = String(next.total)
    const entries = new Map(next.enrollments.map(entry => [`enrollment:${entry.row.source_id}`, entry]))
    const items = []
    for (const group of next.groups) { items.push({ type: 'head', key: `group:${group.kind}`, group }); for (const item of group.items) items.push({ type: 'row', key: item.key, item }) }
    if (!items.length) items.push({ type: 'empty', key: 'empty' })
    const active = document.activeElement, activeRow = active?.closest?.('[data-exception-key]'), activeCtl = active?.dataset?.ctl
    list(body, items, entry => entry.key, (entry, old) => {
      if (entry.type === 'empty') return old || h('div', { class: 'empty' }, icon('check-circle', 'ic-xl'), say(h('p'), 'ws.needsNone'))
      if (entry.type === 'head') { const sig = JSON.stringify([entry.group.items.length, entry.group.open, entry.group.tone, entry.group.items.map(i => choiceOf(i.row || {}))]); if (old?.dataset.sig === sig) return old; const node = groupHead(entry.group); node.dataset.sig = sig; return node }
      const item = entry.item, sig = signature(item, entries.get(item.key))
      if (old?.dataset.sig === sig) return old
      const node = item.kind === 'enrollment' ? enrollmentRow(item, entries.get(item.key)) : item.kind === 'class-target' ? classRow(item, next.target) : reportRow(item)
      node.dataset.sig = sig
      return node
    })
    if (activeRow && !activeRow.isConnected && activeCtl) body.querySelector(`[data-exception-key="${CSS.escape(activeRow.dataset.exceptionKey)}"] [data-ctl="${activeCtl}"]`)?.focus({ preventScroll: true })
  }

  function renderSummary(next) {
    $('stat-source').textContent = String(records().filter(row => row.kind !== 'student').length)
    $('stat-auto').textContent = String(next.auto.total)
    $('stat-decide').textContent = String(next.total)
    const status = $('review-action-summary')
    status.replaceChildren()
    status.classList.toggle('bad', next.blocking > 0)
    const newStudents = next.enrollments.filter(e => !e.skipped && studentSelect(e.row)?.value === 'new').length
    const newEnrollments = next.enrollments.filter(e => !e.skipped && $(`enrollment-${e.row.source_id}`)?.value === 'new').length
    if (next.blocking) status.append(icon('circle-alert'), say(h('span'), 'ws.statusMissing', { count: next.blocking }))
    else if (next.total) status.append(icon('alert'), say(h('span'), 'ws.statusReports', { count: next.total }))
    else if (newStudents || newEnrollments) status.append(icon('check'), say(h('span'), 'ws.statusReady', { students: newStudents, enrollments: newEnrollments }))
    else status.append(icon('check'), say(h('span'), 'ws.statusReadyPlain'))
    hooks.blocking(next.blocking)
  }

  function render() {
    frame = 0
    if ($('mapping')?.hidden || !work()?.snapshot) return
    try { model = compute() } catch (error) { hooks.failure?.(error); return }
    if (!model) return
    renderSummary(model); renderAuto(model); renderExceptions(model)
    if (isDrawerOpen($('detail-drawer')) && selected) hooks.refreshDetail?.()
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(render) }

  return {
    render, schedule,
    model: () => model,
    blocking: () => { const next = compute(); return next ? next.blocking : 0 },
    reset: () => { selected = ''; autoOpen = false },
    select: key => { selected = key; schedule() },
    selected: () => selected,
    choiceOf, createEnrollment, mapEnrollment, firstLesson, nameOf,
  }
}

/* ---------- Detail drawer (enrollment) ---------- */
export function renderEnrollmentDetail(body, row, { view, controller, context, hooks }) {
  const id = row.source_id, student = controller.studentSelect(row), choice = view.choiceOf(row)
  const reports = (hooks.work()?.snapshot?.records || []).filter(x => x.kind === 'report' && x.enrollment_source_id === id)
  const kv = (pairs) => h('dl', { class: 'kv' }, pairs.flatMap(([key, value]) => [say(h('dt'), key), h('dd', { 'data-source-raw': '' }, value || '—')]))
  const source = h('div', { class: 'card-lite' }, say(h('h3'), 'ws.detail.source'), kv([
    ['ws.detail.name', view.nameOf(row)], ['ws.detail.course', row.sourceCourseLabel], ['ws.detail.enrollment', `#${id}`],
    ['ws.detail.start', row.data?.start_date || view.firstLesson(row)], ['ws.detail.reports', tr('ws.detail.reportCount', { count: reports.length })]]))
  const segment = seg(choice === 'skip' ? '' : choice, { onMap: () => { view.mapEnrollment(row) }, onNew: () => { view.createEnrollment(row) }, newDisabled: !(row.student_source_id && hasOption(student, 'new')) })
  const course = context.courses.find(c => c.id === $(`enrollment-course-${id}`)?.value)
  const status = $(`status-${id}`)?.selectedOptions?.[0]?.textContent || ''
  const plan = choice === 'new' || choice === 'map'
    ? h('div', { class: 'card-lite' }, say(h('h3'), choice === 'new' ? 'ws.detail.plan' : 'ws.detail.planMap'), kv([
      ['ws.detail.student', choice === 'new' ? tr('ws.detail.newStudent', { name: view.nameOf(row) }) : student?.selectedOptions?.[0]?.textContent],
      ['ws.detail.enrollment', [course?.display_name || course?.subject, status].filter(Boolean).join(' · ')],
      ['ws.startDate', $(`start-${id}`)?.value],
      ['ws.detail.reports', tr('ws.detail.reportsPlan', { count: reports.length })]]))
    : null
  const candidates = options(student).filter(option => option.value && option.value !== 'new')
  const candidateList = h('div', { class: 'rows panel' })
  if (!candidates.length) candidateList.append(h('div', { class: 'row' }, say(h('span', { class: 'caption' }), 'ws.detail.noCandidates')))
  for (const option of candidates) {
    const person = context.students.find(s => s.id === option.value)
    const relations = (person?.relationships || []).map(rel => `${rel.class_name} ／ ${rel.course_name}`).join(' · ')
    candidateList.append(h('div', { class: 'row' }, h('div', { class: 'row-main' }, h('span', { class: 'row-name', 'data-source-raw': '' }, person?.name || option.textContent), h('span', { class: 'row-meta', 'data-source-raw': '' }, relations || option.textContent)),
      student.value === option.value ? h('span', { class: 'tag tag-ok' }, icon('check')) : h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => { $(`enrollment-${id}`).dataset.inlineChoice = 'map'; setControl(student, option.value); hooks.changed() } }, say(h('span'), 'ws.detail.use'))))
  }
  const skipped = (hooks.work()?.skippedAdmissions || []).includes(id)
  body.replaceChildren(source,
    h('div', { class: 'field' }, say(h('span', { class: 'lbl' }), 'ws.choice'), segment),
    plan,
    h('div', { class: 'field' }, say(h('span', { class: 'lbl' }), 'ws.detail.candidates'), candidateList,
      h('div', {}, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => hooks.queryStudents(row) }, icon('search'), say(h('span'), 'ws.queryStudents')))),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: () => hooks.openAdvanced('students', id) }, icon('sliders'), say(h('span'), 'ws.detail.fullMatch')),
      skipped
        ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => hooks.restore(row) }, icon('rotate'), say(h('span'), 'ws.restore'))
        : h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: () => hooks.skip(row) }, say(h('span'), 'ws.skip-item'))))
}

export { openDrawer, closeDrawer }
