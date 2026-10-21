// Sample-backed enhancements for this provider. No network or credential access.
(() => {
  const model = globalThis.edulogSiteModel, words = globalThis.edulogSiteLexicon.text, site = globalThis.edulogSiteLexicon.locale
  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  const text = node => node?.textContent.trim().replace(/\s+/g, ' ') || ''
  const classLink = a => { try { return a.origin === a.ownerDocument.location.origin && /^\/courses\/dt\/\d+\/?$/.test(a.pathname) } catch { return false } }
  function region(scope, title, className = 'edulog-section') {
    const section = scope.add(scope.element('section'))
    section.className = className
    if (title) section.append(scope.element('h3', tx(title)))
    return section
  }
  function facts(scope, values) {
    const list = scope.element('dl'); list.className = 'edulog-facts'
    for (const [label, value] of values) if (value) {
      const item = scope.element('div'); item.append(scope.element('dt', tx(label)), scope.element('dd', value)); list.append(item)
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
  const normalized = value => String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
  function reportDate(label, cell) {
    const candidates = [cell?.getAttribute('data-date'),cell?.getAttribute('datetime'),cell?.getAttribute('data-start-date'),label]
    for (const value of candidates) {
      const match = String(value || '').match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?\b/)
      if (match) return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`
    }
    return null
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
    const label = element('label', tx('本頁搜尋')), search = element('input')
    search.type = 'search'; search.dataset.edulogSearch = key; search.value = view[key] || ''; label.append(search)
    const count = element('span'); count.setAttribute('role', 'status')
    tools.append(label, count); table.before(tools)
    let rows = []
    let date
    if (dateColumn !== null) {
      const dates = element('label', tx('紀錄日期')); date = element('input'); date.type = 'date'
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
      count.textContent = tx('顯示 {visible} / {total} 筆', { visible, total: rows.filter(r => !r.hidden).length })
      empty.hidden = visible > 0
      empty.textContent = rows.length ? tx('目前篩選條件沒有符合的紀錄。') : tx('目前這份清單沒有紀錄。')
      mark(table, 'data-edulog-empty-table', rows.length ? null : '')
      mark(scroll, 'data-edulog-empty-table', rows.length ? null : '')
    }
    const empty = scope.add(element('p')); empty.className = 'edulog-empty'; empty.setAttribute('role', 'status'); scroll.after(empty)
    listen(search, 'input', apply); if (date) listen(date, 'input', apply)
    apply()
    scope.mark(table, 'data-edulog-dense-table', '')
    return { tools, rows, refresh: apply }
  }
  // Unfilled-report lists (MASTER §6.1, §6.4): rows grouped by class session, overdue
  // (請儘速填寫) first in red, one 填寫 per row, a tag when 學習紀錄節次 differs from
  // 目前節次, and the phone only after a click. The native table stays, hidden, and its
  // links do the work; its search filter still decides which rows are shown.
  const UNFILLED_COLUMNS = ['學生', '學習紀錄節次', '目前節次', '課堂紀錄']
  const OVERDUE = /請儘速填寫|逾期/
  const PHONE = /(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}|0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/
  const SVG = 'http://www.w3.org/2000/svg'
  const LUCIDE = {
    'chevron-down': ['m6 9 6 6 6-6'],
    clock: [['circle', { cx: 12, cy: 12, r: 10 }], 'M12 6v6l4 2'],
    alert: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
    phone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z'],
    inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  }
  function lucide(doc, name) {
    const svg = doc.createElementNS(SVG, 'svg')
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', class: 'edulog-icon', 'data-edulog-owned': '' })) svg.setAttribute(key, value)
    for (const shape of LUCIDE[name]) {
      const [tag, attrs] = typeof shape === 'string' ? ['path', { d: shape }] : shape
      const node = doc.createElementNS(SVG, tag)
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
      node.setAttribute('data-edulog-owned', ''); svg.append(node)
    }
    return svg
  }
  function readUnfilledRows(table) {
    const header = [...table.rows].find(row => [...row.cells].some(cell => /學生/.test(text(cell))))
    const labels = [...(header?.cells || [])].map(cell => text(cell))
    const column = (pattern, fallback) => { const index = labels.findIndex(label => pattern.test(label)); return index < 0 ? fallback : index }
    const at = { student: column(/^學生$/, 0), slot: column(/學習紀錄節次/, 1), current: column(/目前節次/, 2), record: column(/課堂紀錄/, 3) }
    return [...table.rows].filter(row => row !== header && !row.querySelector('th') && row.cells.length > at.record).map(row => {
      const studentCell = row.cells[at.student], recordCell = row.cells[at.record]
      const link = [...studentCell.querySelectorAll('a[href]')].find(a => /^\/dt_admissions\/\d+/.test(a.getAttribute('href') || ''))
      const course = text(studentCell.querySelector('small'))
      const telLink = studentCell.querySelector('a[href^="tel:"]')
      const phone = telLink ? (telLink.getAttribute('href') || '').replace(/^tel:/, '') : PHONE.exec(text(studentCell))?.[0] || null
      const name = text(link) || text(studentCell).replace(course, '').replace(phone || '', '').trim()
      const slot = text(row.cells[at.slot]), current = text(row.cells[at.current])
      return {
        row, name, course, phone, slot, current,
        mismatch: Boolean(slot && current && slot.replace(/\s+/g, '') !== current.replace(/\s+/g, '')),
        overdue: OVERDUE.test(text(row)),
        action: recordCell.querySelector('a[href],button') || null,
      }
    })
  }
  function unfilledList({ doc, scope, view }, table, { monthly }) {
    const { element, listen, mark } = scope
    const items = readUnfilledRows(table)
    const anchor = table.closest('[data-edulog-scroll]') || table
    const section = scope.add(element('section')); section.className = 'edulog-unfilled-list'
    section.setAttribute('aria-label', monthly ? tx('整月未填課堂紀錄') : tx('待補填課堂紀錄'))
    anchor.before(section)
    if (items.length) mark(anchor, 'data-edulog-cards', 'on')
    const summary = element('p'); summary.className = 'edulog-unfilled-summary'; summary.setAttribute('role', 'status')
    const body = element('div')
    section.append(summary, body)
    const shownPhones = view.unfilledPhones || (view.unfilledPhones = new Set())
    const closed = view.unfilledClosed || (view.unfilledClosed = new Set())
    const tag = (tone, label, iconName, title) => { const node = element('span'); node.className = 'edulog-badge'; node.dataset.tone = tone; if (iconName) node.append(lucide(doc, iconName)); node.append(element('span', tx(label))); if (title) node.title = title; return node }
    function rowFor(item) {
      const li = element('li'); li.className = 'edulog-unfilled-row'; li.dataset.bar = item.overdue ? 'danger' : 'warn'
      const main = element('div'); main.className = 'edulog-unfilled-main'
      const title = element('strong'); title.append(element('span', item.name || tx('未命名學生')))
      if (item.mismatch) title.append(tag('notice', '節次不一致', 'alert', tx('學習紀錄節次：{slot}；目前節次：{current}', { slot: item.slot, current: item.current })))
      main.append(title, element('span', [item.course, item.slot && tx('學習紀錄 {slot}', { slot: item.slot }), item.mismatch && tx('目前 {current}', { current: item.current })].filter(Boolean).join(' · ')))
      const facts = element('div'); facts.className = 'edulog-unfilled-facts'
      facts.append(item.overdue ? tag('danger', '請儘速填寫', 'clock') : tag('warn', '待補填'))
      if (item.phone) {
        const key = `${item.name}|${item.phone}`
        if (shownPhones.has(key)) { const call = element('a'); call.className = 'edulog-phone'; call.href = `tel:${item.phone.replace(/[^\d+]/g, '')}`; call.append(lucide(doc, 'phone'), element('span', item.phone)); facts.append(call) }
        else {
          const reveal = element('button'); reveal.type = 'button'; reveal.className = 'edulog-phone'; reveal.append(lucide(doc, 'phone'), element('span', tx('顯示電話')))
          reveal.setAttribute('aria-label', tx('顯示 {name} 的聯絡電話', { name: item.name }))
          listen(reveal, 'click', () => { shownPhones.add(key); render(); section.querySelector(`a.edulog-phone[href="tel:${item.phone.replace(/[^\d+]/g, '')}"]`)?.focus() })
          facts.append(reveal)
        }
      }
      const actions = element('div'); actions.className = 'edulog-unfilled-actions'
      if (item.action) {
        const fill = element('button', tx('填寫')); fill.type = 'button'; fill.className = 'edulog-unfilled-fill'; fill.dataset.edulogUnfilledFill = ''
        fill.setAttribute('aria-label', tx('填寫 {name} 的課堂紀錄', { name: item.name }))
        listen(fill, 'click', () => { if (item.action.isConnected) item.action.click() })
        actions.append(fill)
      } else actions.append(element('span', '—'))
      li.append(main, facts, actions)
      return li
    }
    function render() {
      const shown = items.filter(item => !item.row.hasAttribute('data-edulog-filtered'))
      const overdue = shown.filter(item => item.overdue)
      const groups = new Map()
      for (const item of shown.filter(entry => !entry.overdue)) {
        const key = item.slot || tx('未標示節次')
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(item)
      }
      const ordered = [...(overdue.length ? [['overdue', tx('逾期未填'), overdue]] : []), ...[...groups].map(([slot, list]) => [`slot:${slot}`, slot, list])]
      summary.textContent = items.length ? tx('{count} 份未填', { count: shown.length }) + (overdue.length ? tx(' · {count} 份請儘速填寫', { count: overdue.length }) : '') : ''
      summary.hidden = !items.length
      if (!items.length || !shown.length) {
        const empty = element('div'); empty.className = 'edulog-unfilled-empty'
        empty.append(lucide(doc, 'inbox'), element('strong', items.length ? tx('沒有符合搜尋的學生') : tx('目前清單沒有紀錄')), element('span', items.length ? tx('清除搜尋即可看到全部未填紀錄。') : monthly ? tx('原站這個月份沒有列出未填的課堂紀錄。') : tx('原站目前沒有列出需要補填的課堂紀錄。')))
        body.replaceChildren(empty)
        return
      }
      body.replaceChildren(...ordered.map(([key, label, list]) => {
        const group = element('div'); group.className = 'edulog-unfilled-group'; group.dataset.tone = key === 'overdue' ? 'danger' : 'warn'
        const open = !closed.has(key)
        const head = element('button'); head.type = 'button'; head.className = 'edulog-unfilled-head'; head.setAttribute('aria-expanded', String(open))
        const dot = element('span'); dot.className = 'edulog-status-dot'; dot.setAttribute('aria-hidden', 'true')
        head.append(lucide(doc, 'chevron-down'), key === 'overdue' ? lucide(doc, 'clock') : dot, element('span', label))
        const courses = [...new Set(list.map(item => item.course).filter(Boolean))]
        if (key !== 'overdue' && courses.length) { const sub = element('span', courses.join('、')); sub.className = 'edulog-unfilled-sub'; head.append(sub) }
        const count = element('span', tx('{count} 份', { count: list.length })); count.className = 'edulog-unfilled-count'; head.append(count)
        const rows = element('ul'); rows.hidden = !open
        rows.append(...list.map(rowFor))
        listen(head, 'click', () => { if (closed.has(key)) closed.delete(key); else closed.add(key); render() })
        group.append(head, rows)
        return group
      }))
    }
    render()
    return render
  }
  function enhancePage(context) {
    const { doc, content, page, scope, view } = context
    const pagePath=doc.location.pathname
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
          mark(input, 'aria-label', tx(label))
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
        summary.append(element('strong', tx('查詢月份：{year} {month}', { year, month })), element('p', tx('鐘點與項目依原站明細呈現。')))
        form.after(summary)
        const tables = [...content.querySelectorAll('table')]
        for (const table of tables) { mark(table, 'data-edulog-hours-table', ''); scrollTable(scope, table, 'hours') }
        if (!tables.some(t => [...t.rows].some(r => r.querySelector('td')))) {
          const empty = scope.add(element('p', tx('此月份沒有鐘點紀錄'))); empty.className = 'edulog-empty'; summary.after(empty)
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
              group.className = 'edulog-section'; group.append(element('summary', tx(name)), element('p', tx('不修改密碼請留空。修改後原站會強制登出。')))
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
        const submit = form.querySelector('input[type=submit]'); if (submit) mark(submit, 'value', tx('儲存個人資料'))
      }
    }
    for (const card of content.querySelectorAll('.card')) mark(card, 'data-edulog-card', '')
    // Clarify the global, server-backed search without replacing its handlers.
    const globalSearch = doc.querySelector('#nav-teacher input[name=q]')
    if (globalSearch) { mark(globalSearch, 'aria-label', tx('本站學生搜尋')); mark(globalSearch, 'placeholder', tx('本站學生搜尋')) }
    for (const a of doc.querySelectorAll('.sidebar a[href]')) {
      const href = a.getAttribute('href')
      if (href && !href.startsWith('#') && a.origin === doc.location.origin && a.pathname === doc.location.pathname) mark(a, 'aria-current', 'page')
    }
    if (page.kind === 'class') {
      const heading = content.querySelector('h2'), overview = content.querySelector('[role=tab][href="#overview"]')
      if (heading && site.isTerm(text(heading), '節次資訊')) scope.text(heading, tx('班級工作區'))
      if (overview) scope.text(overview, tx('班級名單'))
      const original = content.querySelector('#overview table:not(#students-table)')
      if (original && original.rows.length > 1) {
        const labels = [...original.rows[0].cells].map(text)
        const values = [...original.rows[1].cells].map(text)
        const summary = region(scope, '班級資訊', 'edulog-class-summary')
        const items = labels.flatMap((label,i) => /上課.*報名.*上限/.test(site.canonLabel(label)) && /^\d+\s*\/\s*\d+\s*\/\s*\d+$/.test(values[i]) ? values[i].split('/').map((value,j)=>[['上課人數','報名人數','人數上限'][j],value.trim()]) : [[label,values[i]]])
        summary.append(facts(scope, items))
        const details = element('details'), caption = element('summary', tx('其他班級資訊'))
        details.append(caption); summary.append(details)
        original.before(summary); move(original, details)
        details.open = view.classDetails === true
        listen(details, 'toggle', () => { view.classDetails = details.open })
      }
      for (const card of content.querySelectorAll('.card.teacher')) mark(card, 'data-edulog-teacher', '')
      const nativeSearch = content.querySelector('#student_id-selectized')
      if (nativeSearch) { mark(nativeSearch, 'aria-label', tx('原站學生查詢')); mark(nativeSearch, 'placeholder', tx('查詢原站學生')) }
    }
    const students = content.querySelector('#students-table')
    if (students) scrollTable(scope, students, 'students')
    const reports = content.querySelector('#reports')
    if (reports) {
      mark(reports, 'data-edulog-dense-table', '')
      const scroll = scrollTable(scope, reports, 'reports')
      mark(scroll, 'data-edulog-report-region', '')
      mark(scroll,'role','region');mark(scroll,'aria-label',tx('課堂紀錄表，可依螢幕寬度捲動'));mark(scroll,'tabindex','0')
      // Source wrappers must not create nested vertical scroll areas.
      for (let parent = scroll.parentElement; parent && parent !== content; parent = parent.parentElement) mark(parent, 'data-edulog-scroll-parent', '')
      const legend = region(scope, '', 'edulog-report-legend')
      legend.append(element('p', tx('課程啟用與課堂記錄是不同狀態；請依原站記錄內容確認報告是否已填寫。')))
      const statisticsHeader = [...(reports.rows[0]?.cells || [])].find(cell => /出席統計/.test(site.canonLabel(text(cell))))
      const sourceHint = statisticsHeader?.querySelector('[data-bs-title],[title],[data-bs-original-title],[data-original-title]')
      const attendanceHint = sourceHint?.getAttribute('data-bs-title') || sourceHint?.getAttribute('title') || sourceHint?.getAttribute('data-bs-original-title') || sourceHint?.getAttribute('data-original-title')
      if (attendanceHint) legend.append(element('p', tx('出席統計：{hint}', { hint: attendanceHint })))
      scroll.before(legend)
      for (const alert of reports.closest('.tab-pane')?.querySelectorAll('.alert') || []) mark(alert, 'data-edulog-report-alert', '')
      const enhanceReportRow = row => {
        if (row.querySelector('td')) {
          mark(row, 'data-edulog-report-row', '')
          mark(row,'data-edulog-course-name',text(row.cells[1]))
          const sourceHeadings=[...(reports.rows[0]?.cells||[])].map(text)
          for(const [index,cell] of [...row.cells].entries())mark(cell,'data-edulog-column-label',sourceHeadings[index]||'')
          view.reportDetails ||= new WeakMap()
          if (!view.reportDetails.has(row)) view.reportDetails.set(row,new Map())
          const states = view.reportDetails.get(row)
          const details = []
          for (const [index,title] of [[2,tx('出席統計與專案')]]) {
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
            disclosure.append(element('summary',tx('學生操作')))
            const body = element('div'); disclosure.append(body); row.cells[0].append(disclosure)
            for (const action of studentActions) move(action, body)
            details.push({disclosure,key:0})
          }
          const layout = () => { for (const {disclosure,key} of details) disclosure.open = doc.defaultView.innerWidth > 991 || states.get(key) === true }
          for (const {disclosure,key} of details) listen(disclosure,'toggle',()=>{ if (doc.defaultView.innerWidth <= 991) states.set(key, disclosure.open) })
          listen(doc.defaultView, 'resize', layout); layout()
        }
        const name = row.cells[0]?.querySelector(':scope > span,:scope > div > span')
        const cleanName=row.cells[0]?.cloneNode(true);cleanName?.querySelectorAll('a,button,input,select,textarea,details,[data-edulog-owned]').forEach(node=>node.remove())
        const student = text(name) || text(cleanName) || [...(row.cells[0]?.childNodes || [])].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ')
        mark(row,'data-edulog-student-name',student)
        for (const button of row.querySelectorAll('.btn,button,input[type=submit]')) mark(button,'data-edulog-action','')
        for (const a of row.querySelectorAll('a[href]')) {
          if (/\/reports\/\d+\/edit$/.test(a.pathname)) {
            const column = [...row.cells].indexOf(a.closest('td'))
            const week = text(reports.rows[0]?.cells[column])
            mark(a, 'aria-label', tx('{student} {week} 填寫課堂記錄', { student, week }))
            mark(a, 'data-edulog-record-action', '')
            scope.text(a, tx('課堂記錄'))
          } else if (/\/students\/\d+\/accounts$/.test(a.pathname)) {
            scope.text(a, tx('學習帳號設定')); mark(a, 'aria-label', tx('{student} 學習帳號設定', { student }))
          } else if (/\/students\/\d+\/teachers_comment$/.test(a.pathname)) {
            scope.text(a, tx('學生總評')); mark(a, 'aria-label', tx('{student} 學生總評', { student }))
          } else if (!text(a)) mark(a, 'aria-label', /comments/.test(a.pathname) ? tx('{student} 教學備註', { student }) : tx('{student} 原站操作', { student }))
        }
        const statistics = row.cells[2]?.querySelector('[title],[data-bs-original-title],[data-original-title]')
        // Use the source's explanation only; do not assign meaning to bare ratios.
        const explanation = statistics?.getAttribute('title') || statistics?.getAttribute('data-bs-original-title') || statistics?.getAttribute('data-original-title') || attendanceHint
        if (explanation) mark(row.cells[2], 'aria-label', `${text(row.cells[2])}：${explanation}`)
      }
      const refreshRows = () => { for (const row of reports.rows) if(!row.hasAttribute('data-edulog-last-teaching-row'))enhanceReportRow(row) }
      refreshRows(); refreshers.push(refreshRows)
      const weekHeaders = model.readWeekColumns(reports.rows[0]?.cells || [])
      const selectedWeek=()=>model.pickWeek(weekHeaders,Number(view.week))
      const reportLinkFor=(row,week)=>{
        for(const link of week&&row.cells[week.index]?.querySelectorAll('a[href]')||[])try{const url=new URL(link.getAttribute('href'),doc.location.href);if(url.origin===doc.location.origin&&/^\/dt_admissions\/\d+\/reports\/\d+\/edit\/?$/.test(url.pathname))return url}catch{}
        return null
      }
      const admissionFor=(row,week)=>{
        const report=reportLinkFor(row,week),match=report?.pathname.match(/^\/dt_admissions\/(\d+)\/reports\//)
        if(match)return `/dt_admissions/${match[1]}`
        for(const link of row.querySelectorAll('a[href]'))try{const url=new URL(link.getAttribute('href'),doc.location.href);if(url.origin===doc.location.origin&&/^\/dt_admissions\/\d+\/?$/.test(url.pathname))return url.pathname.replace(/\/$/,'')}catch{}
        return null
      }
      const historyRowUpdaters=new Map()
      const historyRowLoaders=new Map()
      const historyCache=view.classHistoryCache||(view.classHistoryCache=new Map())
      const historyRequests=view.classHistoryRequests||(view.classHistoryRequests=new Map())
      const historyRevisions=view.classHistoryRevisions||(view.classHistoryRevisions=new Map())
      const enrollmentId=path=>String(path||'').match(/^\/dt_admissions\/(\d+)\/?$/)?.[1]||null
      const makeHistoryPanel = row => {
        if (!row.cells[0] || row.querySelector('.edulog-last-teaching-toggle')) return
        const button=element('button',tx('查看上次教學'))
        scope.add(button);button.type='button';button.className='edulog-last-teaching-toggle';button.setAttribute('aria-expanded','false')
        const live=element('div');live.className='edulog-last-teaching-content';live.setAttribute('role','status');live.setAttribute('aria-live','polite')
        const reload=element('button',tx('重新整理上次教學'));reload.type='button';reload.hidden=true
        const disclosure=element('div');disclosure.className='edulog-last-teaching-panel';disclosure.hidden=true;disclosure.append(live,reload)
        const detailsRow=scope.add(element('tr'));detailsRow.className='edulog-last-teaching-row';detailsRow.hidden=true;detailsRow.dataset.edulogLastTeachingRow=''
        const detailsCell=element('td');detailsCell.colSpan=Math.max(1,reports.rows[0]?.cells.length||row.cells.length);detailsCell.append(disclosure);detailsRow.append(detailsCell);row.after(detailsRow)
        const actionCell=scope.add(element('div'));actionCell.className='edulog-teaching-actions';mark(actionCell,'data-edulog-owned','');actionCell.append(button)
        const statusSummaries=new Map()
        const session=(week=selectedWeek())=>{const cell=week&&row.cells[week.index];return week?{...week,cell,link:reportLinkFor(row,week),date:reportDate(week.label,week.cell),admission:admissionFor(row,week)}:null}
        const statusFor=target=>{
          const state=model.readSessionCell(target?.cell,{upcoming:words.nextWeek.test(target?.label||'')}),raw=state.raw,course=state.courseStatus||tx('原站未提供明確狀態')
          const attendanceLink=target?.cell?.querySelector('a[href*="attendance_status"]')
          const attendance=state.attendance||(attendanceLink?tx('原站提供設定入口，結果待確認'):tx('原站未提供明確出席結果'))
          const report=state.report||(target?.link?tx('可開啟課堂紀錄'):tx('原站未提供課堂紀錄入口'))
          const scheduled=state.scheduledLesson||tx('原站未提供')
          const enabled=state.enabledLesson||tx('原站未提供')
          const otherSession=state.otherSession
          return {raw,course,attendance,report,scheduled,enabled,otherSession,rank:otherSession?'other':target?.link?'current':'unknown'}
        }
        const makeWeekSummary=week=>{
          let summary=statusSummaries.get(week.index)
          if(summary)return summary
          summary=scope.add(element('div'));summary.className='edulog-session-status';summary.dataset.edulogWeekSummary=String(week.index);mark(summary,'data-edulog-owned','')
          const comparison=element('p');comparison.className='edulog-session-comparison';const details=element('details');details.className='edulog-session-extra';details.append(element('summary',tx('課程狀態與詳細資訊')));const body=element('div');details.append(body);summary.append(comparison,details)
          statusSummaries.set(week.index,{summary,comparison,details,body})
          return statusSummaries.get(week.index)
        }
        const updateStatus=()=>{
          const states=weekHeaders.map(week=>({week,target:session(week),status:null})).map(item=>({...item,status:statusFor(item.target)}))
          for(const {week,target,status} of states){
            if(!target?.cell)continue
            const nodes=makeWeekSummary(week),{summary,comparison,details,body}=nodes
            mark(target.cell,'data-edulog-week-status','')
            mark(target.cell,'data-edulog-week-selected',week.index===Number(view.week)?'':null)
            comparison.replaceChildren()
            const field=(label,value)=>{const item=element('span');item.append(element('strong',tx(label)),doc.createTextNode(' '),element('span',value));return item}
            const lesson=field('本堂排定進度',status.scheduled),enabled=field('已啟用教材',status.enabled),attendance=field('出席狀態',status.attendance),report=field('課堂紀錄',status.report)
            comparison.append(lesson,enabled,attendance,report)
            body.replaceChildren()
            for(const [label,value] of [['課程狀態',status.course],['課堂日期',target.date||tx('來源未提供完整日期')]]){const item=element('p');item.append(element('strong',tx('{label}：',{label:tx(label)})),doc.createTextNode(value));body.append(item)}
            mark(summary,'data-edulog-session-rank',status.rank)
            target.cell.append(summary)
          }
          const active=selectedWeek(),activeTarget=session(active),activeState=active&&statusFor(activeTarget)
          if(activeState){mark(row,'data-edulog-session-rank',activeState.rank);mark(detailsRow,'data-edulog-session-rank',activeState.rank);button.dataset.edulogAdmission=enrollmentId(activeTarget?.admission)||''}
        }
        const placeActions=()=>{updateStatus();row.cells[0]?.append(actionCell)}
        placeActions()
        historyRowUpdaters.set(row,placeActions)
        let sequence=0,expanded=false
        const appendField=(parent,label,value)=>{if(value===undefined||value===null||value==='')return;const item=element('p');const strong=element('strong',tx('{label}：',{label:tx(label)}));item.append(strong,doc.createTextNode(String(value)));parent.append(item)}
        const render=result=>{
          live.replaceChildren()
          if(result.status==='none'){live.append(element('p',tx('未找到所選課次日期之前、且含實際教學內容的紀錄。')));return}
          if(result.status==='ambiguous')live.append(element('p',tx('同一天有多份教學紀錄，無法可靠排序；請逐份查看。')))
          const reportsToShow=result.status==='found'?[result.report]:result.reports||[]
          for(const report of reportsToShow){
            const article=element('section');article.className='edulog-last-teaching-result'
            const title=element('h4',`${report.date||tx('日期未提供')}${report.lesson?` · ${report.lesson}`:''}`);article.append(title)
            appendField(article,'完成狀況',report.completed===true?tx('已完成'):report.completed===false?tx('未完成'):tx('未提供'))
            appendField(article,'章節進度',report.progress)
            const noteLines=String(report.internalNotes||'').split(/\r?\n/)
            if(noteLines.length<=3)appendField(article,'內部紀錄',report.internalNotes)
            else{appendField(article,'內部紀錄',noteLines.slice(0,3).join('\n'));const fullNotes=element('details');fullNotes.append(element('summary',tx('展開完整內部紀錄')));const pre=element('pre');pre.textContent=report.internalNotes;fullNotes.append(pre);article.append(fullNotes)}
            const more=element('details');more.append(element('summary',tx('評語、評分與聯絡欄')))
            const body=element('div');appendField(body,'學習表現',report.content);appendField(body,'課程參與評分',report.participation);appendField(body,'課堂秩序評分',report.behavior);appendField(body,'聯絡欄',report.contactNotes)
            if(body.children.length){more.append(body);article.append(more)}
            if(report.externalLink){try{const url=new URL(report.externalLink,doc.location.href);if(url.origin===doc.location.origin){const link=element('a',tx('查看原站紀錄'));link.href=url.href;link.target='_blank';link.rel='noopener';article.append(link)}}catch{}}
            live.append(article)
          }
          const time=element('p');time.className='edulog-last-teaching-read-at';time.append(element('strong',tx('讀取時間：')),doc.createTextNode(new Date(result.readAt||Date.now()).toLocaleString(doc.documentElement.lang||'zh-TW')));live.append(time)
        }
        const load=async(force=false,{isActive=()=>true}={})=>{
          const target=session(),id=++sequence
          reload.hidden=false;reload.disabled=true;live.replaceChildren(element('p',tx('正在讀取此學生的相關報名與教學紀錄…')))
          if(!target?.admission||!target.link){live.replaceChildren(element('p',tx('無法從本堂原站連結可靠識別報名與報告，請使用原站紀錄或從學生名單開啟報名。')));reload.disabled=false;return false}
          try{
            const integration=globalThis.edulogSourceIntegration
            if(typeof integration?.readPreviousTeaching!=='function')throw new Error(tx('目前擴充功能版本不支援按需讀取，請重新載入擴充功能後重試。'))
            let date=target.date
            if(!date){if(typeof integration.resolveSessionDate!=='function')throw new Error(tx('來源沒有完整日期，且目前版本無法從報告編輯頁補讀日期。'));date=(await integration.resolveSessionDate(target.admission,target.link.href)).date}
            const idNumber=enrollmentId(target.admission);if(!idNumber)throw new Error(tx('報名識別資料無效，請從原站報名頁重新開啟。'))
            const key=`${idNumber}|${date}`,revision=historyRevisions.get(idNumber)||0
            if(!force&&historyCache.has(key)){if(id===sequence&&row.isConnected&&isActive()){render(historyCache.get(key));reload.disabled=false;return true}}
            let request=historyRequests.get(key)
            if(!request||force){request=Promise.resolve(integration.readPreviousTeaching(target.admission,date));historyRequests.set(key,request);void request.then(()=>{if(historyRequests.get(key)===request)historyRequests.delete(key)},()=>{if(historyRequests.get(key)===request)historyRequests.delete(key)})}
            const result=await request
            if(id!==sequence||!row.isConnected||doc.location.pathname!==pagePath||session()?.index!==target.index||!isActive())return false
            if((historyRevisions.get(idNumber)||0)!==revision)return false
            historyCache.set(key,result)
            render(result);return true
          }catch(error){if(id===sequence&&row.isConnected&&isActive()){const failure=element('p');failure.append(element('strong',tx('讀取失敗：')),doc.createTextNode(error?.message||tx('未知錯誤')),doc.createTextNode(' '),element('span',tx('請重新整理此學生的摘要。')));live.replaceChildren(failure)}return false}
          finally{if(id===sequence)reload.disabled=false}
        }
        historyRowLoaders.set(row,load)
        listen(button,'click',()=>{expanded=!expanded;if(!expanded)sequence++;button.setAttribute('aria-expanded',String(expanded));disclosure.hidden=!expanded;detailsRow.hidden=!expanded;live.hidden=false;if(expanded)void load()})
        listen(reload,'click',()=>void load(true))
        const onWeekChange=()=>{sequence++;view.cancelClassHistory?.();placeActions();if(expanded){live.hidden=false;live.replaceChildren(element('p',tx('目前課次已變更；請按「重新整理上次教學」讀取對應摘要。')));reload.hidden=false;reload.disabled=false}}
        listen(doc,'edulog:week-change',onWeekChange)
        listen(doc,'turbo:submit-end',event=>{
          const form=event.target?.matches?.('form')?event.target:null
          if(!form||event.detail?.success!==true)return
          let submittedAdmission=null
          try{const url=new URL(form.action,doc.location.href),match=url.pathname.match(/^\/dt_admissions\/(\d+)\/reports(?:\/\d+(?:\/edit)?)?\/?$/);if(url.origin===doc.location.origin)submittedAdmission=match?.[1]||null}catch{}
          if(!submittedAdmission)return
          const currentId=enrollmentId(session()?.admission);if(submittedAdmission!==currentId)return
          sequence++
          historyRevisions.set(submittedAdmission,(historyRevisions.get(submittedAdmission)||0)+1)
          const prefix=`${submittedAdmission}|`;for(const key of historyCache.keys())if(key.startsWith(prefix))historyCache.delete(key)
          for(const key of historyRequests.keys())if(key.startsWith(prefix))historyRequests.delete(key)
          for(const [candidate,update] of historyRowUpdaters)if(candidate.isConnected&&candidate.querySelector('.edulog-last-teaching-toggle')?.dataset.edulogAdmission===submittedAdmission)update()
          if(!expanded)return
          live.replaceChildren(element('p',tx('原站已確認保存。上次教學摘要已更新為待重新讀取。')));reload.hidden=false;reload.disabled=false
        })
      }
      for(const row of reports.rows)if(row.querySelector('td')&&!row.hasAttribute('data-edulog-last-teaching-row'))makeHistoryPanel(row)
      let batchRun=0
      view.updateClassHistoryAvailability=()=>{
        const week=selectedWeek(),eligible=[...historyRowLoaders.keys()].filter(row=>{const cell=week&&row.cells[week.index];if(!cell||words.otherSession.test(text(cell)))return false;return Boolean(reportLinkFor(row,week)&&admissionFor(row,week))})
        view.classHistoryEligibleCount=eligible.length
        if(view.classHistoryAvailabilityValue)view.classHistoryAvailabilityValue.data=` ${eligible.length} `
        if(view.classHistoryAvailabilityWeek)view.classHistoryAvailabilityWeek.textContent=week?.label?model.weekTitle(week.label):tx('原站未標示課次')
      }
      view.loadClassHistory=async({onProgress=()=>{},isActive=()=>true}={})=>{
        const run=++batchRun,week=selectedWeek(),targets=[...historyRowLoaders.entries()].filter(([row])=>{const cell=week&&row.cells[week.index];return Boolean(cell&&!words.otherSession.test(text(cell))&&reportLinkFor(row,week)&&admissionFor(row,week))})
        let next=0,done=0,failed=0
        const active=()=>run===batchRun&&isActive()&&selectedWeek()?.index===week?.index
        const worker=async()=>{while(active()){const index=next++;if(index>=targets.length)return;const [,load]=targets[index];const ok=await load(false,{isActive:active});if(run!==batchRun)return;if(ok)done++;else failed++;onProgress({done,failed,total:targets.length})}}
        await Promise.all(Array.from({length:Math.min(3,targets.length)},worker))
        return {done,failed,total:targets.length,cancelled:run!==batchRun}
      }
      view.cancelClassHistory=()=>{batchRun++}
      refreshers.push(()=>{for(const row of reports.rows)if(row.querySelector('td')&&!row.hasAttribute('data-edulog-last-teaching-row'))makeHistoryPanel(row);for(const [row,update] of historyRowUpdaters)if(row.isConnected)update();view.updateClassHistoryAvailability()})
    }
    if (page.kind === 'history') {
      const admission = content.querySelector('#admission-data,.admission-data')
      const list = admission?.querySelector('ul')
      if (list) {
        const summary = region(scope, '學生與課程', 'edulog-history-summary')
        const items = [...list.children].filter(n => n.tagName === 'LI')
        const core = items.filter(n => site.leadTerm(text(n), '學生', '梯次/節次', '課程名稱', '總堂數', '可補課次數') !== null)
        const info = element('ul'); info.className = 'edulog-history-core'; summary.append(info)
        admission.before(summary)
        const extra = element('details'); extra.className = 'edulog-history-stats'; extra.append(element('summary', tx('堂數與補課資訊')))
        const statsList = element('ul'); extra.append(statsList)
        for (const item of core) move(item, site.leadTerm(text(item), '總堂數', '可補課次數') !== null ? statsList : info)
        if (statsList.children.length) summary.append(extra)
        const stats = [...content.querySelectorAll('p,div')].find(n => !n.children.length && /(?:目前進度|目前进度|Progress).*(?:實際出席|实际出席|Attended)/.test(text(n)))
        if (stats) summary.append(element('p', text(stats)))
        const details = scope.add(element('details')); details.className = 'edulog-admission-details'
        details.append(element('summary', tx('報名與行政資訊'))); admission.before(details); move(admission, details)
        details.open = view.admissionDetails === true; listen(details, 'toggle', () => { view.admissionDetails = details.open })
      }
      const table = [...content.querySelectorAll('table')].find(t => site.pattern('學習評估').test(text(t.rows[0])))
      if (table) {
        const headers = [...table.rows[0].cells].map(text), dateIndex = headers.findIndex(h => site.isTerm(h, '日期'))
        const { tools, rows, refresh } = filterTable(context, table, 'historyQuery', '歷史課堂紀錄', dateIndex < 0 ? null : dateIndex)
        refreshers.push(refresh)
        const newest = element('button', tx('前往最新紀錄')); newest.type = 'button'; tools.append(newest)
        listen(newest, 'click', () => {
          const dated = rows.filter(r => !r.hasAttribute('data-edulog-filtered') && !r.hidden && /\d{4}-\d{2}-\d{2}/.test(text(r.cells[dateIndex])))
          const completed = dated.filter(r => site.pattern('評語', '最新課程階段').test(text(r)))
          const target = (completed.length ? completed : dated).sort((a, b) => text(b.cells[dateIndex]).localeCompare(text(a.cells[dateIndex])))[0]
          if (target) { mark(target, 'tabindex', '-1'); target.focus({ preventScroll: true }); target.scrollIntoView?.({ block: 'center', behavior: 'auto' }) }
        })
        for (const row of rows) {
          const assessment = row.cells[headers.findIndex(h => site.pattern('學習評估').test(h))]
          if (assessment?.textContent.trim()) {
            const details = element('details'); details.className = 'edulog-assessment'
            details.append(element('summary', tx('評語、聯絡與內部紀錄')))
            const original = [...assessment.childNodes]; assessment.append(details); scope.add(details)
            for (const node of original) move(node, details)
          }
        }
      }
    }
    if (page.kind === 'unfilled' || page.kind === 'unfilled-current') {
      const monthly = page.kind === 'unfilled'
      const heading = content.querySelector('h3')
      const title = region(scope, '', 'edulog-page-context')
      title.append(element('strong', monthly ? tx('目前檢視：{month}', { month: text(heading) || tx('原站選定月份') }) : tx('補填學生課堂紀錄')), element('p', monthly ? tx('依班級時段分組；清單範圍以原站目前帳號及月份為準。') : tx('依班級時段分組，請儘速填寫的置頂；節次差異依原站內容呈現，不推定為錯誤。')))
      content.prepend(title)
      if (monthly && heading) mark(heading, 'data-edulog-duplicate-heading', '')
      const table = content.querySelector('table')
      if (table) {
        mark(table, 'data-edulog-unfilled-current', '')
        for (const row of table.rows) {
          if (row.querySelector('th')) continue
          mark(row, 'data-edulog-unfilled-card', '')
          for (const link of row.cells[row.cells.length - 1]?.querySelectorAll('a[href],button') || []) mark(link, 'data-edulog-unfilled-action', '')
        }
        const filter = filterTable(context, table, 'unfilledQuery', monthly ? '未填寫課堂紀錄' : '搜尋補填清單')
        const renderList = unfilledList(context, table, { monthly })
        const search = filter.tools.querySelector('input[type=search]')
        if (search) listen(search, 'input', renderList)
        refreshers.push(() => { filter.refresh(); renderList() })
      }
      if (monthly) for (const a of content.querySelectorAll('a[href]')) if (/month_unfilled_report/.test(a.pathname)) {
        const current = (new URL(a.href).searchParams.get('month') || '') === (new URL(doc.location.href).searchParams.get('month') || '')
        if (current) mark(a, 'aria-current', 'page')
      }
    }
    if (page.kind === 'classes') {
      const switcher = region(scope, '班級檢視', 'edulog-table-tools')
      const listButton = element('button', tx('班級清單')), matrixButton = element('button', tx('原站時段矩陣'))
      listButton.type = matrixButton.type = 'button'; switcher.append(listButton, matrixButton); content.prepend(switcher)
      const pairs = []
      for (const table of content.querySelectorAll('table.dt-stages')) {
        const cards = region(scope, '', 'edulog-class-list')
        const cells = grid(table)
        for (let r = 2; r < cells.length; r++) for (let c = 2; c < cells[r].length; c++) {
          const cell = cells[r][c]
          if (!cell || cells[r].indexOf(cell) !== c || (r > 2 && cells[r - 1]?.[c] === cell)) continue
          for (const original of [...cell.querySelectorAll('a[href]')].filter(classLink)) {
            const card = element('article'), link = element('a', text(cells[r][1]) || text(cells[r][0]) || tx('原站班級'))
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
        if (!cards.children.length) cards.append(element('p', tx('目前這個區域與時段沒有已載入的班級。')))
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
      context.append(element('strong', tx('課表基準日期：{date}', { date: value || today })), element('p', tx('「我的班級」是固定班級入口；下方課表依原站選定日期顯示。')))
      const todayLink = element('a', tx('回到今天')); todayLink.href = `/?today=${today}`; context.append(todayLink); content.prepend(context)
      const opener = [...content.querySelectorAll('a[href]')].find(a => /課程表.*點擊檢視/.test(text(a)))
      if (opener) {
        mark(opener, 'aria-label', tx('載入選定日期課表'))
        const state = scope.add(element('p', tx('課表尚未展開，請按「課程表」載入。'))); state.className = 'edulog-empty'; state.setAttribute('role', 'status'); opener.parentElement.after(state)
        listen(opener, 'click', () => { state.textContent = tx('正在載入課表；若未載入，請重新按原站課表入口。') })
      }
    }
    if (page.kind === 'calendar') {
      const summary = region(scope, '課程行事曆', 'edulog-page-context')
      const update = () => {
      const selected = content.querySelector('.region-title.active')
      const selectedPanel = selected && content.querySelector(selected.getAttribute('href'))
      const day = selectedPanel?.querySelector('[id*="weekday-"][id$="-tab"].active')
      description.textContent = tx('目前區域：{area} · 日期：{day}', { area: text(selected) || tx('尚未選擇'), day: text(day) || tx('請選擇日期') })
      const panels = [...(selectedPanel?.querySelectorAll('[id^=region-][id*=weekday-]:not([id$=-tab])') || [])]
      const active = day && selectedPanel?.querySelector(day.getAttribute('href'))
      const links = active ? [...active.querySelectorAll('a[href]')].filter(classLink) : []
      status.textContent = !selected ? tx('請選擇區域以載入課程。') : !panels.length ? tx('正在載入區域課表；若未載入，請重新選擇原站區域。') : !active ? tx('請選擇日期。') : links.length ? tx('目前日期已載入 {count} 個班級入口。', { count: links.length }) : tx('目前已載入的日期沒有課程。')
      for (const alert of content.querySelectorAll('.alert')) if (site.isTerm(text(alert), '請選擇區域')) mark(alert, 'data-edulog-stale-alert', selected ? '' : null)
      }
      const description = element('p'), status = element('p'); status.setAttribute('role', 'status'); summary.append(description, status); content.prepend(summary)
      update(); refreshers.push(update)
      const input = content.querySelector(site.termForms('選擇欲前往的日期').map(hint => `input[placeholder="${hint}"]:not([type=hidden])`).join(','))
      if (input) {
        mark(input, 'aria-label', tx('前往課程日期'))
        const form = input.closest('form')
        if (form) {
          mark(form, 'data-edulog-calendar-controls', '')
          const previous = [...content.querySelectorAll('a[href]')].find(a => site.isTerm(text(a), '前一週'))
          const next = [...content.querySelectorAll('a[href]')].find(a => site.isTerm(text(a), '下一週'))
          if (previous && next) {
            const original = form.parentElement.closest('.row')
            const navigation = region(scope, '', 'edulog-calendar-nav')
            ;(original || form).before(navigation)
            move(previous, navigation); move(form, navigation); move(next, navigation)
            if (original && !text(original)) mark(original, 'data-edulog-duplicate-heading', '')
          }
        }
      }
      for (const a of content.querySelectorAll('.region-title,[id*="weekday-"][id$="-tab"]')) listen(a, 'click', () => { status.textContent = tx('正在切換原站課表…') })
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
      const target = scope.add(element('p', tx('課次：{label}', { label: view.reportTarget.label }))); target.className = 'edulog-dialog-context'
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
      mark(input, 'aria-label', tx(label))
      const original = [...input.parentElement.querySelectorAll('label')].find(n => !n.htmlFor && site.isTerm(text(n), label))
      if (original) mark(original, 'for', id)
    }
    for (const row of [...form.children]) {
      if (row.querySelector('input,select,textarea') || !site.pattern('完成狀況', '章節進度').test(text(row))) continue
      for (const caption of [...row.children]) {
        const id = site.pattern('完成狀況').test(text(caption)) ? 'dt_admission_lesson_report_completion_status' : site.pattern('章節進度').test(text(caption)) ? 'dt_admission_lesson_report_start_from' : null
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
      if (child.tagName === 'H4' && site.pattern('專案進度').test(text(child))) { mark(child, 'data-edulog-duplicate-heading', ''); continue }
      const ids = [child.id, ...[...child.querySelectorAll('[id]')].map(n => n.id)].join(' ')
      const fields = child.matches('input,select,textarea') ? [child] : [...child.querySelectorAll('input,select,textarea')]
      const name = /attendance_status|lesson_report_reason/.test(ids) ? '出席狀況'
        : /learning_stage|completion_status|start_from|end_to/.test(ids) ? '課程與專案進度'
        : fields.some(n => n.type === 'radio') ? '課堂評量'
        : /feedback|contact/.test(ids) ? '學習表現與聯絡欄'
        : /comment|learning_status|typing_error/.test(ids) ? '內部紀錄'
        : fields.some(n => n.type === 'submit' || n.type === 'checkbox') ? '確認與送出' : null
      // The source keeps completion/section captions in a separate row.
      const captions = !fields.length && site.pattern('完成狀況', '章節進度').test(text(child))
      if (name || captions) move(child, group(name || '課程與專案進度'))
    }
    const footer = sections.get('確認與送出'); if (footer) mark(footer, 'data-edulog-submit-region', '')
    for (const name of ['出席狀況','課程與專案進度','課堂評量','學習表現與聯絡欄','內部紀錄','確認與送出']) if (sections.has(name)) form.append(sections.get(name))
    for (const [name, label] of [['participation_rating', '課程參與'], ['order_rating', '課堂秩序']]) {
      const radios = [...form.querySelectorAll(`input[type=radio][name$="[${name}]"]`)]
      if (!radios.length) continue
      const wrapper = scope.add(element('label', tx('{label}評分', { label: tx(label) }))); wrapper.className = 'edulog-rating-control'
      const select = element('select'); select.setAttribute('aria-label', tx('{label}評分', { label: tx(label) }))
      const empty = element('option', tx('尚未評分')); empty.value = ''; select.append(empty)
      const halfStars = radios.length === 10 && radios.every(n => /^[1-9]$|^10$/.test(n.value))
      for (const radio of [...radios].sort((a,b) => Number(a.value)-Number(b.value))) {
        const option = element('option', halfStars ? tx('{stars} / 5 星', { stars: Number(radio.value)/2 }) : tx('原站評分 {value}', { value: radio.value }))
        option.value = radio.value; select.append(option)
        mark(radio, 'aria-label', `${tx(label)} ${option.textContent}`)
      }
      const sync = () => { select.value = radios.find(n => n.checked)?.value || '' }
      sync(); wrapper.append(select)
      const rating = radios[0].closest('.rating') || radios[0].parentElement
      mark(rating, 'data-edulog-rating-stars', '')
      for (const half of rating.querySelectorAll('label.half,.half')) mark(half, 'data-edulog-rating-half', '')
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
    // Status row, absent-only mode, phrase library, staff-only block and pre-submit checklist.
    globalThis.edulogSiteReportEditor?.enhance({ doc, modal, form, scope, sections })
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
      scope.mark(field,'aria-label',modal.id === 'teachers-comment-modal' ? tx('學生總評') : tx('教學備註'))
      const close = modal.querySelector('button[data-bs-dismiss=modal],button[aria-label=Close]')
      if (close) { scope.mark(close,'data-edulog-close',''); scope.mark(close,'aria-label',tx('關閉視窗')) }
      const note = scope.add(scope.element('p',modal.id === 'teachers-comment-modal' ? tx('學生總評與每次課堂記錄分開儲存，請使用原站送出按鈕。') : tx('教學備註使用原站儲存機制；關閉視窗不代表已儲存。')))
      note.className = 'edulog-dialog-context'; field.before(note)
      entries.push({ root:modal, form:field.closest('form') || field, restore:scope.restore })
    }
    // Student learning-account modal: platform list, masked credentials, native forms.
    const accounts = globalThis.edulogSiteAccounts && doc.querySelector(globalThis.edulogSiteLexicon.accounts.modal)
    if (accounts) { const scope = createScope(doc); const enhancement = globalThis.edulogSiteAccounts.enhance(doc, accounts, scope); if (enhancement) entries.push(enhancement) }
    return { roots:entries.map(e=>e.root), isCurrent:()=>entries.every(e=>e.root.isConnected && (e.root.querySelector('form') || e.root.querySelector('textarea')) === e.form) && doc.querySelectorAll('#lesson-report-modal form,#edit-teacher-comment-modal textarea,#teachers-comment-modal textarea').length + (globalThis.edulogSiteAccounts ? doc.querySelectorAll('#accounts-modal .modal-body').length : 0) === entries.length, restore(){ for (const e of entries) e.restore() } }
  }
  globalThis.edulogSiteWorkflows = Object.freeze({ enhancePage, enhanceDialog, enhanceDialogs })
})()
