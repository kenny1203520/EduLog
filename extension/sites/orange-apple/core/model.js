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
    return lexicon.locale.canonStatus(collapse(copy.textContent), cell.ownerDocument)
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
    return [...headerCells].map((cell, index) => ({ cell, index, label: lexicon.locale.canonWeekLabel(collapse(cell.textContent), cell.ownerDocument) })).filter(item => words.weekLabel.test(item.label))
  }
  function pickWeek(weeks, index) {
    return weeks.find(week => week.index === index) || weeks.find(week => words.currentWeek.test(week.label)) || weeks[0] || null
  }
  // Week labels stay in zh-TW wording for reading (see lexicon.locale); this is the form teachers see.
  const weekTitle = label => String(label || '').replace(/上週|本週|下週/g, word => globalThis.edulogUi?.tx(word) ?? word)
  // Health check before enhancing. `denied` is a legitimate provider page;
  // `missing` means the markup no longer matches what this adapter expects.
  function checkPage(doc, kind) {
    const content = doc.querySelector(selectors.content)
    if (content && words.accessDenied.test([...content.querySelectorAll('h1,h2')].map(h => h.textContent).join(' '))) return { ok: false, reason: 'denied', missing: [] }
    const missing = [...probes['*'], ...(probes[kind] || [])].filter(selector => !doc.querySelector(selector))
    return missing.length ? { ok: false, reason: 'missing', missing } : { ok: true, reason: null, missing }
  }
  // "樹林_非凡文理_201教室（菁英） - 週六 第 1 時段 (10:00 ~ 12:00)" → weekday, times and place parts.
  function classSchedule(name) {
    const text = lexicon.locale.canonClassName(collapse(name))
    const separator = text.lastIndexOf(' - ')
    if (separator < 0) return null
    const placeText = text.slice(0, separator).trim()
    const schedule = text.slice(separator + 3).trim()
    const weekdayLabel = lexicon.navigation.weekdays.find(day => schedule.startsWith(day))
    if (!weekdayLabel) return null
    const details = schedule.slice(weekdayLabel.length).trim()
    const opening = details.indexOf('('), closing = details.indexOf(')', opening + 1)
    if (opening < 0 || closing !== details.length - 1) return null
    const period = details.slice(0, opening).trim()
    if (!period.startsWith('\u7b2c') || !period.endsWith('\u6642\u6bb5')) return null
    const sequence = period.slice(1, -2).trim()
    const digits = value => value.length > 0 && [...value].every(char => char >= '0' && char <= '9')
    if (!digits(sequence)) return null
    const times = details.slice(opening + 1, closing).split('~').map(value => value.trim())
    if (times.length !== 2) return null
    const parseTime = value => {
      const parts = value.split(':')
      if (parts.length !== 2 || parts[0].length < 1 || parts[0].length > 2 || parts[1].length !== 2 || !parts.every(digits)) return null
      return `${parts[0].padStart(2, '0')}:${parts[1]}`
    }
    const start = parseTime(times[0]), end = parseTime(times[1])
    if (!start || !end) return null
    const place = placeText.split('_').filter(Boolean)
    return { weekday: lexicon.navigation.weekdays.indexOf(weekdayLabel), weekdayLabel, start, end, branch: place.slice(0, -1).join(' '), room: place.at(-1) || placeText }
  }
  // The source site schedules classes in Taiwan time (UTC+8, no daylight saving), whatever the browser's time zone.
  const SITE_OFFSET = 8 * 3600e3
  function siteParts(now = new Date()) {
    const d = new Date(now.getTime() + SITE_OFFSET)
    return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() }
  }
  const siteTime = (year, month, day, hours = 0, minutes = 0) => new Date(Date.UTC(year, month, day, hours, minutes) - SITE_OFFSET)
  // A week header such as "本週(10/17)" names the session's date; the year is the one closest to now.
  function weekDate(label, now = new Date()) {
    const match = /(\d{1,2})\/(\d{1,2})/.exec(collapse(label))
    if (!match) return null
    const month = Number(match[1]) - 1, day = Number(match[2]), year = siteParts(now).year
    const candidates = [-1, 0, 1].map(offset => siteTime(year + offset, month, day)).filter(date => siteParts(date).month === month)
    return candidates.sort((a, b) => Math.abs(a - now) - Math.abs(b - now))[0] || null
  }
  // true once the session's start time has passed; null when the date or time is unknown.
  function sessionStarted(label, start, now = new Date()) {
    const date = weekDate(label, now), time = /^(\d{1,2}):(\d{2})$/.exec(start || '')
    if (!date || !time) return null
    const { year, month, day } = siteParts(date)
    return now >= siteTime(year, month, day, Number(time[1]), Number(time[2]))
  }
  globalThis.edulogSiteModel = Object.freeze({ matchPage, sessionText, classifySession, readSessionCell, readWeekColumns, pickWeek, checkPage, classSchedule, weekDate, weekTitle, sessionStarted, siteParts })
})()
