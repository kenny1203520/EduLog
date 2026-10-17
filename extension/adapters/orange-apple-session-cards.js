// Single-session student cards for the lesson report table, plus the filter chips that
// drive both the cards and the native table. Every action clicks the provider's own
// link or button; the extension never submits anything itself.
(() => {
  const lexicon = globalThis.edulogSiteLexicon, model = globalThis.edulogSiteModel
  if (!lexicon || !model) return
  const { text: words, selectors } = lexicon
  const LOW_REMAINING = 2
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  const CHIPS = [['pending', '待處理'], ['attention', '需關注'], ['unmarked', '未點名'], ['incomplete', '資料未齊'], ['all', '全部'], ['other', '非本堂']]
  const GROUP_RANK = { danger: 0, warn: 1, ok: 2, paused: 3, other: 4 }

  // ---- Reading ---------------------------------------------------------------
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
  const linkMatching = (row, test) => [...row.querySelectorAll('a[href]')].find(a => test(a.getAttribute('href') || '', a))
  function readStudent(row, week, roster, upcoming) {
    const nameCell = row.cells[0], courseCell = row.cells[1], cell = row.cells[week.index]
    const name = collapse(nameCell?.querySelector(':scope > span')?.textContent) || row.getAttribute('data-edulog-student-name') || model.sessionText(nameCell)
    const admission = row.querySelector(selectors.admissionId)?.getAttribute('data-admission-id') || null
    const state = model.readSessionCell(cell, { upcoming })
    const courseText = collapse(courseCell?.textContent)
    const expired = words.courseExpired.exec(courseText)?.[0] || null
    const remaining = admission ? roster.get(admission)?.remaining : undefined
    const stats = /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/.exec(collapse(row.cells[2]?.textContent))
    const note = row.querySelector(selectors.noteLink)
    const paused = Boolean(state.courseStatus && !state.otherSession)
    const issues = []
    if (!state.otherSession) {
      // 需關注 (red) is about the student; 待處理 (amber) is something the teacher still has to fill in.
      if (state.attendanceMark === 'absent') issues.push({ tone: 'danger', icon: 'alert', label: '缺席' })
      else if (state.attendancePending) issues.push({ tone: 'warn', icon: 'clock', label: '尚未點名' })
      if (state.behind) issues.push({ tone: 'danger', icon: 'alert', label: '跟不上進度' })
      if (state.reportPending) issues.push({ tone: 'warn', icon: 'pencil', label: '資料未齊' })
      if (expired) issues.push({ tone: 'danger', icon: 'alert', label: '課程已到期' })
      else if (remaining !== undefined && remaining <= LOW_REMAINING) issues.push({ tone: 'warn', icon: 'clock', label: `剩餘 ${remaining} 堂` })
    }
    const group = state.otherSession ? 'other' : issues.some(issue => issue.tone === 'danger') ? 'danger' : issues.length ? 'warn' : paused ? 'paused' : 'ok'
    // Assumption to verify on the live site: an available "啟用 L" control is the provider's
    // .enable-ks-lesson-btn without disabled/invisible; "已啟用 Lx" is a disabled div.
    const enable = cell?.querySelector(selectors.enableLesson)
    const enableReady = Boolean(enable && !enable.disabled && !enable.classList.contains('disabled') && !enable.classList.contains('invisible'))
    return {
      row, name, admission, state, issues, group, paused, other: state.otherSession, upcoming,
      course: collapse(courseCell?.querySelector('span')?.textContent),
      stage: collapse(courseCell?.querySelector(selectors.lastStage)?.textContent),
      recordLink: cell?.querySelector(selectors.recordLink) || null,
      enable: enableReady ? enable : null, enableBlocked: Boolean(enable) && !enableReady && state.attendancePending,
      stats: stats ? { attended: stats[1], absent: stats[2], unrecorded: stats[3] } : null,
      // Assumption to verify: the note popover box has text only when a note exists.
      note, noteHasContent: Boolean(collapse(note?.querySelector('.admission-comment-box')?.textContent)),
      profile: linkMatching(row, href => lexicon.paths.enrollment.test(href)),
      account: linkMatching(row, href => /\/students\/\d+\/accounts/.test(href)),
      review: linkMatching(row, href => /teachers_comment/.test(href)),
      project: linkMatching(row, href => /code_check/.test(href)),
      lastTeaching: row.querySelector('.edulog-last-teaching-toggle'),
    }
  }
  // A session that has not started yet (later this week) is treated like next week's: nothing is due.
  function readSession(table, week, roster = new Map(), { notStarted = false } = {}) {
    const upcoming = words.nextWeek.test(week.label) || notStarted
    const students = [...table.tBodies].flatMap(body => [...body.rows])
      .filter(row => !row.hasAttribute('data-edulog-last-teaching-row') && row.cells[week.index])
      .map(row => readStudent(row, week, roster, upcoming))
    return { label: week.label, upcoming, notStarted, students }
  }
  function matchesChip(student, chip) {
    if (chip === 'other') return student.other
    if (student.other) return false
    if (chip === 'pending') return student.issues.some(issue => issue.tone === 'warn')
    if (chip === 'attention') return student.issues.some(issue => issue.tone === 'danger')
    if (chip === 'unmarked') return student.state.attendancePending
    if (chip === 'incomplete') return student.state.reportPending
    return true
  }
  // The lesson report page opens on the whole class (exceptions sorted first); the chip
  // counts show how many need attention, and a chip narrows the list when wanted.
  const defaultChip = () => 'all'
  const countChips = students => Object.fromEntries(CHIPS.map(([chip]) => [chip, students.filter(student => matchesChip(student, chip)).length]))
  const sortStudents = students => students.map((student, index) => ({ student, index })).sort((a, b) => GROUP_RANK[a.student.group] - GROUP_RANK[b.student.group] || a.index - b.index).map(item => item.student)

  // ---- Teaching-note reminders ----------------------------------------------
  // A note is "new" when it has content that differs from the last one the teacher opened.
  // Note text stays in memory; only SHA-256 fingerprints go to extension storage.
  const noteText = student => collapse(student.note?.querySelector('.admission-comment-box')?.textContent)
  const notes = { hashes: new Map(), seen: new Map() }
  async function fingerprint(text) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }
  async function syncNotes(students, onChange) {
    const runtime = globalThis.edulogRuntime
    if (!runtime?.send || !globalThis.crypto?.subtle) return
    const changed = students.filter(student => student.admission && student.noteHasContent && notes.hashes.get(student.admission)?.text !== noteText(student))
    if (!changed.length) return
    for (const student of changed) notes.hashes.set(student.admission, { text: noteText(student), hash: await fingerprint(noteText(student)) })
    const ids = changed.map(student => student.admission)
    const result = await runtime.send({ type: 'get-notes-seen', ids }).catch(() => null)
    if (!result?.seen) return
    for (const id of ids) notes.seen.set(id, result.seen[id] || null)
    onChange?.()
  }
  const noteIsNew = student => {
    const current = student.admission && student.noteHasContent && notes.hashes.get(student.admission)
    return Boolean(current && notes.seen.has(student.admission) && notes.seen.get(student.admission) !== current.hash)
  }
  function markNoteSeen(student) {
    const current = notes.hashes.get(student.admission)
    if (!current) return
    notes.seen.set(student.admission, current.hash)
    void globalThis.edulogRuntime?.send({ type: 'note-seen', id: student.admission, hash: current.hash }).catch(() => {})
  }

  // ---- Rendering -------------------------------------------------------------
  const ICONS = { alert: ['M12 8v5', 'M12 16.5h.01', 'circle'], clock: ['M12 7v5l3 2', 'circle'], check: ['M7 12.5l3.2 3.2L17 9'], pencil: ['M4 20h4l10-10-4-4L4 16z', 'M13.5 6.5l4 4'], pause: ['M10 8v8', 'M14 8v8', 'circle'], note: ['M6 3h9l3 3v15H6z', 'M9 11h6', 'M9 15h6'], cross: ['M8 8l8 8', 'M16 8l-8 8'], dash: ['M7 12h10'], triangle: ['M12 4l9 16H3z', 'M12 10v4'] }
  function icon(doc, name) {
    const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg')
    svg.setAttribute('data-edulog-owned', ''); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'edulog-icon')
    for (const shape of ICONS[name]) {
      const node = doc.createElementNS(ns, shape === 'circle' ? 'circle' : 'path')
      if (shape === 'circle') { node.setAttribute('cx', '12'); node.setAttribute('cy', '12'); node.setAttribute('r', '9') } else node.setAttribute('d', shape)
      node.setAttribute('data-edulog-owned', ''); svg.append(node)
    }
    return svg
  }
  function createChips({ doc, scope, onSelect }) {
    const { element, listen } = scope
    const group = element('div'); group.className = 'edulog-filter-chips'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', '學生篩選')
    const buttons = new Map()
    for (const [chip, label] of CHIPS) {
      const button = element('button'); button.type = 'button'; button.dataset.chip = chip
      const text = element('span', label), count = element('span'); count.className = 'edulog-chip-count'
      button.append(text, count); group.append(button); buttons.set(chip, { button, count })
      listen(button, 'click', () => onSelect(chip))
    }
    return {
      element: group,
      update(counts, active) {
        for (const [chip, { button, count }] of buttons) {
          count.textContent = String(counts[chip] ?? 0)
          button.setAttribute('aria-pressed', String(chip === active))
          button.dataset.empty = String(!counts[chip])
        }
      },
    }
  }
  // 精簡列 (from 1024px): one line per student. Remembered per list in extension storage.
  function createDensityToggle({ scope, key, target, view }) {
    const { element, listen } = scope
    const button = element('button', '精簡列'); button.type = 'button'; button.className = 'edulog-density-toggle'
    const apply = compact => { button.setAttribute('aria-pressed', String(compact)); if (compact) target.dataset.edulogDensity = 'compact'; else delete target.dataset.edulogDensity; view.density = { ...view.density, [key]: compact } }
    apply(Boolean(view.density?.[key]))
    listen(button, 'click', () => {
      const compact = button.getAttribute('aria-pressed') !== 'true'
      apply(compact)
      void globalThis.edulogRuntime?.send({ type: 'set-density', list: key, density: compact ? 'compact' : 'comfortable' })?.catch(() => {})
    })
    if (view.density?.[key] === undefined) void globalThis.edulogRuntime?.send({ type: 'get-density' })?.then(result => { if (result?.density && target.isConnected) apply(result.density[key] === 'compact') }).catch(() => {})
    return button
  }
  // Folds cards with nothing to act on into one row (used by the class roster).
  function calmGroup(scope, label) {
    const { element } = scope
    const li = element('li'); li.className = 'edulog-calm-group'
    const details = element('details'), summary = element('summary'), list = element('ul')
    list.className = 'edulog-card-list'
    details.append(summary, list); li.append(details)
    return { li, update(cards) { summary.textContent = label(cards.length); list.replaceChildren(...cards) } }
  }

  function mountCards({ doc, scope, anchor, onChange, revealAttendance }) {
    const { element, listen } = scope
    const section = scope.add(element('section'))
    section.className = 'edulog-session-cards'; section.setAttribute('aria-label', '本堂學生')
    const status = element('p'); status.className = 'edulog-cards-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    const list = element('ul'); list.className = 'edulog-card-list'
    section.append(status, list)
    anchor.before(section)
    const cards = new Map()
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    const badge = (tone, iconName, label) => { const node = element('span'); node.className = 'edulog-badge'; node.dataset.tone = tone; node.append(icon(doc, iconName), dataText('span', label)); return node }
    const proxy = (label, target, className, aria) => {
      const button = element('button', label); button.type = 'button'; if (className) button.className = className
      if (aria) button.setAttribute('aria-label', aria)
      listen(button, 'click', () => { if (target?.isConnected) target.click() })
      return button
    }
    function cardFor(student) {
      let card = cards.get(student.row)
      if (card) return card
      const li = element('li'); li.className = 'edulog-session-card'
      const face = element('div'); face.className = 'edulog-card-face'
      const detail = element('div'); detail.className = 'edulog-card-detail'
      li.append(face, detail)
      // The last-teaching disclosure lives in the hidden native row; show it under the card.
      const panel = student.lastTeaching?.closest('tr')?.nextElementSibling?.querySelector('.edulog-last-teaching-panel')
      if (panel) scope.move(panel, detail)
      card = { li, face }
      cards.set(student.row, card)
      return card
    }
    // Four-cell status row: attendance | completion | internal record | learning performance.
    // Each cell pairs colour with an icon and a word; not shown for upcoming, paused or other sessions.
    const CELL = {
      attendance: { present: ['ok', 'check', '出席'], absent: ['danger', 'cross', '缺席'], unmarked: ['warn', 'dash', '未點名'] },
      completion: { done: ['ok', 'check', '完整完成'], check: ['warn', 'triangle', '待確認'], empty: ['warn', 'dash', '未填'] },
      internal: { ok: ['ok', 'check', '跟得上'], behind: ['danger', 'cross', '跟不上'], empty: ['warn', 'dash', '未選'] },
      performance: { done: ['ok', 'check', '已完成'], empty: ['warn', 'dash', '未完成'] },
    }
    function statusStrip(student) {
      const state = student.state
      if (student.upcoming || student.other || student.paused || !state.attendanceMark) return null
      const absent = state.attendanceMark === 'absent'
      const strip = element('ul'); strip.className = 'edulog-card-status'; strip.setAttribute('aria-label', `${student.name} 本堂狀態`)
      const cells = [['attendance', '出席', state.attendanceMark], ['completion', '完成狀況', state.completionMark], ['internal', '內部紀錄', state.internalMark], ['performance', '學習表現', state.performanceMark]]
      let calm = true
      for (const [key, label, mark] of cells) {
        // Until attendance is taken the other three are not due yet; when absent they do not apply.
        const [tone, iconName, word] = key === 'attendance' ? CELL[key][mark] || ['neutral', 'dash', '—'] : absent ? ['neutral', 'dash', '不適用'] : state.attendanceMark !== 'present' ? ['neutral', 'dash', '—'] : CELL[key][mark] || ['neutral', 'dash', '—']
        if (tone !== 'ok') calm = false
        const item = element('li'); item.dataset.tone = tone
        item.append(icon(doc, iconName), dataText('span', label, 'edulog-card-status-label'), dataText('span', word, 'edulog-card-status-value'))
        strip.append(item)
      }
      strip.dataset.calm = String(calm && !absent)
      return strip
    }
    function fillFace(face, student, sessionLabel) {
      const main = element('div'); main.className = 'edulog-card-main'
      const title = element('strong'); title.textContent = student.name
      if (student.noteHasContent) { const mark = icon(doc, 'note'); mark.setAttribute('aria-hidden', 'false'); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', '有教學備註'); title.append(mark) }
      const progress = [student.course, student.state.scheduledLesson && `本堂 ${student.state.scheduledLesson}`, student.stage && `最後上課 ${student.stage}`].filter(Boolean).join(' · ')
      main.append(title, dataText('span', progress, 'edulog-todo-meta'))
      if (student.state.enabledLesson && student.state.enabledLesson !== '已啟用') main.append(dataText('span', `已啟用 ${student.state.enabledLesson}`, 'edulog-todo-meta'))
      const strip = statusStrip(student)
      const badges = element('div'); badges.className = 'edulog-card-badges'
      for (const issue of student.issues) {
        const node = badge(issue.tone, issue.icon, issue.label)
        // 尚未點名 leads to the student's quick-attendance tile when that block is on the page.
        if (issue.label === '尚未點名' && revealAttendance?.target(student.row)) {
          const jump = element('button'); jump.type = 'button'; jump.className = 'edulog-badge edulog-badge-link'; jump.dataset.tone = issue.tone
          jump.append(...node.childNodes); jump.setAttribute('aria-label', `${student.name} 尚未點名，前往快速點名`)
          listen(jump, 'click', () => revealAttendance.reveal(student.row))
          badges.append(jump)
        } else badges.append(node)
      }
      if (noteIsNew(student)) {
        const alert = element('button'); alert.type = 'button'; alert.className = 'edulog-badge edulog-note-alert'; alert.dataset.tone = 'info'
        alert.append(icon(doc, 'note'), dataText('span', '新教學備註'))
        alert.setAttribute('aria-label', `${student.name} 有新的教學備註，開啟查看`)
        listen(alert, 'click', () => { if (student.note?.isConnected) student.note.click(); markNoteSeen(student); onChange?.() })
        badges.append(alert)
      }
      if (student.other) badges.append(badge('neutral', 'pause', '非本堂'))
      else if (student.paused) badges.append(badge('neutral', 'pause', student.state.courseStatus))
      const actions = element('div'); actions.className = 'edulog-card-actions'
      const label = `${student.name} ${sessionLabel}`
      if (student.recordLink && !student.other && !student.paused) {
        const primary = !student.upcoming && student.state.attendancePending ? '點名與紀錄' : !student.upcoming && student.state.reportPending ? '填寫紀錄' : '查看紀錄'
        actions.append(proxy(primary, student.recordLink, primary === '查看紀錄' ? 'edulog-card-secondary' : 'edulog-card-primary', `${label} ${primary}`))
      }
      if (student.enable) actions.append(proxy(collapse(student.enable.textContent) || '啟用課程', student.enable, 'edulog-card-secondary', `${label} ${collapse(student.enable.textContent) || '啟用課程'}`))
      else if (student.enableBlocked) actions.append(dataText('span', '啟用需先點名', 'edulog-card-hint'))
      const more = element('details'); more.className = 'edulog-card-more'
      const summary = element('summary', '更多'); summary.setAttribute('aria-label', `${student.name} 更多操作`)
      const menu = element('div'); menu.className = 'edulog-card-menu'
      if (student.profile) { const link = element('a', '完整紀錄'); link.href = student.profile.getAttribute('href'); menu.append(link) }
      if (student.lastTeaching) menu.append(proxy('上次教學', student.lastTeaching))
      if (student.note) { const open = proxy('教學備註', student.note); if (noteIsNew(student)) listen(open, 'click', () => { markNoteSeen(student); onChange?.() }); menu.append(open) }
      if (student.review) menu.append(proxy('學生總評', student.review))
      if (student.account) menu.append(proxy('學習帳號設定', student.account))
      if (student.project) { const link = element('a', '專案檢查'); link.href = student.project.getAttribute('href'); link.target = '_blank'; link.rel = 'noopener noreferrer'; menu.append(link) }
      if (student.stats) menu.append(dataText('p', `出席 ${student.stats.attended} · 缺 ${student.stats.absent} · 未記 ${student.stats.unrecorded}`, 'edulog-card-stats'))
      more.append(summary, menu)
      if (menu.childNodes.length) actions.append(more)
      face.replaceChildren(...[main, badges, actions, strip].filter(Boolean))
    }
    return {
      element: section,
      render({ session, visible, chip, counts, hidden }) {
        section.hidden = hidden
        if (hidden) return
        const shown = sortStudents(session.students.filter(student => visible.has(student.row)))
        const open = new Set([...cards.values()].filter(card => card.face.querySelector('.edulog-card-more')?.open).map(card => card.li))
        const items = shown.map(student => {
          const card = cardFor(student)
          card.li.dataset.group = student.group
          fillFace(card.face, student, session.label)
          if (open.has(card.li)) card.face.querySelector('.edulog-card-more').open = true
          return card.li
        })
        // Every student stays listed here: teachers work through the whole class on this page.
        // Cards filtered out stay in the list, hidden, so moved provider panels can be restored.
        const rest = [...cards.values()].map(card => card.li).filter(li => !items.includes(li))
        for (const li of items) li.hidden = false
        for (const li of rest) li.hidden = true
        list.replaceChildren(...items, ...rest)
        void syncNotes(session.students, onChange)
        const notes = []
        if (session.notStarted) notes.push('本堂還沒開始上課，開始後才會列出點名與紀錄；目前只列出課程到期與堂數提醒。')
        else if (session.upcoming) notes.push('下週課次尚未開始，只列出課程到期與堂數提醒。')
        else if (!counts.pending && counts.all) notes.push(counts.attention ? `本堂沒有待補填的事項；${counts.attention} 位學生需關注。` : '本堂學生都已點名，資料也已填齊。')
        if (!items.length) notes.push(chip === 'other' && !counts.other ? '此課次沒有非本堂學生。' : '沒有符合篩選的學生。')
        status.replaceChildren()
        if (!session.upcoming && !counts.pending && counts.all) status.append(badge('ok', 'check', '完成'))
        status.append(dataText('span', notes.join(' ')))
        status.hidden = !notes.length
      },
    }
  }
  globalThis.edulogSiteSessionCards = Object.freeze({ CHIPS, defaultChip, readRoster, readSession, matchesChip, countChips, sortStudents, createChips, mountCards, createDensityToggle, calmGroup })
})()
