// 班級工作區: class header, roster, lesson-report cards and the session matrix.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  kit.page(['class'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    const heading = content.querySelector('h2'), overview = content.querySelector('[role=tab][href="#overview"]')
    if (heading && site.isTerm(text(heading), '節次資訊')) scope.text(heading, tx('班級工作區'))
    if (overview) scope.text(overview, tx('班級名單'))
    const original = content.querySelector('#overview table:not(#students-table)')
    if (original && original.rows.length > 1) {
      const labels = [...original.rows[0].cells].map(text)
      const values = [...original.rows[1].cells].map(text)
      const summary = region(scope, '班級資訊', 'edulog-class-summary')
      const items = labels.flatMap((label,i) => /上課.*報名.*上限/.test(site.canonLabel(label)) && /^\d+\s*\/\s*\d+\s*\/\s*\d+$/.test(values[i]) ? values[i].split('/').map((value,j)=>[['上課人數','報名人數','人數上限'][j],value.trim()]) : [[label,values[i]]])
      summary.append(facts(scope, items))
      const details = element('details'), caption = element('summary', tx('其他班級資訊'))
      details.append(caption); summary.append(details)
      original.before(summary); move(original, details)
      details.open = view.classDetails === true
      listen(details, 'toggle', () => { view.classDetails = details.open })
    }
    for (const card of content.querySelectorAll('.card.teacher')) mark(card, 'data-edulog-teacher', '')
    const nativeSearch = content.querySelector('#student_id-selectized')
    if (nativeSearch) { mark(nativeSearch, 'aria-label', tx('原站學生查詢')); mark(nativeSearch, 'placeholder', tx('查詢原站學生')) }
  })
})()
