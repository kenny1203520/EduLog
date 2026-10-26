// 課程行事曆: region and weekday status.
(() => {
  const kit = globalThis.edulogSitePageKit
  if (!kit) return
  const { model, words, site, tx, text, classLink, region, facts, grid, normalized, reportDate, scrollTable, filterTable, UNFILLED_COLUMNS, OVERDUE, PHONE, SVG, LUCIDE, lucide } = kit
  kit.page(['calendar'], context => {
    const { doc, content, page, scope, view, refreshers, pagePath } = context
    const { mark, element, listen, move } = scope
    const summary = region(scope, '課程行事曆', 'edulog-page-context')
    const update = () => {
    const selected = content.querySelector('.region-title.active')
    const selectedPanel = selected && content.querySelector(selected.getAttribute('href'))
    const day = selectedPanel?.querySelector('[id*="weekday-"][id$="-tab"].active')
    description.textContent = tx('目前區域：{area} · 日期：{day}', { area: text(selected) || tx('尚未選擇'), day: text(day) || tx('請選擇日期') })
    const panels = [...(selectedPanel?.querySelectorAll('[id^=region-][id*=weekday-]:not([id$=-tab])') || [])]
    const active = day && selectedPanel?.querySelector(day.getAttribute('href'))
    const links = active ? [...active.querySelectorAll('a[href]')].filter(link => classLink(link)) : []
    status.textContent = !selected ? tx('請選擇區域以載入課程。') : !panels.length ? tx('正在載入區域課表；若未載入，請重新選擇原站區域。') : !active ? tx('請選擇日期。') : links.length ? tx('目前日期已載入 {count} 個班級入口。', { count: links.length }) : tx('目前已載入的日期沒有課程。')
    for (const alert of content.querySelectorAll('.alert')) if (site.isTerm(text(alert), '請選擇區域')) mark(alert, 'data-edulog-stale-alert', selected ? '' : null)
    }
    const description = element('p'), status = element('p'); status.setAttribute('role', 'status'); summary.append(description, status); content.prepend(summary)
    update(); refreshers.push(update)
    const input = content.querySelector(site.termForms('選擇欲前往的日期').map(hint => `input[placeholder="${hint}"]:not([type=hidden])`).join(','))
    if (input) {
      mark(input, 'aria-label', tx('前往課程日期'))
      const form = input.closest('form')
      if (form) {
        mark(form, 'data-edulog-calendar-controls', '')
        const previous = [...content.querySelectorAll('a[href]')].find(a => site.isTerm(text(a), '前一週'))
        const next = [...content.querySelectorAll('a[href]')].find(a => site.isTerm(text(a), '下一週'))
        if (previous && next) {
          const original = form.parentElement.closest('.row')
          const navigation = region(scope, '', 'edulog-calendar-nav')
          ;(original || form).before(navigation)
          move(previous, navigation); move(form, navigation); move(next, navigation)
          if (original && !text(original)) mark(original, 'data-edulog-duplicate-heading', '')
        }
      }
    }
    for (const a of content.querySelectorAll('.region-title,[id*="weekday-"][id$="-tab"]')) listen(a, 'click', () => { status.textContent = tx('正在切換原站課表…') })
    for (const table of content.querySelectorAll('table.content-table')) { mark(table, 'data-edulog-calendar-table', ''); scrollTable(scope, table, 'calendar') }
  })
})()
