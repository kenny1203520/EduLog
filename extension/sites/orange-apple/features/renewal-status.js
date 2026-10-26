// 「剩餘課堂」(/dt_admissions): the renewal list. Reads the provider's table and changes one
// enrollment's renewal status. The provider's own menu never works (its handler binds
// `.js-change-admission-renew-status a`, but that class sits on the <a> itself), so this sends the
// request that handler meant to send: PUT /dt_admissions/:id.json with { dt_admission: { renew_status } }.
// It is the only write EduLog makes to the provider, and only after the teacher confirms.
(() => {
  const lexicon = globalThis.edulogSiteLexicon
  if (!lexicon) return
  const site = lexicon.locale
  const ORIGIN = 'https://corp.orangeapple.co'
  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  const STATUSES = Object.freeze(['pending', 'renewed', 'not-renew'])
  // What the provider's handler writes back into its badge on success.
  const BADGE = Object.freeze({ renewed: ['text-bg-success', '已續班'], pending: ['text-bg-warning', '未續班'], 'not-renew': ['text-bg-default', '不續班'] })
  const PHONE = /(?:\+?886[-\s]?|0)9\d{2}[-\s]?\d{3}[-\s]?\d{3}|0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  // A cell's text split at <br>, as the provider stacks values in one cell.
  function lines(cell) {
    const out = ['']
    for (const node of cell?.childNodes || []) {
      if (node.nodeName === 'BR') out.push('')
      else out[out.length - 1] += node.textContent
    }
    return out.map(collapse).filter(Boolean)
  }
  const toneOf = badge => !badge ? null : badge.classList.contains('text-bg-success') ? 'ok' : badge.classList.contains('text-bg-warning') ? 'warn' : badge.classList.contains('text-bg-danger') ? 'danger' : 'neutral'
  const renewOf = badge => !badge ? null : badge.classList.contains('text-bg-success') ? 'renewed' : badge.classList.contains('text-bg-warning') ? 'pending' : 'not-renew'
  function badgeFact(cell) {
    const badge = cell?.querySelector('.badge')
    if (!badge) return null
    return { label: collapse(badge.textContent), tone: toneOf(badge), date: lines(cell).filter(line => line !== collapse(badge.textContent)).join(' ') }
  }
  function read(table) {
    if (!table) return []
    const header = [...table.rows].find(row => row.querySelector('th'))
    const labels = [...(header?.cells || [])].map(cell => collapse(cell.textContent))
    const column = (test, fallback) => { const index = labels.findIndex(label => test(label)); return index < 0 ? fallback : index }
    const at = {
      name: column(label => site.isTerm(label, '姓名'), 0), contact: column(label => site.pattern('聯絡人').test(label), 1),
      course: column(label => site.isTerm(label, '課程'), 2), order: column(label => site.pattern('訂單狀態').test(label), 3),
      remaining: column(label => site.pattern('剩餘次數').test(label), 4), renew: column(label => site.pattern('續班與否').test(label), 5),
      next: column(label => site.pattern('下階段').test(label), 6), owner: column(label => site.pattern('建立人').test(label), 7),
    }
    return [...table.rows].filter(row => row !== header && !row.querySelector('th') && row.cells.length > at.renew).map(row => {
      const cell = key => row.cells[at[key]]
      const contact = lines(cell('contact'))
      const phone = contact.find(line => PHONE.test(line)) || null, email = contact.find(line => /@/.test(line)) || null
      const courseCell = cell('course'), classAnchor = courseCell?.querySelector('a[href]')
      let classPath = null
      try { const url = new URL(classAnchor?.getAttribute('href') || '', ORIGIN); if (url.origin === ORIGIN && lexicon.paths.classPage.test(url.pathname)) classPath = url.pathname } catch { /* no class link */ }
      const remaining = /(-?\d+)\s*\/\s*(-?\d+)/.exec(collapse(cell('remaining')?.textContent))
      const actions = [...row.querySelectorAll(lexicon.selectors.renewAction)]
      const id = actions.map(a => a.getAttribute('data-id')).find(value => /^\d+$/.test(value || '')) || null
      return {
        row, id, name: collapse(cell('name')?.textContent),
        contact: { parent: contact.find(line => line !== phone && line !== email) || null, phone, email },
        className: collapse(classAnchor?.textContent) || null, classPath,
        course: lines(courseCell).filter(line => line !== collapse(classAnchor?.textContent)).join(' ') || null,
        order: badgeFact(cell('order')), next: badgeFact(cell('next')),
        remaining: remaining ? Number(remaining[1]) : null, makeup: remaining ? Number(remaining[2]) : null,
        renew: renewOf(cell('renew')?.querySelector(lexicon.selectors.renewStatus)),
        owner: collapse(cell('owner')?.textContent) || null,
        codes: new Set(actions.map(a => a.getAttribute('data-renew-status')).filter(code => STATUSES.includes(code))),
      }
    })
  }
  // Sends one renewal change, then updates the provider's own badge the way its handler would.
  async function change({ doc, item, status, fetch: send = globalThis.fetch }) {
    if (!STATUSES.includes(status) || !/^\d+$/.test(item?.id || '') || !item.codes?.has(status)) throw new Error(tx('這個續班狀態無法變更。'))
    if (doc.location.origin !== ORIGIN) throw new Error(tx('這個續班狀態無法變更。'))
    const token = doc.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
    if (!token) throw new Error(tx('原站登入狀態已失效，請重新整理頁面。'))
    const response = await send(`${ORIGIN}/dt_admissions/${item.id}.json`, {
      method: 'PUT', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ dt_admission: { renew_status: status } }),
    })
    if (!response?.ok) throw new Error(tx('原站沒有接受這次變更（{status}）。', { status: response?.status ?? '—' }))
    const badge = item.row.querySelector(lexicon.selectors.renewStatus)
    if (badge) { badge.classList.remove('text-bg-success', 'text-bg-warning', 'text-bg-default'); badge.classList.add(BADGE[status][0]); badge.textContent = BADGE[status][1] }
    item.renew = status
    return status
  }
  globalThis.edulogSiteRenewals = Object.freeze({ STATUSES, read, change })
})()
