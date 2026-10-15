import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// tests/fixtures/real-class.html keeps the real #students-table structure (de-identified):
// note popover and laptop-loan frame in the name cell, period lines under the course,
// the 預計開課日期 badge, remaining/makeup counts and the provider's colour legend.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function classPage() {
  const dom = new JSDOM(read('fixtures/real-class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, original = w.document.body.outerHTML
  for (const file of ['lexicon', 'model', 'session-cards', 'roster', 'workflows']) w.eval(read(`../adapters/orange-apple-${file}.js`))
  w.eval(read('../adapters/orange-apple.js'))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { dom, w, doc: w.document, view, result, original }
}
const cards = doc => [...doc.querySelectorAll('.edulog-roster-card:not([hidden])')]
const names = doc => cards(doc).map(card => card.querySelector('.edulog-card-main strong').textContent)
const card = (doc, name, index = 0) => cards(doc).filter(item => item.querySelector('.edulog-card-main strong').textContent === name)[index]
const badges = item => [...item.querySelectorAll('.edulog-badge')].map(badge => `${badge.dataset.tone}:${badge.textContent}`).join('|')
const chip = (doc, key) => doc.querySelector(`[data-roster-chip="${key}"]`)
const chipCounts = doc => Object.fromEntries([...doc.querySelectorAll('[data-roster-chip]')].map(button => [button.dataset.rosterChip, button.querySelector('.edulog-chip-count').textContent]))
const rosterRow = (doc, admission) => doc.querySelector(`#students-table [data-admission-id="${admission}"]`).closest('tr')

test('every enrolment becomes a card, fewest lessons left first, and the native table is hidden', () => {
  const s = classPage()
  assert.equal(cards(s.doc).length, 9)
  assert.equal(names(s.doc).join('|'), '學生戊|學生庚|學生甲|學生乙|學生丙|學生丁|學生乙|學生己|學生辛')
  assert.equal(s.doc.querySelector('#students-table').closest('.table-responsive').getAttribute('data-edulog-cards'), 'on')
  assert.equal(s.doc.querySelector('.color-labels').hasAttribute('data-edulog-replaced'), true)
  // The legend shares its .row with the roster column on the live page; nothing of the roster may be hidden.
  for (const selector of ['.edulog-roster-cards', '[data-roster-chip]', '[data-edulog-search="students"]']) assert.equal(s.doc.querySelector(selector).closest('[data-edulog-replaced]'), null, selector)
  const first = card(s.doc, '學生甲')
  assert.match(first.querySelector('.edulog-card-main').textContent, /六年級 · 菁英_Python程式開發班/)
  assert.match(first.querySelector('.edulog-card-main').textContent, /\(2026-06-27 ~ 2026-10-31\)/)
  assert.equal(first.querySelector('.edulog-roster-remaining').textContent, '剩餘 8 / 15 堂')
  assert.equal(first.querySelector('.edulog-roster-bar > span').style.width, '53%')
  assert.match(first.querySelector('.edulog-roster-progress').textContent, /補課 0 \/ 2/)
  s.dom.window.close()
})

test('badges carry remaining lessons, not-started dates, special states and same-name enrolments as text', () => {
  const s = classPage()
  assert.equal(badges(card(s.doc, '學生戊')), 'danger:剩餘 0 堂')
  assert.equal(card(s.doc, '學生戊').dataset.group, 'danger')
  assert.equal(badges(card(s.doc, '學生庚')), 'warn:剩餘 1 堂|warn:進度較慢')
  assert.equal(badges(card(s.doc, '學生甲')), 'info:調課')
  assert.equal(badges(card(s.doc, '學生丙')), 'info:本週試聽')
  assert.equal(badges(card(s.doc, '學生丁')), 'neutral:已試聽')
  assert.equal(badges(card(s.doc, '學生乙', 0)), 'neutral:同名 2 筆報名')
  const later = card(s.doc, '學生乙', 1)
  assert.equal(badges(later), 'neutral:尚未開課 · 預計 2026/12/05|neutral:同名 2 筆報名')
  assert.match(later.querySelector('.edulog-card-main').textContent, /預計 2026\/12\/05 開課/)
  assert.equal(badges(card(s.doc, '學生辛')), '')
  s.dom.window.close()
})

test('chips filter the cards and combine with the student search', () => {
  const s = classPage()
  assert.equal(JSON.stringify(chipCounts(s.doc)), JSON.stringify({ all: '9', low: '2', notStarted: '1', special: '6' }))
  assert.equal(chip(s.doc, 'all').getAttribute('aria-pressed'), 'true')
  chip(s.doc, 'low').click()
  assert.equal(names(s.doc).join('|'), '學生戊|學生庚')
  chip(s.doc, 'notStarted').click()
  assert.equal(names(s.doc).join('|'), '學生乙')
  chip(s.doc, 'special').click()
  assert.equal(names(s.doc).join('|'), '學生庚|學生甲|學生乙|學生丙|學生丁|學生乙')
  const search = s.doc.querySelector('[data-edulog-search="students"]')
  search.value = '學生乙'; search.dispatchEvent(new s.w.Event('input'))
  assert.equal(names(s.doc).join('|'), '學生乙|學生乙')
  assert.match(search.closest('.edulog-table-tools').textContent, /顯示 2 \/ 9 位學生/)
  search.value = '不存在'; search.dispatchEvent(new s.w.Event('input'))
  assert.equal(cards(s.doc).length, 0)
  assert.equal(s.doc.querySelector('.edulog-roster-cards .edulog-cards-status').textContent, '沒有符合篩選的學生。')
  s.dom.window.close()
})

test('the card checkbox, teaching note and laptop loan use the provider\'s own controls', () => {
  const s = classPage()
  const native = rosterRow(s.doc, 9003).querySelector('input[type=checkbox]'), changes = []
  native.addEventListener('change', () => changes.push(native.checked))
  const own = card(s.doc, '學生丙').querySelector('.edulog-roster-select input')
  own.click()
  assert.equal(native.checked, true)
  assert.equal(own.checked, true)
  assert.equal(JSON.stringify(changes), '[true]')
  own.click()
  assert.equal(native.checked, false)
  const header = s.doc.querySelector('#students-table th input[type=checkbox]')
  let headerClicks = 0
  header.addEventListener('click', () => headerClicks++)
  s.doc.querySelector('.edulog-roster-select-all input').click()
  assert.equal(headerClicks, 1)
  assert.equal(header.checked, true)
  let opened = 0
  rosterRow(s.doc, 9003).querySelector('a.admission-comment').addEventListener('click', event => { event.preventDefault(); opened++ })
  const more = card(s.doc, '學生丙').querySelector('.edulog-card-more')
  ;[...more.querySelectorAll('button')].find(button => button.textContent === '教學備註').click()
  assert.equal(opened, 1)
  assert.ok(more.querySelector('turbo-frame#laptop_9003 .dropdown-menu'), 'the native laptop dropdown moved into 更多')
  assert.equal(more.querySelector('a[href="/dt_admissions/9003"]').textContent, '完整紀錄')
  assert.ok(card(s.doc, '學生丙').querySelector('[aria-label="有教學備註"]'))
  s.dom.window.close()
})

test('restore returns the exact original page, including the moved laptop frames', () => {
  const s = classPage()
  card(s.doc, '學生丙').querySelector('.edulog-card-more').open = true
  s.result.restore()
  assert.equal(s.doc.body.outerHTML, s.original)
  s.dom.window.close()
})

test('in 全部 enrolments without badges fold into one row, and 精簡列 is remembered per list', async () => {
  const s = classPage()
  const calm = s.doc.querySelector('.edulog-roster-cards .edulog-calm-group')
  assert.equal(calm.querySelector('summary').textContent, '其他 2 位沒有特別狀態')
  assert.equal(calm.querySelector('details').open, false)
  assert.equal([...calm.querySelectorAll('.edulog-roster-card strong')].map(node => node.textContent).join('|'), '學生己|學生辛')
  chip(s.doc, 'low').click()
  assert.equal(s.doc.querySelector('.edulog-roster-cards .edulog-calm-group'), null, 'other chips list cards directly')
  const sent = []
  s.w.edulogRuntime = { send: async message => { sent.push(message); return { density: {} } } }
  const toggle = s.doc.querySelector('.edulog-table-tools .edulog-density-toggle')
  toggle.click()
  assert.equal(toggle.getAttribute('aria-pressed'), 'true')
  assert.equal(s.doc.querySelector('.edulog-roster-cards').dataset.edulogDensity, 'compact')
  assert.equal(JSON.stringify(sent), JSON.stringify([{ type: 'set-density', list: 'roster', density: 'compact' }]))
  assert.equal(s.view.density.roster, true)
  s.result.restore()
  assert.equal(s.doc.body.outerHTML, s.original)
  s.dom.window.close()
})
