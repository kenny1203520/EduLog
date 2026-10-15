// Class roster (班級名單) cards with filter chips. One card per enrolment; the native
// #students-table stays in the DOM (hidden) and remains the source for every action:
// the batch checkbox, teaching note and laptop loan are the provider's own controls.
(() => {
  const lexicon = globalThis.edulogSiteLexicon
  if (!lexicon) return
  const { text: words, selectors } = lexicon
  const LOW_REMAINING = 2
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  const CHIPS = [['all', '全部'], ['low', '剩餘少'], ['notStarted', '尚未開課'], ['special', '特殊狀態']]
  // Assumption to verify on the live site: rows carry the legend's classes, or its inline colours.
  const SPECIAL = [
    { test: row => row.classList.contains('audition'), tone: 'info', label: '本週試聽' },
    { test: row => row.classList.contains('auditioned'), tone: 'neutral', label: '已試聽' },
    { test: (row, colour) => row.classList.contains('temp-transfer') || colour === 'lightyellow', tone: 'info', label: '調課' },
    { test: (row, colour) => colour === '#f39c12' || colour === 'rgb(243, 156, 18)', tone: 'warn', label: '進度較慢' },
  ]
  const rowColour = row => collapse(/background(?:-color)?\s*:\s*([^;]+)/i.exec(row.getAttribute('style') || '')?.[1]).toLowerCase()

  // ---- Reading ---------------------------------------------------------------
  function readEnrolments(table) {
    const header = [...table.rows].find(row => [...row.cells].some(cell => words.nameHeader.test(collapse(cell.textContent))))
    if (!header) return []
    const headers = [...header.cells].map(cell => collapse(cell.textContent))
    const column = pattern => headers.findIndex(label => pattern.test(label))
    const at = { name: column(words.nameHeader), grade: column(/年級/), course: column(/課程/), signup: column(/報名時間/), remaining: column(words.remainingLessons), makeup: column(/補課/) }
    const doc = table.ownerDocument
    const enrolments = []
    for (const row of [...table.tBodies].flatMap(body => [...body.rows])) {
      if (row === header || row.querySelector('th') || row.cells.length < headers.length) continue
      const cell = key => row.cells[at[key]]
      const nameCell = cell('name')
      // The name is the cell's own text, without the note popover or the laptop frame.
      const name = collapse([...(nameCell?.childNodes || [])].filter(node => node.nodeType === 3 || (node.nodeType === 1 && !node.matches('a, turbo-frame, [data-edulog-owned]'))).map(node => node.textContent).join(' '))
      if (!name) continue
      const admission = row.querySelector(selectors.admissionId)?.getAttribute('data-admission-id') || null
      const courseCell = cell('course')
      const course = collapse([...(courseCell?.childNodes || [])].filter(node => node.nodeType === 3 || node.nodeName === 'SPAN').map(node => node.textContent).join(' '))
      const period = collapse([...(courseCell?.querySelectorAll(':scope > div') || [])].map(node => node.textContent).join(' '))
      const signup = cell('signup')
      const startBadge = [...(signup?.querySelectorAll('.badge') || [])].find(node => words.plannedStart.test(node.textContent))
      const remaining = /(\d+)\s*\/\s*(\d+)/.exec(collapse(cell('remaining')?.textContent))
      const makeup = /(\d+)\s*\/\s*(\d+)/.exec(collapse(cell('makeup')?.textContent))
      const colour = rowColour(row)
      const note = row.querySelector(selectors.noteLink)
      enrolments.push({
        row, name, admission,
        grade: collapse(cell('grade')?.textContent),
        course, period,
        plannedStart: startBadge ? collapse(startBadge.nextElementSibling?.textContent) || '未定' : null,
        remaining: remaining ? Number(remaining[1]) : null, total: remaining ? Number(remaining[2]) : null,
        makeup: makeup ? { used: Number(makeup[1]), allowed: Number(makeup[2]) } : null,
        special: SPECIAL.filter(item => item.test(row, colour)).map(({ tone, label }) => ({ tone, label })),
        checkbox: row.cells[0]?.querySelector('input[type=checkbox]') || null,
        note, noteHasContent: Boolean(collapse(note?.querySelector('.admission-comment-box')?.textContent)),
        laptop: row.querySelector(selectors.laptopFrame),
        // The full-record link lives in the lesson report table for the same admission.
        profile: admission ? [...doc.querySelectorAll(`a[href="/dt_admissions/${admission}"]`)][0] || null : null,
      })
    }
    const byName = new Map()
    for (const item of enrolments) byName.set(item.name, (byName.get(item.name) || 0) + 1)
    for (const item of enrolments) item.sameName = byName.get(item.name)
    return enrolments
  }
  const isLow = item => item.remaining !== null && !item.plannedStart && item.remaining <= LOW_REMAINING
  function matchesChip(item, chip) {
    if (chip === 'low') return isLow(item)
    if (chip === 'notStarted') return Boolean(item.plannedStart)
    if (chip === 'special') return item.special.length > 0 || item.sameName > 1
    return true
  }
  const countChips = items => Object.fromEntries(CHIPS.map(([chip]) => [chip, items.filter(item => matchesChip(item, chip)).length]))
  // Fewest lessons left first (0 before 1–2), then the provider's order.
  const rank = item => isLow(item) ? (item.remaining === 0 ? 0 : 1) : 2
  const sortEnrolments = items => items.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map(entry => entry.item)
  function badgesFor(item) {
    const badges = []
    if (isLow(item)) badges.push({ tone: item.remaining === 0 ? 'danger' : 'warn', icon: 'clock', label: `剩餘 ${item.remaining} 堂` })
    if (item.plannedStart) badges.push({ tone: 'neutral', icon: 'pause', label: `尚未開課 · 預計 ${item.plannedStart}` })
    for (const special of item.special) badges.push({ ...special, icon: special.tone === 'warn' ? 'alert' : 'tag' })
    if (item.sameName > 1) badges.push({ tone: 'neutral', icon: 'tag', label: `同名 ${item.sameName} 筆報名` })
    return badges
  }

  // ---- Rendering -------------------------------------------------------------
  const ICONS = { alert: ['M12 8v5', 'M12 16.5h.01', 'circle'], clock: ['M12 7v5l3 2', 'circle'], pause: ['M10 8v8', 'M14 8v8', 'circle'], note: ['M6 3h9l3 3v15H6z', 'M9 11h6', 'M9 15h6'], tag: ['M4 4h7l9 9-7 7-9-9z', 'M8.5 8.5h.01'] }
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
  function mount({ doc, scope, table, box, view, onChange }) {
    const { element, listen, mark, move } = scope
    const items = readEnrolments(table)
    if (!items.length) return null
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    const proxy = (label, target) => { const button = element('button', label); button.type = 'button'; listen(button, 'click', () => { if (target?.isConnected) target.click() }); return button }

    // Chips sit in the existing search box; the colour legend is replaced by text badges.
    const chips = element('div'); chips.className = 'edulog-filter-chips'; chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', '名單篩選')
    const chipButtons = new Map()
    for (const [chip, label] of CHIPS) {
      const button = element('button'); button.type = 'button'; button.dataset.rosterChip = chip
      const count = element('span'); count.className = 'edulog-chip-count'
      button.append(dataText('span', label), count); chips.append(button); chipButtons.set(chip, { button, count })
      listen(button, 'click', () => { view.rosterFilter = chip; onChange?.() })
    }
    box.append(chips)
    const legend = table.closest('.tab-pane, .content')?.querySelector(selectors.rosterLegend)
    if (legend) mark(legend.closest('.row') || legend, 'data-edulog-replaced', '')

    // Batch selection stays native: card boxes and 全選 click the provider's checkboxes.
    const headerBox = [...table.rows].find(row => row.querySelector('th'))?.querySelector('th input[type=checkbox]')
    const boxes = []
    const syncBoxes = () => { for (const [own, native] of boxes) own.checked = native.checked }
    if (headerBox) {
      const label = element('label'); label.className = 'edulog-roster-select-all'
      const all = element('input'); all.type = 'checkbox'
      listen(all, 'change', () => { if (headerBox.checked !== all.checked) headerBox.click(); syncBoxes() })
      label.append(all, dataText('span', '全選名單')); box.append(label)
      boxes.push([all, headerBox])
    }

    const section = scope.add(element('section')); section.className = 'edulog-roster-cards'; section.setAttribute('aria-label', '班級名單')
    const status = element('p'); status.className = 'edulog-cards-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
    const list = element('ul'); list.className = 'edulog-card-list'
    section.append(status, list)
    const region = table.closest('.table-responsive, [data-edulog-scroll]') || table
    region.before(section)
    mark(region, 'data-edulog-cards', 'on')

    const cards = new Map(items.map(item => {
      const li = element('li'); li.className = 'edulog-roster-card'
      li.dataset.group = isLow(item) ? (item.remaining === 0 ? 'danger' : 'warn') : item.plannedStart ? 'paused' : 'ok'
      const face = element('div'); face.className = 'edulog-card-face'
      const main = element('div'); main.className = 'edulog-card-main'
      const title = element('strong'); title.textContent = item.name
      if (item.noteHasContent) { const mark = icon(doc, 'note'); mark.setAttribute('aria-hidden', 'false'); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', '有教學備註'); title.append(mark) }
      main.append(title, dataText('span', [item.grade, item.course].filter(Boolean).join(' · '), 'edulog-todo-meta'))
      main.append(dataText('span', item.plannedStart ? `預計 ${item.plannedStart} 開課` : item.period, 'edulog-todo-meta'))
      const progress = element('div'); progress.className = 'edulog-roster-progress'
      if (item.total) {
        progress.append(dataText('span', `剩餘 ${item.remaining} / ${item.total} 堂`, 'edulog-roster-remaining'))
        const bar = element('span'); bar.className = 'edulog-roster-bar'; bar.setAttribute('aria-hidden', 'true'); bar.dataset.tone = li.dataset.group
        const fill = element('span'); fill.style.width = `${Math.round(100 * item.remaining / item.total)}%`; bar.append(fill)
        progress.append(bar)
      }
      if (item.makeup) progress.append(dataText('span', `補課 ${item.makeup.used} / ${item.makeup.allowed}`, 'edulog-todo-meta'))
      const badges = element('div'); badges.className = 'edulog-card-badges'
      for (const badge of badgesFor(item)) {
        const node = element('span'); node.className = 'edulog-badge'; node.dataset.tone = badge.tone
        node.append(icon(doc, badge.icon), dataText('span', badge.label)); badges.append(node)
      }
      const actions = element('div'); actions.className = 'edulog-card-actions'
      if (item.checkbox) {
        const label = element('label'); label.className = 'edulog-roster-select'
        const own = element('input'); own.type = 'checkbox'; own.setAttribute('aria-label', `選取 ${item.name}`)
        listen(own, 'change', () => { if (item.checkbox.checked !== own.checked) item.checkbox.click(); syncBoxes() })
        listen(item.checkbox, 'change', syncBoxes)
        label.append(own, dataText('span', '選取')); actions.append(label)
        boxes.push([own, item.checkbox])
      }
      const more = element('details'); more.className = 'edulog-card-more'
      const summary = element('summary', '更多'); summary.setAttribute('aria-label', `${item.name} 更多操作`)
      const menu = element('div'); menu.className = 'edulog-card-menu'
      if (item.note) menu.append(proxy('教學備註', item.note))
      if (item.profile) { const link = element('a', '完整紀錄'); link.href = item.profile.getAttribute('href'); menu.append(link) }
      if (item.laptop) {
        // The provider's own laptop-loan dropdown moves here so it stays usable while the table is hidden.
        const loan = element('div'); loan.className = 'edulog-roster-laptop'
        loan.append(dataText('span', '筆電借用', 'edulog-card-status-label'))
        menu.append(loan); move(item.laptop, loan)
      }
      more.append(summary, menu)
      if (menu.childNodes.length) actions.append(more)
      face.append(main, progress, badges, actions)
      li.append(face)
      return [item.row, li]
    }))

    return {
      allows: row => { const item = items.find(entry => entry.row === row); return !item || matchesChip(item, view.rosterFilter || 'all') },
      render(visible) {
        const chip = CHIPS.some(([key]) => key === view.rosterFilter) ? view.rosterFilter : 'all'
        view.rosterFilter = chip
        const counts = countChips(items)
        for (const [key, { button, count }] of chipButtons) { count.textContent = String(counts[key]); button.setAttribute('aria-pressed', String(key === chip)); button.dataset.empty = String(!counts[key]) }
        const shown = sortEnrolments(items.filter(item => visible.has(item.row) && matchesChip(item, chip)))
        list.replaceChildren(...shown.map(item => cards.get(item.row)))
        syncBoxes()
        status.textContent = shown.length ? '' : '沒有符合篩選的學生。'
        status.hidden = Boolean(shown.length)
      },
    }
  }
  globalThis.edulogSiteRoster = Object.freeze({ CHIPS, readEnrolments, matchesChip, countChips, sortEnrolments, badgesFor, mount })
})()
