import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
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

const statusOf = (doc, name) => [...card(doc, name).querySelectorAll('.edulog-card-status li')].map(item => `${item.dataset.tone}:${item.querySelector('.edulog-card-status-value').textContent}`).join(' ')

test('single-session mode shows cards for what needs action and hides the native table and alert', () => {
  const s = classPage()
  assert.equal(s.doc.querySelector('.edulog-session-cards').hidden, false)
  assert.equal(s.doc.querySelector('[data-edulog-report-region]').getAttribute('data-edulog-cards'), 'on')
  assert.equal(s.doc.querySelector('.alert').hasAttribute('data-edulog-replaced'), true)
  assert.equal(JSON.stringify(chipCounts(s.doc)), JSON.stringify({ pending: '4', attention: '3', unmarked: '1', incomplete: '2', all: '7', other: '1' }))
  assert.equal(chip(s.doc, 'pending').getAttribute('aria-pressed'), 'true')
  assert.equal(names(s.doc).join('|'), '學生庚|學生甲|學生乙|學生辛')
  assert.equal(card(s.doc, '學生庚').dataset.group, 'danger')
  assert.equal(s.doc.querySelector('.edulog-session-cards').querySelectorAll('table').length, 0)
  s.dom.window.close()
})

test('chips separate what to fill in from student concerns, with concerns first', () => {
  const s = classPage()
  chip(s.doc, 'all').click()
  assert.equal(names(s.doc).join('|'), '學生丙|學生戊|學生庚|學生甲|學生乙|學生辛|學生丁')
  chip(s.doc, 'attention').click()
  assert.equal(names(s.doc).join('|'), '學生丙|學生戊|學生庚')
  assert.equal([...card(s.doc, '學生庚').querySelectorAll('.edulog-badge')].map(node => node.textContent).join('|'), '跟不上進度|剩餘 1 堂')
  assert.match(card(s.doc, '學生戊').textContent, /課程已到期/)
  chip(s.doc, 'incomplete').click()
  assert.equal(names(s.doc).join('|'), '學生乙|學生辛')
  chip(s.doc, 'other').click()
  assert.equal(names(s.doc).join('|'), '學生己')
  s.doc.querySelector('[data-edulog-search="reports"]').value = '不存在'
  s.doc.querySelector('[data-edulog-search="reports"]').dispatchEvent(new s.w.Event('input'))
  assert.match(s.doc.querySelector('.edulog-cards-status').textContent, /沒有符合篩選的學生/)
  s.dom.window.close()
})

test('the four-cell status row reads the confirmed icon meanings', () => {
  const s = classPage()
  chip(s.doc, 'all').click()
  assert.equal(statusOf(s.doc, '學生乙'), 'ok:出席 warn:待確認 ok:跟得上 warn:未完成')
  assert.equal(statusOf(s.doc, '學生辛'), 'ok:出席 warn:未填 warn:未選 ok:已完成')
  assert.equal(statusOf(s.doc, '學生庚'), 'ok:出席 ok:完整完成 danger:跟不上 ok:已完成')
  assert.equal(statusOf(s.doc, '學生丙'), 'danger:缺席 neutral:不適用 neutral:不適用 neutral:不適用')
  assert.equal(statusOf(s.doc, '學生甲'), 'warn:未點名 neutral:— neutral:— neutral:—')
  assert.equal(card(s.doc, '學生丁').querySelector('.edulog-card-status').dataset.calm, 'true')
  assert.equal(card(s.doc, '學生戊').querySelector('.edulog-card-status'), null)
  assert.equal(card(s.doc, '學生乙').querySelector('.edulog-card-status').getAttribute('aria-label'), '學生乙 本堂狀態')
  s.dom.window.close()
})

test('the main action follows the session state and clicks the native control', () => {
  const s = classPage()
  chip(s.doc, 'all').click()
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
  chip(s.doc, 'all').click()
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
  assert.equal(JSON.stringify(chipCounts(s.doc)), JSON.stringify({ pending: '0', attention: '1', unmarked: '0', incomplete: '0', all: '6', other: '2' }))
  assert.equal(chip(s.doc, 'attention').getAttribute('aria-pressed'), 'true')
  assert.match(s.doc.querySelector('.edulog-cards-status').textContent, /下週課次尚未開始/)
  assert.equal(card(s.doc, '學生甲'), undefined)
  s.doc.querySelector('[data-report-mode="compare"]').click()
  assert.equal(s.doc.querySelector('.edulog-session-cards').hidden, true)
  assert.equal(s.doc.querySelector('[data-edulog-report-region]').hasAttribute('data-edulog-cards'), false)
  s.dom.window.close()
})

test('restore returns the exact original page, including the moved last-teaching panel', () => {
  const s = classPage()
  chip(s.doc, 'all').click()
  assert.ok(card(s.doc, '學生甲').querySelector('.edulog-card-detail .edulog-last-teaching-panel'))
  s.result.restore()
  assert.equal(s.doc.body.outerHTML, s.original)
  s.dom.window.close()
})

// Teaching-note reminders need the runtime bridge and Web Crypto; both are stubbed here.
function withNotes(store, html = read('fixtures/real-class.html')) {
  const dom = new JSDOM(html, { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, calls = []
  Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true })
  w.edulogRuntime = { send: async message => {
    calls.push(message)
    if (message.type === 'get-notes-seen') return { seen: Object.fromEntries(message.ids.map(id => [id, store[id] || null])) }
    if (message.type === 'note-seen') { store[message.id] = message.hash; return { ok: true } }
  } }
  for (const file of ['lexicon', 'model', 'session-cards', 'workflows']) w.eval(read(`../adapters/orange-apple-${file}.js`))
  w.eval(read('../adapters/orange-apple.js'))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { dom, w, doc: w.document, calls, result }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30))

test('a teaching note with unseen content shows a reminder until it is opened', async () => {
  const store = {}
  const s = withNotes(store)
  chip(s.doc, 'all').click(); await settle()
  const alert = card(s.doc, '學生丙').querySelector('.edulog-note-alert')
  assert.ok(alert, 'unseen note shows a reminder')
  assert.equal(alert.textContent, '新教學備註')
  assert.equal(card(s.doc, '學生甲').querySelector('.edulog-note-alert'), null, 'no reminder without note content')
  let opened = 0
  rowFor(s.doc, '學生丙').querySelector('a.admission-comment').addEventListener('click', event => { event.preventDefault(); opened++ })
  alert.click(); await settle()
  assert.equal(opened, 1)
  assert.equal(card(s.doc, '學生丙').querySelector('.edulog-note-alert'), null)
  assert.match(store['9003'], /^[0-9a-f]{64}$/)
  assert.equal(JSON.stringify(s.calls).includes('需留意作業進度'), false, 'note text never leaves the page')
  s.dom.window.close()
  const again = withNotes(store)
  chip(again.doc, 'all').click(); await settle()
  assert.equal(card(again.doc, '學生丙').querySelector('.edulog-note-alert'), null, 'seen content stays quiet')
  again.dom.window.close()
  const changed = withNotes(store, read('fixtures/real-class.html').replaceAll('需留意作業進度', '本週改為線上上課'))
  chip(changed.doc, 'all').click(); await settle()
  assert.ok(card(changed.doc, '學生丙').querySelector('.edulog-note-alert'), 'changed content reminds again')
  changed.result.restore()
  assert.equal(changed.doc.querySelector('.edulog-note-alert'), null)
  changed.dom.window.close()
})
