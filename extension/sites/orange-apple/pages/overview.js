// 教師總覽: schedule context next to the weekly to-do view.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  kit.page(['overview'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    for (const table of content.querySelectorAll('table')) { mark(table, 'data-edulog-overview-table', ''); scrollTable(scope, table, 'overview') }
    const value = new URL(doc.location.href).searchParams.get('today')
    const parts = model.siteParts(); const today = `${parts.year}-${String(parts.month + 1).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
    const note = region(scope, '', 'edulog-page-context')
    note.append(element('strong', tx('課表基準日期：{date}', { date: value || today })), element('p', tx('「我的班級」是固定班級入口；下方課表依原站選定日期顯示。')))
    const todayLink = element('a', tx('回到今天')); todayLink.href = `/?today=${today}`; note.append(todayLink); content.prepend(note)
    // The schedule opener is the card heading link to /?today=… (its wording is not translated).
    const opener = content.querySelector('.card-header h4 a[href*="today="]') || [...content.querySelectorAll('a[href]')].find(a => /課程表.*點擊檢視/.test(text(a)))
    if (opener) {
      mark(opener, 'aria-label', tx('載入選定日期課表'))
      const state = scope.add(element('p', tx('課表尚未展開，請按「課程表」載入。'))); state.className = 'edulog-empty'; state.setAttribute('role', 'status'); opener.parentElement.after(state)
      listen(opener, 'click', () => { state.textContent = tx('正在載入課表；若未載入，請重新按原站課表入口。') })
    }
  })
})()
