import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// tests/fixtures/real-class.html is de-identified but keeps the real class page structure:
// icon-based attendance/record state, <br> week headers, roster with remaining lessons,
// the provider's enable-lesson control and teaching-note popover.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function classPage() {
  const dom = new JSDOM(read('fixtures/real-class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, original = w.document.body.outerHTML
  for (const file of ['lexicon', 'model', 'session-cards', 'workflows']) w.eval(read(`../adapters/orange-apple-${file}.js`))
  w.eval(read('../adapters/orange-apple.js'))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { dom, w, doc: w.document, view, result, original }
}
const cards = doc => [...doc.querySelectorAll('.edulog-session-card')]
const names = doc => cards(doc).map(card => card.querySelector('.edulog-card-main strong').textContent)
const card = (doc, name) => cards(doc).find(item => item.querySelector('.edulog-card-main strong').textContent === name)
const chip = (doc, key) => doc.querySelector(`[data-chip="${key}"]`)
const chipCounts = doc => Object.fromEntries([...doc.querySelectorAll('[data-chip]')].map(button => [button.dataset.chip, button.querySelector('.edulog-chip-count').textContent]))
const rowFor = (doc, name) => [...doc.querySelectorAll('#reports tbody tr')].find(row => row.cells[0]?.querySelector(':scope > span')?.textContent === name)

test('single-session mode shows cards for what needs action and hides the native table and alert', () => {
  const s = classPage()
  assert.equal(s.doc.querySelector('.edulog-session-cards').hidden, false)
  assert.equal(s.doc.querySelector('[data-edulog-report-region]').getAttribute('data-edulog-cards'), 'on')
  assert.equal(s.doc.querySelector('.alert').hasAttribute('data-edulog-replaced'), true)
  assert.equal(JSON.stringify(chipCounts(s.doc)), JSON.stringify({ pending: '5', absent: '1', unmarked: '1', unwritten: '1', all: '6', other: '1' }))
  assert.equal(chip(s.doc, 'pending').getAttribute('aria-pressed'), 'true')
  assert.equal(names(s.doc).join('|'), '學生丙|學生戊|學生甲|學生乙|學生庚')
  assert.equal(card(s.doc, '學生丙').dataset.group, 'danger')
  assert.equal(s.doc.querySelector('.edulog-session-cards').querySelectorAll('table').length, 0)
  s.dom.window.close()
})

test('chips switch the list, keep exceptions first, and put paused and other-session students last', () => {
  const s = classPage()
  chip(s.doc, 'all').click()
  assert.equal(names(s.doc).join('|'), '學生丙|學生戊|學生甲|學生乙|學生庚|學生丁')
  assert.match(card(s.doc, '學生丁').textContent, /已出席 · 紀錄已填/)
  assert.match(card(s.doc, '學生戊').textContent, /課程已到期/)
  chip(s.doc, 'other').click()
  assert.equal(names(s.doc).join('|'), '學生己')
  assert.match(card(s.doc, '學生己').textContent, /非本堂/)
  chip(s.doc, 'unwritten').click()
  assert.equal(names(s.doc).join('|'), '學生乙')
  s.doc.querySelector('[data-edulog-search="reports"]').value = '不存在'
  s.doc.querySelector('[data-edulog-search="reports"]').dispatchEvent(new s.w.Event('input'))
  assert.match(s.doc.querySelector('.edulog-cards-status').textContent, /沒有符合篩選的學生/)
  s.dom.window.close()
})

test('the main action follows the session state and clicks the native control', () => {
  const s = classPage()
  const clicks = []
  for (const link of s.doc.querySelectorAll('#reports a, #reports .enable-ks-lesson-btn')) link.addEventListener('click', event => { event.preventDefault(); clicks.push(link.getAttribute('href') || link.textContent) })
  const primary = name => card(s.doc, name).querySelector('.edulog-card-actions > button')
  assert.equal(primary('學生甲').textContent, '點名與紀錄')
  assert.equal(primary('學生甲').className, 'edulog-card-primary')
  assert.match(card(s.doc, '學生甲').textContent, /啟用需先點名/)
  assert.equal(primary('學生乙').textContent, '填寫紀錄')
  assert.equal(primary('學生丙').textContent, '查看紀錄')
  assert.equal(primary('學生丙').className, 'edulog-card-secondary')
  primary('學生甲').click()
  assert.equal(clicks.at(-1), rowFor(s.doc, '學生甲').cells[4].querySelector('a[href$="/edit"]').getAttribute('href'))
  const enable = [...card(s.doc, '學生乙').querySelectorAll('button')].find(button => button.textContent === '啟用 L3')
  enable.click()
  assert.equal(clicks.at(-1), '啟用 L3')
  assert.equal(card(s.doc, '學生戊').querySelector('.edulog-card-actions > button'), null)
  s.dom.window.close()
})

test('the more menu proxies secondary provider actions and shows attendance stats', () => {
  const s = classPage()
  const target = card(s.doc, '學生丙'), clicks = []
  for (const link of rowFor(s.doc, '學生丙').querySelectorAll('a')) link.addEventListener('click', event => { event.preventDefault(); clicks.push(link.textContent.trim() || link.className) })
  assert.ok(target.querySelector('.edulog-card-main [aria-label="有教學備註"]'))
  assert.equal(card(s.doc, '學生甲').querySelector('[aria-label="有教學備註"]'), null)
  const menu = target.querySelector('.edulog-card-menu')
  assert.equal([...menu.querySelectorAll('a,button')].map(item => item.textContent).join('|'), '完整紀錄|上次教學|教學備註|學生總評|學習帳號設定|專案檢查')
  assert.equal(menu.querySelector('a').getAttribute('href'), '/dt_admissions/9003')
  assert.equal([...menu.querySelectorAll('a')].at(-1).getAttribute('rel'), 'noopener noreferrer')
  assert.match(menu.textContent, /出席 3 · 缺 1 · 未記 2/)
  ;[...menu.querySelectorAll('button')].find(button => button.textContent === '學生總評').click()
  assert.equal(clicks.at(-1), '學生總評')
  s.dom.window.close()
})

test('next week and compare mode: upcoming sessions are not pending; compare shows the native table', () => {
  const s = classPage()
  s.doc.querySelector('.edulog-week-tools [data-week="5"]').click()
  assert.equal(JSON.stringify(chipCounts(s.doc)), JSON.stringify({ pending: '1', absent: '0', unmarked: '0', unwritten: '0', all: '5', other: '2' }))
  assert.match(s.doc.querySelector('.edulog-cards-status').textContent, /下週課次尚未開始/)
  assert.equal(card(s.doc, '學生甲'), undefined)
  s.doc.querySelector('[data-report-mode="compare"]').click()
  assert.equal(s.doc.querySelector('.edulog-session-cards').hidden, true)
  assert.equal(s.doc.querySelector('[data-edulog-report-region]').hasAttribute('data-edulog-cards'), false)
  s.dom.window.close()
})

test('restore returns the exact original page, including the moved last-teaching panel', () => {
  const s = classPage()
  assert.ok(card(s.doc, '學生甲').querySelector('.edulog-card-detail .edulog-last-teaching-panel'))
  s.result.restore()
  assert.equal(s.doc.body.outerHTML, s.original)
  s.dom.window.close()
})
