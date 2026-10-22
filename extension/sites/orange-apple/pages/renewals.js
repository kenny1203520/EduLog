// 剩餘課堂: renewal groups, contact on request and the renewal change.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  const RENEW_GROUPS = [['pending', '未續班', 'warn'], ['renewed', '已續班', 'ok'], ['not-renew', '不續班', 'neutral'], [null, '未標示續班狀態', 'neutral']]
  const RENEW_WORDS = { pending: '未續班', renewed: '已續班', 'not-renew': '不續班' }
  function renewalList({ doc, scope, view }, table) {
    const { element, listen, mark } = scope
    const api = globalThis.edulogSiteRenewals
    const items = api.read(table)
    const anchor = table.closest('#dt-admissions') || table
    const section = scope.add(element('section')); section.className = 'edulog-unfilled-list edulog-renewal-list'
    section.setAttribute('aria-label', tx('剩餘課堂'))
    anchor.before(section)
    if (items.length) mark(anchor, 'data-edulog-cards', 'on')
    const summary = element('p'); summary.className = 'edulog-unfilled-summary'
    const notice = element('p'); notice.className = 'edulog-renewal-notice'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); notice.hidden = true
    const body = element('div')
    section.append(summary, notice, body)
    const shownContacts = view.renewalContacts || (view.renewalContacts = new Set())
    const closed = view.renewalClosed || (view.renewalClosed = new Set(['not-renew']))
    const busy = new Set()
    const badge = (tone, label) => { const node = element('span'); node.className = 'edulog-badge'; node.dataset.tone = tone; node.append(element('span', label)); return node }
    const tell = (message, tone) => { notice.textContent = message; notice.dataset.tone = tone; notice.hidden = false }
    async function setStatus(item, status) {
      const word = tx(RENEW_WORDS[status])
      if (!doc.defaultView.confirm(tx('將 {name} 設為「{status}」？', { name: item.name, status: word }))) return
      busy.add(item); render()
      try {
        await api.change({ doc, item, status })
        tell(tx('已將 {name} 設為「{status}」。', { name: item.name, status: word }), 'ok')
      } catch (error) {
        tell(tx('無法變更 {name} 的續班狀態：{message}', { name: item.name, message: error?.message || tx('未知錯誤') }), 'danger')
      } finally { busy.delete(item); render() }
    }
    function rowFor(item) {
      const li = element('li'); li.className = 'edulog-unfilled-row edulog-renewal-row'
      li.dataset.bar = item.remaining === null ? 'neutral' : item.remaining <= 0 ? 'danger' : item.remaining <= 2 ? 'warn' : 'ok'
      const main = element('div'); main.className = 'edulog-unfilled-main'
      main.append(element('strong', item.name || tx('未命名學生')))
      const where = element('span')
      if (item.course) where.append(doc.createTextNode(item.course))
      if (item.classPath) {
        if (item.course) where.append(doc.createTextNode(' · '))
        const link = element('a'); link.href = item.classPath; link.textContent = item.className || tx('班級'); where.append(link)
      }
      main.append(where)
      if (item.owner) { const owner = element('span', tx('業務 {name}', { name: item.owner })); owner.className = 'edulog-renewal-owner'; main.append(owner) }
      const facts = element('div'); facts.className = 'edulog-unfilled-facts'
      if (item.remaining !== null) facts.append(badge(li.dataset.bar, tx('剩餘 {remaining} 堂 · 可補 {makeup}', { remaining: item.remaining, makeup: item.makeup })))
      if (item.order) facts.append(badge(item.order.tone, tx('本期 {status} {date}', { status: item.order.label, date: item.order.date }).trim()))
      if (item.next) facts.append(badge(item.next.tone, tx('下階段 {status} {date}', { status: item.next.label, date: item.next.date }).trim()))
      const { parent, phone, email } = item.contact
      if (phone || email || parent) {
        const key = `${item.id || item.name}`
        if (shownContacts.has(key)) {
          const contact = element('span'); contact.className = 'edulog-renewal-contact'
          if (parent) contact.append(element('span', parent))
          if (phone) { const call = element('a'); call.className = 'edulog-phone'; call.href = `tel:${phone.replace(/[^\d+]/g, '')}`; call.append(lucide(doc, 'phone'), element('span', phone)); contact.append(call) }
          if (email) { const mail = element('a', email); mail.className = 'edulog-renewal-email'; mail.href = `mailto:${email}`; contact.append(mail) }
          facts.append(contact)
        } else {
          const reveal = element('button'); reveal.type = 'button'; reveal.className = 'edulog-phone'; reveal.append(lucide(doc, 'phone'), element('span', tx('顯示聯絡方式')))
          reveal.setAttribute('aria-label', tx('顯示 {name} 的聯絡方式', { name: item.name }))
          listen(reveal, 'click', () => { shownContacts.add(key); render(); [...section.querySelectorAll('.edulog-renewal-row')].find(row => row.dataset.renewalKey === key)?.querySelector('.edulog-renewal-contact a')?.focus() })
          facts.append(reveal)
        }
      }
      li.dataset.renewalKey = `${item.id || item.name}`
      const actions = element('div'); actions.className = 'edulog-unfilled-actions edulog-renewal-actions'
      actions.setAttribute('role', 'group'); actions.setAttribute('aria-label', tx('{name} 的續班狀態', { name: item.name }))
      for (const status of api.STATUSES.filter(code => item.codes.has(code))) {
        const button = element('button', tx(RENEW_WORDS[status])); button.type = 'button'; button.dataset.renew = status
        button.setAttribute('aria-pressed', String(item.renew === status))
        button.disabled = busy.has(item) || !item.id
        if (item.renew !== status) listen(button, 'click', () => void setStatus(item, status))
        actions.append(button)
      }
      if (busy.has(item)) actions.append(element('span', tx('送出中…')))
      li.append(main, facts, actions)
      return li
    }
    function render() {
      const byGroup = RENEW_GROUPS.map(([code, label, tone]) => [code, label, tone, items.filter(item => item.renew === code).sort((a, b) => (a.remaining ?? Infinity) - (b.remaining ?? Infinity))]).filter(group => group[3].length)
      const low = items.filter(item => item.remaining !== null && item.remaining <= 2 && item.renew !== 'not-renew').length
      summary.textContent = tx('未續班 {pending} · 已續班 {renewed} · 不續班 {stopped}', { pending: items.filter(i => i.renew === 'pending').length, renewed: items.filter(i => i.renew === 'renewed').length, stopped: items.filter(i => i.renew === 'not-renew').length }) + (low ? tx(' · 剩餘 2 堂以下 {count} 位', { count: low }) : '')
      summary.hidden = !items.length
      if (!items.length) {
        const empty = element('div'); empty.className = 'edulog-unfilled-empty'
        empty.append(lucide(doc, 'inbox'), element('strong', tx('目前清單沒有紀錄')), element('span', tx('可調整上方的剩餘堂數、城市或續班狀態篩選。')))
        body.replaceChildren(empty)
        return
      }
      body.replaceChildren(...byGroup.map(([code, label, tone, list]) => {
        const key = code || 'unknown'
        const group = element('div'); group.className = 'edulog-unfilled-group'; group.dataset.tone = tone
        const open = !closed.has(key)
        const head = element('button'); head.type = 'button'; head.className = 'edulog-unfilled-head'; head.setAttribute('aria-expanded', String(open))
        const dot = element('span'); dot.className = 'edulog-status-dot'; dot.setAttribute('aria-hidden', 'true')
        head.append(lucide(doc, 'chevron-down'), dot, element('span', tx(label)))
        const count = element('span', tx('{count} 位', { count: list.length })); count.className = 'edulog-unfilled-count'; head.append(count)
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
  // Devise sign-in and password pages as one centred card. The native form, its fields and its
  // POST stay as they are; EduLog never reads what is typed and sends nothing.
  kit.page(['renewals'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    const filter = content.querySelector(globalThis.edulogSiteLexicon.selectors.renewFilter)
    if (filter) mark(filter, 'data-edulog-renew-filter', '')
    const table = content.querySelector(globalThis.edulogSiteLexicon.selectors.renewTable)
    if (table && globalThis.edulogSiteRenewals) refreshers.push(renewalList(context, table))
  })
})()
