import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
import { classEntries, exceptionModel } from '../workspace/views/model.js'

// The view modules use the page globals; each DOM test installs a fresh jsdom window.
async function page(html = '<body></body>') {
  const dom = new JSDOM(html, { runScripts: 'outside-only' }), w = dom.window
  w.eval(readFileSync(new URL('../shared/ui-core.js', import.meta.url), 'utf8')); await new Promise(resolve => setTimeout(resolve, 0))
  for (const name of ['document', 'Node', 'Event', 'CSS', 'requestAnimationFrame', 'matchMedia']) globalThis[name] = w[name] || globalThis[name]
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0)
  globalThis.edulogUi = w.edulogUi
  const { registerStrings } = await import('../workspace/views/strings.js'); registerStrings()
  w.edulogUi.setLocale('zh-TW')
  return { dom, w, close: () => { for (const name of ['document', 'Node', 'Event', 'edulogUi']) delete globalThis[name]; dom.window.close() } }
}

test('my classes merge open class tabs with classes synced before, current tab first', () => {
  const list = classEntries({
    currentTabId: 12,
    tabs: [{ id: 10, title: '初階程式 A 班', path: '/courses/dt/11' }, { id: 12, title: '機器人 B 班', path: '/courses/dt/12' }, { id: 20, title: '未填報告', path: '/admissions/unfilled_report' }],
    works: [{ type: 'import', status: 'complete', sourceClassId: '14', sourceTitle: '積木創客 D 班', updatedAt: 2000 }, { type: 'import', status: 'complete', sourceClassId: '11', updatedAt: 1000, snapshot: { records: [{ kind: 'enrollment' }, { kind: 'enrollment' }] } }, { type: 'import', status: 'collected', sourceClassId: '15' }, { type: 'prefill', sourceClassId: '16' }],
  })
  assert.deepEqual(list.map(item => item.classId), ['12', '11', '14', '15'])
  assert.equal(list[0].current, true)
  assert.equal(list[1].tabId, 10); assert.equal(list[1].lastSync, 1000); assert.equal(list[1].students, 2)
  assert.equal(list[2].tabId, null); assert.equal(list[2].path, '/courses/dt/14'); assert.equal(list[2].title, '積木創客 D 班')
  assert.equal(list[3].lastSync, 0)
})

test('confirm lists only exceptions in the fixed group order and counts automatic matches', () => {
  const needs = (key, code, extra = {}) => ({ key, category: 'needs', reason: code, issues: [{ code }], record: { sourceStudentName: key, date: '2026-10-04', enrollment_source_id: '301', ...extra } })
  const enrollment = (id, extra = {}) => ({ row: { kind: 'enrollment', source_id: id, sourceStudentName: `學生 ${id}` }, valid: false, skipped: false, missing: [], ...extra })
  const model = exceptionModel({
    items: [needs('a', 'class'), needs('b', 'class-other'), needs('c', 'occurrence-mismatch'), needs('d', 'both-changed'), needs('e', 'date'), needs('f', 'enrollment', { enrollment_source_id: '302' }), needs('g', 'enrollment', { enrollment_source_id: '302' }),
      { key: 'h', category: 'bind' }, { key: 'i', category: 'history' }, { key: 'j', category: 'linked' }, { key: 'k', category: 'system-excluded', attendanceEvidence: true }, { key: 'l', category: 'unfilled' }, { key: 'm', category: 'skipped' }],
    enrollments: [enrollment('302'), enrollment('303', { missing: ['start'] }), enrollment('304', { valid: true }), enrollment('305', { skipped: true })],
    classTarget: { needed: true, missing: [] },
  })
  assert.deepEqual(model.groups.map(group => [group.kind, group.items.map(item => item.key)]), [['class', ['class-target', 'a', 'b']], ['occurrence', ['c']], ['both', ['d']], ['student', ['enrollment:302']], ['missing', ['enrollment:303']], ['other', ['e']]])
  assert.equal(model.total, 8)
  assert.equal(model.blocking, 3, 'class and enrollment decisions block syncing; report exceptions do not')
  assert.equal(model.missing, 1)
  assert.equal(model.groups.find(group => group.kind === 'student').items[0].reports, 2)
  assert.deepEqual([model.auto.students, model.auto.reports, model.auto.attendance, model.auto.total], [1, 3, 1, 5])
  assert.equal(model.groups.find(group => group.kind === 'missing').tone, 'danger')
})

