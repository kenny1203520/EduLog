import test from 'node:test'
import { siteFiles } from '../site-files.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../../app/node_modules/jsdom/lib/api.js'

// fixtures/real-class.html this week (10/17): 甲 unmarked, 乙/丁/庚/辛 present, 丙 absent,
// 戊 paused, 己 not in this class. The quick-attendance form is injected as on the live page.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const ROSTER = [['學生甲', 7002], ['學生乙', 7005], ['學生丙', 7008], ['學生丁', 7011], ['學生庚', 7015], ['學生辛', 7017]]
const quickForm = (roster = ROSTER) => `<form action="/courses/dt/101/update_attendance" method="post"><table><tbody><tr>${roster.map(([n]) => `<th>${n}&nbsp;L2<br>課程(9)</th>`).join('')}</tr><tr>${roster.map(([, id]) => `<td><label><input name="report_ids[]" type="checkbox" value="${id}"></label></td>`).join('')}</tr><tr><th><button name="type" value="0">設定為出席</button><button id="set-leave-btn" name="type" value="1">設定為不出席</button></th></tr></tbody></table></form>`
function classPage({ roster, clipboard } = {}) {
  const dom = new JSDOM(read('../fixtures/real-class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  w.document.querySelector('.alert').insertAdjacentHTML('afterend', quickForm(roster))
  const copied = []
  if (clipboard !== false) Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { if (clipboard === 'reject') throw new Error('denied'); copied.push(text) } } })
  for (const file of siteFiles('lexicon', 'model', 'session-cards', 'attendance-export', 'quick-attendance', 'workflows')) w.eval(read(`../../${file}`))
  w.eval(read('../../sites/orange-apple/core/adapter.js'))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { dom, w, doc: w.document, view, result, copied }
}
const toolbarCopy = doc => doc.querySelector('.edulog-week-tools .edulog-copy-attendance button')
const quickCopy = doc => doc.querySelector('.edulog-quick-attendance .edulog-copy-attendance button')
const settle = w => new Promise(resolve => w.setTimeout(resolve, 0))
const THIS_WEEK = ['測試分校_201教室 - 週六 第 1 時段 (10:00 ~ 12:00)', '10/17 應出 6｜出席 4｜缺席 1｜未點名 1', '缺席：學生丙', '未點名：學生甲', '暫停：學生戊', '非本班：學生己'].join('\n')

test('the toolbar copy follows the selected week in single-session mode', async () => {
  const s = classPage()
  toolbarCopy(s.doc).click(); await settle(s.w)
  assert.equal(s.copied[0], THIS_WEEK)
  assert.equal(toolbarCopy(s.doc).textContent, '已複製')
  assert.match(s.doc.querySelector('.edulog-week-tools .edulog-copy-attendance [role=status]').textContent, /已複製/)
  s.dom.window.close()
})

test('three-week comparison copies one section per week', async () => {
  const s = classPage()
  s.doc.querySelector('[data-report-mode="compare"]').click()
  toolbarCopy(s.doc).click(); await settle(s.w)
  const dates = s.copied[0].split('\n').filter(line => /^\d+\/\d+ /.test(line)).map(line => line.split(' ')[0])
  assert.deepEqual(dates, ['10/10', '10/17', '10/24'])
  assert.equal(s.copied[0].split('\n\n').length, 3)
  // Next week has not happened, so it reads 尚未上課 rather than listing everyone as 未點名.
  const next = s.copied[0].split('\n\n')[2]
  assert.match(next, /^10\/24 尚未上課｜應出 \d+/)
  assert.doesNotMatch(next, /未點名/)
  s.dom.window.close()
})

test('the quick-attendance copy stays on its own week even when another week is selected', async () => {
  const s = classPage()
  s.doc.querySelector('[data-week]:not([aria-pressed="true"])').click()
  quickCopy(s.doc).click(); await settle(s.w)
  assert.equal(s.copied[0], THIS_WEEK)
  s.dom.window.close()
})

test('the copy stays reachable when the marked block is folded', () => {
  const s = classPage({ roster: ROSTER.filter(([name]) => name !== '學生甲') })
  const after = s.doc.querySelector('.edulog-quick-attendance > .edulog-qa-done-tools .edulog-copy-attendance button')
  assert.ok(after)
  assert.equal(after.closest('details'), null)
  s.dom.window.close()
})

test('without clipboard access the text is shown selected for copying by hand', async () => {
  for (const clipboard of [false, 'reject']) {
    const s = classPage({ clipboard })
    toolbarCopy(s.doc).click(); await settle(s.w)
    const area = s.doc.querySelector('.edulog-week-tools .edulog-copy-attendance textarea')
    assert.equal(area.hidden, false)
    assert.equal(area.value, THIS_WEEK)
    assert.match(s.doc.querySelector('.edulog-week-tools .edulog-copy-attendance [role=status]').textContent, /手動複製/)
    s.dom.window.close()
  }
})

test('restore removes both copy buttons', () => {
  const s = classPage()
  assert.equal(s.doc.querySelectorAll('.edulog-copy-attendance').length, 2)
  s.result.restore()
  assert.equal(s.doc.querySelectorAll('.edulog-copy-attendance').length, 0)
  s.dom.window.close()
})

test('toText leaves out zero-count name lines', () => {
  const { dom } = classPage()
  const text = dom.window.edulogSiteAttendanceExport.toText({ title: '', weeks: [{ date: '10/17', students: [{ name: '甲', status: '出席' }, { name: '乙', status: '出席' }] }] })
  assert.equal(text, '10/17 應出 2｜出席 2｜缺席 0｜未點名 0')
  dom.window.close()
})
