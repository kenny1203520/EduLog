// 班級列表.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  kit.page(['classes'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    const switcher = region(scope, '班級檢視', 'edulog-table-tools')
    const listButton = element('button', tx('班級清單')), matrixButton = element('button', tx('原站時段矩陣'))
    listButton.type = matrixButton.type = 'button'; switcher.append(listButton, matrixButton); content.prepend(switcher)
    const pairs = []
    for (const table of content.querySelectorAll('table.dt-stages')) {
      const cards = region(scope, '', 'edulog-class-list')
      const cells = grid(table)
      for (let r = 2; r < cells.length; r++) for (let c = 2; c < cells[r].length; c++) {
        const cell = cells[r][c]
        if (!cell || cells[r].indexOf(cell) !== c || (r > 2 && cells[r - 1]?.[c] === cell)) continue
        for (const original of [...cell.querySelectorAll('a[href]')].filter(classLink)) {
          const card = element('article'), link = element('a', text(cells[r][1]) || text(cells[r][0]) || tx('原站班級'))
          link.href = original.href; card.append(link)
          const counts = text(original).match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/)
          card.append(facts(scope, [
            ['教室', text(cells[r][0])], ['星期', text(cells[0][c])], ['原站時段', text(cells[1][c])],
            ...(counts ? [['付費（含長期停課）', counts[1]], ['所有報名', counts[2]], ['教室人數上限', counts[3]]] : [['原站人數資訊', text(original)]]),
          ]))
          const other = text(cell).replace(text(original), '').trim(); if (other) card.append(element('p', other))
          cards.append(card)
        }
      }
      if (!cards.children.length) cards.append(element('p', tx('目前這個區域與時段沒有已載入的班級。')))
      table.before(cards)
      const scroll = scope.add(element('div')); scroll.className = 'edulog-table-scroll'
      table.before(scroll); move(table, scroll)
      pairs.push({ table, cards, scroll })
    }
    const select = mode => {
      view.classLayout = mode
      listButton.setAttribute('aria-pressed', String(mode === 'list')); matrixButton.setAttribute('aria-pressed', String(mode === 'matrix'))
      for (const { table, cards, scroll } of pairs) { mark(table, 'data-edulog-matrix-hidden', mode === 'list' ? '' : null); scroll.hidden = mode === 'list'; cards.hidden = mode !== 'list' }
    }
    listen(listButton, 'click', () => select('list')); listen(matrixButton, 'click', () => select('matrix')); select(view.classLayout || 'list')
  })
})()