test('resolved rows stay listed with an ok tone until the step is left', () => {
  const row = { kind: 'enrollment', source_id: '301', sourceStudentName: '王小明' }
  const shown = new Set(['enrollment:301', 'class-target'])
  const model = exceptionModel({ items: [], enrollments: [{ row, valid: true, skipped: false, missing: [], wasMissing: true }], classTarget: { needed: false }, shown })
  assert.deepEqual(model.groups.map(group => [group.kind, group.tone, group.items[0].tone, group.items[0].resolved]), [['class', 'ok', 'ok', true], ['missing', 'ok', 'ok', true]])
  assert.equal(model.total, 0); assert.equal(model.blocking, 0)
  const fresh = exceptionModel({ items: [], enrollments: [{ row, valid: true, skipped: false, missing: [] }], classTarget: { needed: false } })
  assert.equal(fresh.groups.length, 0, 'never-listed matches are counted, not listed'); assert.equal(fresh.auto.students, 1)
})

test('render helpers create elements and keep keyed nodes in order', async () => {
  const p = await page()
  try {
    const { h, list } = await import('../shared/render.js')
    const clicks = []
    const button = h('button', { class: ['btn', false && 'x', 'btn-sm'], type: 'button', 'aria-label': '關閉', dataset: { ctl: 'close' }, onclick: () => clicks.push(1), hidden: false }, 'A', null, ['B'])
    button.click()
    assert.equal(button.className, 'btn btn-sm'); assert.equal(button.getAttribute('aria-label'), '關閉'); assert.equal(button.dataset.ctl, 'close'); assert.equal(button.textContent, 'AB'); assert.deepEqual(clicks, [1])
    const host = p.w.document.createElement('ul'), render = (item, old) => old || h('li', {}, item.label)
    list(host, [{ id: 1, label: 'one' }, { id: 2, label: 'two' }, { id: 3, label: 'three' }], item => item.id, render)
    const [one, two] = host.children
    list(host, [{ id: 2 }, { id: 4, label: 'four' }, { id: 1 }], item => item.id, render)
    assert.deepEqual([...host.children].map(node => node.textContent), ['two', 'four', 'one'])
    assert.equal(host.children[0], two); assert.equal(host.children[2], one, 'existing nodes are reused, not recreated')
    list(host, [{ id: 2 }, { id: 4 }], item => item.id, (item, old) => item.id === 2 ? h('li', {}, 'replaced') : old)
    assert.deepEqual([...host.children].map(node => node.textContent), ['replaced', 'four'])
  } finally { p.close() }
})

