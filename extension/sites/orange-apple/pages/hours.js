// 「我的鐘點」: labelled month query and scrollable tables.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  kit.page(['hours'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
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
  })
})()
