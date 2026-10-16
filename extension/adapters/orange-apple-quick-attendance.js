// "本週快速點名" as a grid of tappable student tiles. The provider's form stays in the page,
// hidden, and remains the only thing that saves: each tile mirrors one native report_ids[]
// checkbox, and the two actions click the provider's own submit buttons.
(() => {
  const lexicon = globalThis.edulogSiteLexicon, model = globalThis.edulogSiteModel, cardsApi = globalThis.edulogSiteSessionCards
  if (!lexicon || !model || !cardsApi) return
  const { selectors } = lexicon
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  const MARKS = { present: ['ok', '出席'], absent: ['danger', '缺席'], unmarked: ['warn', '未點名'] }

  // ---- Reading ---------------------------------------------------------------
  // Header cells read "姓名 L2 <note><br>課程(9)"; used when a report is not in the table.
  function readHeader(th) {
    if (!th) return { name: '', course: '', lesson: '' }
    const nodes = [...th.childNodes], br = nodes.findIndex(node => node.nodeName === 'BR')
    const head = collapse(nodes.slice(0, br < 0 ? nodes.length : br).filter(node => node.nodeType === 3).map(node => node.textContent).join(' '))
    const course = br < 0 ? '' : collapse(nodes.slice(br + 1).map(node => node.textContent).join(' ')).replace(/\(\d+\)$/, '')
    return { name: head.split(' ')[0] || '', course, lesson: /\bL(\d+)\b/.exec(head)?.[0] || '' }
  }
  function read({ form, reports, roster = new Map(), notStarted = () => false }) {
    const boxes = [...form.querySelectorAll(selectors.quickAttendanceBox)]
    if (!boxes.length) return []
    const weeks = reports ? model.readWeekColumns(reports.querySelectorAll('tr:first-child th')) : []
    const sessions = new Map()
    const studentFor = cell => {
      const week = weeks.find(item => item.index === cell.cellIndex)
      if (!week) return null
      if (!sessions.has(week.index)) sessions.set(week.index, cardsApi.readSession(reports, week, roster, { notStarted: notStarted(week.label) }))
      return sessions.get(week.index).students.find(student => student.row === cell.parentElement) || null
    }
    const entries = boxes.map((box, index) => {
      const cell = box.closest('td'), headRow = cell?.closest('tr')?.previousElementSibling
      const header = readHeader(headRow?.cells[cell.cellIndex])
      const id = /^\d+$/.test(box.value) ? box.value : null
      const reportCell = id && reports?.querySelector(`turbo-frame#report_status_${id}`)?.closest('td')
      const student = reportCell ? studentFor(reportCell) : null
      return {
        box, id, index, student,
        name: student?.name || header.name || `第 ${index + 1} 位`,
        course: student?.course || header.course,
        lesson: student?.state.scheduledLesson || '',
        mark: student?.state.attendanceMark || null,
      }
    })
    // Same order as the student cards below; anything not found in the table goes last.
    const order = cardsApi.sortStudents(entries.filter(entry => entry.student).map(entry => entry.student))
    const rank = new Map(order.map((student, index) => [student, index]))
    return entries.sort((a, b) => (a.student ? rank.get(a.student) : Infinity) - (b.student ? rank.get(b.student) : Infinity) || a.index - b.index)
  }

  // ---- Rendering -------------------------------------------------------------
  function mount({ doc, scope, form, entries, view = {} }) {
    if (!entries.length) return null
    const { element, listen, mark } = scope
    const win = doc.defaultView
    const text = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    const badge = (tone, label) => { const node = text('span', label, 'edulog-badge'); node.dataset.tone = tone; return node }
    const button = (label, className) => { const node = element('button', label); node.type = 'button'; if (className) node.className = className; return node }

    const section = scope.add(element('section'))
    section.className = 'edulog-quick-attendance'; section.setAttribute('aria-label', '本週快速點名')
    const head = element('div'); head.className = 'edulog-qa-head'
    const title = element('h3', '本週快速點名')
    const counts = element('p'); counts.className = 'edulog-qa-counts'
    const tools = element('div'); tools.className = 'edulog-qa-tools'; tools.setAttribute('role', 'group'); tools.setAttribute('aria-label', '選取學生')
    const all = button('全選'), invert = button('反選'), clear = button('清除')
    tools.append(all, invert, clear)
    head.append(title, counts, tools)

    const grid = element('ul'); grid.className = 'edulog-qa-grid'
    const tiles = new Map()
    for (const entry of entries) {
      const li = element('li')
      const tile = element('label'); tile.className = 'edulog-qa-tile'
      const box = element('input'); box.type = 'checkbox'
      const main = element('span'); main.className = 'edulog-qa-main'
      const meta = [entry.lesson && `本堂 ${entry.lesson}`, entry.course].filter(Boolean).join(' · ')
      main.append(text('strong', entry.name))
      if (meta) main.append(text('span', meta, 'edulog-qa-meta'))
      const [tone, word] = MARKS[entry.mark] || ['neutral', '—']
      tile.dataset.mark = entry.mark || 'unknown'
      tile.append(box, main, badge(tone, word))
      li.append(tile); grid.append(li)
      tiles.set(entry, { tile, box })
      listen(box, 'change', () => { entry.box.checked = box.checked; update() })
    }

    const bar = element('div'); bar.className = 'edulog-qa-bar'
    const selected = element('span'); selected.className = 'edulog-qa-selected'; selected.setAttribute('role', 'status'); selected.setAttribute('aria-live', 'polite')
    const present = button('設定為出席', 'edulog-qa-present'), absent = button('設定為不出席', 'edulog-qa-absent')
    bar.append(selected, present, absent)

    const tally = { present: 0, absent: 0, unmarked: 0 }
    for (const entry of entries) if (tally[entry.mark] !== undefined) tally[entry.mark]++
    counts.textContent = `應出 ${entries.length} · 出席 ${tally.present} · 缺席 ${tally.absent} · 未點名 ${tally.unmarked}`
    // Once every student has a mark the block folds into one line; it stays editable when reopened.
    const done = entries.every(entry => entry.mark === 'present' || entry.mark === 'absent')
    if (done) {
      const details = element('details'); details.className = 'edulog-qa-done'
      const summary = element('summary')
      summary.append(badge('ok', '完成'), text('span', `已點名 ${entries.length}/${entries.length}：出席 ${tally.present}、缺席 ${tally.absent}`))
      details.open = Boolean(view.quickAttendanceOpen)
      details.append(summary, head, grid, bar)
      listen(details, 'toggle', () => { view.quickAttendanceOpen = details.open })
      section.append(details)
    } else section.append(head, grid, bar)
    form.before(section)
    mark(form, 'data-edulog-replaced', '')

    let busy = false
    function update() {
      const chosen = entries.filter(entry => entry.box.checked)
      for (const [entry, { tile, box }] of tiles) { box.checked = entry.box.checked; tile.dataset.selected = String(entry.box.checked) }
      selected.textContent = chosen.length ? `已選 ${chosen.length} 位` : '勾選學生後設定出席狀態'
      bar.dataset.active = String(chosen.length > 0)
      if (!busy) present.disabled = absent.disabled = !chosen.length
    }
    const setAll = value => { for (const entry of entries) entry.box.checked = typeof value === 'function' ? value(entry) : value; update() }
    listen(all, 'click', () => setAll(true))
    listen(invert, 'click', () => setAll(entry => !entry.box.checked))
    listen(clear, 'click', () => setAll(false))
    function submit(type, trigger) {
      const chosen = entries.filter(entry => entry.box.checked)
      const nativeButton = form.querySelector(`${selectors.quickAttendanceSubmit}[value="${type}"]`)
      if (!chosen.length || !nativeButton || busy) return
      if (type === '1' && !win.confirm(`將 ${chosen.length} 位設為不出席：${chosen.map(entry => entry.name).join('、')}\n不出席的學生本堂無法啟用課程。`)) return
      busy = true
      present.disabled = absent.disabled = true
      trigger.textContent = '送出中…'
      // The provider re-renders this turbo-frame after saving, which rebuilds the tiles.
      // If nothing comes back, let the teacher try again.
      win.setTimeout(() => { if (!section.isConnected) return; busy = false; trigger.textContent = type === '1' ? '設定為不出席' : '設定為出席'; update() }, 15000)
      nativeButton.click()
    }
    listen(present, 'click', () => submit('0', present))
    listen(absent, 'click', () => submit('1', absent))
    update()

    const reduceMotion = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    return {
      element: section,
      // Used by the student cards' 尚未點名 badge: bring the tile into view without selecting it.
      targetFor(row) {
        const entry = entries.find(item => item.student?.row === row)
        return entry ? tiles.get(entry).tile : null
      },
      reveal(row) {
        const entry = entries.find(item => item.student?.row === row)
        if (!entry) return false
        const { tile, box } = tiles.get(entry)
        const details = section.querySelector('details.edulog-qa-done')
        if (details) details.open = true
        tile.scrollIntoView?.({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' })
        tile.setAttribute('data-edulog-flash', '')
        win.setTimeout(() => tile.removeAttribute('data-edulog-flash'), 1600)
        box.focus?.({ preventScroll: true })
        return true
      },
    }
  }
  globalThis.edulogSiteQuickAttendance = Object.freeze({ read, mount, readHeader })
})()