test('class list renders, picks and switches language', async () => {
  const p = await page('<body><ul id="classes"></ul></body>')
  try {
    const { renderClassList } = await import('../workspace/views/import-read.js')
    const picked = [], host = p.w.document.getElementById('classes')
    renderClassList(host, [{ classId: '11', title: '初階程式 A 班', tabId: 10, current: true, lastSync: 0, students: 8 }, { classId: '12', title: '', tabId: null, current: false, lastSync: new Date(2026, 9, 11).getTime(), students: 0 }], { selected: '11', onPick: item => picked.push(item.classId) })
    const rows = [...host.querySelectorAll('li')]
    assert.equal(rows[0].querySelector('input').checked, true); assert.match(rows[0].textContent, /目前分頁/); assert.match(rows[0].textContent, /8 位學生/)
    assert.match(rows[1].textContent, /原站班級 #12/); assert.match(rows[1].textContent, /上次同步 10\/11/)
    rows[1].querySelector('input').checked = true; rows[1].querySelector('input').dispatchEvent(new p.w.Event('change')); assert.deepEqual(picked, ['12'])
    p.w.edulogUi.setLocale('en'); assert.match(rows[0].textContent, /Current tab/); assert.match(rows[0].textContent, /8 students/)
    renderClassList(host, [], { selected: '', onPick() {} }); assert.match(host.textContent, /No classes found/)
  } finally { p.close() }
})

test('done view shows tiles and a skipped list where each item can be reprocessed', async () => {
  const p = await page('<body><div id="tiles"></div><section id="skipped" hidden></section></body>')
  try {
    const { renderDoneView } = await import('../workspace/views/import-done.js')
    const again = [], tilesHost = p.w.document.getElementById('tiles'), skippedHost = p.w.document.getElementById('skipped')
    renderDoneView({ tilesHost, skippedHost, tiles: [{ key: 'ws.tile.students', value: 2 }, { key: 'ws.tile.skipped', value: 1, tone: 'warn' }], skipped: [{ key: 'r1', name: '黃品睿', meta: '10/01', reason: '找不到課堂' }], onReprocess: item => again.push(item.key) })
    assert.deepEqual([...tilesHost.querySelectorAll('.tile')].map(tile => tile.textContent), ['2新建學生', '1略過'])
    assert.equal(tilesHost.querySelector('.tile.warn b').textContent, '1')
    assert.equal(skippedHost.hidden, false); assert.match(skippedHost.textContent, /略過的項目/); assert.match(skippedHost.textContent, /黃品睿/)
    skippedHost.querySelector('[data-reprocess="r1"]').click(); assert.deepEqual(again, ['r1'])
    renderDoneView({ tilesHost, skippedHost, tiles: [], skipped: [], onReprocess() {} }); assert.equal(skippedHost.hidden, true)
  } finally { p.close() }
})

test('work log groups unfinished and finished work with one primary action per row', async () => {
  const p = await page('<body><div id="log"></div></body>')
  try {
    const { renderWorkList } = await import('../workspace/views/work-log.js')
    const host = p.w.document.getElementById('log'), events = []
    renderWorkList(host, { groups: [{ key: 'open', items: [{ id: 'w1', title: '自然探索 A 班', meta: '確認中', tone: 'warn', tag: '確認中', open: true }] }, { key: 'done', items: [{ id: 'w2', title: '程式積木 B 班', meta: '已完成', open: false }, { id: 'w3', title: '機器人 C 班', meta: '已完成', open: false, selected: true }] }, { key: 'archived', items: [] }], onSelect: id => events.push(['select', id]), onPrimary: id => events.push(['continue', id]) })
    assert.deepEqual([...host.querySelectorAll('.group-head')].map(head => head.textContent), ['未完成1', '已完成2'])
    assert.equal(host.querySelector('[data-work-id="w1"] [data-work-primary]').textContent, '繼續')
    assert.equal(host.querySelector('[data-work-id="w2"] [data-work-view]').textContent, '查看')
    assert.equal(host.querySelector('[data-work-id="w3"]').getAttribute('aria-current'), 'true')
    host.querySelector('[data-work-primary="w1"]').click(); host.querySelector('[data-work-id="w2"]').click()
    assert.deepEqual(events, [['continue', 'w1'], ['select', 'w2']])
    p.w.edulogUi.setLocale('en'); assert.equal(host.querySelector('[data-work-primary]').textContent, 'Continue')
    renderWorkList(host, { groups: [], onSelect() {}, onPrimary() {} }); assert.match(host.textContent, /No work matches/)
  } finally { p.close() }
})

test('the workspace has one token-only stylesheet with the role type scale', async () => {
  const html = readFileSync(new URL('../workspace/workspace.html', import.meta.url), 'utf8')
  assert.deepEqual([...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map(match => match[1]), ['../styles/edulog-tokens.css', '../styles/ui-tokens.css', './workspace.css'])
  assert.doesNotMatch(html, /prefill-view|data-flow="prefill"/)
  const css = readFileSync(new URL('../workspace/workspace.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b(?![\w-])/i, 'no hard-coded colours')
  assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/, 'no literal colour functions')
  const sizes = [...css.matchAll(/font(?:-size)?:\s*([^;}]+)/g)].map(match => match[1])
  for (const size of sizes) assert.match(size, /^(inherit|var\(--edulog-font-(tag|caption|body|button|name|heading|title)\)(\/var\(--edulog-leading(-tight)?\) var\(--edulog-font\))?)$/, `font sizes come from the role tokens: ${size}`)
  const tokens = readFileSync(new URL('../styles/ui-tokens.css', import.meta.url), 'utf8')
  assert.match(tokens, /min-height:var\(--edulog-control-height\)/); assert.doesNotMatch(tokens.split('@media')[0], /touch-target/)
  assert.match(tokens, /@media \(max-width:767px\),\(pointer:coarse\)\{:root\{--edulog-control-height:var\(--edulog-touch-target\)/)
})

test('every workspace view string has Chinese and English copy', async () => {
  const { strings } = await import('../workspace/views/strings.js')
  for (const [key, [zh, en]] of Object.entries(strings)) {
    assert.ok(zh && en, `${key} has both languages`)
    assert.match(zh, /[\u4e00-\u9fff]|^[\w\s{}·/.:&-]+$/u, `${key} zh`)
    assert.doesNotMatch(en, /[\u4e00-\u9fff]/u, `${key} English has no Chinese`)
    assert.deepEqual([...zh.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), [...en.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort(), `${key} placeholders match`)
  }
})
