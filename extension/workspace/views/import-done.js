// Step 3 完成: count tiles and the list of skipped items, each with 重新處理.
import { h, list, icon } from '../../shared/render.js'
import { say } from './strings.js'

/** tiles: [{ key, value, tone? }]; skipped: [{ key, name, meta, reason }] */
export function renderDoneView({ tilesHost, skippedHost, tiles, skipped, onReprocess }) {
  list(tilesHost, tiles, tile => tile.key, (tile, old) => {
    const node = old || h('div', { class: 'tile' }, h('b'), h('span'))
    node.className = ['tile', tile.tone].filter(Boolean).join(' ')
    node.querySelector('b').textContent = String(tile.value)
    say(node.querySelector('span'), tile.key)
    return node
  })
  skippedHost.hidden = !skipped.length
  if (!skipped.length) { skippedHost.replaceChildren(); return }
  let rows = skippedHost.querySelector('.rows')
  if (!rows) {
    rows = h('div', { class: 'rows' })
    skippedHost.replaceChildren(h('div', { class: 'panel-head' }, say(h('h2', { id: 'skipped-title' }), 'ws.skippedTitle'), h('span', { class: 'count', id: 'skipped-count' }), say(h('p'), 'ws.skippedHelp')), rows)
    skippedHost.setAttribute('aria-labelledby', 'skipped-title')
  }
  skippedHost.querySelector('#skipped-count').textContent = String(skipped.length)
  const shownItems = skipped.slice(0, 50)
  list(rows, shownItems, item => item.key, (item, old) => {
    const sig = JSON.stringify(item)
    if (old?.dataset.sig === sig) return old
    const node = h('div', { class: 'row', 'data-tone': 'warn', dataset: { sig } },
      h('div', { class: 'row-main' }, h('span', { class: 'row-name', 'data-source-raw': '' }, item.name || '—'), h('span', { class: 'row-meta', 'data-source-raw': '' }, [item.meta, item.reason].filter(Boolean).join(' · '))),
      h('div', { class: 'row-side' }, h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-reprocess': item.key, onclick: () => onReprocess(item) }, icon('rotate'), say(h('span'), 'ws.reprocess'))))
    return node
  })
}
