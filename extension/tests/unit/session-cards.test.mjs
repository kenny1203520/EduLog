import test from 'node:test'
import { siteFiles } from '../site-files.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { JSDOM } from '../../../app/node_modules/jsdom/lib/api.js'

// tests/fixtures/real-class.html is de-identified but keeps the real class page structure:
// icon-based attendance/record state, <br> week headers, roster with remaining lessons,
// the provider's enable-lesson control and teaching-note popover.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function classPage() {
  const dom = new JSDOM(read('../fixtures/real-class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, original = w.document.body.outerHTML
  for (const file of siteFiles('lexicon', 'model', 'session-cards', 'workflows')) w.eval(read(`../../${file}`))
  w.eval(read('../../sites/orange-apple/core/adapter.js'))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { dom, w, doc: w.document, view, result, original }
}
const cards = doc => [...doc.querySelectorAll('.edulog-session-card:not([hidden])')]
const names = doc => cards(doc).map(card => card.querySelector('.edulog-row-name').textContent)
const card = (doc, name) => cards(doc).find(item => item.querySelector('.edulog-row-name').textContent === name)
const chip = (doc, key) => doc.querySelector(`[data-chip="${key}"]`)
const chipCounts = doc => Object.fromEntries([...doc.querySelectorAll('[data-chip]')].map(button => [button.dataset.chip, button.querySelector('.edulog-chip-count').textContent]))
const rowFor = (doc, name) => [...doc.querySelectorAll('#reports tbody tr')].find(row => row.cells[0]?.querySelector(':scope > span')?.textContent === name)

const statusOf = (doc, name) => [...card(doc, name).querySelectorAll('.edulog-card-status li')].map(item => `${item.dataset.tone}:${item.querySelector('.edulog-card-status-value').textContent}`).join(' ')
const tagsOf = (doc, name) => [...card(doc, name).querySelectorAll('.edulog-card-badges .edulog-badge')].map(node => node.textContent).join('|')

test('single-session mode opens on 待處理 for a due week and hides the native table and alert', () => {
  const s = classPage()
  assert.equal(s.doc.querySelector('.edulog-session-cards').hidden, false)
  assert.equal(s.doc.querySelector('[data-edulog-report-region]').getAttribute('data-edulog-cards'), 'on')
  assert.equal(s.doc.querySelector('.alert').hasAttribute('data-edulog-replaced'), true)
  assert.equal(JSON.stringify(chipCounts(s.doc)), JSON.stringify({ pending: '3', unmarked: '1', incomplete: '3', all: '7', attention: '3', leave: '1', done: '2', closed: '1', other: '1' }))
  assert.equal(chip(s.doc, 'pending').getAttribute('aria-pressed'), 'true')
  assert.equal(names(s.doc).join('|'), '學生甲|學生乙|學生辛')
  chip(s.doc, 'all').click()
  assert.equal(names(s.doc).join('|'), '學生丙|學生戊|學生庚|學生甲|學生乙|學生辛|學生丁')
  assert.equal(card(s.doc, '學生庚').dataset.group, 'danger')
  assert.equal(card(s.doc, '學生甲').dataset.group, 'warn')
  assert.equal(s.doc.querySelector('.edulog-session-cards').querySelectorAll('table').length, 0)
  s.dom.window.close()
})

test('four persistent chips; the rest live under 更多 and name the active filter', () => {
  const s = classPage()
  const bar = s.doc.querySelector('.edulog-filter-chips')
  assert.deepEqual([...bar.querySelectorAll(':scope > button')].map(button => button.dataset.chip), ['pending', 'unmarked', 'incomplete', 'all'])
  const more = bar.querySelector('.edulog-chip-more')
  assert.deepEqual([...more.querySelectorAll('[data-chip]')].map(button => button.dataset.chip), ['attention', 'leave', 'done', 'closed', 'other'])
  assert.equal(more.querySelector('summary').textContent, '更多')
  chip(s.doc, 'attention').click()
  assert.equal(names(s.doc).join('|'), '學生丙|學生戊|學生庚')
  assert.equal(more.querySelector('summary').textContent, '需關注')
  assert.equal(more.open, false)
  assert.equal(tagsOf(s.doc, '學生庚'), '跟不上進度|剩餘 1 堂')
  assert.equal(tagsOf(s.doc, '學生戊'), '課程已到期|暫停課程|原站未開放')
  chip(s.doc, 'incomplete').click()
  assert.equal(names(s.doc).join('|'), '學生甲|學生乙|學生辛')
  chip(s.doc, 'leave').click()
  assert.equal(names(s.doc).join('|'), '學生丙')
  chip(s.doc, 'closed').click()
  assert.equal(names(s.doc).join('|'), '學生戊')
  chip(s.doc, 'other').click()
  assert.equal(names(s.doc).join('|'), '學生己')
  s.doc.querySelector('[data-edulog-search="reports"]').value = '不存在'
  s.doc.querySelector('[data-edulog-search="reports"]').dispatchEvent(new s.w.Event('input'))
  assert.match(s.doc.querySelector('.edulog-cards-status').textContent, /沒有符合篩選的學生/)
  s.dom.window.close()
})

test('the four statuses are always shown as small indicators with words', () => {
  const s = classPage()
  chip(s.doc, 'all').click()
  assert.equal(statusOf(s.doc, '學生乙'), 'ok:已點名 warn:待確認 ok:已填 warn:未填')
  assert.equal(statusOf(s.doc, '學生辛'), 'ok:已點名 warn:未填 warn:未填 ok:已填')
  assert.equal(statusOf(s.doc, '學生庚'), 'ok:已點名 ok:已填 danger:跟不上 ok:已填')
  assert.equal(statusOf(s.doc, '學生丙'), 'danger:缺席 neutral:不適用 neutral:不適用 neutral:不適用')
  // Before attendance the report fields still show what is open.
  assert.equal(statusOf(s.doc, '學生甲'), 'warn:未點名 warn:未填 warn:未填 warn:未填')
  // No provider edit link: 原站未開放, never hidden.
  assert.equal(statusOf(s.doc, '學生戊'), 'neutral:原站未開放 neutral:原站未開放 neutral:原站未開放 neutral:原站未開放')
  assert.equal(card(s.doc, '學生丁').querySelector('.edulog-card-status').dataset.calm, 'true')
  assert.equal(card(s.doc, '學生乙').querySelector('.edulog-card-status').getAttribute('aria-label'), '學生乙 本堂狀態')
  assert.equal(card(s.doc, '學生乙').querySelector('[data-status="completion"]').getAttribute('aria-label'), '完成狀況：待確認')
  assert.deepEqual([...card(s.doc, '學生乙').querySelectorAll('.edulog-card-status-label')].map(node => node.textContent), ['出席', '完成狀況', '內部紀錄', '學習表現'])
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
  for (const item of cards(s.doc)) assert.ok(item.querySelectorAll('.edulog-card-primary').length <= 1, 'one primary action per row')
  primary('學生甲').click()
  assert.equal(clicks.at(-1), rowFor(s.doc, '學生甲').cells[4].querySelector('a[href$="/edit"]').getAttribute('href'))
  const enable = [...card(s.doc, '學生乙').querySelectorAll('button')].find(button => button.textContent === '啟用 L3')
  enable.click()
  assert.equal(clicks.at(-1), '啟用 L3')
  assert.equal(card(s.doc, '學生戊').querySelector('.edulog-card-actions > button'), null)
  assert.equal(card(s.doc, '學生戊').querySelector('.edulog-card-none').getAttribute('aria-label'), '學生戊 原站未開放填寫')
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

test('next week keeps statuses and fill actions, greys what is not due and opens on 全部', () => {
  const s = classPage()
  s.doc.querySelector('.edulog-week-tools [data-week="5"]').click()
  assert.equal(JSON.stringify(chipCounts(s.doc)), JSON.stringify({ pending: '0', unmarked: '5', incomplete: '5', all: '6', attention: '1', leave: '0', done: '0', closed: '1', other: '2' }))
  assert.equal(chip(s.doc, 'all').getAttribute('aria-pressed'), 'true')
  assert.equal(s.doc.querySelector('.edulog-session-cards').dataset.week, 'future')
  assert.match(s.doc.querySelector('.edulog-cards-status').textContent, /下週課次：可以先填寫紀錄/)
  assert.equal(statusOf(s.doc, '學生甲'), 'neutral:未點名 neutral:未填 neutral:未填 neutral:未填')
  assert.equal(card(s.doc, '學生甲').dataset.group, 'ok', 'nothing due next week: no amber bar')
  assert.equal(card(s.doc, '學生甲').querySelector('.edulog-card-actions > button').textContent, '點名與紀錄')
  assert.equal(s.doc.querySelectorAll('.edulog-session-card:not([hidden]) .edulog-card-status').length, 6)
  // Back to a due week: its own default (待處理) again.
  s.doc.querySelector('.edulog-week-tools [data-week="4"]').click()
  assert.equal(chip(s.doc, 'pending').getAttribute('aria-pressed'), 'true')
  s.doc.querySelector('[data-report-mode="compare"]').click()
  assert.equal(s.doc.querySelector('.edulog-session-cards').hidden, true)
  assert.equal(s.doc.querySelector('[data-edulog-report-region]').hasAttribute('data-edulog-cards'), false)
  s.dom.window.close()
})

test('a lesson that has not started yet is still due: statuses, actions and 待處理 stay', () => {
  const s = classPage()
  const session = s.w.edulogSiteSessionCards.readSession(s.doc.querySelector('#reports'), { index: 4, label: '本週(10/17)' }, new Map(), { notStarted: true })
  assert.equal(session.upcoming, false)
  assert.equal(session.notStarted, true)
  const counts = s.w.edulogSiteSessionCards.countChips(session.students)
  assert.equal(counts.pending, 3)
  assert.equal(s.w.edulogSiteSessionCards.defaultChip(counts, session), 'pending')
  assert.equal(s.doc.body.textContent.includes('本堂還沒開始上課'), false)
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
function withNotes(store, html = read('../fixtures/real-class.html')) {
  const dom = new JSDOM(html, { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, calls = []
  Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true })
  w.edulogRuntime = { send: async message => {
    calls.push(message)
    if (message.type === 'get-notes-seen') return { seen: Object.fromEntries(message.ids.map(id => [id, store[id] || null])) }
    if (message.type === 'note-seen') { store[message.id] = message.hash; return { ok: true } }
  } }
  for (const file of siteFiles('lexicon', 'model', 'session-cards', 'workflows')) w.eval(read(`../../${file}`))
  w.eval(read('../../sites/orange-apple/core/adapter.js'))
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
  const changed = withNotes(store, read('../fixtures/real-class.html').replaceAll('需留意作業進度', '本週改為線上上課'))
  chip(changed.doc, 'all').click(); await settle()
  assert.ok(card(changed.doc, '學生丙').querySelector('.edulog-note-alert'), 'changed content reminds again')
  changed.result.restore()
  assert.equal(changed.doc.querySelector('.edulog-note-alert'), null)
  changed.dom.window.close()
})

test('the lesson report page lists every student: no folded 狀態正常 row', () => {
  const s = classPage()
  chip(s.doc, 'all').click()
  assert.equal(s.doc.querySelector('.edulog-session-cards .edulog-calm-group'), null)
  const calm = cards(s.doc).filter(item => item.dataset.group === 'ok')
  assert.ok(calm.length > 0, 'calm students are shown as cards')
  for (const item of calm) assert.equal(item.parentElement, s.doc.querySelector('.edulog-session-cards > .edulog-card-list'))
  s.dom.window.close()
})

// 完成狀況's yellow icon is resolved by reading the saved report (same-origin GET, cached).
function classPageReading(report) {
  const dom = new JSDOM(read('../fixtures/real-class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, requests = []
  w.fetch = async url => {
    requests.push(String(url))
    if (!report) return { ok: false, status: 500, text: async () => '' }
    const option = report.status ? `<option value="${report.status}" selected></option>` : '<option value="" selected></option>'
    return { ok: true, status: 200, text: async () => `<form><select id="dt_admission_lesson_report_completion_status">${option}</select><input id="dt_admission_lesson_report_start_from" value="${report.from || ''}"><input id="dt_admission_lesson_report_end_to" value="${report.to || ''}"></form>` }
  }
  for (const file of siteFiles('lexicon', 'model', 'report-editor', 'session-cards', 'workflows')) w.eval(read(`../../${file}`))
  w.eval(read('../../sites/orange-apple/core/adapter.js'))
  w.edulogSiteAdapter.enhancePage(w.document, {})
  return { dom, w, doc: w.document, requests }
}
const completionOf = (doc, name) => statusOf(doc, name).split(' ')[1]
for (const [title, report, expected] of [
  ['尚未完成 with both chapters counts as filled', { status: 'not_all_done', from: '1', to: '3' }, 'ok:已填'],
  ['完整完成 without chapters asks for the chapters', { status: 'all_done' }, 'warn:章節未填'],
  ['尚未完成 without chapters asks for the chapters', { status: 'not_all_done', from: '2' }, 'warn:待補章節'],
  ['a failed read falls back to 待確認', null, 'warn:待確認'],
]) test(`yellow 完成狀況: ${title}`, async () => {
  const s = classPageReading(report)
  chip(s.doc, 'all').click()
  assert.match(completionOf(s.doc, '學生乙'), /^(warn:待確認|neutral:核對中)$/, 'unresolved until the report is read')
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(completionOf(s.doc, '學生乙'), expected)
  assert.ok(s.requests.length >= 1 && s.requests.every(url => /\/dt_admissions\/\d+\/reports\/\d+\/edit$/.test(new URL(url).pathname)), 'only report edit pages are read')
  const before = s.requests.length
  chip(s.doc, 'all').click(); await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(s.requests.length, before, 'each report is read once per page')
  s.dom.window.close()
})
test('provider placeholders L0 and "L? ?" are not shown as lesson progress', () => {
  const s = classPage()
  const known = s.w.edulogSiteSessionCards.knownLesson
  assert.equal(known('L0'), false); assert.equal(known('L? ?'), false); assert.equal(known(''), false); assert.equal(known('L12'), true)
  s.dom.window.close()
})
