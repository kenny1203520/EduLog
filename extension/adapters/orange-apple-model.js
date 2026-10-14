// Reads provider markup into plain facts. Views render from these facts instead of
// matching provider wording themselves. Pure reads: no DOM writes, no network.
(() => {
  const lexicon = globalThis.edulogSiteLexicon
  const { text: words, selectors, probes } = lexicon
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')

  function matchPage(path) {
    const route = lexicon.routes.find(item => item.pattern.test(path))
    return route ? { kind: route.kind, title: route.title } : null
  }
  // Text the provider shows in a session cell, without links, controls or our nodes.
  function sessionText(cell) {
    if (!cell) return ''
    const copy = cell.cloneNode(true)
    copy.querySelectorAll('a,button,input,select,textarea,[data-edulog-owned]').forEach(node => node.remove())
    return collapse(copy.textContent)
  }
  function classifySession(raw) {
    const attendancePending = words.attendancePending.test(raw)
    const attendanceKnown = words.attendance.test(raw) && !attendancePending
    const reportPending = words.reportPending.test(raw)
    const reportKnown = words.reportDone.test(raw) && !reportPending
    return {
      raw,
      otherSession: words.otherSession.test(raw),
      attendancePending, attendanceKnown, reportPending, reportKnown,
      statusKnown: words.statusKnown.test(raw) || attendanceKnown || attendancePending || reportKnown || reportPending,
      courseStatus: words.courseStatus.exec(raw)?.[0] || null,
      attendance: words.attendance.exec(raw)?.[0] || null,
      report: words.reportPending.exec(raw)?.[0] || null,
      scheduledLesson: words.scheduledLesson.exec(raw)?.[1] || words.lessonCode.exec(raw)?.[0] || null,
      enabledLesson: words.enabledLesson.exec(raw)?.[1] || (words.enabled.test(raw) ? '已啟用' : null),
    }
  }
  const iconTone = (cell, selector) => {
    const host = cell?.querySelector(selector)?.closest('span')
    return host ? ['success', 'danger', 'secondary'].find(tone => host.classList.contains(`text-${tone}`)) || null : null
  }
  // Text plus icon state for one session cell. Icon meanings (confirmed with teachers):
  // person green = attended, red = absent, grey = not marked; pencil green = record
  // written, grey = not written; a green record button only means attendance was taken.
  // An upcoming session (next week) is never pending yet.
  function readSessionCell(cell, { upcoming = false } = {}) {
    const state = classifySession(sessionText(cell))
    const attendanceTone = iconTone(cell, selectors.attendanceIcon), recordTone = iconTone(cell, selectors.recordIcon)
    const attendanceMark = attendanceTone === 'success' ? 'present' : attendanceTone === 'danger' ? 'absent' : attendanceTone === 'secondary' ? 'unmarked' : null
    const recordMark = recordTone === 'success' ? 'written' : recordTone ? 'unwritten' : null
    const link = cell?.querySelector(selectors.recordLink)
    const active = !state.otherSession && !upcoming
    return {
      ...state,
      attendanceMark, recordMark,
      recordPath: link ? link.getAttribute('href') : null,
      recordCreated: Boolean(link?.classList.contains('btn-success')),
      attendanceKnown: state.attendanceKnown || attendanceMark === 'present' || attendanceMark === 'absent',
      attendancePending: state.attendancePending || (active && attendanceMark === 'unmarked'),
      reportKnown: state.reportKnown || recordMark === 'written',
      reportPending: state.reportPending || (active && attendanceMark === 'present' && recordMark === 'unwritten'),
      statusKnown: state.statusKnown || Boolean(attendanceMark || recordMark),
      attendance: state.attendance || (attendanceMark === 'present' ? '出席' : attendanceMark === 'absent' ? '缺席' : attendanceMark === 'unmarked' ? (upcoming ? '尚未上課' : '尚未點名') : null),
      report: state.report || (recordMark === 'written' ? '已填寫' : recordMark === 'unwritten' && !upcoming ? '未填寫' : null),
    }
  }
  function readWeekColumns(headerCells) {
    return [...headerCells].map((cell, index) => ({ cell, index, label: collapse(cell.textContent) })).filter(item => words.weekLabel.test(item.label))
  }
  function pickWeek(weeks, index) {
    return weeks.find(week => week.index === index) || weeks.find(week => words.currentWeek.test(week.label)) || weeks[0] || null
  }
  // Health check before enhancing. `denied` is a legitimate provider page;
  // `missing` means the markup no longer matches what this adapter expects.
  function checkPage(doc, kind) {
    const content = doc.querySelector(selectors.content)
    if (content && words.accessDenied.test([...content.querySelectorAll('h1,h2')].map(h => h.textContent).join(' '))) return { ok: false, reason: 'denied', missing: [] }
    const missing = [...probes['*'], ...(probes[kind] || [])].filter(selector => !doc.querySelector(selector))
    return missing.length ? { ok: false, reason: 'missing', missing } : { ok: true, reason: null, missing }
  }
  globalThis.edulogSiteModel = Object.freeze({ matchPage, sessionText, classifySession, readSessionCell, readWeekColumns, pickWeek, checkPage })
})()
