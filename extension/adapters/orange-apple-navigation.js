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

  // "樹林_非凡文理_201教室（菁英） - 週六 第 1 時段 (10:00 ~ 12:00)" → 週六 10:00–12:00 · 201教室（菁英）
  function parseClassName(name) {
    const text = collapse(name), match = config.className.exec(text)
    if (!match) return { primary: text, secondary: '', weekday: 7, start: '99:99', full: text }
    const place = match[1].split('_').filter(Boolean)
    return { primary: `${match[2]} ${match[3]}–${match[4]}`, secondary: place.at(-1) || match[1], weekday: config.weekdays.indexOf(match[2]), start: match[3].padStart(5, '0'), full: text }
  }
  // Monday first, Sunday last, then by start time.
  const weekOrder = weekday => weekday === 0 ? 7 : weekday
  function readClasses(sidebar, doc) {
    const here = pathOf(doc.location.pathname)
    const today = new Date().getDay()
    const seen = new Set()
    return [...sidebar.querySelectorAll(config.classLinks)].map(link => {
      const path = pathOf(link.getAttribute('href'))
      if (!path || seen.has(path)) return null
      seen.add(path)
      const info = parseClassName(link.textContent)
      return { ...info, path, link, today: info.weekday === today, current: here === path || here.startsWith(`${path}/`), pending: pending.get(path) }
    }).filter(Boolean).sort((a, b) => weekOrder(a.weekday) - weekOrder(b.weekday) || a.start.localeCompare(b.start))
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
    nav.className = 'edulog-nav'; nav.setAttribute('aria-label', '主要導覽'); nav.id = 'edulog-nav'
    const dataText = (tag, value, className) => { const node = element(tag); node.textContent = value; if (className) node.className = className; return node }
    const section = label => { const box = element('section'); box.className = 'edulog-nav-section'; box.append(dataText('h2', label, 'edulog-nav-heading')); const list = element('ul'); box.append(list); nav.append(box); return list }
    const link = (href, label, current) => { const item = element('li'), anchor = element('a'); anchor.href = href; anchor.textContent = label; if (current) anchor.setAttribute('aria-current', 'page'); item.append(anchor); return { item, anchor } }
    const proxy = (label, target) => { const button = element('button', label); button.type = 'button'; listen(button, 'click', () => { if (target?.isConnected) target.click() }); return button }

    const close = element('button', '關閉導覽'); close.type = 'button'; close.className = 'edulog-nav-close'
    listen(close, 'click', () => setOpen(false))
    nav.append(close)

    if (classes.length) {
      const list = section('我的班級')
      for (const item of classes) {
        const entry = element('li'), anchor = element('a')
        anchor.href = item.path; anchor.title = item.full; anchor.className = 'edulog-nav-class'
        if (item.current) anchor.setAttribute('aria-current', 'page')
        const text = element('span'); text.className = 'edulog-nav-class-text'
        text.append(dataText('strong', item.primary)); if (item.secondary) text.append(dataText('span', item.secondary, 'edulog-nav-class-place'))
        anchor.append(text)
        const marks = element('span'); marks.className = 'edulog-nav-marks'
        if (item.today) marks.append(dataText('span', '今天', 'edulog-nav-today'))
        if (item.pending) { const count = dataText('span', String(item.pending), 'edulog-nav-count'); count.setAttribute('aria-label', `${item.pending} 位待處理`); marks.append(count) }
        if (marks.childNodes.length) anchor.append(marks)
        entry.append(anchor); list.append(entry)
      }
    }
    const seenLinks = new Set(), workLinks = []
    for (const native of sidebar.querySelectorAll(config.menuLinks)) {
      const href = native.getAttribute('href') || ''
      if (href.startsWith('#') || native.closest('.collapse:not(.navbar-collapse)')) continue
      const path = pathOf(href)
      if (!path || seenLinks.has(path)) continue
      seenLinks.add(path); workLinks.push({ href, label: collapse(native.textContent), current: path === here })
    }
    if (workLinks.length) { const work = section('工作'); for (const entry of workLinks) work.append(link(entry.href, entry.label, entry.current).item) }
    // Module groups (師資模組, 人資模組) only appear when the provider gave them entries.
    for (const group of sidebar.querySelectorAll(config.moduleGroups)) {
      const entries = [...group.querySelectorAll(':scope .collapse a[href]')].filter(a => !(a.getAttribute('href') || '').startsWith('#'))
      if (!entries.length) continue
      const title = collapse(group.querySelector(':scope > a')?.textContent) || '其他'
      const list = section(title)
      for (const entry of entries) list.append(link(entry.getAttribute('href'), collapse(entry.textContent), pathOf(entry.getAttribute('href')) === here).item)
    }
    // The provider's server-backed student search moves into the navigation bar.
    const search = sidebar.querySelector(config.search)
    if (search) { const box = element('div'); box.className = 'edulog-nav-search'; nav.append(box); scope.move(search, box) }

    const footer = element('div'); footer.className = 'edulog-nav-footer'
    const profile = sidebar.querySelector(config.profile)
    if (profile) { const anchor = element('a', '個人資料'); anchor.href = profile.getAttribute('href'); if (pathOf(anchor.getAttribute('href')) === here) anchor.setAttribute('aria-current', 'page'); footer.append(anchor) }
    const locales = [...sidebar.querySelectorAll(config.locales)]
    if (locales.length) {
      const group = element('div'); group.className = 'edulog-nav-locales'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', '原站語言')
      for (const locale of locales) { const button = proxy(collapse(locale.textContent), locale); if (locale.classList.contains('btn-primary')) button.setAttribute('aria-pressed', 'true'); group.append(button) }
      footer.append(group)
    }
    const logout = sidebar.querySelector(config.logout)
    if (logout) { const button = proxy('登出', logout); button.className = 'edulog-nav-logout'; footer.append(button) }
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
  globalThis.edulogSiteNavigation = Object.freeze({ parseClassName, readClasses, currentClass, mount })
})()
