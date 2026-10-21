// Overview "本週待辦" task view. Reads a few provider pages (same origin, read-only),
// renders an exceptions-first summary and links back to the native pages for every action.
(() => {
  const lexicon = globalThis.edulogSiteLexicon, model = globalThis.edulogSiteModel
  if (!lexicon || !model) return
  const { text: words, selectors, sources, paths } = lexicon
  const ORIGIN = 'https://corp.orangeapple.co'
  const FRESH_MS = 5 * 60 * 1000
  const MAX_CLASSES = 20, READERS = 3, PREVIEW = 5
  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  const plain = cell => model.sessionText(cell)
  const cache = globalThis.edulogTodoCache || (globalThis.edulogTodoCache = new Map())

  // ---- Reading ---------------------------------------------------------------
  const readable = path => [sources.unfilledCurrent, sources.unfilledMonth, sources.calendar, sources.hours].includes(path) || /^\/courses\/dt\/\d+\/lesson_reports$/.test(path)
  async function readDoc(path) {
    if (!readable(path)) throw new Error(tx('來源路徑尚未驗證。'))
    const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(15000) : undefined
    const response = await globalThis.fetch(`${ORIGIN}${path}`, { credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: timeout, headers: { Accept: 'text/html' } })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error(tx('原站頁面暫時無法讀取或權限不足。'))
    const html = await response.text()
    if (html.length > 5_000_000) throw new Error(tx('原站頁面超過可處理大小。'))
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (!doc.querySelector(selectors.content)) throw new Error(tx('原站頁面版面已變更，暫時無法辨識。'))
    return doc
  }
  // Cached per path for a few minutes; concurrent callers share one request.
  function cached(key, load, force = false) {
    const entry = cache.get(key)
    if (!force && entry && (entry.promise || Date.now() - entry.at < FRESH_MS)) return entry.promise || Promise.resolve(entry.value)
    const promise = load().then(value => { cache.set(key, { at: Date.now(), value }); return value }, error => { cache.delete(key); throw error })
    cache.set(key, { at: entry?.at || 0, value: entry?.value, promise })
    return promise
  }
  const freshValue = key => { const entry = cache.get(key); return entry && !entry.promise && Date.now() - entry.at < FRESH_MS ? entry.value : undefined }
  const sameOriginPath = href => { try { const url = new URL(href, ORIGIN); return url.origin === ORIGIN ? `${url.pathname}${url.search}` : null } catch { return null } }

  function headerIndex(row, pattern) { return [...(row?.cells || [])].findIndex(cell => pattern.test(collapse(cell.textContent))) }
  function extractUnfilled(doc, overdue) {
    const table = [...doc.querySelectorAll(`${selectors.content} table`)].find(item => {
      const head = item.tHead?.rows[0] || item.rows[0]
      return headerIndex(head, words.unfilledStudent) >= 0 && headerIndex(head, words.unfilledRecord) >= 0
    })
    if (!table) throw new Error(tx('未填寫列表版面已變更，暫時無法辨識。'))
    const head = table.tHead?.rows[0] || table.rows[0]
    const columns = { student: headerIndex(head, words.unfilledStudent), slot: headerIndex(head, words.unfilledSlot), record: headerIndex(head, words.unfilledRecord) }
    return [...table.tBodies].flatMap(body => [...body.rows]).filter(row => row.cells.length > columns.record).map(row => {
      const studentCell = row.cells[columns.student]
      const studentLink = [...studentCell.querySelectorAll('a[href]')].find(a => paths.enrollment.test(new URL(a.getAttribute('href'), ORIGIN).pathname))
      const studentCopy = studentCell.cloneNode(true)
      studentCopy.querySelectorAll('a[href]').forEach(link => {
        if (!paths.enrollment.test(new URL(link.getAttribute('href'), ORIGIN).pathname)) link.remove()
      })
      studentCopy.querySelectorAll('button,input,select,textarea,svg,i,[data-bs-toggle="tooltip"],[data-admission-id],.admission-comment-box,[data-edulog-owned]').forEach(node => node.remove())
      studentCopy.querySelectorAll('br').forEach(node => node.replaceWith(doc.createTextNode('\n')))
      const segments = studentCopy.textContent.split('\n').map(collapse).filter(Boolean)
      const courseNode = studentCopy.querySelector('small')
      const course = collapse(courseNode?.textContent) || (studentLink ? '' : segments[1] || '')
      if (segments.length < 2) courseNode?.remove()
      const student = collapse(studentLink?.textContent) || (segments.length > 1 ? segments[0] : collapse(studentCopy.textContent)) || plain(studentCell).replace(course, '').trim()
      const action = [...row.cells[columns.record].querySelectorAll('a[href]')].map(a => sameOriginPath(a.getAttribute('href'))).find(Boolean) || null
      return {
        student,
        studentPath: studentLink ? new URL(studentLink.getAttribute('href'), ORIGIN).pathname : null,
        course, slot: columns.slot >= 0 ? collapse(row.cells[columns.slot]?.textContent) : '', action, overdue,
      }
    }).filter(item => item.student)
  }
  function mergeUnfilled(overdueItems, currentItems) {
    const seen = new Set(), merged = []
    for (const item of [...overdueItems, ...currentItems]) {
      const key = item.action || `${item.studentPath}|${item.slot}`
      if (seen.has(key)) continue
      seen.add(key); merged.push(item)
    }
    return merged
  }
  function extractCalendar(doc, classPaths = []) {
    const allowed = new Set(classPaths)
    const days = []
    for (const pane of doc.querySelectorAll(`${selectors.content} ${selectors.calendarDayPane}`)) {
      const label = collapse(doc.getElementById(`${pane.id}-tab`)?.textContent) || ''
      const entries = []
      for (const table of pane.querySelectorAll('table')) {
        const rooms = [...(table.tHead?.rows[0]?.cells || [])].map(cell => collapse(cell.textContent))
        for (const row of table.tBodies.length ? [...table.tBodies].flatMap(body => [...body.rows]) : [...table.rows]) {
          const time = collapse(row.cells[0]?.textContent)
          for (const [index, cell] of [...row.cells].entries()) {
            if (index === 0) continue
            for (const link of cell.querySelectorAll('a[href]')) {
              const path = new URL(link.getAttribute('href'), ORIGIN).pathname.replace(/\/$/, '')
              if (!paths.classPage.test(path) || (allowed.size && !allowed.has(path))) continue
              entries.push({ time, room: rooms[index] || '', classPath: path, detail: collapse(cell.textContent) })
            }
          }
        }
      }
      days.push({ label, entries })
    }
    return days
  }
  // 「我的鐘點」: one row per class slot ("…201教室（菁英） - 週六 第 1 時段 (10:00 ~ 12:00)", its
  // dates, an NT$ amount), bonus rows dated by month, and other tables (營隊) with day lists.
  // Each table is followed by the provider's total line; only its NT$ figure is read, never the
  // teacher name printed next to it.
  const minutes = time => { const [h, m] = time.split(':').map(Number); return h * 60 + m }
  function extractHours(doc, now = new Date()) {
    const content = doc.querySelector(selectors.content)
    const picked = name => content.querySelector(`select[name=${name}]`)?.selectedOptions?.[0]
    const period = ['year', 'month'].map(name => collapse(picked(name)?.textContent)).filter(Boolean).join(' ')
    const year = Number(/\d{4}/.exec(picked('year')?.value || picked('year')?.textContent || '')?.[0]), month = Number(/\d{1,2}/.exec(picked('month')?.value || picked('month')?.textContent || '')?.[0])
    const today = model.siteParts(now)
    const isCurrent = !year || !month ? null : year === today.year && month === today.month + 1
    // Text between tables, in document order: segment i + 1 follows table i.
    const copy = content.cloneNode(true), tables = [...copy.querySelectorAll('table')]
    tables.forEach((table, index) => table.replaceWith(copy.ownerDocument.createTextNode(`\u0000${index}\u0000`)))
    const after = copy.textContent.split(/\u0000\d+\u0000/).slice(1)
    const lessons = [], events = [], other = []
    let unreadable = 0, sum = 0, providerTotal = 0, allTotals = true
    for (const [index, table] of [...content.querySelectorAll('table')].entries()) {
      const rows = [...table.rows]
      const section = collapse(rows[0]?.cells[0]?.textContent)
      for (const row of rows.slice(1)) {
        const cells = [...row.cells]
        if (cells.length < 3) continue
        const label = collapse(cells[0].textContent), dateText = collapse(cells[1].textContent), amountText = collapse(cells.at(-1).textContent)
        const dates = dateText.match(words.hourDate) || []
        const amount = /\d/.test(amountText) ? Number(amountText.replace(/NT\$|,|\s/g, '')) : NaN
        if (!label || !Number.isFinite(amount)) { unreadable++; continue }
        sum += amount
        const schedule = model.classSchedule(label)
        if (schedule && dates.length) lessons.push({ section, label, schedule, dates, amount, hours: dates.length * Math.max(0, minutes(schedule.end) - minutes(schedule.start)) / 60 })
        else if (dates.length) events.push({ section, label, dates, amount })
        else if (words.hourMonth.test(dateText) || !dateText) other.push({ section, label, amount })
        else unreadable++
      }
      const total = words.hourTotal.exec(after[index] || '')?.[1]
      if (total) providerTotal += Number(total.replace(/,/g, '')); else allTotals = false
    }
    const tableCount = content.querySelectorAll('table').length
    const round = value => Math.round(value * 100) / 100
    return {
      period, isCurrent,
      total: tableCount && allTotals ? providerTotal : round(sum), estimated: Boolean(tableCount) && !allTotals,
      sessions: lessons.reduce((count, item) => count + item.dates.length, 0), hours: round(lessons.reduce((count, item) => count + item.hours, 0)),
      lessons: lessons.map(({ schedule, ...item }) => ({ ...item, weekday: schedule.weekdayLabel, start: schedule.start, end: schedule.end, room: schedule.room })),
      events, other, unreadable,
    }
  }
  function extractAttendance(doc) {
    const table = doc.querySelector(selectors.reportsTable)
    if (!table) throw new Error(tx('課次報告版面已變更，暫時無法辨識。'))
    const week = model.pickWeek(model.readWeekColumns(table.querySelectorAll('tr:first-child th')))
    if (!week) return { week: null, items: [] }
    const items = []
    for (const row of [...table.tBodies].flatMap(body => [...body.rows])) {
      if (!row.cells[week.index] || row.querySelector('th')) continue
      const state = model.readSessionCell(row.cells[week.index])
      if (state.otherSession) continue
      const status = state.attendanceMark === 'absent' || (state.attendance && words.absent.test(state.attendance)) ? 'absent' : state.attendancePending ? 'pending' : null
      if (status) items.push({ student: studentName(row.cells[0]), status, label: tx(status === 'absent' ? '缺席' : state.attendanceMark === 'unmarked' ? '尚未點名' : '待確認出席') })
    }
    // Same 待處理 count as the lesson report cards, so the navigation shows one number everywhere.
    const cards = globalThis.edulogSiteSessionCards
    const pending = cards ? cards.countChips(cards.readSession(table, week, cards.readRoster(doc)).students).pending : items.filter(item => item.status === 'pending').length
    return { week: week.label, items, pending }
  }
  // Weekday, time and place for each sidebar class (shared parsing with the navigation bar).
  function describeClasses(classes, now = new Date()) {
    const nav = globalThis.edulogSiteNavigation
    const parsed = classes.map(item => ({ ...item, ...(nav ? nav.parseClassName(item.title) : { primary: item.title, secondary: '', weekday: 7, start: '' }), title: item.title }))
    return (nav ? nav.placeLabels(parsed) : parsed).map(item => ({ ...item, today: item.weekday === model.siteParts(now).weekday }))
  }
  // Read today's classes first, then those already taught this week, then the rest.
  const weekOrder = weekday => weekday === 0 ? 7 : weekday
  function prioritise(classes, now = new Date()) {
    const today = weekOrder(model.siteParts(now).weekday)
    const rank = item => item.weekday === undefined || item.weekday === 7 || item.weekday < 0 ? 2 : weekOrder(item.weekday) === today ? 0 : weekOrder(item.weekday) < today ? 1 : 2
    return classes.map((item, index) => ({ item, index })).sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index).map(entry => entry.item)
  }
  const classId = path => path.split('/').pop()
  // The provider wraps the name in a span next to comment links; fall back to the cell text.
  const studentName = cell => collapse(cell?.querySelector(':scope > span')?.textContent) || plain(cell)
  function teacherClasses(doc) {
    const links = [...doc.querySelectorAll(selectors.sidebarLinks)].map(a => ({ path: new URL(a.getAttribute('href'), ORIGIN).pathname.replace(/\/$/, ''), title: collapse(a.textContent) })).filter(item => paths.classPage.test(item.path) && item.title)
    return [...new Map(links.map(item => [item.path, item])).values()]
  }
  const loaders = {
    reports: force => Promise.all([
      cached(sources.unfilledMonth, async () => extractUnfilled(await readDoc(sources.unfilledMonth), true), force),
      cached(sources.unfilledCurrent, async () => extractUnfilled(await readDoc(sources.unfilledCurrent), false), force),
    ]).then(([overdue, current]) => mergeUnfilled(overdue, current)),
    schedule: (force, classes) => cached(sources.calendar, async () => extractCalendar(await readDoc(sources.calendar), classes.map(item => item.path)), force),
    hours: force => cached(sources.hours, async () => extractHours(await readDoc(sources.hours)), force),
    attendance: async (force, classes) => {
      const targets = prioritise(classes).slice(0, MAX_CLASSES), results = []
      let next = 0, failed = 0
      const worker = async () => {
        while (next < targets.length) {
          const item = targets[next++], path = sources.classReports(item.path.split('/').pop())
          try { results.push({ ...item, ...(await cached(path, async () => extractAttendance(await readDoc(path)), force)) }) }
          catch { failed++ }
        }
      }
      await Promise.all(Array.from({ length: READERS }, worker))
      if (failed && failed === targets.length) throw new Error(tx('各班課次報告暫時無法讀取。'))
      return { classes: targets.map(item => results.find(result => result.path === item.path)).filter(Boolean), failed, skipped: Math.max(0, classes.length - targets.length) }
    },
  }
  const cachedFor = (key, classes) => {
    if (key === 'reports') { const overdue = freshValue(sources.unfilledMonth), current = freshValue(sources.unfilledCurrent); return overdue && current ? mergeUnfilled(overdue, current) : undefined }
    if (key === 'schedule') return freshValue(sources.calendar)
    if (key === 'hours') return freshValue(sources.hours)
    const targets = prioritise(classes).slice(0, MAX_CLASSES), values = targets.map(item => freshValue(sources.classReports(classId(item.path))))
    return targets.length && values.every(Boolean) ? { classes: targets.map((item, index) => ({ ...item, ...values[index] })), failed: 0, skipped: Math.max(0, classes.length - targets.length) } : undefined
  }

  const sourceKeys = (key, classes) => key === 'reports' ? [sources.unfilledMonth, sources.unfilledCurrent] : key === 'schedule' ? [sources.calendar] : key === 'hours' ? [sources.hours] : prioritise(classes).slice(0, MAX_CLASSES).map(item => sources.classReports(classId(item.path)))
  const cachedAt = (key, classes) => Math.min(...sourceKeys(key, classes).map(path => cache.get(path)?.at || Date.now()))

  // ---- Rendering -------------------------------------------------------------
  const ICONS = {
    alert: ['M12 8v5', 'M12 16.5h.01', 'circle'],
    clock: ['M12 7v5l3 2', 'circle'],
    check: ['M7 12.5l3.2 3.2L17 9'],
    calendar: ['M4 7h16v13H4z', 'M4 11h16', 'M8 4v5', 'M16 4v5'],
  }
  function icon(doc, name) {
    const ns = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(ns, 'svg')
    svg.setAttribute('data-edulog-owned', ''); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'edulog-icon')
    for (const shape of ICONS[name]) {
      const node = shape === 'circle' ? doc.createElementNS(ns, 'circle') : doc.createElementNS(ns, 'path')
      if (shape === 'circle') { node.setAttribute('cx', '12'); node.setAttribute('cy', '12'); node.setAttribute('r', '9') } else node.setAttribute('d', shape)
      node.setAttribute('data-edulog-owned', ''); svg.append(node)
    }
    return svg
  }
  function mount({ doc, content, scope, view = {} }) {
    const { element, listen } = scope
    const classes = describeClasses(teacherClasses(doc))
    const classByPath = new Map(classes.map(item => [item.path, item]))
    const root = scope.add(element('section'))
    root.className = 'edulog-todo'; root.setAttribute('aria-labelledby', 'edulog-todo-title')
    const head = element('div'); head.className = 'edulog-todo-head'
    const title = element('h2', tx('本週待辦')); title.id = 'edulog-todo-title'
    const updated = element('p'); updated.className = 'edulog-todo-updated'; updated.setAttribute('role', 'status'); updated.setAttribute('aria-live', 'polite')
    const refresh = element('button', tx('重新整理')); refresh.type = 'button'; refresh.className = 'edulog-todo-refresh'
    head.append(title, updated, refresh)
    const grid = element('div'); grid.className = 'edulog-todo-grid'
    root.append(head, grid)
    content.prepend(root)
    const alive = () => root.isConnected

    function card(key, heading, sourcePath) {
      const section = element('section'); section.className = 'edulog-todo-card'; section.dataset.edulogTodo = key
      const titleRow = element('h3'); const label = element('span', heading); const count = element('span'); count.className = 'edulog-todo-count'
      titleRow.append(label, count)
      const body = element('div'); body.className = 'edulog-todo-body'; body.setAttribute('aria-live', 'polite')
      const source = element('a', tx('在原站查看')); source.className = 'edulog-todo-source'; source.href = sourcePath
      section.append(titleRow, body, source); grid.append(section)
      return { section, body, count }
    }
    const cards = {
      reports: card('reports', tx('待填報告'), sources.unfilledCurrent),
      schedule: card('schedule', tx('本週課表'), sources.calendar),
      attendance: card('attendance', tx('本週點名與出席'), classes[0] ? sources.classReports(classId(classes[0].path)) : '/'),
      hours: card('hours', tx('本月鐘點'), sources.hours),
    }
    const badge = (tone, iconName, label) => { const node = element('span'); node.className = 'edulog-badge'; node.dataset.tone = tone; node.append(icon(doc, iconName), element('span', label)); return node }
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    const empty = (target, message) => { const node = element('p'); node.className = 'edulog-todo-empty'; node.append(badge('ok', 'check', tx('完成')), element('span', message)); target.body.replaceChildren(node); target.count.textContent = '' }
    function loading(target) {
      const skeleton = element('div'); skeleton.className = 'edulog-skeleton'; skeleton.setAttribute('aria-hidden', 'true')
      for (let index = 0; index < 3; index++) skeleton.append(element('span'))
      const status = element('p', tx('正在讀取原站資料…')); status.className = 'edulog-visually-hidden'
      target.body.replaceChildren(skeleton, status); target.section.setAttribute('aria-busy', 'true')
    }
    function failure(target, key, error) {
      const box = element('div'); box.className = 'edulog-todo-error'
      const message = element('p'); message.append(badge('danger', 'alert', tx('讀取失敗')), dataText('span', error?.message || tx('原站頁面暫時無法讀取。')))
      const retry = element('button', tx('重試')); retry.type = 'button'
      listen(retry, 'click', () => run(key, true))
      box.append(message, retry); target.body.replaceChildren(box); target.count.textContent = ''
    }
    const list = () => { const node = element('ul'); node.className = 'edulog-todo-list'; return node }
    // One block per class: the class once in the heading with one link, then names and badges.
    // Long groups show the first few students and keep the rest behind 顯示其餘.
    function groupList(groups) {
      const wrap = element('ul'); wrap.className = 'edulog-todo-groups'
      for (const group of groups) {
        const li = element('li'); li.className = 'edulog-todo-group'; if (group.today) li.dataset.today = ''
        const head = element('div'); head.className = 'edulog-todo-group-head'
        const main = element('div'); main.className = 'edulog-todo-main'
        main.append(dataText('strong', group.title), dataText('span', [group.place, group.summary].filter(Boolean).join(' · '), 'edulog-todo-meta'))
        head.append(main)
        if (group.today) head.append(badge('info', 'calendar', tx('今天')))
        if (group.href) { const go = element('a', group.action); go.className = 'edulog-todo-action'; go.href = group.href; go.setAttribute('aria-label', `${group.title} ${group.action}`); head.append(go) }
        const rows = element('ul'); rows.className = 'edulog-todo-group-items'
        for (const [index, item] of group.items.entries()) {
          const row = element('li'); row.className = 'edulog-todo-group-item'
          row.append(dataText('span', item.name, 'edulog-todo-name'), ...item.marks)
          row.hidden = index >= PREVIEW; rows.append(row)
        }
        li.append(head, rows)
        const rest = group.items.length - PREVIEW
        if (rest > 0) {
          const more = element('button'); more.type = 'button'; more.className = 'edulog-todo-more'; more.textContent = tx('顯示其餘 {count} 位', { count: rest }); more.setAttribute('aria-expanded', 'false')
          listen(more, 'click', () => {
            const open = more.getAttribute('aria-expanded') !== 'true'
            more.setAttribute('aria-expanded', String(open)); more.textContent = open ? tx('收合') : tx('顯示其餘 {count} 位', { count: rest })
            for (const [index, row] of [...rows.children].entries()) if (index >= PREVIEW) row.hidden = !open
          })
          li.append(more)
        }
        wrap.append(li)
      }
      return wrap
    }
    const classLabel = (path, fallback) => { const item = classByPath.get(path); return { title: item?.primary || fallback || tx('其他'), place: item?.secondary || '', today: Boolean(item?.today), weekday: item?.weekday ?? 7, start: item?.start || '' } }
    const renderers = {
      reports(target, items) {
        if (!items.length) return empty(target, tx('本週報告都填完了'))
        target.count.textContent = String(items.length)
        // Grouped by the class in each fill link; overdue groups first.
        const groups = new Map()
        for (const item of items) {
          const path = /^\/courses\/dt\/\d+/.exec(item.action || '')?.[0] || null
          const key = path || item.slot || item.course
          if (!groups.has(key)) groups.set(key, { path, fallback: item.slot || item.course, items: [] })
          groups.get(key).items.push(item)
        }
        const rows = groupList([...groups.values()].map(group => {
          const label = classLabel(group.path, group.fallback), overdue = group.items.filter(item => item.overdue).length
          return {
            ...label, overdue, href: group.path ? sources.classReports(classId(group.path)) : null, action: tx('前往課堂記錄'),
            summary: [overdue && tx('逾期 {count}', { count: overdue }), group.items.length - overdue && tx('待補填 {count}', { count: group.items.length - overdue })].filter(Boolean).join(' · '),
            items: group.items.map(item => {
              const marks = [item.overdue ? badge('danger', 'alert', tx('逾期未填')) : badge('warn', 'clock', tx('待補填'))]
              if (item.action) { const go = element('a', tx('去填寫')); go.className = 'edulog-todo-fill'; go.href = item.action; go.setAttribute('aria-label', tx('{name} 去填寫', { name: item.student })); marks.push(go) }
              return { name: item.student, marks }
            }),
          }
        }).sort((a, b) => Number(Boolean(b.overdue)) - Number(Boolean(a.overdue)) || Number(b.today) - Number(a.today)))
        const note = element('p'); note.className = 'edulog-todo-note'
        note.append(element('span', tx('已配對 EduLog 時，開啟課堂紀錄會出現 EduLog 預填。')))
        const open = element('button', tx('設定 EduLog 配對')); open.type = 'button'; open.className = 'edulog-todo-link-button'
        listen(open, 'click', () => doc.getElementById('edulog-extension-root')?.shadowRoot?.querySelector('.integration')?.click())
        note.append(open)
        target.body.replaceChildren(rows, note)
      },
      schedule(target, days) {
        const today = model.siteParts(), todayKey = `${today.month + 1}/${today.day}`
        const withEntries = days.filter(day => day.entries.length)
        if (!withEntries.length) { target.count.textContent = ''; const node = element('p', tx(classes.length ? '本週行事曆沒有你的班級課程。' : '本週行事曆沒有排定課程。')); node.className = 'edulog-todo-empty'; return target.body.replaceChildren(node) }
        target.count.textContent = String(withEntries.reduce((sum, day) => sum + day.entries.length, 0))
        const rows = list()
        for (const day of withEntries) {
          const match = words.calendarDay.exec(day.label), isToday = Boolean(match) && `${Number(match[1])}/${Number(match[2])}` === todayKey
          for (const entry of day.entries) {
            const li = element('li'); li.className = 'edulog-todo-item'; if (isToday) li.dataset.today = ''
            const main = element('div'); main.className = 'edulog-todo-main'
            const classTitle = classes.find(item => item.path === entry.classPath)?.title || entry.detail
            main.append(dataText('strong', `${day.label} ${entry.time}`.trim()), dataText('span', [classTitle, entry.room].filter(Boolean).join(' · '), 'edulog-todo-meta'))
            li.append(main)
            if (isToday) li.append(badge('info', 'calendar', tx('今天')))
            const go = element('a', tx('開啟班級')); go.className = 'edulog-todo-action'; go.href = entry.classPath; li.append(go)
            rows.append(li)
          }
        }
        target.body.replaceChildren(rows)
      },
      attendance(target, result) {
        const notes = []
        if (result.failed) notes.push(tx('{count} 個班級暫時無法讀取。', { count: result.failed }))
        if (result.skipped) notes.push(tx('只檢查了 {checked} / {total} 個班。', { checked: result.classes.length + result.failed, total: result.classes.length + result.failed + result.skipped }))
        if (!classes.length) { target.count.textContent = ''; const node = element('p', tx('側邊欄沒有找到你的班級。')); node.className = 'edulog-todo-empty'; return target.body.replaceChildren(node) }
        // A session counts only once it has started; later classes this week are not "unmarked" yet.
        const now = new Date(), shared = globalThis.edulogClassPending || (globalThis.edulogClassPending = new Map())
        let waiting = 0
        const groups = []
        for (const item of result.classes) {
          const label = classLabel(item.path, item.title)
          const started = model.sessionStarted(item.week, label.start, now) !== false
          shared.set(item.path, started ? item.pending ?? 0 : 0)
          if (!started) { waiting++; continue }
          if (!item.items.length) continue
          const absent = item.items.filter(entry => entry.status === 'absent'), pending = item.items.filter(entry => entry.status !== 'absent')
          groups.push({
            ...label, href: sources.classReports(classId(item.path)), action: tx('前往課次'),
            summary: [pending.length && tx('待點名 {count}', { count: pending.length }), absent.length && tx('缺席 {count}', { count: absent.length })].filter(Boolean).join(' · '),
            items: [...absent, ...pending].map(entry => ({ name: entry.student, marks: [entry.status === 'absent' ? badge('danger', 'alert', entry.label) : badge('warn', 'clock', entry.label)] })),
          })
        }
        globalThis.edulogSiteNavigation?.announcePending(doc)
        if (waiting) notes.push(tx('{count} 個班本週還沒上課，開始上課後才會列入。', { count: waiting }))
        const total = groups.reduce((sum, group) => sum + group.items.length, 0)
        if (!total) empty(target, tx('已上課的班級都點完名，也沒有缺席'))
        else {
          target.count.textContent = String(total)
          groups.sort((a, b) => Number(b.today) - Number(a.today) || weekOrder(a.weekday) - weekOrder(b.weekday) || a.start.localeCompare(b.start))
          target.body.replaceChildren(groupList(groups))
        }
        for (const message of notes) { const node = dataText('p', message, 'edulog-todo-note'); target.body.append(node) }
      },
      // Pay figures stay masked until the teacher shows them (remembered); counts are always shown.
      hours(target, summary) {
        target.count.textContent = ''
        const money = value => `NT$ ${Number(value).toLocaleString('en-US')}`
        const amounts = []
        const amount = value => { const node = dataText('span', '', 'edulog-hours-amount'); node.dataset.value = money(value); amounts.push(node); return node }
        const head = element('p'); head.className = 'edulog-todo-summary'
        head.append(dataText('strong', summary.period || tx('本月')))
        if (summary.isCurrent === false) head.append(badge('warn', 'calendar', tx('不是本月')))
        const items = [...summary.lessons, ...summary.events, ...summary.other]
        if (!items.length && !summary.unreadable) { head.append(element('span', tx('這個月還沒有鐘點紀錄'))); return target.body.replaceChildren(head) }
        const totalRow = element('div'); totalRow.className = 'edulog-hours-total'
        const total = amount(summary.total); total.classList.add('edulog-hours-figure')
        const toggle = element('button'); toggle.type = 'button'; toggle.className = 'edulog-hours-toggle'
        totalRow.append(total, toggle)
        const facts = dataText('p', [tx('共 {count} 堂', { count: summary.sessions }), summary.hours && tx('約 {hours} 小時', { hours: summary.hours })].filter(Boolean).join(' · '), 'edulog-todo-meta')
        const rows = list()
        const row = (title, meta, value) => { const li = element('li'); li.className = 'edulog-todo-item'; const main = element('div'); main.className = 'edulog-todo-main'; main.append(dataText('strong', title)); if (meta) main.append(dataText('span', meta, 'edulog-todo-meta')); li.append(main, amount(value)); rows.append(li) }
        for (const item of summary.lessons) row(`${tx(item.weekday)} ${item.start.replace(/^0/, '')}–${item.end.replace(/^0/, '')}`, [item.room, tx('{count} 堂', { count: item.dates.length })].join(' · '), item.amount)
        for (const item of summary.events) row(item.label, [item.section, tx('{count} 天', { count: item.dates.length })].filter(Boolean).join(' · '), item.amount)
        for (const item of summary.other) row(item.label, tx('不計入堂數'), item.amount)
        const notes = []
        if (summary.estimated) notes.push(tx('原站沒有提供合計，金額為逐列加總。'))
        if (summary.unreadable) notes.push(tx('{count} 筆無法判讀，請到原站查看。', { count: summary.unreadable }))
        const show = visible => {
          view.amountVisible = visible
          toggle.textContent = visible ? tx('隱藏金額') : tx('顯示金額'); toggle.setAttribute('aria-pressed', String(visible))
          for (const node of amounts) node.textContent = visible ? node.dataset.value : 'NT$ ••••'
        }
        listen(toggle, 'click', () => { const visible = !view.amountVisible; show(visible); void globalThis.edulogRuntime?.send({ type: 'set-amount-visible', visible })?.catch(() => {}) })
        const known = typeof view.amountVisible === 'boolean'
        show(view.amountVisible === true)
        if (!known) void globalThis.edulogRuntime?.send({ type: 'get-amount-visible' })?.then(result => { if (typeof result?.visible === 'boolean' && toggle.isConnected) show(result.visible) }).catch(() => {})
        target.body.replaceChildren(head, totalRow, facts, rows, ...notes.map(message => dataText('p', message, 'edulog-todo-note')))
      },
    }
    const loadedAt = new Map()
    function stamp() {
      const times = [...loadedAt.values()]
      if (!times.length) { updated.textContent = ''; return }
      const oldest = new Date(Math.min(...times))
      updated.textContent = tx('更新於 {time}', { time: `${String(oldest.getHours()).padStart(2, '0')}:${String(oldest.getMinutes()).padStart(2, '0')}` })
    }
    const runs = new Map()
    function run(key, force = false) {
      const target = cards[key], ticket = (runs.get(key) || 0) + 1
      runs.set(key, ticket)
      const ready = force ? undefined : cachedFor(key, classes)
      if (ready !== undefined) { renderers[key](target, ready); loadedAt.set(key, cachedAt(key, classes)); stamp(); return Promise.resolve() }
      if (key === 'attendance' && !classes.length) { renderers.attendance(target, { classes: [], failed: 0, skipped: 0 }); return Promise.resolve() }
      loading(target)
      return loaders[key](force, classes).then(value => {
        if (!alive() || runs.get(key) !== ticket) return
        target.section.removeAttribute('aria-busy'); renderers[key](target, value); loadedAt.set(key, Date.now()); stamp()
      }, error => {
        if (!alive() || runs.get(key) !== ticket) return
        target.section.removeAttribute('aria-busy'); failure(target, key, error)
      })
    }
    const all = force => Promise.all(Object.keys(cards).map(key => run(key, force)))
    listen(refresh, 'click', async () => {
      refresh.disabled = true
      try { await all(true) } finally { if (alive()) refresh.disabled = false }
    })
    const ready = all(false)
    return { root, ready }
  }
  globalThis.edulogSiteTodo = Object.freeze({ mount, readDoc, extractUnfilled, mergeUnfilled, extractCalendar, extractHours, extractAttendance, teacherClasses, describeClasses, prioritise, clearCache: () => cache.clear() })
})()
