import { sourceName, sourceUrl, frontendUrl, shortId, displayDate, statusLabel, mergeEvidence } from './mapping-presentation.js'
const $ = id => document.getElementById(id)
const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n }
const stateNames = { skipped: '已略過', remembered: '已記住', identity: '可靠識別', pending: '待確認', missing: '需補資料', invalid: '已失效' }
export function evidenceDetails(records) {
  const details = node('details', undefined, 'source-evidence')
  details.append(node('summary', '擷取原文'))
  const entries = mergeEvidence(...records.map(r => r.sourceEvidence || []))
  if (!entries.length) details.append(node('p', '此工作尚未保留擷取原文。可查看原站，或按「補讀來源資料」補齊。', 'hint'))
  for (const e of entries) {
    const section = node('section')
    section.append(node('p', `${e.sourcePath} · ${e.table || '來源表格'} · 第 ${e.row} 列`, 'evidence-location'))
    const dl = node('dl', undefined, 'evidence-fields')
    for (const field of e.fields || []) dl.append(node('dt', field.label), node('dd', field.text || '原站未提供'))
    section.append(dl)
    if (e.capturedAt && Number.isFinite(new Date(e.capturedAt).valueOf())) section.append(node('small', `擷取時間：${new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(e.capturedAt))}`))
    details.append(section)
  }
  return details
}
function addLink(parent, label, url) {
  if (!url) return
  const a = node('a', `${label} ↗`, 'mapping-link'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.setAttribute('aria-label', `${label}（新分頁）`); parent.append(a)
}
export function createMappingView({ work, context, settingsUrl, changed, queryStudent }) {
  let entries = [], section = 'courses', selected = '', pinCurrent = true, mobileEditor = false, scrolls = {}, listScrolls = {}, listWindows = {}, sections = {}, restoredWork = ''
  const viewport = matchMedia('(max-width: 768px)')
  const save = () => { if (work()) work().mappingView = { section, selected, mobileEditor, search: $('mapping-search').value, scrolls, listScrolls, listWindows, sections, courseOverrides: work().mappingView?.courseOverrides || [] }; changed() }
  function visible(entry) {
    const filter = $('mapping-filter').value, search = $('mapping-search').value.trim().toLocaleLowerCase('zh-TW')
    return entry.section === section && (pinCurrent && entry.key === selected || (!search || `${entry.title} ${entry.subtitle}`.toLocaleLowerCase('zh-TW').includes(search)) && (filter === 'all' || filter === 'pending' && !['remembered','skipped'].includes(entry.status) || filter === entry.status))
  }
  function choose(key, user = false) {
    if (viewport.matches && !mobileEditor) listWindows[section] = window.scrollY
    if (selected) scrolls[selected] = $('mapping-editor-pane').scrollTop
    selected = key; pinCurrent = true; mobileEditor = Boolean(key)
    refresh()
    $('mapping-editor-pane').scrollTop = scrolls[key] || 0
    if (user) {
      const heading = $('mapping-editor-title'); heading.focus({ preventScroll: true })
      if (viewport.matches) $('mapping-workbench').scrollIntoView({ block: 'start' })
      const entry = entries.find(e => e.key === key)
      if (entry?.row) queryStudent(entry.row)
      save()
    }
  }
  function arrange(panel, records) {
    if (panel.dataset.arranged) return
    panel.dataset.arranged = 'true'
    panel.open = true
    const actions = node('div', undefined, 'mapping-actions'), more = node('details', undefined, 'mapping-more')
    more.append(node('summary', '更多操作'))
    for (const b of [...panel.querySelectorAll('button')]) {
      if (/^確認並記住/.test(b.textContent)) { b.classList.add('primary'); actions.append(b) }
      else if (/^(修改|略過|清除|保留 EduLog|恢復此筆)/.test(b.textContent)) more.append(b)
    }
    panel.append(evidenceDetails(records))
    const feedback = node('div', '核對來源與目標後，確認並記住此對應。', 'mapping-feedback'); feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite'); feedback.setAttribute('aria-atomic', 'true'); panel.append(feedback)
    if (more.children.length > 1) actions.append(more)
    panel.append(actions)
  }
  function mount(groups, cards) {
    const previousEntry = entries.find(e => e.key === selected), sameWork = restoredWork === work().id
    entries = []
    const old = work().mappingView || {}
    if (restoredWork !== work().id) { section = old.section || 'courses'; selected = old.selected || ''; mobileEditor = old.mobileEditor || false; scrolls = old.scrolls || {}; listScrolls = old.listScrolls || {}; listWindows = old.listWindows || {}; sections = old.sections || {}; $('mapping-search').value = old.search || ''; restoredWork = work().id }
    for (const [i, g] of groups.entries()) {
      const panel = $(`course-group-${i}`); arrange(panel, g.rows)
      const brief = node('section', undefined, 'source-brief'); brief.append(node('h3', '來源課程'), node('p', g.label), node('p', `${g.rows.length} 筆報名 · ${g.sourceId ? '課程 ID ' + g.sourceId : '依本班來源名稱確認'}`, 'hint'))
      for (const row of g.rows) addLink(brief, `${sourceName(row)} · 報名 #${row.source_id}`, sourceUrl(work().snapshot.sourceOrigin, row.data.external_link))
      panel.querySelector('summary').after(brief)
      panel.querySelector('.source-evidence').before(node('div', undefined, 'selected-target')); entries.push({ key: `course:${g.key}`, section: 'courses', title: g.key.startsWith('missing:') ? `來源報名 #${g.rows[0].source_id} 的課程` : g.label, subtitle: `${g.rows.length} 筆報名`, panel, group: g, index: i })
    }
    for (const row of work().snapshot.records.filter(r => r.kind === 'enrollment')) {
      const panel = cards.get(row.source_id); arrange(panel, [row, ...work().snapshot.records.filter(r => r.kind === 'student' && r.source_id === row.student_source_id)])
      const source = panel.querySelector('.mapping-comparison > div')
      addLink(source, '查看原站報名', sourceUrl(work().snapshot.sourceOrigin, row.data.external_link))
      source.append(node('p', `來源報名 #${row.source_id} · ${displayDate(row.data.start_date)}${row.data.status ? ' · ' + statusLabel(row.data.status) : ''}`, 'hint'))
      const target = node('div', undefined, 'selected-target'); panel.querySelector('.mapping-comparison > div:last-child').append(target)
      entries.push({ key: `admission:${row.source_id}`, section: 'admissions', title: sourceName(row), subtitle: `${row.sourceCourseLabel || '來源課程待核對'} · 報名 #${row.source_id}`, panel, row })
    }
    refresh()
    if (!entries.some(e => e.key === selected)) selected = sameWork && previousEntry?.group ? entries.find(e => e.group?.rows.some(r => previousEntry.group.rows.some(old => old.source_id === r.source_id)))?.key || '' : ''
    if (!selected && !viewport.matches) choose(entries.find(e => e.section === section && e.status !== 'remembered')?.key || entries.find(e => e.section === section)?.key || '')
    refresh()
  }
  function targetSummary(entry) {
    const box = entry.panel.querySelector('.selected-target'); if (!box) return
    const parts = []
    if (entry.group) {
      const id = $(`source-course-${entry.index}`).value, c = context().courses.find(c => c.id === id)
      if (c) parts.push(['course', c])
    } else {
      const studentSelect = entry.panel.querySelector('select[id^="student-"]'), student = context().students.find(s => s.id === studentSelect?.value)
      const course = context().courses.find(c => c.id === $(`enrollment-course-${entry.row.source_id}`).value), enrollment = context().enrollments.find(e => e.id === $(`enrollment-${entry.row.source_id}`).value)
      if (student) parts.push(['student', student]); if (course) parts.push(['course', course]); if (enrollment) parts.push(['enrollment', enrollment])
    }
    const signature = JSON.stringify(parts) + settingsUrl()
    if (box.dataset.signature === signature) return
    box.dataset.signature = signature; box.replaceChildren()
    for (const [kind, record] of parts) {
      box.append(node('strong', `${kind === 'student' ? record.name : kind === 'course' ? record.display_name || record.subject : statusLabel(record.status)} · #${shortId(record.id)}`))
      if (kind === 'student') { for (const rel of record.relationships || []) box.append(node('p', `${rel.class_name} ／ ${rel.course_name}`, 'hint')); box.append(node('p', record.name === entry.row?.sourceStudentName ? '推薦原因：名稱相同，仍需核對身份。' : '已選目標；請依來源資料核對身份。', 'hint')); addLink(box, '查看 EduLog 學生', frontendUrl(settingsUrl(), `/dashboard/student/${record.id}`)) }
      if (kind === 'course') box.append(node('p', `${record.subject || '科目未提供'} ／ ${record.stage || '階段未提供'}`, 'hint'))
      if (kind === 'enrollment') { box.append(node('p', `開始日期：${displayDate(record.start_date)}`, 'hint')); addLink(box, '查看 EduLog 報名與報告', frontendUrl(settingsUrl(), `/dashboard/reports/${record.id}`)); if (!record.status || !['regular', 'trial', 'completed', 'dropped'].includes(record.status)) box.append(node('p', `原始狀態：${record.status || '未提供'}`, 'hint')) }
    }
    if (parts.length && !frontendUrl(settingsUrl(), '/dashboard/student/00000000-0000-4000-8000-000000000000')) box.append(node('p', '尚未取得可靠的 EduLog 前端網址，請重新檢查連線。', 'hint'))
    if (!parts.length) box.append(node('p', '選定既有目標後可查看詳細資料；新建目標於建立後才能開啟。', 'hint'))
  }
  function refresh() {
    if (!entries.length) return
    for (const e of entries) {
      e.status = e.row ? e.panel.dataset.state : $(`course-state-${e.index}`).textContent.startsWith('已記住') ? 'remembered' : e.group.key.startsWith('missing:') ? 'missing' : 'pending'
      e.panel.hidden = e.key !== selected; if (!e.panel.hidden) e.panel.open = true
      const primary=e.panel.querySelector('.mapping-actions>.primary');if(primary&&!e.panel.hasAttribute('aria-busy')){const unknown=e.panel.dataset.saveUnknown==='true';primary.textContent=unknown?'請先核對保存結果':e.status==='remembered'?'已記住此對應':primary.dataset.originalLabel;primary.setAttribute('aria-disabled',String(unknown||e.status==='remembered'))}
      if (!e.button) { const b = node('button', undefined, 'mapping-list-item'); b.type = 'button'; b.addEventListener('click', () => choose(e.key, true)); e.button = b }
      const selectedTarget = e.row ? e.panel.querySelector('select[id^="student-"]') : $(`source-course-${e.index}`)
      let targetLabel = selectedTarget?.value && selectedTarget.value !== 'new' ? selectedTarget.selectedOptions[0]?.textContent : ''
      if (e.row && targetLabel) { const course = context().courses.find(c => c.id === $(`enrollment-course-${e.row.source_id}`).value); if (course) targetLabel += ` ／ ${course.display_name || course.subject}` }
      const missing = e.row ? [!e.row.sourceStudentName && '來源姓名未提供', !e.row.student_source_id && '無學生 ID，可指定既有學生', !e.row.sourceCourseLabel && '來源課程未提供', !$(`start-${e.row.source_id}`).value && '請補報名日期', !$(`status-${e.row.source_id}`).value && '請補報名狀態'].filter(Boolean) : e.group.key.startsWith('missing:') ? ['請補來源課程'] : []
      const content = `${e.title}|${e.subtitle}|${e.status}|${targetLabel}|${missing.join()}`
      if (e.button.dataset.content !== content) { e.button.dataset.content = content; e.button.replaceChildren(node('strong', e.title), node('span', e.subtitle), node('small', stateNames[e.status], `state-${e.status}`)); if (e.status === 'remembered' && targetLabel) e.button.append(node('small', `→ ${targetLabel}`)); else if (missing.length) e.button.append(node('small', missing.join(' · '))) }
      e.button.setAttribute('aria-current', e.key === selected ? 'true' : 'false'); e.button.hidden = !visible(e); targetSummary(e)
    }
    const list = $('mapping-items')
    // Stable nodes and order keep the active item, focus and scroll position.
    for (const e of entries) if (e.button.parentNode !== list) list.append(e.button)
    const active = entries.find(e => e.key === selected)
    $('mapping-editor-title').textContent = active?.title || '從清單選擇要核對的資料'
    $('mapping-editor-subtitle').textContent = active?.subtitle || '每次核對一筆，已保存的對應可再次使用。'
    $('mapping-empty').hidden = Boolean(active)
    $('mapping-list-empty').hidden = entries.some(e => !e.button.hidden)
    $('mapping-workbench').dataset.mobileView = mobileEditor ? 'editor' : 'list'
    for (const b of document.querySelectorAll('[data-mapping-section]')) { b.setAttribute('aria-pressed', String(b.dataset.mappingSection === section)); b.textContent = `${b.dataset.mappingSection === 'courses' ? '來源課程' : '學生與報名'} ${entries.filter(e => e.section === b.dataset.mappingSection).length}` }
  }
  for (const b of document.querySelectorAll('[data-mapping-section]')) b.addEventListener('click', () => {
    if (section === b.dataset.mappingSection) return
    listScrolls[section] = $('mapping-items').scrollTop
    sections[section] = { selected, search: $('mapping-search').value, filter: $('mapping-filter').value }
    section = b.dataset.mappingSection
    const previous = sections[section] || {}
    selected = previous.selected || ''; mobileEditor = false
    $('mapping-search').value = previous.search || ''; $('mapping-filter').value = previous.filter || 'pending'
    refresh(); $('mapping-items').scrollTop = listScrolls[section] || 0
    if (!viewport.matches) choose(selected || entries.find(e => e.section === section && visible(e))?.key || '')
    save()
  })
  $('mapping-search').addEventListener('input', () => { pinCurrent = false; refresh(); save() })
  $('mapping-filter').addEventListener('change', () => { pinCurrent = false; refresh(); save() })
  $('mapping').addEventListener('input', event => { if (event.target !== $('mapping')) refresh() })
  $('mapping-back').addEventListener('click', () => { mobileEditor = false; refresh(); entries.find(e => e.key === selected)?.button.focus({ preventScroll: true }); window.scrollTo(0, listWindows[section] || 0); save() })
  $('mapping-editor-pane').addEventListener('scroll', () => { if (selected) scrolls[selected] = $('mapping-editor-pane').scrollTop })
  viewport.addEventListener('change', refresh)
  return { mount, refresh, revealRow: row => { section = 'admissions'; choose(`admission:${row.source_id}`, true) } }
}
