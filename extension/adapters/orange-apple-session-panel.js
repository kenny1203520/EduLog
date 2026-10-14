// "本堂待處理" panel above the provider's lesson report table. Lists only students who
// need action in the selected session; the native table stays below for everything else.
(() => {
  const lexicon = globalThis.edulogSiteLexicon, model = globalThis.edulogSiteModel
  if (!lexicon || !model) return
  const { text: words, selectors } = lexicon
  const LOW_REMAINING = 2
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')

  // Remaining lessons per admission, from the class roster when it is on the same page.
  function readRoster(doc) {
    const roster = new Map(), table = doc.querySelector(selectors.studentsTable)
    if (!table) return roster
    const header = [...table.rows].find(row => [...row.cells].some(cell => words.remainingLessons.test(collapse(cell.textContent))))
    const column = header ? [...header.cells].findIndex(cell => words.remainingLessons.test(collapse(cell.textContent))) : -1
    if (column < 0) return roster
    for (const row of table.rows) {
      const admission = row.querySelector(selectors.admissionId)?.getAttribute('data-admission-id')
      const match = /(\d+)\s*\/\s*(\d+)/.exec(collapse(row.cells[column]?.textContent))
      if (admission && match) roster.set(admission, { remaining: Number(match[1]), total: Number(match[2]) })
    }
    return roster
  }
  function readSession(table, week, roster) {
    const upcoming = words.nextWeek.test(week.label), students = []
    for (const row of [...table.tBodies].flatMap(body => [...body.rows])) {
      if (row.hasAttribute('data-edulog-last-teaching-row') || !row.cells[week.index]) continue
      const nameCell = row.cells[0], courseCell = row.cells[1]
      const name = collapse(nameCell?.querySelector(':scope > span')?.textContent) || row.getAttribute('data-edulog-student-name') || model.sessionText(nameCell)
      const admission = row.querySelector(selectors.admissionId)?.getAttribute('data-admission-id') || null
      const state = model.readSessionCell(row.cells[week.index], { upcoming })
      const course = collapse(courseCell?.querySelector('span')?.textContent) || ''
      const expired = words.courseExpired.exec(collapse(courseCell?.textContent))?.[0] || null
      const remaining = admission ? roster.get(admission)?.remaining : undefined
      const issues = []
      if (!state.otherSession) {
        if (state.attendanceMark === 'absent') issues.push({ tone: 'danger', icon: 'alert', label: '缺席' })
        else if (state.attendancePending) issues.push({ tone: 'warn', icon: 'clock', label: '尚未點名' })
        else if (state.reportPending) issues.push({ tone: 'warn', icon: 'pencil', label: '紀錄未填' })
        if (expired) issues.push({ tone: 'danger', icon: 'alert', label: '課程已到期' })
        else if (remaining !== undefined && remaining <= LOW_REMAINING) issues.push({ tone: 'warn', icon: 'clock', label: `剩餘 ${remaining} 堂` })
      }
      students.push({
        name, admission, course, state, issues, other: state.otherSession,
        recordLink: row.cells[week.index].querySelector(selectors.recordLink),
        profilePath: [...row.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).find(href => lexicon.paths.enrollment.test(href)) || null,
      })
    }
    return { label: week.label, upcoming, students }
  }

  const ICONS = { alert: ['M12 8v5', 'M12 16.5h.01', 'circle'], clock: ['M12 7v5l3 2', 'circle'], check: ['M7 12.5l3.2 3.2L17 9'], pencil: ['M4 20h4l10-10-4-4L4 16z', 'M13.5 6.5l4 4'] }
  function icon(doc, name) {
    const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'edulog-icon')
    for (const shape of ICONS[name]) {
      const node = doc.createElementNS(ns, shape === 'circle' ? 'circle' : 'path')
      if (shape === 'circle') { node.setAttribute('cx', '12'); node.setAttribute('cy', '12'); node.setAttribute('r', '9') } else node.setAttribute('d', shape)
      svg.append(node)
    }
    return svg
  }
  const rank = student => student.issues.some(issue => issue.tone === 'danger') ? 0 : 1

  function mount({ doc, scope, reports, weeks, currentWeek, anchor }) {
    const { element, listen } = scope
    const panel = scope.add(element('section'))
    panel.className = 'edulog-session-panel'; panel.setAttribute('aria-labelledby', 'edulog-session-panel-title')
    const heading = element('h3'); heading.id = 'edulog-session-panel-title'
    const title = element('span', '本堂待處理'), week = element('span'), count = element('span')
    week.className = 'edulog-session-panel-week'; count.className = 'edulog-todo-count'
    heading.append(title, week, count)
    const body = element('div'); body.setAttribute('aria-live', 'polite')
    panel.append(heading, body)
    anchor.before(panel)
    const roster = readRoster(doc)
    const badge = issue => { const node = element('span'); node.className = 'edulog-badge'; node.dataset.tone = issue.tone; node.append(icon(doc, issue.icon)); const label = element('span'); label.textContent = issue.label; node.append(label); return node }
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    let last = ''
    function refresh() {
      const selected = model.pickWeek(weeks, currentWeek())
      if (!selected) { panel.hidden = true; return }
      panel.hidden = false
      const session = readSession(reports, selected, roster)
      const flagged = session.students.filter(student => student.issues.length).sort((a, b) => rank(a) - rank(b))
      const settled = session.students.filter(student => !student.other && !student.issues.length).length
      const others = session.students.filter(student => student.other).length
      const signature = JSON.stringify([session.label, flagged.map(student => [student.admission, student.name, student.issues.map(issue => issue.label)]), settled, others])
      if (signature === last) return
      last = signature
      week.textContent = session.label
      count.textContent = flagged.length ? String(flagged.length) : ''
      const nodes = []
      if (flagged.length) {
        const list = element('ul'); list.className = 'edulog-todo-list'
        for (const student of flagged) {
          const li = element('li'); li.className = 'edulog-todo-item'
          const main = element('div'); main.className = 'edulog-todo-main'
          main.append(dataText('strong', student.name), dataText('span', [student.course, student.state.scheduledLesson].filter(Boolean).join(' · '), 'edulog-todo-meta'))
          const badges = element('div'); badges.className = 'edulog-session-panel-badges'
          for (const issue of student.issues) badges.append(badge(issue))
          li.append(main, badges)
          if (student.recordLink) {
            const open = element('button', '課堂記錄'); open.type = 'button'; open.className = 'edulog-todo-action'
            open.setAttribute('aria-label', `${student.name} ${session.label} 課堂記錄`)
            // Use the native link so the provider's modal, Turbo frame and date context stay in charge.
            listen(open, 'click', () => student.recordLink.isConnected && student.recordLink.click())
            li.append(open)
          }
          if (student.profilePath) { const profile = element('a', '完整紀錄'); profile.className = 'edulog-todo-action'; profile.href = student.profilePath; li.append(profile) }
          list.append(li)
        }
        nodes.push(list)
      }
      const summary = element('p'); summary.className = 'edulog-todo-empty'
      if (session.upcoming) summary.append(dataText('span', '下週課次尚未開始，只列出課程到期與堂數提醒。'))
      else if (!flagged.length) { const done = badge({ tone: 'ok', icon: 'check', label: '完成' }); summary.append(done, dataText('span', '本堂學生都已點名，紀錄也已填寫。')) }
      if (settled && flagged.length) summary.append(dataText('span', `其餘 ${settled} 位本堂學生已處理完成。`))
      if (others) summary.append(dataText('span', `另有 ${others} 位非本堂學生，請見下方「非本堂學生」。`))
      if (summary.childNodes.length) nodes.push(summary)
      body.replaceChildren(...nodes)
    }
    refresh()
    return { panel, refresh }
  }
  globalThis.edulogSiteSessionPanel = Object.freeze({ mount, readRoster, readSession })
})()
