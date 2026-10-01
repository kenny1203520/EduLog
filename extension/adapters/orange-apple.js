// Provider routes, selectors and terminology belong only in this adapter.
(() => {
  function matchPage(path) {
    if (path === '/') return { kind: 'overview', title: '教師總覽' }
    if (/^\/courses\/dt\/\d+\/?$/.test(path)) return { kind: 'class', title: '班級工作區' }
    if (/^\/courses\/dt\/\d+\/lesson_reports\/?$/.test(path)) return { kind: 'reports', title: '課次報告' }
    return null
  }
  function enhancePage(doc, view = {}) {
    const page = matchPage(doc.location.pathname)
    const content = doc.querySelector('#page-body > .content')
    if (!page || !content) return null
    const changes = new Map(), added = [], listeners = []
    function mark(node, name, value = '') {
      if (!changes.has(node)) changes.set(node, new Map())
      const attrs = changes.get(node)
      if (!attrs.has(name)) attrs.set(name, node.getAttribute(name))
      if (value === null) node.removeAttribute(name)
      else node.setAttribute(name, value)
    }
    function listen(node, event, handler) {
      node.addEventListener(event, handler)
      listeners.push(() => node.removeEventListener(event, handler))
    }
    function element(tag, text) {
      const node = doc.createElement(tag)
      node.dataset.edulogOwned = ''
      if (text) node.textContent = text
      return node
    }
    function controls(table, label) {
      const box = element('div')
      box.className = 'edulog-table-tools'
      const field = element('label')
      field.append(element('span', label))
      const input = element('input')
      input.type = 'search'; input.placeholder = '搜尋目前頁面的學生'
      field.append(input)
      const count = element('span')
      count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite')
      box.append(field, count); table.before(box); added.push(box)
      return { box, input, count }
    }
    mark(doc.documentElement, 'data-edulog-ui', 'on')
    mark(doc.documentElement, 'data-edulog-page', page.kind)
    if (page.kind === 'overview') {
      const links = [...doc.querySelectorAll('.sidebar a[href]')].filter(a => {
        try { const url = new URL(a.href); return url.origin === doc.location.origin && /^\/courses\/dt\/\d+\/?$/.test(url.pathname) }
        catch { return false }
      })
      const unique = [...new Map(links.map(a => [a.href, a])).values()]
      if (unique.length) {
        const shortcuts = element('section')
        shortcuts.className = 'edulog-class-shortcuts'
        shortcuts.setAttribute('aria-label', '我的班級')
        shortcuts.append(element('h2', '我的班級'))
        const grid = element('div')
        for (const original of unique) {
          const link = element('a')
          link.href = original.href
          link.append(element('strong', original.textContent.trim()), element('span', '開啟班級工作區 →'))
          grid.append(link)
        }
        shortcuts.append(grid); content.prepend(shortcuts); added.push(shortcuts)
      }
    }
    let refreshStudents = () => {}, refreshReports = () => {}
    const students = content.querySelector('#students-table')
    if (students) {
      const { input, count } = controls(students, '學生搜尋')
      input.dataset.edulogSearch = 'students'
      input.value = view.studentQuery || ''
      const headers = [...students.querySelectorAll('thead th')].map(h => h.textContent.trim())
      refreshStudents = () => {
        const rows = [...students.tBodies].flatMap(body => [...body.rows])
        let visible = 0
        for (const row of rows) {
          const matches = row.textContent.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase())
          mark(row, 'data-edulog-filtered', matches ? null : '')
          if (matches) visible++
          for (const [index, cell] of [...row.cells].entries()) {
            mark(cell, 'data-edulog-label', headers[index] || '')
            if (index > 2 && !/操作/.test(headers[index] || '')) mark(cell, 'data-edulog-extra', '')
          }
          const nameCell = row.cells[0]
          if (nameCell && !nameCell.querySelector('[data-edulog-expand]')) {
            const button = element('button', '更多資料')
            button.type = 'button'; button.dataset.edulogExpand = ''
            button.setAttribute('aria-expanded', 'false')
            listen(button, 'click', () => {
              const expanded = button.getAttribute('aria-expanded') !== 'true'
              button.setAttribute('aria-expanded', String(expanded))
              button.textContent = expanded ? '收合資料' : '更多資料'
              mark(row, 'data-edulog-expanded', expanded ? '' : null)
            })
            nameCell.append(button); added.push(button)
          }
        }
        const text = `顯示 ${visible} / ${rows.length} 位學生`
        if (count.textContent !== text) count.textContent = text
        view.studentQuery = input.value
      }
      listen(input, 'input', refreshStudents); refreshStudents()
    }
    const reports = content.querySelector('#reports')
    if (reports) {
      const { box, input, count } = controls(reports, '報告學生搜尋')
      input.dataset.edulogSearch = 'reports'
      input.value = view.reportQuery || ''
      const weekButtons = element('div')
      weekButtons.className = 'edulog-week-tools'
      weekButtons.setAttribute('role', 'group'); weekButtons.setAttribute('aria-label', '報告週次')
      const headers = [...reports.querySelectorAll('tr:first-child th')]
      const weeks = headers.map((h, index) => ({ label: h.textContent.trim(), index })).filter(h => /上週|本週|下週/.test(h.label))
      const selected = weeks.find(w => w.index === view.week) || weeks.find(w => /本週/.test(w.label)) || weeks[0]
      function selectWeek(index) {
        view.week = index
        for (const button of weekButtons.children) button.setAttribute('aria-pressed', String(Number(button.dataset.week) === index))
        for (const row of reports.rows) for (const [column, cell] of [...row.cells].entries()) {
          if (weeks.some(w => w.index === column)) {
            mark(cell, 'data-edulog-week-cell', '')
            mark(cell, 'data-edulog-week-selected', column === index ? '' : null)
          }
        }
      }
      for (const week of weeks) {
        const button = element('button', week.label)
        button.type = 'button'; button.dataset.week = String(week.index)
        listen(button, 'click', () => selectWeek(week.index)); weekButtons.append(button)
      }
      if (weeks.length) box.append(weekButtons)
      refreshReports = () => {
        const rows = [...reports.rows].filter(row => row.querySelector('td'))
        let visible = 0
        for (const row of rows) {
          const matches = (row.cells[0]?.textContent || '').toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase())
          mark(row, 'data-edulog-filtered', matches ? null : '')
          if (matches) visible++
        }
        if (selected) selectWeek(view.week ?? selected.index)
        const text = `顯示 ${visible} / ${rows.length} 位學生 · 保留原站課次狀態`
        if (count.textContent !== text) count.textContent = text
        view.reportQuery = input.value
      }
      listen(input, 'input', refreshReports); refreshReports()
      mark(reports.parentElement, 'data-edulog-report-region', '')
    }
    return {
      page,
      refresh() { refreshStudents(); refreshReports() },
      restore() {
        for (const remove of listeners) remove()
        for (const node of added) node.remove()
        for (const [node, attrs] of changes) for (const [name, old] of attrs) {
          if (old === null) node.removeAttribute(name)
          else node.setAttribute(name, old)
        }
      },
    }
  }
  globalThis.edulogSiteAdapter = Object.freeze({
    id: 'orange-apple', matchesHost: host => host === 'corp.orangeapple.co',
    matchesTeachingPage: path => Boolean(matchPage(path)), matchPage, enhancePage,
    readContext: doc => ({ ...matchPage(doc.location.pathname), sourcePath: doc.location.pathname }),
  })
})()
