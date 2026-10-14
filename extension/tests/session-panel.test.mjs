import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// tests/fixtures/real-class.html is de-identified but keeps the real class page structure:
// icon-based attendance/record state, <br> week headers, roster with remaining lessons.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function classPage() {
  const dom = new JSDOM(read('fixtures/real-class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  for (const file of ['lexicon', 'model', 'session-panel', 'workflows']) w.eval(read(`../adapters/orange-apple-${file}.js`))
  w.eval(read('../adapters/orange-apple.js'))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { dom, w, doc: w.document, view, result }
}
const panel = doc => doc.querySelector('.edulog-session-panel')
const names = doc => [...panel(doc).querySelectorAll('.edulog-todo-main strong')].map(node => node.textContent)
const badges = doc => [...panel(doc).querySelectorAll('.edulog-todo-item')].map(item => [...item.querySelectorAll('.edulog-badge')].map(node => node.textContent).join('+'))
const rowFor = (doc, name) => [...doc.querySelectorAll('#reports tbody tr')].find(row => row.cells[0]?.querySelector(':scope > span')?.textContent === name)

test('icon state is read from the real session markup', () => {
  const s = classPage(), model = s.w.edulogSiteModel
  const cell = name => rowFor(s.doc, name).cells[4]
  const states = ['學生甲', '學生乙', '學生丙', '學生丁'].map(name => { const state = model.readSessionCell(cell(name)); return [state.attendanceMark, state.recordMark, state.attendancePending, state.reportPending, state.recordCreated] })
  assert.equal(JSON.stringify(states), JSON.stringify([['unmarked', 'unwritten', true, false, false], ['present', 'unwritten', false, true, true], ['absent', 'unwritten', false, false, true], ['present', 'written', false, false, true]]))
  const upcoming = model.readSessionCell(rowFor(s.doc, '學生甲').cells[5], { upcoming: true })
  assert.equal(JSON.stringify([upcoming.attendancePending, upcoming.reportPending, upcoming.attendance]), JSON.stringify([false, false, '尚未上課']))
  assert.equal(model.readSessionCell(rowFor(s.doc, '學生己').cells[4]).otherSession, true)
  s.dom.window.close()
})

test('the panel lists only students needing action in the selected session, most urgent first', () => {
  const s = classPage()
  const tools = s.doc.querySelector('[data-edulog-search="reports"]').closest('.edulog-table-tools')
  assert.equal(panel(s.doc).nextElementSibling, tools)
  assert.equal(panel(s.doc).querySelector('.edulog-session-panel-week').textContent, '本週(10/17)')
  assert.equal(names(s.doc).join('|'), '學生丙|學生戊|學生甲|學生乙|學生庚')
  assert.equal(badges(s.doc).join('|'), '缺席|課程已到期|尚未點名|紀錄未填|剩餘 1 堂')
  assert.equal(panel(s.doc).querySelector('.edulog-todo-count').textContent, '5')
  assert.match(panel(s.doc).textContent, /其餘 1 位本堂學生已處理完成/)
  assert.match(panel(s.doc).textContent, /另有 1 位非本堂學生/)
  assert.equal(panel(s.doc).querySelectorAll('table').length, 0)
  s.dom.window.close()
})

test('panel actions reuse the native record link and switching weeks re-reads the session', () => {
  const s = classPage()
  const native = rowFor(s.doc, '學生甲').cells[4].querySelector('a[href$="/edit"]')
  let clicked = 0
  native.addEventListener('click', event => { event.preventDefault(); clicked++ })
  const item = [...panel(s.doc).querySelectorAll('.edulog-todo-item')].find(node => node.textContent.includes('學生甲'))
  item.querySelector('button').click()
  assert.equal(clicked, 1)
  assert.equal(item.querySelector('a').getAttribute('href'), '/dt_admissions/9001')
  s.doc.querySelector('.edulog-week-tools [data-week="5"]').click()
  assert.equal(panel(s.doc).querySelector('.edulog-session-panel-week').textContent, '下週(10/24)')
  assert.equal(names(s.doc).join('|'), '學生戊')
  assert.match(panel(s.doc).textContent, /下週課次尚未開始/)
  s.doc.querySelector('.edulog-week-tools [data-week="3"]').click()
  assert.equal(names(s.doc).join('|'), '學生丙|學生戊|學生庚')
  s.dom.window.close()
})

test('icon state feeds the existing counts and per-session summaries; restore removes the panel', () => {
  const s = classPage()
  const counts = s.doc.querySelector('[data-edulog-search="reports"]').closest('.edulog-table-tools').querySelector('[role="status"]').textContent.replace(/\s+/g, ' ')
  assert.match(counts, /已確認出席 4 /)
  assert.match(counts, /已填紀錄 2 /)
  assert.match(rowFor(s.doc, '學生丙').cells[4].textContent, /出席狀態\s*缺席/)
  assert.match(rowFor(s.doc, '學生甲').cells[4].textContent, /出席狀態\s*尚未點名/)
  s.result.restore()
  assert.equal(s.doc.querySelector('.edulog-session-panel'), null)
  s.dom.window.close()
})
