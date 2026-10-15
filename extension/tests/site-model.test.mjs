import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function load(html = '<!doctype html><body></body>', path = '/') {
  const dom = new JSDOM(html, { url: `https://corp.orangeapple.co${path}`, runScripts: 'outside-only' })
  for (const file of ['lexicon', 'model']) dom.window.eval(read(`../adapters/orange-apple-${file}.js`))
  return { dom, doc: dom.window.document, model: dom.window.edulogSiteModel, lexicon: dom.window.edulogSiteLexicon }
}

test('every lexicon route resolves to one page kind', () => {
  const { model, dom } = load()
  const samples = { '/': 'overview', '/my/hour': 'hours', '/my': 'profile', '/my/7/edit': 'profile-edit', '/courses/dt': 'classes', '/calendar': 'calendar', '/admissions/month_unfilled_report': 'unfilled', '/admissions/unfilled_report': 'unfilled-current', '/dt_admissions/5/reports/9/edit': 'report-editor', '/dt_admissions/5': 'history', '/courses/dt/101': 'class', '/courses/dt/101/lesson_reports': 'reports' }
  for (const [path, kind] of Object.entries(samples)) assert.equal(model.matchPage(path)?.kind, kind, path)
  assert.equal(model.matchPage('/calendar/2026'), null)
  assert.equal(model.matchPage('/admin'), null)
  dom.window.close()
})

test('session text classification separates pending, known and other-session states', () => {
  const { model, dom } = load()
  const pending = model.classifySession('第 3 週 (L12) 待確認出席 未填寫')
  assert.equal(pending.attendancePending, true)
  assert.equal(pending.attendanceKnown, false)
  assert.equal(pending.reportPending, true)
  assert.equal(pending.scheduledLesson, 'L12')
  assert.equal(pending.statusKnown, true)
  const done = model.classifySession('出席 已填寫課堂紀錄 已啟用 L4')
  assert.equal(done.attendanceKnown, true)
  assert.equal(done.reportKnown, true)
  assert.equal(done.enabledLesson, 'L4')
  const other = model.classifySession('此週非本班學生')
  assert.equal(other.otherSession, true)
  assert.equal(other.courseStatus, '此週非本班學生')
  const blank = model.classifySession('')
  assert.equal(blank.statusKnown, false)
  assert.equal(blank.courseStatus, null)
  dom.window.close()
})

test('session text ignores links, controls and extension-owned nodes', () => {
  const { model, doc, dom } = load('<!doctype html><table><tr><td> 缺席 <a href="/x">未填寫</a><button>停課</button><span data-edulog-owned>已完課</span>\n 第 1 週 </td></tr></table>')
  assert.equal(model.sessionText(doc.querySelector('td')), '缺席 第 1 週')
  assert.equal(model.sessionText(null), '')
  dom.window.close()
})

test('week columns prefer the requested index, then this week, then the first week', () => {
  const { model, doc, dom } = load('<!doctype html><table><tr><th>學生</th><th>上週\n10/7</th><th>本週 10/14</th><th>下週</th></tr></table>')
  const weeks = model.readWeekColumns(doc.querySelector('tr').cells)
  assert.equal(JSON.stringify(weeks.map(week => [week.index, week.label])), JSON.stringify([[1, '上週 10/7'], [2, '本週 10/14'], [3, '下週']]))
  assert.equal(model.pickWeek(weeks, 3).index, 3)
  assert.equal(model.pickWeek(weeks, 9).index, 2)
  assert.equal(model.pickWeek(weeks.filter(week => week.index !== 2)).index, 1)
  assert.equal(model.pickWeek([]), null)
  dom.window.close()
})

