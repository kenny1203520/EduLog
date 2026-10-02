// Sample-backed enhancements for this provider. No network or credential access.
(() => {
  const text = node => node?.textContent.trim().replace(/\s+/g, ' ') || ''
  const classLink = a => { try { return a.origin === a.ownerDocument.location.origin && /^\/courses\/dt\/\d+\/?$/.test(a.pathname) } catch { return false } }
  function region(scope, title, className = 'edulog-section') {
    const section = scope.add(scope.element('section'))
    section.className = className
    if (title) section.append(scope.element('h3', title))
    return section
  }
  function facts(scope, values) {
    const list = scope.element('dl'); list.className = 'edulog-facts'
    for (const [label, value] of values) if (value) {
      const item = scope.element('div'); item.append(scope.element('dt', label), scope.element('dd', value)); list.append(item)
    }
    return list
  }
  function grid(table) {
    const result = []
    for (const [r, row] of [...table.rows].entries()) {
      result[r] ||= []
      let col = 0
      for (const cell of row.cells) {
        while (result[r][col]) col++
        for (let y = 0; y < cell.rowSpan; y++) {
          result[r + y] ||= []
          for (let x = 0; x < cell.colSpan; x++) result[r + y][col + x] = cell
        }
        col += cell.colSpan
      }
    }
    return result
  }
  function scrollTable(scope, table, kind = '') {
    const parent = table.parentElement
    if (parent.matches('.table-responsive,.edulog-table-scroll')) {
      scope.mark(parent, 'data-edulog-scroll', kind)
      return parent
    }
    const wrapper = scope.add(scope.element('div')); wrapper.className = 'edulog-table-scroll'
    wrapper.dataset.edulogScroll = kind
    table.before(wrapper); scope.move(table, wrapper)
    return wrapper
  }
  function filterTable({ doc, scope, view }, table, key, title, dateColumn = null) {
    const { element, listen, mark } = scope
    const tools = region(scope, title, 'edulog-table-tools')
    const label = element('label', '本頁搜尋'), search = element('input')
    search.type = 'search'; search.dataset.edulogSearch = key; search.value = view[key] || ''; label.append(search)
    const count = element('span'); count.setAttribute('role', 'status')
    tools.append(label, count); table.before(tools)
    let rows = []
    let date
    if (dateColumn !== null) {
      const dates = element('label', '紀錄日期'); date = element('input'); date.type = 'date'
      date.dataset.edulogSearch = `${key}Date`; date.value = view[`${key}Date`] || ''; dates.append(date); tools.append(dates)
    }
    const scroll = scrollTable(scope, table, key)
    const apply = () => {
      rows = [...table.rows].filter(r => r.querySelector('td') && !r.querySelector('th'))
      view[key] = search.value; if (date) view[`${key}Date`] = date.value
      let visible = 0
      for (const row of rows) {
        const match = text(row).toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()) && (!date?.value || text(row.cells[dateColumn]).includes(date.value))
        mark(row, 'data-edulog-filtered', match ? null : '')
        if (match && !row.hidden) visible++
      }
      count.textContent = `顯示 ${visible} / ${rows.filter(r => !r.hidden).length} 筆`
      empty.hidden = visible > 0
      empty.textContent = rows.length ? '目前篩選條件沒有符合的紀錄。' : '目前這份清單沒有紀錄。'
      mark(table, 'data-edulog-empty-table', rows.length ? null : '')
      mark(scroll, 'data-edulog-empty-table', rows.length ? null : '')
    }
    const empty = scope.add(element('p')); empty.className = 'edulog-empty'; empty.setAttribute('role', 'status'); scroll.after(empty)
    listen(search, 'input', apply); if (date) listen(date, 'input', apply)
    apply()
    scope.mark(table, 'data-edulog-dense-table', '')
    return { tools, rows, refresh: apply }
  }
  function enhancePage(context) {
    const { doc, content, page, scope, view } = context
    const refreshers = []
    const { mark, element, listen, move } = scope
    for (const button of content.querySelectorAll('.btn,button,input[type=submit],.nav-link')) mark(button, 'data-edulog-action', '')
    if (page.kind === 'hours') {
      const form = [...content.querySelectorAll('form')].find(f => ['year', 'month'].every(name => f.querySelector(`select[name=${name}]`)?.form === f))
      if (form) {
        mark(form, 'data-edulog-hours-filter', '')
        for (const [name, label] of [['year','年份'],['month','月份']]) {
          const input = form.querySelector(`select[name=${name}]`)
          if (!input || input.form !== form || !form.contains(input)) throw new Error('Hours filter changed while applying the theme')
          mark(input, 'aria-label', label)
          // Native inputs can be nested in Bootstrap columns or already labelled.
          // Insert beside the actual input, without replacing it or nesting labels.
          if (!input.labels?.length && !input.closest('label')) {
            const wrapper = scope.add(element('label', label))
            input.before(wrapper); move(input, wrapper)
          }
        }
        const summary = region(scope, '', 'edulog-page-context')
        const year = form.querySelector('[name=year]').selectedOptions[0]?.textContent || ''
        const month = form.querySelector('[name=month]').selectedOptions[0]?.textContent || ''
        summary.append(element('strong', `查詢月份：${year} ${month}`), element('p', '鐘點與項目依原站明細呈現。'))
        form.after(summary)
        const tables = [...content.querySelectorAll('table')]
        for (const table of tables) { mark(table, 'data-edulog-hours-table', ''); scrollTable(scope, table, 'hours') }
        if (!tables.some(t => [...t.rows].some(r => r.querySelector('td')))) {
          const empty = scope.add(element('p', '此月份沒有鐘點紀錄')); empty.className = 'edulog-empty'; summary.after(empty)
        }
      }
    }
    if (page.kind === 'profile') {
      const heading = content.querySelector('h1,h2'), avatar = content.querySelector('img')
      if (heading) {
        const header = region(scope, '', 'edulog-profile-header'); heading.before(header); move(heading, header)
        if (avatar) { mark(avatar, 'data-edulog-profile-avatar', ''); move(avatar, header) }
        const edit = content.querySelector('a[href$="/edit"]'); if (edit) move(edit, header)
      }
      const sections = new Map()
      const lines = [...content.querySelectorAll('p > strong')].map(strong => strong.parentElement)
      for (const line of lines) {
        const label = text(line.querySelector('strong'))
        const name = /電話|地址|緊急聯絡|Email/i.test(label) ? '聯絡資訊' : /姓名|所屬區域|合作年資/.test(label) ? '基本資料' : '其他資訊'
        if (!sections.has(name)) { const section = region(scope, name); content.append(section); sections.set(name, section) }
        const siblings = line.parentElement
        const unit = siblings !== content && siblings.matches('div') && siblings.children[0] === line && !siblings.querySelector('a,form,h1,h2') && !siblings.querySelector('p > strong ~ strong') && siblings.querySelectorAll('strong').length === 1 ? siblings : line
        mark(unit, 'data-edulog-profile-field', ''); move(unit, sections.get(name))
      }
    }
    if (page.kind === 'profile-edit') {
      const form = content.querySelector('form[action^="/my/"]'), inputs = form?.querySelector('.form-inputs')
      if (inputs) {
        mark(form, 'data-edulog-profile-form', '')
        const groups = new Map()
        for (const field of [...inputs.children]) {
          const control = field.querySelector('input:not([type=hidden]),select,textarea')
          if (!control) continue
          const name = /password/.test(control.id) ? '修改密碼' : /contact_/.test(control.id) ? '緊急聯絡人' : /skill|avatar/.test(control.id) ? '技能與照片' : '聯絡資訊'
          if (!groups.has(name)) {
            const group = name === '修改密碼' ? scope.add(element('details')) : region(scope, name)
            if (name === '修改密碼') {
              group.className = 'edulog-section'; group.append(element('summary', name), element('p', '不修改密碼請留空。修改後原站會強制登出。'))
              group.open = view.profilePasswordOpen === true || doc.activeElement?.type === 'password' || Boolean(inputs.querySelector('input[type=password][aria-invalid=true],.employee_password .error,.employee_password_confirmation .error'))
              listen(group,'toggle',()=>{view.profilePasswordOpen=group.open})
              // Reveal native validation failures before the browser focuses the field.
              listen(control, 'invalid', () => { group.open = true })
            }
            inputs.append(group); groups.set(name, group)
          }
          if (name === '修改密碼') listen(control, 'invalid', () => { groups.get(name).open = true })
          const label = field.querySelector('label'); if (label && control.id) mark(label, 'for', control.id)
          mark(field, 'data-edulog-profile-input', ''); move(field, groups.get(name))
        }
        for (const name of ['聯絡資訊','緊急聯絡人','技能與照片','修改密碼']) if (groups.has(name)) inputs.append(groups.get(name))
        const submit = form.querySelector('input[type=submit]'); if (submit) mark(submit, 'value', '儲存個人資料')
      }
    }
    for (const card of content.querySelectorAll('.card')) mark(card, 'data-edulog-card', '')
    // Clarify the global, server-backed search without replacing its handlers.
    const globalSearch = doc.querySelector('#nav-teacher input[name=q]')
    if (globalSearch) { mark(globalSearch, 'aria-label', '本站學生搜尋'); mark(globalSearch, 'placeholder', '本站學生搜尋') }
    for (const a of doc.querySelectorAll('.sidebar a[href]')) {
      const href = a.getAttribute('href')
      if (href && !href.startsWith('#') && a.origin === doc.location.origin && a.pathname === doc.location.pathname) mark(a, 'aria-current', 'page')
    }
    if (page.kind === 'class') {
      const heading = content.querySelector('h2'), overview = content.querySelector('[role=tab][href="#overview"]')
      if (heading && text(heading) === '節次資訊') scope.text(heading, '班級工作區')
      if (overview) scope.text(overview, '班級名單')
      const original = content.querySelector('#overview table:not(#students-table)')
      if (original && original.rows.length > 1) {
        const labels = [...original.rows[0].cells].map(text)
        const values = [...original.rows[1].cells].map(text)
        const summary = region(scope, '班級資訊', 'edulog-class-summary')
        const items = labels.flatMap((label,i) => /上課.*報名.*上限/.test(label) && /^\d+\s*\/\s*\d+\s*\/\s*\d+$/.test(values[i]) ? values[i].split('/').map((value,j)=>[['上課人數','報名人數','人數上限'][j],value.trim()]) : [[label,values[i]]])
        summary.append(facts(scope, items))
        const details = element('details'), caption = element('summary', '其他班級資訊')
        details.append(caption); summary.append(details)
        original.before(summary); move(original, details)
        details.open = view.classDetails === true
        listen(details, 'toggle', () => { view.classDetails = details.open })
      }
      for (const card of content.querySelectorAll('.card.teacher')) mark(card, 'data-edulog-teacher', '')
      const nativeSearch = content.querySelector('#student_id-selectized')
      if (nativeSearch) { mark(nativeSearch, 'aria-label', '原站學生查詢'); mark(nativeSearch, 'placeholder', '查詢原站學生') }
    }
    const students = content.querySelector('#students-table')
    if (students) scrollTable(scope, students, 'students')
    const reports = content.querySelector('#reports')
    if (reports) {
      mark(reports, 'data-edulog-dense-table', '')
      const scroll = scrollTable(scope, reports, 'reports')
      mark(scroll, 'data-edulog-report-region', '')
      // Source wrappers must not create nested vertical scroll areas.
      for (let parent = scroll.parentElement; parent && parent !== content; parent = parent.parentElement) mark(parent, 'data-edulog-scroll-parent', '')
      const legend = region(scope, '', 'edulog-report-legend')
      legend.append(element('p', '課程啟用與課堂記錄是不同狀態；請依原站記錄內容確認報告是否已填寫。'))
      const statisticsHeader = [...(reports.rows[0]?.cells || [])].find(cell => /出席統計/.test(text(cell)))
      const sourceHint = statisticsHeader?.querySelector('[data-bs-title],[title],[data-bs-original-title],[data-original-title]')
      const attendanceHint = sourceHint?.getAttribute('data-bs-title') || sourceHint?.getAttribute('title') || sourceHint?.getAttribute('data-bs-original-title') || sourceHint?.getAttribute('data-original-title')
      if (attendanceHint) legend.append(element('p', `出席統計：${attendanceHint}`))
      scroll.before(legend)
      for (const alert of reports.closest('.tab-pane')?.querySelectorAll('.alert') || []) mark(alert, 'data-edulog-report-alert', '')
      const enhanceReportRow = row => {
        if (row.querySelector('td')) {
          mark(row, 'data-edulog-report-row', '')
          view.reportDetails ||= new WeakMap()
          if (!view.reportDetails.has(row)) view.reportDetails.set(row,new Map())
          const states = view.reportDetails.get(row)
          const details = []
          for (const [index,title] of [[1,'課程與進度'],[2,'出席統計與專案']]) {
            const cell = row.cells[index]; if (!cell || cell.querySelector(':scope > .edulog-report-details')) continue
            mark(cell, 'data-edulog-report-meta', '')
            const disclosure = scope.add(element('details')); disclosure.className = 'edulog-report-details'
            disclosure.append(element('summary', title))
            const body = element('div'); disclosure.append(body)
            const children = [...cell.childNodes]; cell.append(disclosure)
            for (const node of children) move(node, body)
            details.push({disclosure,key:index})
          }
          const studentActions = [...row.cells[0].querySelectorAll('a[href]')].filter(a => !/comments/.test(a.pathname) && !a.closest('.edulog-student-actions'))
          if (studentActions.length) {
            const disclosure = scope.add(element('details')); disclosure.className = 'edulog-report-details edulog-student-actions'
            disclosure.append(element('summary','學生操作'))
            const body = element('div'); disclosure.append(body); row.cells[0].append(disclosure)
            for (const action of studentActions) move(action, body)
            details.push({disclosure,key:0})
          }
          const layout = () => { for (const {disclosure,key} of details) disclosure.open = doc.defaultView.innerWidth > 991 || states.get(key) === true }
          for (const {disclosure,key} of details) listen(disclosure,'toggle',()=>{ if (doc.defaultView.innerWidth <= 991) states.set(key, disclosure.open) })
          listen(doc.defaultView, 'resize', layout); layout()
        }
        const name = row.cells[0]?.querySelector(':scope > span,:scope > div > span')
        const student = text(name) || [...(row.cells[0]?.childNodes || [])].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ') || text(row.cells[0])
        for (const button of row.querySelectorAll('.btn,button,input[type=submit]')) mark(button,'data-edulog-action','')
        for (const a of row.querySelectorAll('a[href]')) {
          if (/\/reports\/\d+\/edit$/.test(a.pathname)) {
            const column = [...row.cells].indexOf(a.closest('td'))
            const week = text(reports.rows[0]?.cells[column])
            mark(a, 'aria-label', `${student} ${week} 填寫課堂記錄`)
            mark(a, 'data-edulog-record-action', '')
            scope.text(a, '課堂記錄')
          } else if (/\/students\/\d+\/accounts$/.test(a.pathname)) {
            scope.text(a, '學習帳號設定'); mark(a, 'aria-label', `${student} 學習帳號設定`)
          } else if (/\/students\/\d+\/teachers_comment$/.test(a.pathname)) {
            scope.text(a, '學生總評'); mark(a, 'aria-label', `${student} 學生總評`)
          } else if (!text(a)) mark(a, 'aria-label', /comments/.test(a.pathname) ? `${student} 教學備註` : `${student} 原站操作`)
        }
        const statistics = row.cells[2]?.querySelector('[title],[data-bs-original-title],[data-original-title]')
        // Use the source's explanation only; do not assign meaning to bare ratios.
        const explanation = statistics?.getAttribute('title') || statistics?.getAttribute('data-bs-original-title') || statistics?.getAttribute('data-original-title') || attendanceHint
        if (explanation) mark(row.cells[2], 'aria-label', `${text(row.cells[2])}：${explanation}`)
      }
      const refreshRows = () => { for (const row of reports.rows) enhanceReportRow(row) }
      refreshRows(); refreshers.push(refreshRows)
    }
    if (page.kind === 'history') {
      const admission = content.querySelector('#admission-data,.admission-data')
      const list = admission?.querySelector('ul')
      if (list) {
        const summary = region(scope, '學生與課程', 'edulog-history-summary')
        const items = [...list.children].filter(n => n.tagName === 'LI')
        const core = items.filter(n => /^(學生|梯次\/節次|課程名稱|總堂數|可補課次數)/.test(text(n)))
        const info = element('ul'); info.className = 'edulog-history-core'; summary.append(info)
        admission.before(summary)
        const extra = element('details'); extra.className = 'edulog-history-stats'; extra.append(element('summary', '堂數與補課資訊'))
        const statsList = element('ul'); extra.append(statsList)
        for (const item of core) move(item, /^(總堂數|可補課次數)/.test(text(item)) ? statsList : info)
        if (statsList.children.length) summary.append(extra)
        const stats = [...content.querySelectorAll('p,div')].find(n => !n.children.length && /目前進度.*實際出席/.test(text(n)))
        if (stats) summary.append(element('p', text(stats)))
        const details = scope.add(element('details')); details.className = 'edulog-admission-details'
        details.append(element('summary', '報名與行政資訊')); admission.before(details); move(admission, details)
        details.open = view.admissionDetails === true; listen(details, 'toggle', () => { view.admissionDetails = details.open })
      }
      const table = [...content.querySelectorAll('table')].find(t => /學習評估/.test(text(t.rows[0])))
      if (table) {
        const headers = [...table.rows[0].cells].map(text), dateIndex = headers.findIndex(h => h === '日期')
        const { tools, rows, refresh } = filterTable(context, table, 'historyQuery', '歷史課堂紀錄', dateIndex < 0 ? null : dateIndex)
        refreshers.push(refresh)
        const newest = element('button', '前往最新紀錄'); newest.type = 'button'; tools.append(newest)
        listen(newest, 'click', () => {
          const dated = rows.filter(r => !r.hasAttribute('data-edulog-filtered') && !r.hidden && /\d{4}-\d{2}-\d{2}/.test(text(r.cells[dateIndex])))
          const completed = dated.filter(r => /評語|最新課程階段/.test(text(r)))
          const target = (completed.length ? completed : dated).sort((a, b) => text(b.cells[dateIndex]).localeCompare(text(a.cells[dateIndex])))[0]
          if (target) { mark(target, 'tabindex', '-1'); target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'center', behavior: 'auto' }) }
        })
        for (const row of rows) {
          const assessment = row.cells[headers.findIndex(h => /學習評估/.test(h))]
          if (assessment?.textContent.trim()) {
            const details = element('details'); details.className = 'edulog-assessment'
            details.append(element('summary', '評語、聯絡與內部紀錄'))
            const original = [...assessment.childNodes]; assessment.append(details); scope.add(details)
            for (const node of original) move(node, details)
          }
        }
      }
    }
    if (page.kind === 'unfilled') {
      const heading = content.querySelector('h3')
      const title = region(scope, '', 'edulog-page-context')
      title.append(element('strong', `目前檢視：${text(heading) || '原站選定月份'}`), element('p', '清單範圍以原站目前帳號及月份為準。'))
      content.prepend(title)
      if (heading) mark(heading, 'data-edulog-duplicate-heading', '')
      const table = content.querySelector('table')
      if (table) refreshers.push(filterTable(context, table, 'unfilledQuery', '未填寫課堂紀錄').refresh)
      for (const a of content.querySelectorAll('a[href]')) if (/month_unfilled_report/.test(a.pathname)) {
        const current = (new URL(a.href).searchParams.get('month') || '') === (new URL(doc.location.href).searchParams.get('month') || '')
        if (current) mark(a, 'aria-current', 'page')
      }
    }
    if (page.kind === 'classes') {
      const switcher = region(scope, '班級檢視', 'edulog-table-tools')
      const listButton = element('button', '班級清單'), matrixButton = element('button', '原站時段矩陣')
      listButton.type = matrixButton.type = 'button'; switcher.append(listButton, matrixButton); content.prepend(switcher)
      const pairs = []
      for (const table of content.querySelectorAll('table.dt-stages')) {
        const cards = region(scope, '', 'edulog-class-list')
        const cells = grid(table)
        for (let r = 2; r < cells.length; r++) for (let c = 2; c < cells[r].length; c++) {
          const cell = cells[r][c]
          if (!cell || cells[r].indexOf(cell) !== c || (r > 2 && cells[r - 1]?.[c] === cell)) continue
          for (const original of [...cell.querySelectorAll('a[href]')].filter(classLink)) {
            const card = element('article'), link = element('a', text(cells[r][1]) || text(cells[r][0]) || '原站班級')
            link.href = original.href; card.append(link)
            const counts = text(original).match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/)
            card.append(facts(scope, [
              ['教室', text(cells[r][0])], ['星期', text(cells[0][c])], ['原站時段', text(cells[1][c])],
              ...(counts ? [['付費（含長期停課）', counts[1]], ['所有報名', counts[2]], ['教室人數上限', counts[3]]] : [['原站人數資訊', text(original)]]),
            ]))
            const other = text(cell).replace(text(original), '').trim(); if (other) card.append(element('p', other))
            cards.append(card)
          }
        }
        if (!cards.children.length) cards.append(element('p', '目前這個區域與時段沒有已載入的班級。'))
        table.before(cards)
        const scroll = scope.add(element('div')); scroll.className = 'edulog-table-scroll'
        table.before(scroll); move(table, scroll)
        pairs.push({ table, cards, scroll })
      }
      const select = mode => {
        view.classLayout = mode
        listButton.setAttribute('aria-pressed', String(mode === 'list')); matrixButton.setAttribute('aria-pressed', String(mode === 'matrix'))
        for (const { table, cards, scroll } of pairs) { mark(table, 'data-edulog-matrix-hidden', mode === 'list' ? '' : null); scroll.hidden = mode === 'list'; cards.hidden = mode !== 'list' }
      }
      listen(listButton, 'click', () => select('list')); listen(matrixButton, 'click', () => select('matrix')); select(view.classLayout || 'list')
    }
    if (page.kind === 'overview') {
      for (const table of content.querySelectorAll('table')) { mark(table, 'data-edulog-overview-table', ''); scrollTable(scope, table, 'overview') }
      const value = new URL(doc.location.href).searchParams.get('today')
      const current = new Date(); const today = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`
      const context = region(scope, '', 'edulog-page-context')
      context.append(element('strong', `課表基準日期：${value || today}`), element('p', '「我的班級」是固定班級入口；下方課表依原站選定日期顯示。'))
      const todayLink = element('a', '回到今天'); todayLink.href = `/?today=${today}`; context.append(todayLink); content.prepend(context)
      const opener = [...content.querySelectorAll('a[href]')].find(a => /課程表.*點擊檢視/.test(text(a)))
      if (opener) {
        mark(opener, 'aria-label', '載入選定日期課表')
        const state = scope.add(element('p', '課表尚未展開，請按「課程表」載入。')); state.className = 'edulog-empty'; state.setAttribute('role', 'status'); opener.parentElement.after(state)
        listen(opener, 'click', () => { state.textContent = '正在載入課表；若未載入，請重新按原站課表入口。' })
      }
    }
    if (page.kind === 'calendar') {
      const summary = region(scope, '課程行事曆', 'edulog-page-context')
      const update = () => {
      const selected = content.querySelector('.region-title.active')
      const selectedPanel = selected && content.querySelector(selected.getAttribute('href'))
      const day = selectedPanel?.querySelector('[id*="weekday-"][id$="-tab"].active')
      description.textContent = `目前區域：${text(selected) || '尚未選擇'} · 日期：${text(day) || '請選擇日期'}`
      const panels = [...(selectedPanel?.querySelectorAll('[id^=region-][id*=weekday-]:not([id$=-tab])') || [])]
      const active = day && selectedPanel?.querySelector(day.getAttribute('href'))
      const links = active ? [...active.querySelectorAll('a[href]')].filter(classLink) : []
      status.textContent = !selected ? '請選擇區域以載入課程。' : !panels.length ? '正在載入區域課表；若未載入，請重新選擇原站區域。' : !active ? '請選擇日期。' : links.length ? `目前日期已載入 ${links.length} 個班級入口。` : '目前已載入的日期沒有課程。'
      for (const alert of content.querySelectorAll('.alert')) if (text(alert) === '請選擇區域') mark(alert, 'data-edulog-stale-alert', selected ? '' : null)
      }
      const description = element('p'), status = element('p'); status.setAttribute('role', 'status'); summary.append(description, status); content.prepend(summary)
      update(); refreshers.push(update)
      const input = content.querySelector('input[placeholder="選擇欲前往的日期"]:not([type=hidden])')
      if (input) {
        mark(input, 'aria-label', '前往課程日期')
        const form = input.closest('form')
        if (form) {
          mark(form, 'data-edulog-calendar-controls', '')
          const previous = [...content.querySelectorAll('a[href]')].find(a => text(a) === '前一週')
          const next = [...content.querySelectorAll('a[href]')].find(a => text(a) === '下一週')
          if (previous && next) {
            const original = form.parentElement.closest('.row')
            const navigation = region(scope, '', 'edulog-calendar-nav')
            ;(original || form).before(navigation)
            move(previous, navigation); move(form, navigation); move(next, navigation)
            if (original && !text(original)) mark(original, 'data-edulog-duplicate-heading', '')
          }
        }
      }
      for (const a of content.querySelectorAll('.region-title,[id*="weekday-"][id$="-tab"]')) listen(a, 'click', () => { status.textContent = '正在切換原站課表…' })
      for (const table of content.querySelectorAll('table.content-table')) { mark(table, 'data-edulog-calendar-table', ''); scrollTable(scope, table, 'calendar') }
    }
    return { refresh: () => { for (const refresh of refreshers) refresh() } }
  }
  function enhanceDialog(doc, view, scope) {
    const modal = doc.querySelector('#lesson-report-modal'), form = modal?.querySelector('form')
    if (!form) return null
    const { mark, element, listen, move } = scope
    mark(modal, 'data-edulog-dialog', '')
    if (view.reportTarget && form.getAttribute('action') === view.reportTarget.path.replace(/\/edit$/, '')) {
      const target = scope.add(element('p', `課次：${view.reportTarget.label}`)); target.className = 'edulog-dialog-context'
      modal.querySelector('.modal-header')?.append(target)
    }
    const labels = {
      lesson_report_attendance_status: '出席狀況', lesson_report_reason: '不出席原因',
      dt_admission_lesson_report_learning_stage: '學習課程', dt_admission_lesson_report_completion_status: '完成狀況',
      dt_admission_lesson_report_start_from: '章節起點', dt_admission_lesson_report_end_to: '章節終點',
      lesson_report_feedback: '學習表現', lesson_report_comment: '內部紀錄', admission_lesson_report_learning_status: '學習狀況（內部）',
    }
    for (const [id, label] of Object.entries(labels)) {
      const input = form.querySelector(`#${id}`)
      if (!input) continue
      mark(input, 'aria-label', label)
      const original = [...input.parentElement.querySelectorAll('label')].find(n => !n.htmlFor && text(n) === label)
      if (original) mark(original, 'for', id)
    }
    for (const row of [...form.children]) {
      if (row.querySelector('input,select,textarea') || !/完成狀況|章節進度/.test(text(row))) continue
      for (const caption of [...row.children]) {
        const id = /完成狀況/.test(text(caption)) ? 'dt_admission_lesson_report_completion_status' : /章節進度/.test(text(caption)) ? 'dt_admission_lesson_report_start_from' : null
        const input = id && form.querySelector(`#${id}`)
        const column = input?.closest('.col-md-6,.col-md-4') || input?.parentElement
        if (column) { move(caption, column); mark(caption, 'data-edulog-field-caption', ''); mark(column, 'data-edulog-field-column', '') }
      }
      if (!text(row)) mark(row, 'data-edulog-duplicate-heading', '')
    }
    const sections = new Map()
    const group = name => {
      if (!sections.has(name)) { const box = region(scope, name, 'edulog-form-section'); form.append(box); sections.set(name, box) }
      return sections.get(name)
    }
    const children = [...form.children]
    for (const child of children) {
      if (child.matches('input[type=hidden],script,[data-edulog-owned]')) continue
      if (child.tagName === 'H4' && /專案進度/.test(text(child))) { mark(child, 'data-edulog-duplicate-heading', ''); continue }
      const ids = [child.id, ...[...child.querySelectorAll('[id]')].map(n => n.id)].join(' ')
      const fields = child.matches('input,select,textarea') ? [child] : [...child.querySelectorAll('input,select,textarea')]
      const name = /attendance_status|lesson_report_reason/.test(ids) ? '出席狀況'
        : /learning_stage|completion_status|start_from|end_to/.test(ids) ? '課程與專案進度'
        : fields.some(n => n.type === 'radio') ? '課堂評量'
        : /feedback|contact/.test(ids) ? '學習表現與聯絡欄'
        : /comment|learning_status|typing_error/.test(ids) ? '內部紀錄'
        : fields.some(n => n.type === 'submit' || n.type === 'checkbox') ? '確認與送出' : null
      // The source keeps completion/section captions in a separate row.
      const captions = !fields.length && /完成狀況|章節進度/.test(text(child))
      if (name || captions) move(child, group(name || '課程與專案進度'))
    }
    const footer = sections.get('確認與送出'); if (footer) mark(footer, 'data-edulog-submit-region', '')
    for (const name of ['出席狀況','課程與專案進度','課堂評量','學習表現與聯絡欄','內部紀錄','確認與送出']) if (sections.has(name)) form.append(sections.get(name))
    for (const [name, label] of [['participation_rating', '課程參與'], ['order_rating', '課堂秩序']]) {
      const radios = [...form.querySelectorAll(`input[type=radio][name$="[${name}]"]`)]
      if (!radios.length) continue
      const wrapper = scope.add(element('label', `${label}評分`)); wrapper.className = 'edulog-rating-control'
      const select = element('select'); select.setAttribute('aria-label', `${label}評分`)
      const empty = element('option', '尚未評分'); empty.value = ''; select.append(empty)
      const halfStars = radios.length === 10 && radios.every(n => /^[1-9]$|^10$/.test(n.value))
      for (const radio of [...radios].sort((a,b) => Number(a.value)-Number(b.value))) {
        const option = element('option', halfStars ? `${Number(radio.value)/2} / 5 星` : `原站評分 ${radio.value}`)
        option.value = radio.value; select.append(option)
        mark(radio, 'aria-label', `${label} ${option.textContent}`)
      }
      const sync = () => { select.value = radios.find(n => n.checked)?.value || '' }
      sync(); wrapper.append(select)
      const rating = radios[0].closest('.rating') || radios[0].parentElement
      const column = rating.closest('.col-md-6,.col-md-4') || rating.parentElement
      column.append(wrapper)
      mark(column, 'data-edulog-rating-column', '')
      listen(select, 'change', () => {
        const radio = radios.find(n => n.value === select.value)
        if (!radio) { sync(); return }
        radio.checked = true
        radio.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }))
        radio.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }))
      })
      for (const radio of radios) listen(radio, 'change', sync)
    }
    const heading = modal.querySelector('.modal-title,h4')
    if (heading) { if (!heading.id) mark(heading, 'id', 'edulog-report-title'); mark(modal, 'aria-labelledby', heading.id) }
    mark(modal, 'role', 'dialog'); mark(modal, 'aria-modal', 'true')
    return { form, restore: scope.restore }
  }
  function enhanceDialogs(doc, view, createScope) {
    const entries = []
    const report = doc.querySelector('#lesson-report-modal form')
    if (report) { const scope = createScope(doc); const enhancement = enhanceDialog(doc,view,scope); if (enhancement) entries.push({root: report.closest('.modal'), ...enhancement}) }
    // These IDs and field structures have been inspected on the live site.
    for (const modal of doc.querySelectorAll('#edit-teacher-comment-modal,#teachers-comment-modal')) {
      const field = modal.querySelector('textarea'); if (!field) continue
      const scope = createScope(doc), title = modal.querySelector('.modal-title')
      scope.mark(modal,'data-edulog-dialog','compact'); scope.mark(modal,'role','dialog'); scope.mark(modal,'aria-modal','true')
      if (title) { if (!title.id) scope.mark(title,'id',`edulog-${modal.id}-title`); scope.mark(modal,'aria-labelledby',title.id) }
      scope.mark(field,'aria-label',modal.id === 'teachers-comment-modal' ? '學生總評' : '教學備註')
      const close = modal.querySelector('button[data-bs-dismiss=modal],button[aria-label=Close]')
      if (close) { scope.mark(close,'data-edulog-close',''); scope.mark(close,'aria-label','關閉視窗') }
      const note = scope.add(scope.element('p',modal.id === 'teachers-comment-modal' ? '學生總評與每次課堂記錄分開儲存，請使用原站送出按鈕。' : '教學備註使用原站儲存機制；關閉視窗不代表已儲存。'))
      note.className = 'edulog-dialog-context'; field.before(note)
      entries.push({ root:modal, form:field.closest('form') || field, restore:scope.restore })
    }
    return { roots:entries.map(e=>e.root), isCurrent:()=>entries.every(e=>e.root.isConnected && (e.root.querySelector('form') || e.root.querySelector('textarea')) === e.form) && doc.querySelectorAll('#lesson-report-modal form,#edit-teacher-comment-modal textarea,#teachers-comment-modal textarea').length === entries.length, restore(){ for (const e of entries) e.restore() } }
  }
  globalThis.edulogSiteWorkflows = Object.freeze({ enhancePage, enhanceDialog, enhanceDialogs })
})()
