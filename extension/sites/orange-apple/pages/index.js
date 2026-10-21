// Runs the page handler registered for this page kind (pages/*.js), after marking native actions.
// Statements that apply to every page run here, in their original order between the handlers.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  function enhancePage(context) {
    const { doc, content, page, scope, view } = context
    const pagePath=doc.location.pathname
    const refreshers = []
    const { mark, element, listen, move } = scope
    for (const button of content.querySelectorAll('.btn,button,input[type=submit],.nav-link')) mark(button, 'data-edulog-action', '')
    const pageContext = { ...context, refreshers, pagePath }
    if (page.kind === 'hours') kit.handlers.get(page.kind)(pageContext)
    if (page.kind === 'profile') kit.handlers.get(page.kind)(pageContext)
    if (page.kind === 'profile-edit') kit.handlers.get(page.kind)(pageContext)
    {
      for (const card of content.querySelectorAll('.card')) mark(card, 'data-edulog-card', '')
      const globalSearch = doc.querySelector('#nav-teacher input[name=q]')
      if (globalSearch) { mark(globalSearch, 'aria-label', tx('本站學生搜尋')); mark(globalSearch, 'placeholder', tx('本站學生搜尋')) }
      for (const a of doc.querySelectorAll('.sidebar a[href]')) {
        const href = a.getAttribute('href')
        if (href && !href.startsWith('#') && a.origin === doc.location.origin && a.pathname === doc.location.pathname) mark(a, 'aria-current', 'page')
      }
    }
    if (page.kind === 'class') kit.handlers.get(page.kind)(pageContext)
    kit.shared.get('report-table')(pageContext)
    if (page.kind === 'history') kit.handlers.get(page.kind)(pageContext)
    if (page.kind === 'unfilled' || page.kind === 'unfilled-current') kit.handlers.get(page.kind)(pageContext)
    if (page.kind === 'renewals') kit.handlers.get(page.kind)(pageContext)
    if (page.kind === 'sign-in' || page.kind === 'password') kit.handlers.get(page.kind)(pageContext)
    if (page.kind === 'classes') kit.handlers.get(page.kind)(pageContext)
    if (page.kind === 'overview') kit.handlers.get(page.kind)(pageContext)
    if (page.kind === 'calendar') kit.handlers.get(page.kind)(pageContext)
    return { refresh: () => { for (const refresh of refreshers) refresh() } }
  }
  const dialogs = globalThis.edulogSitePageDialogs
  globalThis.edulogSiteWorkflows = Object.freeze({ enhancePage, enhanceDialog: dialogs.enhanceDialog, enhanceDialogs: dialogs.enhanceDialogs })
})()
