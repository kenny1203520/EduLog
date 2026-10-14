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
  globalThis.edulogSiteModel = Object.freeze({ matchPage, sessionText, classifySession, readWeekColumns, pickWeek, checkPage })
})()
