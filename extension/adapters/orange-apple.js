// Provider routes, selectors and terminology belong only in this adapter.
(() => {
  function matchPage(path) {
    if (/^\/my\/hour\/?$/.test(path)) return { kind: 'hours', title: '我的鐘點' }
    if (/^\/my\/?$/.test(path)) return { kind: 'profile', title: '個人資料' }
    if (/^\/my\/\d+\/edit\/?$/.test(path)) return { kind: 'profile-edit', title: '編輯個人資料' }
    if (path === '/') return { kind: 'overview', title: '教師總覽' }
    if (/^\/courses\/dt\/?$/.test(path)) return { kind: 'classes', title: '班級列表' }
    if (path === '/calendar') return { kind: 'calendar', title: '課程行事曆' }
    if (path === '/admissions/month_unfilled_report') return { kind: 'unfilled', title: '未填寫紀錄' }
    if (/^\/dt_admissions\/\d+\/?$/.test(path)) return { kind: 'history', title: '學生學習紀錄' }
    if (/^\/courses\/dt\/\d+\/?$/.test(path)) return { kind: 'class', title: '班級工作區' }
    if (/^\/courses\/dt\/\d+\/lesson_reports\/?$/.test(path)) return { kind: 'reports', title: '課次報告' }
    return null
  }
  function createScope(doc) {
    const changes = new Map(), added = [], listeners = [], moves = [], texts = new Map()
    return {
      text(node, value) { if (!node || node.textContent === value) return; if (!texts.has(node)) texts.set(node, [...node.childNodes]); node.textContent = value },
      mark(node, name, value = '') {
        if (!node) return
        if (!changes.has(node)) changes.set(node, new Map())
        const attrs = changes.get(node)
        if (!attrs.has(name)) attrs.set(name, node.getAttribute(name))
        if (value === null) node.removeAttribute(name)
        else node.setAttribute(name, value)
      },
      listen(node, event, handler) { node.addEventListener(event, handler); listeners.push(() => node.removeEventListener(event, handler)) },
      element(tag, text) { const node = doc.createElement(tag); node.dataset.edulogOwned = ''; if (text) node.textContent = text; return node },
      add(node) { added.push(node); return node },
      move(node, destination) {
        const anchor = doc.createElement('span'); anchor.dataset.edulogOwned = ''; anchor.hidden = true
        node.before(anchor); moves.push({ node, anchor }); destination.append(node)
      },
      restore() {
        for (const remove of listeners) remove()
        for (const { node, anchor } of moves.reverse()) { if (anchor.parentNode) anchor.replaceWith(node) }
        for (const node of added) node.remove()
        for (const [node, children] of texts) node.replaceChildren(...children)
        for (const [node, attrs] of changes) for (const [name, old] of attrs) {
          if (old === null) node.removeAttribute(name); else node.setAttribute(name, old)
        }
      },
    }
  }
  function enhancePage(doc, view = {}, documentMode = false) {
    const page = matchPage(doc.location.pathname)
    const content = doc.querySelector('#page-body > .content')
    if (!page || !content || /沒有存取權限|無權限|Access denied/i.test([...content.querySelectorAll('h1,h2')].map(h => h.textContent).join(' '))) return null
    if (page.kind === 'hours' && !content.querySelector('form select[name=year]')) return null
    if (page.kind === 'profile' && (!content.querySelector('h1') || !content.querySelector('a[href^="/my/"][href$="/edit"]'))) return null
    if (page.kind === 'profile-edit' && !content.querySelector('form[action^="/my/"] .form-inputs')) return null
    const scope = createScope(doc)
    const { mark, listen, element } = scope
    const added = { push: node => scope.add(node) }
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
      box.append(field, count); (table.closest('[data-edulog-scroll],.table-responsive') || table).before(box); added.push(box)
      return { box, input, count }
    }
    if (!documentMode) {
      mark(doc.documentElement, 'data-edulog-ui', 'on')
      mark(doc.documentElement, 'data-edulog-page', page.kind)
    }
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
      view.expandedStudents ||= new WeakSet()
      const { input, count } = controls(students, '目前名單篩選')
      input.dataset.edulogSearch = 'students'
      input.value = view.studentQuery || ''
      const headerRow = [...students.rows].find(r => [...r.cells].some(c => /姓名/.test(c.textContent))) || students.tHead?.rows[0]
      mark(headerRow, 'data-edulog-student-header', '')
      for (const row of students.rows) if (row.querySelector('#student_id-selectized') || row.querySelector('input[type=search],input[placeholder*="學生"]')) mark(row, 'data-edulog-student-search', '')
      const headers = [...(headerRow?.cells || [])].map(h => h.textContent.trim())
      const nameIndex = Math.max(0, headers.findIndex(h => /姓名/.test(h)))
      mark(headerRow?.cells[nameIndex], 'data-edulog-name', '')
      refreshStudents = () => {
        const rows = [...students.tBodies].flatMap(body => [...body.rows]).filter(row => row !== headerRow && !row.querySelector('th') && !row.hasAttribute('data-edulog-student-search'))
        let visible = 0
        for (const row of rows) {
          const matches = row.textContent.toLocaleLowerCase().includes(input.value.trim().toLocaleLowerCase())
          mark(row, 'data-edulog-filtered', matches ? null : '')
          if (matches) visible++
          for (const [index, cell] of [...row.cells].entries()) {
            mark(cell, 'data-edulog-label', headers[index] || '')
            if (index > 1 && !/姓名|年級|課程|操作/.test(headers[index] || '')) mark(cell, 'data-edulog-extra', '')
          }
          const nameCell = row.cells[nameIndex]
          mark(nameCell, 'data-edulog-name', '')
          if (nameCell && !nameCell.querySelector('[data-edulog-expand]')) {
            const button = element('button', '更多資料')
            button.type = 'button'; button.dataset.edulogExpand = ''
            const wasExpanded = view.expandedStudents.has(row)
            button.setAttribute('aria-expanded', String(wasExpanded))
            button.textContent = wasExpanded ? '收合資料' : '更多資料'
            mark(row, 'data-edulog-expanded', wasExpanded ? '' : null)
            listen(button, 'click', () => {
              const expanded = button.getAttribute('aria-expanded') !== 'true'
              button.setAttribute('aria-expanded', String(expanded))
              button.textContent = expanded ? '收合資料' : '更多資料'
              if (expanded) view.expandedStudents.add(row)
              else view.expandedStudents.delete(row)
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
    const workflow = globalThis.edulogSiteWorkflows?.enhancePage({ doc, content, page, view, scope })
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
      const dateContext = event => {
        const link = event.target.closest('a[data-edulog-record-action]')
        if (!link) return
        const row = link.closest('tr'), column = [...row.cells].indexOf(link.closest('td'))
        const label = reports.rows[0]?.cells[column]?.textContent.trim()
        if (label) view.reportTarget = { path: link.pathname, label }
      }
      listen(reports, 'click', dateContext)
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
    }
    const sourceTables = [...content.querySelectorAll('table')]
    const shape = sourceTables.map(table => ({ table, rows: table.rows.length }))
    return {
      page,
      isCurrent() {
        return doc.querySelector('#page-body > .content') === content && sourceTables.length === content.querySelectorAll('table').length && shape.every(({ table, rows }) => table.isConnected && table.rows.length === rows)
      },
      refresh() { refreshStudents(); refreshReports(); workflow?.refresh() },
      restore: scope.restore,
    }
  }
  globalThis.edulogSiteAdapter = Object.freeze({
    id: 'orange-apple', matchesHost: host => host === 'corp.orangeapple.co',
    matchesTeachingPage: path => Boolean(matchPage(path)), matchPage, enhancePage,
    enhanceDialog: (doc, view) => globalThis.edulogSiteWorkflows?.enhanceDialog(doc, view, createScope(doc)),
    enhanceDialogs: (doc, view) => globalThis.edulogSiteWorkflows?.enhanceDialogs(doc, view, createScope),
    readContext: doc => ({ ...matchPage(doc.location.pathname), sourcePath: doc.location.pathname }),
  })
})()
