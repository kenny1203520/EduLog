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
  // Tones the provider uses on the span around each icon. Yellow is assumed to be
  // text-warning (to verify on the live site).
  const iconTone = (cell, selector) => {
    const host = cell?.querySelector(selector)?.closest('span')
    return host ? ['success', 'warning', 'danger', 'secondary'].find(tone => host.classList.contains(`text-${tone}`)) || null : null
  }
  // Text plus icon state for one session cell. Icon meanings (confirmed with teachers),
  // in cell order:
  //   person   attendance     green attended, red absent, grey not marked
  //   pencil   completion     green 完整完成, yellow 尚未完成 or 章節未填 (indistinguishable), grey not filled
  //   question internal note  green 能跟上進度, red 跟不上 (太難／分心), grey not chosen
  //   comment  performance    green 學習紀錄／課堂評量／學習報告 done, grey not done
  // A green record button only means attendance was taken. Absent students and upcoming
  // (next-week) sessions never have pending items.
  function readSessionCell(cell, { upcoming = false } = {}) {
    const state = classifySession(sessionText(cell))
    const tone = selector => iconTone(cell, selector)
    const attendanceTone = tone(selectors.attendanceIcon), completionTone = tone(selectors.completionIcon), internalTone = tone(selectors.internalIcon), performanceTone = tone(selectors.performanceIcon)
    const attendanceMark = attendanceTone === 'success' ? 'present' : attendanceTone === 'danger' ? 'absent' : attendanceTone === 'secondary' ? 'unmarked' : null
    const completionMark = completionTone === 'success' ? 'done' : completionTone === 'warning' || completionTone === 'danger' ? 'check' : completionTone ? 'empty' : null
    const internalMark = internalTone === 'success' ? 'ok' : internalTone === 'danger' ? 'behind' : internalTone ? 'empty' : null
    const performanceMark = performanceTone === 'success' ? 'done' : performanceTone ? 'empty' : null
    const link = cell?.querySelector(selectors.recordLink)
    const active = !state.otherSession && !upcoming
    const present = attendanceMark === 'present'
    // What the teacher still has to fill in for an attended session.
    const missing = active && present ? [
      completionMark === 'check' && 'completionCheck', completionMark === 'empty' && 'completionEmpty',
      internalMark === 'empty' && 'internalEmpty', performanceMark === 'empty' && 'performanceEmpty',
    ].filter(Boolean) : []
    const complete = present && completionMark === 'done' && internalMark && internalMark !== 'empty' && performanceMark === 'done'
    return {
      ...state,
      attendanceMark, completionMark, internalMark, performanceMark, missing,
      behind: active && present && internalMark === 'behind',
      recordPath: link ? link.getAttribute('href') : null,
      recordCreated: Boolean(link?.classList.contains('btn-success')),
      attendanceKnown: state.attendanceKnown || attendanceMark === 'present' || attendanceMark === 'absent',
      attendancePending: state.attendancePending || (active && attendanceMark === 'unmarked'),
      reportKnown: state.reportKnown || Boolean(complete),
      reportPending: state.reportPending || missing.length > 0,
      statusKnown: state.statusKnown || Boolean(attendanceMark || completionMark || internalMark || performanceMark),
      attendance: state.attendance || (attendanceMark === 'present' ? '出席' : attendanceMark === 'absent' ? '缺席' : attendanceMark === 'unmarked' ? (upcoming ? '尚未上課' : '尚未點名') : null),
      report: state.report || (complete ? '已完成' : missing.length ? '資料未齊' : null),
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
