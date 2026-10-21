// Shared helpers for page enhancements (regions, facts, tables, filters, icons). Page files under
// pages/ register one handler per page kind; pages/index.js runs the one matching the page.
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
  const handlers = new Map()
  // A page file registers its handler for one or more page kinds (lexicon route kinds).
  const page = (kinds, handler) => { for (const kind of kinds) handlers.set(kind, handler) }
  // Steps that run on every page (pages/index.js calls them in order).
  const shared = new Map()
  const every = (name, handler) => shared.set(name, handler)
  globalThis.edulogSitePageKit = Object.freeze({ model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide, page, handlers, every, shared })
})()
