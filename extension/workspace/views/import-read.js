// Step 1 讀取: "my classes" as a radio list; the current tab's class is preselected.
import { h, list } from '../../shared/render.js'
import { say } from './strings.js'
import { shortDate } from './model.js'

export function renderClassList(host, classes, { selected, onPick }) {
  const items = classes.length ? classes : [{ classId: '', empty: true }]
  list(host, items, item => item.classId || 'empty', (item, old) => {
    if (item.empty) return old || say(h('li', { class: 'row empty-row caption' }), 'ws.classEmpty')
    const checked = item.classId === selected
    const sig = JSON.stringify([item, checked])
    if (old?.dataset.sig === sig) return old
    const input = h('input', { type: 'radio', name: 'source-class', value: item.classId, checked, onchange: () => { if (input.checked) onPick(item) } })
    const title = h('span', { class: 'row-name' }, item.title ? h('span', { 'data-source-raw': '' }, item.title) : say(h('span'), 'ws.classId', { id: item.classId }))
    if (item.current) title.append(say(h('span', { class: 'tag tag-info' }), 'ws.classCurrent'))
    const meta = h('span', { class: 'row-meta' })
    const parts = []
    if (item.tabId && !item.current) parts.push(say(h('span'), 'ws.classOpen'))
    if (item.students) parts.push(say(h('span'), 'ws.classStudents', { count: item.students }))
    parts.push(item.lastSync ? say(h('span'), 'ws.classSynced', { date: shortDate(item.lastSync) }) : say(h('span'), 'ws.classNever'))
    parts.forEach((part, index) => { if (index) meta.append(' · '); meta.append(part) })
    return h('li', { class: 'row clickable radio-row', 'aria-selected': checked ? 'true' : null, dataset: { classId: item.classId, selected: String(checked), sig } },
      h('label', { class: 'row-label' }, input, h('span', { class: 'row-main' }, title, meta)))
  })
}
