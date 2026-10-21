// Teacher navigation: one left navigation bar built from the provider's sidebar. The native
// sidebar stays in the DOM (hidden); links navigate normally and actions with provider
// handlers (logout, language) click the provider's own elements.
(() => {
  const lexicon = globalThis.edulogSiteLexicon
  if (!lexicon) return
  const config = lexicon.navigation
  const collapse = value => String(value || '').trim().replace(/\s+/g, ' ')
  const ORIGIN = 'https://corp.orangeapple.co'
  const pathOf = href => { try { return new URL(href, ORIGIN).pathname.replace(/\/$/, '') || '/' } catch { return null } }
  // Pending counts other views already computed (lesson report cards); never fetched for this.
  const pending = globalThis.edulogClassPending || (globalThis.edulogClassPending = new Map())

  const GROUP_BY_WEEKDAY = 6
  // "樹林_非凡文理_201教室（菁英） - 週六 第 1 時段 (10:00 ~ 12:00)" → 週六 10:00–12:00 · 201教室（菁英）
  function parseClassName(name) {
    const text = collapse(name), schedule = globalThis.edulogSiteModel?.classSchedule(text)
    if (!schedule) return { primary: text, secondary: '', branch: '', weekday: 7, start: '99:99', full: text }
    return { primary: `${tx(schedule.weekdayLabel)} ${schedule.start.replace(/^0/, '')}–${schedule.end.replace(/^0/, '')}`, secondary: schedule.room, branch: schedule.branch, weekday: schedule.weekday, start: schedule.start, full: text }
  }
  // The branch is only shown when the teacher's classes are in more than one branch.
  function placeLabels(classes) {
    const branches = new Set(classes.map(item => item.branch).filter(Boolean))
    return branches.size > 1 ? classes.map(item => ({ ...item, secondary: [item.branch, item.secondary].filter(Boolean).join(' · ') })) : classes
  }
  // Monday first, Sunday last, then by start time.
  const weekOrder = weekday => weekday === 0 ? 7 : weekday
  // UI wording goes through the shared phrasebook (zh-TW / zh-CN / en); data stays in params.
  const tx = (text, params = {}) => globalThis.edulogUi?.tx(text, params) ?? String(text).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  const menuLabel = (path, native) => config.labels[path] ? tx(config.labels[path]) : collapse(native.textContent)
  function readClasses(sidebar, doc) {
    const here = pathOf(doc.location.pathname)
    const today = globalThis.edulogSiteModel?.siteParts().weekday ?? new Date().getDay()
    const seen = new Set()
    const items = [...sidebar.querySelectorAll(config.classLinks)].map(link => {
      const path = pathOf(link.getAttribute('href'))
      if (!path || seen.has(path)) return null
      seen.add(path)
      const info = parseClassName(link.textContent)
      return { ...info, path, link, today: info.weekday === today, current: here === path || here.startsWith(`${path}/`), pending: pending.get(path) }
    }).filter(Boolean).sort((a, b) => weekOrder(a.weekday) - weekOrder(b.weekday) || a.start.localeCompare(b.start))
    return placeLabels(items)
  }
  function currentClass(doc) {
    const sidebar = doc.querySelector(config.sidebar)
    return sidebar ? readClasses(sidebar, doc).find(item => item.current) || null : null
  }

  function mount({ doc, scope }) {
    const sidebar = doc.querySelector(config.sidebar)
    if (!sidebar || (!sidebar.querySelector(config.classLinks) && !sidebar.querySelector(config.menuLinks))) return null
    const { element, listen, mark } = scope
    const here = pathOf(doc.location.pathname)
    const classes = readClasses(sidebar, doc)
    const nav = scope.add(element('nav'))
    nav.className = 'edulog-nav'; nav.setAttribute('aria-label', tx('主要導覽')); nav.id = 'edulog-nav'
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    const section = label => { const box = element('section'); box.className = 'edulog-nav-section'; box.append(dataText('h2', label, 'edulog-nav-heading')); const list = element('ul'); box.append(list); nav.append(box); return list }
    const link = (href, label, current) => { const item = element('li'), anchor = element('a'); anchor.href = href; anchor.textContent = label; if (current) anchor.setAttribute('aria-current', 'page'); item.append(anchor); return { item, anchor } }
    const proxy = (label, target) => { const button = element('button', label); button.type = 'button'; listen(button, 'click', () => { if (target?.isConnected) target.click() }); return button }

    const close = element('button', tx('關閉導覽')); close.type = 'button'; close.className = 'edulog-nav-close'
    listen(close, 'click', () => setOpen(false))
    nav.append(close)

    const counts = new Map()
    const showCount = (marks, path) => {
      marks.querySelector('.edulog-nav-count')?.remove()
      const value = pending.get(path)
      if (value) { const count = dataText('span', String(value), 'edulog-nav-count'); count.setAttribute('aria-label', tx('{count} 位待處理', { count: value })); marks.append(count) }
      marks.hidden = !marks.childNodes.length
    }
    if (classes.length) {
      const list = section(tx('我的班級'))
      // Many classes: one group per weekday, today's group first.
      const grouped = classes.length > GROUP_BY_WEEKDAY
      const order = grouped ? [...classes].sort((a, b) => Number(b.today) - Number(a.today)) : classes
      let groupList = list, groupDay = null
      for (const item of order) {
        if (grouped && item.weekday !== groupDay) {
          groupDay = item.weekday
          const group = element('li'); group.className = 'edulog-nav-day'
          group.append(dataText('h3', item.weekday === 7 ? tx('其他') : `${tx(config.weekdays[item.weekday])}${item.today ? tx('（今天）') : ''}`, 'edulog-nav-day-heading'))
          groupList = element('ul'); group.append(groupList); list.append(group)
        }
        const entry = element('li'), anchor = element('a')
        anchor.href = item.path; anchor.title = item.full; anchor.className = 'edulog-nav-class'
        if (item.current) anchor.setAttribute('aria-current', 'page')
        const text = element('span'); text.className = 'edulog-nav-class-text'
        text.append(dataText('strong', item.primary)); if (item.secondary) text.append(dataText('span', item.secondary, 'edulog-nav-class-place'))
        anchor.append(text)
        const marks = element('span'); marks.className = 'edulog-nav-marks'
        if (item.today && !grouped) marks.append(dataText('span', tx('今天'), 'edulog-nav-today'))
        anchor.append(marks); showCount(marks, item.path); counts.set(item.path, marks)
        entry.append(anchor); groupList.append(entry)
      }
    }
    // Counts arrive later from views that already read the class pages (no fetch here).
    listen(doc, 'edulog:class-pending', () => { for (const [path, marks] of counts) showCount(marks, path) })
    const seenLinks = new Set(), workLinks = []
    for (const native of sidebar.querySelectorAll(config.menuLinks)) {
      const href = native.getAttribute('href') || ''
      if (href.startsWith('#') || native.closest('.collapse:not(.navbar-collapse)')) continue
      const path = pathOf(href)
      if (!path || seenLinks.has(path)) continue
      seenLinks.add(path); workLinks.push({ href, label: menuLabel(path, native), current: path === here })
    }
    if (workLinks.length) { const work = section(tx('工作')); for (const entry of workLinks) work.append(link(entry.href, entry.label, entry.current).item) }
    // Module groups (師資模組, 人資模組) only appear when the provider gave them entries.
    for (const group of sidebar.querySelectorAll(config.moduleGroups)) {
      const entries = [...group.querySelectorAll(':scope .collapse a[href]')].filter(a => !(a.getAttribute('href') || '').startsWith('#'))
      if (!entries.length) continue
      const title = collapse(group.querySelector(':scope > a')?.textContent)
      const list = section(!title ? tx('其他') : config.groupLabels.includes(title) ? tx(title) : title)
      for (const entry of entries) list.append(link(entry.getAttribute('href'), menuLabel(pathOf(entry.getAttribute('href')), entry), pathOf(entry.getAttribute('href')) === here).item)
    }
    // The provider's server-backed student search moves into the navigation bar.
    const search = sidebar.querySelector(config.search)
    if (search) { const box = element('div'); box.className = 'edulog-nav-search'; nav.append(box); scope.move(search, box) }

    const footer = element('div'); footer.className = 'edulog-nav-footer'
    const profile = sidebar.querySelector(config.profile)
    if (profile) { const anchor = element('a', tx('個人資料')); anchor.href = profile.getAttribute('href'); if (pathOf(anchor.getAttribute('href')) === here) anchor.setAttribute('aria-current', 'page'); footer.append(anchor) }
    const locales = [...sidebar.querySelectorAll(config.locales)]
    if (locales.length) {
      const group = element('div'); group.className = 'edulog-nav-locales'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', tx('原站語言'))
      for (const locale of locales) { const button = proxy(collapse(locale.textContent), locale); if (locale.classList.contains('btn-primary')) button.setAttribute('aria-pressed', 'true'); group.append(button) }
      footer.append(group)
    }
    const logout = sidebar.querySelector(config.logout)
    if (logout) { const button = proxy(tx('登出'), logout); button.className = 'edulog-nav-logout'; footer.append(button) }
    nav.append(footer)

    for (const native of sidebar.querySelectorAll(`:scope > ${config.classSwitcher}, :scope > ${config.nav}`)) mark(native, 'data-edulog-replaced', '')
    sidebar.prepend(nav)

    // Drawer (narrow screens): backdrop, Escape and a simple focus loop while open.
    const backdrop = scope.add(element('div')); backdrop.className = 'edulog-nav-backdrop'
    doc.body.append(backdrop)
    listen(backdrop, 'click', () => setOpen(false))
    function setOpen(open) {
      const html = doc.documentElement
      if (open) html.setAttribute('data-edulog-nav-open', ''); else html.removeAttribute('data-edulog-nav-open')
      const toggle = doc.getElementById('edulog-extension-root')?.shadowRoot?.querySelector('.menu')
      toggle?.setAttribute('aria-expanded', String(open))
      if (open) nav.querySelector('a,button:not(.edulog-nav-close)')?.focus()
      else if (toggle) toggle.focus()
    }
    listen(doc, 'keydown', event => {
      if (!doc.documentElement.hasAttribute('data-edulog-nav-open')) return
      if (event.key === 'Escape') { setOpen(false); return }
      if (event.key !== 'Tab') return
      const items = [...nav.querySelectorAll('a[href],button,input,select')].filter(node => !node.disabled && node.getClientRects().length)
      if (!items.length) return
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus() }
    })
    return { nav, setOpen, current: classes.find(item => item.current) || null }
  }
  // Views call this after updating globalThis.edulogClassPending so the bar refreshes its counts.
  const announcePending = doc => doc.dispatchEvent(new doc.defaultView.CustomEvent('edulog:class-pending'))
  globalThis.edulogSiteNavigation = Object.freeze({ parseClassName, placeLabels, readClasses, currentClass, mount, announcePending })
})()
