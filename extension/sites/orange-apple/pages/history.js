// 學生學習紀錄: one enrollment's history table.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  kit.page(['history'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
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
  })
})()