test('health check reports denied pages and missing provider structure', () => {
  const reports = load(read('fixtures/reports.html'), '/courses/dt/101/lesson_reports')
  assert.equal(JSON.stringify(reports.model.checkPage(reports.doc, 'reports')), JSON.stringify({ ok: true, reason: null, missing: [] }))
  reports.doc.querySelector('#reports').remove()
  const broken = reports.model.checkPage(reports.doc, 'reports')
  assert.equal(broken.ok, false)
  assert.equal(broken.reason, 'missing')
  assert.deepEqual([...broken.missing], ['#reports'])
  reports.dom.window.close()
  const denied = load('<!doctype html><div id="page-body"><div class="content"><h1>沒有存取權限</h1></div></div>', '/courses/dt/101')
  assert.equal(denied.model.checkPage(denied.doc, 'class').reason, 'denied')
  denied.dom.window.close()
  const empty = load('<!doctype html><div id="page-body"></div>', '/courses/dt')
  assert.deepEqual([...empty.model.checkPage(empty.doc, 'classes').missing], ['#page-body > .content'])
  empty.dom.window.close()
})

test('session icons map to attendance, completion, internal record and performance in either icon form', () => {
  const svg = (name, tone) => `<span class="text-${tone}"><svg class="svg-inline--fa fa-${name}"></svg></span>`
  const { model, doc, dom } = load(`<!doctype html><table><tr>
    <td id="a">第 3 週(L3)${svg('user', 'success')}${svg('pencil', 'warning')}${svg('circle-question', 'danger')}${svg('comment-dots', 'secondary')}</td>
    <td id="b">L4<span class="text-secondary"><i class="fa fa-user"></i></span><span class="text-secondary"><i class="fa fa-pencil"></i></span><span class="text-secondary"><i class="fa fa-question-circle"></i></span><span class="text-secondary"><i class="fa fa-commenting"></i></span></td>
    <td id="c">${svg('user', 'danger')}${svg('pencil', 'secondary')}${svg('circle-question', 'secondary')}${svg('comment-dots', 'secondary')}</td>
  </tr></table>`)
  const a = model.readSessionCell(doc.getElementById('a'))
  assert.equal(JSON.stringify([a.attendanceMark, a.completionMark, a.internalMark, a.performanceMark, a.behind, [...a.missing].join(','), a.report]), JSON.stringify(['present', 'check', 'behind', 'empty', true, 'completionCheck,performanceEmpty', '資料未齊']))
  const upcoming = model.readSessionCell(doc.getElementById('b'), { upcoming: true })
  assert.equal(JSON.stringify([upcoming.attendancePending, upcoming.reportPending, upcoming.missing.length]), JSON.stringify([false, false, 0]))
  const absent = model.readSessionCell(doc.getElementById('c'))
  assert.equal(JSON.stringify([absent.attendanceMark, absent.reportPending, absent.missing.length, absent.behind]), JSON.stringify(['absent', false, 0, false]))
  dom.window.close()
})

test('class schedule and session start come from the class name and the week header', () => {
  const { model, dom } = load()
  const schedule = model.classSchedule('樹林_非凡文理_201教室（菁英） - 週六 第 2 時段 (9:30 ~ 11:30)')
  assert.equal(JSON.stringify(schedule), JSON.stringify({ weekday: 6, weekdayLabel: '週六', start: '09:30', end: '11:30', branch: '樹林 非凡文理', room: '201教室（菁英）' }))
  assert.equal(model.classSchedule('特殊班級名稱'), null)
  const at = text => new Date(text)
  assert.equal(model.sessionStarted('本週(10/17)', '09:30', at('2026-10-15T12:00:00')), false, 'Thursday before a Saturday class')
  assert.equal(model.sessionStarted('本週(10/17)', '09:30', at('2026-10-17T09:29:00')), false, 'one minute before the start')
  assert.equal(model.sessionStarted('本週(10/17)', '09:30', at('2026-10-17T09:30:00')), true, 'at the start time')
  assert.equal(model.sessionStarted('上週(10/10)', '09:30', at('2026-10-15T12:00:00')), true)
  assert.equal(model.weekDate('本週(1/2)', at('2026-12-30T12:00:00')).getFullYear(), 2027, 'the year closest to now')
  assert.equal(model.sessionStarted('本週', '09:30', at('2026-10-15T12:00:00')), null, 'unknown date')
  dom.window.close()
})
