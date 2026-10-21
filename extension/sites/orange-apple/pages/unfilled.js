// 未填寫 / 補填 lists: grouped cards with phone reveal.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
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
  // 「剩餘課堂」 as grouped rows (未續班 first, fewest lessons left first), in the unfilled list's
  // layout. Contact details appear only on request; renewal changes go through edulogSiteRenewals.
  kit.page(['unfilled', 'unfilled-current'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
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
  })
})()
