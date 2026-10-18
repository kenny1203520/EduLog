// Single-session student rows for the lesson report table, plus the filter chips that
// drive both the rows and the native table. Every action clicks the provider's own
// link or button; the extension never submits anything itself.
//
// One row per student: name, course · lesson, the four report statuses
// (出席 / 完成狀況 / 內部紀錄 / 學習表現) and one primary action. The statuses are shown
// for past, current (also before the lesson starts) and next week alike: teachers write
// reports on the day and check next week's absences ahead of time. Next week is not due
// yet, so its open items are neutral (grey), not amber.
(() => {
  const lexicon = globalThis.edulogSiteLexicon, model = globalThis.edulogSiteModel
  if (!lexicon || !model) return
  const { text: words, selectors } = lexicon
  const LOW_REMAINING = 2
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  // Persistent chips first; the rest sit under 更多.
  const PRIMARY_CHIPS = [['pending', '待處理'], ['unmarked', '未點名'], ['incomplete', '資料未齊'], ['all', '全部']]
  const MORE_CHIPS = [['attention', '需關注'], ['leave', '請假 / 缺席'], ['done', '已完成'], ['closed', '原站未開放'], ['other', '非本堂']]
  const CHIPS = [...PRIMARY_CHIPS, ...MORE_CHIPS]
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
    // Read as an active session so the marks are the provider's, whatever the week.
    const state = model.readSessionCell(cell)
    const courseText = collapse(courseCell?.textContent)
    const expired = words.courseExpired.exec(courseText)?.[0] || null
    const remaining = admission ? roster.get(admission)?.remaining : undefined
    const stats = /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/.exec(collapse(row.cells[2]?.textContent))
    const note = row.querySelector(selectors.noteLink)
    const paused = Boolean(state.courseStatus && !state.otherSession)
    const recordLink = cell?.querySelector(selectors.recordLink) || null
    const other = state.otherSession
    // Without the provider's edit link nothing can be filled in here: 原站未開放.
    const closed = !other && !recordLink
    const absent = state.attendanceMark === 'absent'
    const unmarked = !other && !closed && state.attendanceMark === 'unmarked'
    const open = [state.completionMark, state.internalMark, state.performanceMark].some(mark => mark === 'empty' || mark === 'check')
    const incomplete = !other && !closed && !absent && open
    const issues = []
    if (!other) {
      // 需關注 (red) is about the student; amber is something the teacher still has to fill in.
      if (absent) issues.push({ tone: 'danger', icon: 'alert', label: '缺席' })
      if (state.behind) issues.push({ tone: 'danger', icon: 'alert', label: '跟不上進度' })
      if (expired) issues.push({ tone: 'danger', icon: 'alert', label: '課程已到期' })
      else if (remaining !== undefined && remaining <= LOW_REMAINING) issues.push({ tone: 'warn', icon: 'clock', label: `剩餘 ${remaining} 堂` })
    }
    const due = !upcoming && (unmarked || incomplete)
    const group = other ? 'other' : issues.some(issue => issue.tone === 'danger') ? 'danger' : due || issues.length ? 'warn' : paused ? 'paused' : 'ok'
    // Assumption to verify on the live site: an available "啟用 L" control is the provider's
    // .enable-ks-lesson-btn without disabled/invisible; "已啟用 Lx" is a disabled div.
    const enable = cell?.querySelector(selectors.enableLesson)
    const enableReady = Boolean(enable && !enable.disabled && !enable.classList.contains('disabled') && !enable.classList.contains('invisible'))
    return {
      row, name, admission, state, issues, group, paused, other, upcoming, closed, absent, unmarked, incomplete, due,
      complete: !other && !closed && !unmarked && !incomplete && !absent,
      course: collapse(courseCell?.querySelector('span')?.textContent),
      stage: collapse(courseCell?.querySelector(selectors.lastStage)?.textContent),
      recordLink,
      enable: enableReady ? enable : null, enableBlocked: Boolean(enable) && !enableReady && unmarked,
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
  // Only next week is "upcoming". A lesson later today is due like any other: the teacher
  // may take attendance and write the report before it starts. `notStarted` only adds a hint.
  function readSession(table, week, roster = new Map(), { notStarted = false } = {}) {
    const upcoming = words.nextWeek.test(week.label)
    const students = [...table.tBodies].flatMap(body => [...body.rows])
      .filter(row => !row.hasAttribute('data-edulog-last-teaching-row') && row.cells[week.index])
      .map(row => readStudent(row, week, roster, upcoming))
    return { label: week.label, upcoming, notStarted: !upcoming && notStarted, students }
  }
  function matchesChip(student, chip) {
    if (chip === 'other') return student.other
    if (student.other) return false
    if (chip === 'pending') return Boolean(student.due)
    if (chip === 'attention') return student.issues.some(issue => issue.tone === 'danger')
    if (chip === 'unmarked') return Boolean(student.unmarked)
    if (chip === 'incomplete') return Boolean(student.incomplete)
    if (chip === 'leave') return Boolean(student.absent)
    if (chip === 'done') return Boolean(student.complete)
    if (chip === 'closed') return Boolean(student.closed)
    return true
  }
  // Past and current weeks open on 待處理 while anything is due; next week (nothing due yet)
  // and a fully done week open on 全部.
  const defaultChip = (counts = {}, session = {}) => !session.upcoming && counts.pending ? 'pending' : 'all'
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
  // Lucide icons (24×24, stroke 2). Strings are path data; objects are other SVG shapes.
  const ICONS = {
    alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
    clock: [{ circle: { cx: 12, cy: 12, r: 10 } }, 'M12 6v6l4 2'],
    check: ['M20 6 9 17l-5-5'],
    pencil: ['M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z', 'm15 5 4 4'],
    pause: [{ circle: { cx: 12, cy: 12, r: 10 } }, 'M10 15V9', 'M14 15V9'],
    note: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4', 'M16 13H8', 'M16 17H8', 'M10 9H8'],
    cross: ['M18 6 6 18', 'm6 6 12 12'],
    dash: ['M5 12h14'],
    triangle: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
    lock: [{ rect: { width: 18, height: 11, x: 3, y: 11, rx: 2 } }, 'M7 11V7a5 5 0 0 1 10 0v4'],
    'chevron-down': ['m6 9 6 6 6-6'],
    info: [{ circle: { cx: 12, cy: 12, r: 10 } }, 'M12 16v-4', 'M12 8h.01'],
  }
  function icon(doc, name) {
    const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg')
    svg.setAttribute('data-edulog-owned', ''); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'edulog-icon')
    for (const shape of ICONS[name]) {
      const [tag, attrs] = typeof shape === 'string' ? ['path', { d: shape }] : Object.entries(shape)[0]
      const node = doc.createElementNS(ns, tag)
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
      node.setAttribute('data-edulog-owned', ''); svg.append(node)
    }
    return svg
  }
  // Four persistent chips, the rest in a 更多 disclosure. A chosen 更多 chip shows its
  // name on the disclosure so the active filter is always visible.
  function createChips({ doc, scope, onSelect }) {
    const { element, listen } = scope
    const group = element('div'); group.className = 'edulog-filter-chips'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', '學生篩選')
    const buttons = new Map()
    const chipButton = (chip, label) => {
      const button = element('button'); button.type = 'button'; button.dataset.chip = chip
      const text = element('span', label), count = element('span'); count.className = 'edulog-chip-count'
      button.append(text, count); buttons.set(chip, { button, count })
      listen(button, 'click', () => { more.open = false; onSelect(chip) })
      return button
    }
    for (const [chip, label] of PRIMARY_CHIPS) group.append(chipButton(chip, label))
    const more = element('details'); more.className = 'edulog-chip-more'
    const summary = element('summary'); const summaryText = element('span', '更多'); summary.append(summaryText, icon(doc, 'chevron-down'))
    const menu = element('div'); menu.className = 'edulog-chip-menu'; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', '更多篩選')
    for (const [chip, label] of MORE_CHIPS) menu.append(chipButton(chip, label))
    more.append(summary, menu); group.append(more)
    listen(doc, 'click', event => { if (more.open && !more.contains(event.target)) more.open = false })
    return {
      element: group,
      update(counts, active) {
        for (const [chip, { button, count }] of buttons) {
          count.textContent = String(counts[chip] ?? 0)
          button.setAttribute('aria-pressed', String(chip === active))
          button.dataset.empty = String(!counts[chip])
        }
        const chosen = MORE_CHIPS.find(([chip]) => chip === active)
        summaryText.textContent = chosen ? chosen[1] : '更多'
        summary.dataset.active = String(Boolean(chosen))
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

  // Status words per mark. Tone is the due tone; next week turns warn into neutral.
  const CELL = {
    attendance: { present: ['ok', '已點名'], absent: ['danger', '缺席'], unmarked: ['warn', '未點名'] },
    completion: { done: ['ok', '已填'], check: ['warn', '待確認'], empty: ['warn', '未填'] },
    internal: { ok: ['ok', '已填'], behind: ['danger', '跟不上'], empty: ['warn', '未填'] },
    performance: { done: ['ok', '已填'], empty: ['warn', '未填'] },
  }
  const STATUS_FIELDS = [['attendance', '出席', 'attendanceMark'], ['completion', '完成狀況', 'completionMark'], ['internal', '內部紀錄', 'internalMark'], ['performance', '學習表現', 'performanceMark']]
  function statusValues(student) {
    return STATUS_FIELDS.map(([key, label, field]) => {
      const mark = student.state[field]
      let [tone, word] = student.closed ? ['neutral', '原站未開放']
        : key !== 'attendance' && student.absent ? ['neutral', '不適用']
        : CELL[key][mark] || ['neutral', '—']
      if (student.upcoming && tone === 'warn') tone = 'neutral'
      return { key, label, tone, word }
    })
  }

  function mountCards({ doc, scope, anchor, onChange, revealAttendance }) {
    const { element, listen } = scope
    const section = scope.add(element('section'))
    section.className = 'edulog-session-cards'; section.setAttribute('aria-label', '本堂學生')
    const status = element('p'); status.className = 'edulog-cards-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    const head = element('div'); head.className = 'edulog-rows-head'; head.setAttribute('aria-hidden', 'true')
    head.append(element('span', '學生'), element('span', '出席 · 完成狀況 · 內部紀錄 · 學習表現'), element('span', '操作'))
    const list = element('ul'); list.className = 'edulog-card-list edulog-row-list'
    section.append(status, head, list)
    anchor.before(section)
    const cards = new Map()
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    const tag = (tone, label, iconName) => { const node = element('span'); node.className = 'edulog-badge'; node.dataset.tone = tone; if (iconName) node.append(icon(doc, iconName)); node.append(dataText('span', label)); return node }
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
      // The last-teaching disclosure lives in the hidden native row; show it under the row.
      const panel = student.lastTeaching?.closest('tr')?.nextElementSibling?.querySelector('.edulog-last-teaching-panel')
      if (panel) scope.move(panel, detail)
      card = { li, face }
      cards.set(student.row, card)
      return card
    }
    // Four small indicators: dot + label + value. Shown for every student of this session.
    function statusStrip(student) {
      if (student.other) return null
      const strip = element('ul'); strip.className = 'edulog-card-status'; strip.setAttribute('aria-label', `${student.name} 本堂狀態`)
      const values = statusValues(student)
      for (const { key, label, tone, word } of values) {
        const item = element('li'); item.dataset.tone = tone; item.dataset.status = key
        item.setAttribute('aria-label', `${label}：${word}`)
        const dot = element('span'); dot.className = 'edulog-status-dot'; dot.setAttribute('aria-hidden', 'true')
        const parts = [dot, dataText('span', label, 'edulog-card-status-label'), dataText('span', word, 'edulog-card-status-value')]
        // 未點名 leads to the student's quick-attendance tile when that block is on the page.
        if (key === 'attendance' && student.unmarked && revealAttendance?.target(student.row)) {
          const jump = element('button'); jump.type = 'button'; jump.className = 'edulog-status-jump'
          jump.setAttribute('aria-label', `${student.name} 尚未點名，前往快速點名`)
          jump.append(...parts); item.append(jump)
          listen(jump, 'click', () => revealAttendance.reveal(student.row))
        } else item.append(...parts)
        strip.append(item)
      }
      strip.dataset.calm = String(values.every(value => value.tone === 'ok'))
      return strip
    }
    function primaryAction(student) {
      if (!student.recordLink || student.other) return null
      const label = student.unmarked ? '點名與紀錄' : student.incomplete ? '填寫紀錄' : '查看紀錄'
      return { label, primary: label !== '查看紀錄' }
    }
    function fillFace(face, student, sessionLabel) {
      const main = element('div'); main.className = 'edulog-card-main'
      const title = element('strong'); title.append(dataText('span', student.name, 'edulog-row-name'))
      if (student.noteHasContent) { const mark = icon(doc, 'note'); mark.setAttribute('aria-hidden', 'false'); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', '有教學備註'); title.append(mark) }
      // Tags next to the name: context the four statuses do not carry.
      const tags = element('span'); tags.className = 'edulog-card-badges'
      for (const issue of student.issues) tags.append(tag(issue.tone, issue.label))
      if (student.other) tags.append(tag('neutral', '非本堂'))
      else if (student.paused) tags.append(tag('neutral', student.state.courseStatus))
      if (student.closed) tags.append(tag('neutral', '原站未開放'))
      if (noteIsNew(student)) {
        const alert = element('button'); alert.type = 'button'; alert.className = 'edulog-badge edulog-note-alert'; alert.dataset.tone = 'info'
        alert.append(icon(doc, 'note'), dataText('span', '新教學備註'))
        alert.setAttribute('aria-label', `${student.name} 有新的教學備註，開啟查看`)
        listen(alert, 'click', () => { if (student.note?.isConnected) student.note.click(); markNoteSeen(student); onChange?.() })
        tags.append(alert)
      }
      if (tags.childNodes.length) title.append(tags)
      const progress = [student.course, student.state.scheduledLesson && `本堂 ${student.state.scheduledLesson}`, sessionLabel, student.stage && `最後上課 ${student.stage}`].filter(Boolean).join(' · ')
      main.append(title, dataText('span', progress, 'edulog-todo-meta'))
      if (student.state.enabledLesson && student.state.enabledLesson !== '已啟用') main.append(dataText('span', `已啟用 ${student.state.enabledLesson}`, 'edulog-todo-meta'))
      const strip = statusStrip(student)
      const actions = element('div'); actions.className = 'edulog-card-actions'
      const label = `${student.name} ${sessionLabel}`
      const action = primaryAction(student)
      if (action) actions.append(proxy(action.label, student.recordLink, action.primary ? 'edulog-card-primary' : 'edulog-card-secondary', `${label} ${action.label}`))
      else if (student.closed) { const none = dataText('span', '—', 'edulog-card-none'); none.setAttribute('aria-label', `${student.name} 原站未開放填寫`); none.setAttribute('role', 'img'); actions.append(none) }
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
      face.replaceChildren(...[main, strip, actions].filter(Boolean))
    }
    return {
      element: section,
      render({ session, visible, chip, counts, hidden }) {
        section.hidden = hidden
        if (hidden) return
        section.dataset.week = session.upcoming ? 'future' : 'due'
        const shown = sortStudents(session.students.filter(student => visible.has(student.row)))
        const open = new Set([...cards.values()].filter(card => card.face.querySelector('.edulog-card-more')?.open).map(card => card.li))
        const items = shown.map(student => {
          const card = cardFor(student)
          card.li.dataset.group = student.group
          card.li.dataset.closed = String(Boolean(student.closed))
          fillFace(card.face, student, session.label)
          if (open.has(card.li)) card.face.querySelector('.edulog-card-more').open = true
          return card.li
        })
        // Every student stays listed here: teachers work through the whole class on this page.
        // Rows filtered out stay in the list, hidden, so moved provider panels can be restored.
        const rest = [...cards.values()].map(card => card.li).filter(li => !items.includes(li))
        for (const li of items) li.hidden = false
        for (const li of rest) li.hidden = true
        list.replaceChildren(...items, ...rest)
        head.hidden = !items.length
        void syncNotes(session.students, onChange)
        const notes = []
        let tone = null
        if (session.notStarted) { tone = 'info'; notes.push('本堂還沒開始；現在就可以先點名、填寫紀錄，送出前仍可修改。') }
        else if (session.upcoming) { tone = 'info'; notes.push('下週課次：可以先填寫紀錄、查看誰請假；未填項目以灰色顯示，尚未到期。') }
        else if (!counts.pending && counts.all) { tone = 'ok'; notes.push(counts.attention ? `本堂沒有待補填的事項；${counts.attention} 位學生需關注。` : '本堂學生都已點名，資料也已填齊。') }
        if (!items.length) notes.push(chip === 'other' && !counts.other ? '此課次沒有非本堂學生。' : '沒有符合篩選的學生。')
        status.replaceChildren()
        status.dataset.tone = tone || 'neutral'
        if (tone) status.append(icon(doc, tone === 'ok' ? 'check' : 'info'))
        status.append(dataText('span', notes.join(' ')))
        status.hidden = !notes.length
      },
    }
  }
  globalThis.edulogSiteSessionCards = Object.freeze({ CHIPS, PRIMARY_CHIPS, MORE_CHIPS, defaultChip, readRoster, readSession, matchesChip, countChips, sortStudents, statusValues, createChips, mountCards, createDensityToggle, calmGroup })
})()
