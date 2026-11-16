export const renewalPagePath = page => '/dt_admissions?city_id=&remaining_lte=20' + (page === 1 ? '' : `&page=${page}`)

// Reuse only the synthetic rows. Each served page has a different student.
export function renewalPage(html, page) {
  let row = 0
  const filtered = html.replace(/<tr\b[\s\S]*?<\/tr>/g, markup => {
    const index = row++
    return index === 0 || index === page ? markup : ''
  })
  if (page < 1 || page > 4) return filtered
  const link = (number, label, attributes = '') =>
    `<li class="page-item"><a class="page-link" href="${renewalPagePath(number).replaceAll('&', '&amp;')}"${attributes}>${label}</a></li>`
  const numbers = [1, 2, 3, 4].map(number => number === page
    ? `<li class="page-item active"><span class="page-link">${page}</span></li>`
    : link(number, number)).join('')
  const previous = page > 1 ? link(1, '第一頁') + link(page - 1, '上一頁', ' rel="prev"') : ''
  const next = page < 4 ? link(page + 1, '下一頁', ' rel="next"') + link(4, '最後一頁') : ''
  return filtered.replace('</table>', `</table><nav><ul class="pagination">${previous}${numbers}${next}</ul></nav>`)
}
