// 工作紀錄: 未完成 / 已完成 groups, one primary action per row (繼續 / 查看).
import { h, list, icon } from '../../shared/render.js'
import { say } from './strings.js'

/**
 * groups: [{ key: 'open'|'done'|'archived', items: [{ id, title, meta, tone, tag, open, selected }] }]
 * onSelect(id) opens the detail drawer; onPrimary(id) continues an unfinished work.
 */
export function renderWorkList(host, { groups, onSelect, onPrimary, empty }) {
  const entries = []
  for (const group of groups) {
    if (!group.items.length) continue
    entries.push({ type: 'head', key: `group:${group.key}`, group })
    for (const item of group.items) entries.push({ type: 'row', key: item.id, item })
  }
  if (!entries.length) entries.push({ type: 'empty', key: 'empty' })
  list(host, entries, entry => entry.key, (entry, old) => {
    if (entry.type === 'empty') return old || h('div', { class: 'empty' }, icon('history', 'ic-xl'), say(h('p'), empty || 'ws.log.empty'))
    if (entry.type === 'head') {
      const sig = String(entry.group.items.length)
      if (old?.dataset.sig === sig) return old
      return h('div', { class: 'group-head', dataset: { sig } }, h('span', { class: `dot dot-${entry.group.key === 'open' ? 'warn' : entry.group.key === 'done' ? 'ok' : 'neutral'}` }), say(h('span'), `ws.log.${entry.group.key}`), h('span', { class: 'count' }, sig))
    }
    const item = entry.item, sig = JSON.stringify(item)
    if (old?.dataset.sig === sig) return old
    const primary = item.open
      ? h('button', { type: 'button', class: 'btn btn-soft btn-sm', 'data-work-primary': item.id, onclick: event => { event.stopPropagation(); onPrimary(item.id) } }, icon('play'), say(h('span'), 'ws.log.continue'))
      : h('button', { type: 'button', class: 'btn btn-secondary btn-sm', 'data-work-view': item.id, onclick: event => { event.stopPropagation(); onSelect(item.id) } }, icon('eye'), say(h('span'), 'ws.log.view'))
    const row = h('div', { class: 'row clickable', 'data-tone': item.tone || null, 'data-work-id': item.id, 'aria-selected': item.selected ? 'true' : null, 'aria-current': item.selected ? 'true' : null, tabindex: '0', dataset: { sig },
      onclick: () => onSelect(item.id), onkeydown: event => { if (event.key === 'Enter' && event.target === row) onSelect(item.id) } },
    h('div', { class: 'row-main' },
      h('span', { class: 'row-name' }, h('span', { class: 'work-record-title', 'data-source-raw': '' }, item.title), item.tag ? h('span', { class: `tag tag-${item.tone || 'neutral'}` }, item.tag) : null),
      h('span', { class: 'row-meta' }, item.meta)),
    h('div', { class: 'row-side' }, primary))
    return row
  })
}
