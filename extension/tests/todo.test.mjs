import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const withRows = (html, rows) => html.replace('<tbody></tbody>', `<tbody>${rows}</tbody>`)
const overdueRow = '<tr><td><a href="/dt_admissions/309">學生丙</a><small>課程丙</small></td><td>週一第 1 時段</td><td>週一第 1 時段</td><td><a class="btn" href="/courses/dt/102/lesson_reports?student_id=309">填寫課堂紀錄</a></td></tr>'
const absentReports = read('fixtures/reports.html').replace('<td>暫停課程</td>', '<td>缺席</td>').replace('<span id="report_status_401">已啟用</span>', '<span id="report_status_401">待確認出席</span>')
function pages(overrides = {}) {
  return {
    '/admissions/unfilled_report': read('fixtures/unfilled-current.html'),
    '/admissions/month_unfilled_report': withRows(read('fixtures/unfilled.html'), overdueRow),
    '/calendar': read('fixtures/calendar.html'),
    '/my/hour': read('fixtures/hours.html'),
    '/courses/dt/101/lesson_reports': absentReports,
    '/courses/dt/102/lesson_reports': read('fixtures/reports.html'),
    ...overrides,
  }
}
function overview(responses = pages()) {
  const dom = new JSDOM(read('fixtures/overview.html'), { url: 'https://corp.orangeapple.co/', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, requests = []
  w.fetch = async (url, options) => {
    const path = new URL(url).pathname
    requests.push({ path, options })
    const body = responses[path]
    if (body instanceof Error) throw body
    if (body === undefined) return { ok: false, headers: { get: () => 'text/html' }, text: async () => '' }
    return { ok: true, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => body }
  }
  for (const file of ['lexicon', 'model', 'todo', 'workflows']) w.eval(read(`../adapters/orange-apple-${file}.js`))
  w.eval(read('../adapters/orange-apple.js'))
  w.edulogSiteTodo.clearCache()
  return { dom, w, doc: w.document, requests, enhance: (view = {}) => { const result = w.edulogSiteAdapter.enhancePage(w.document, view); return { result, view } } }
}
const section = (doc, key) => doc.querySelector(`[data-edulog-todo="${key}"]`)
const texts = (doc, key, selector) => [...section(doc, key).querySelectorAll(selector)].map(node => node.textContent)

test('readers extract unfilled, calendar, hours and attendance facts from provider pages', () => {
  const { w, dom } = overview()
  const parse = html => new w.DOMParser().parseFromString(html, 'text/html')
  const todo = w.edulogSiteTodo
  const current = todo.extractUnfilled(parse(read('fixtures/unfilled-current.html')), false)
  assert.equal(JSON.stringify(current.map(item => [item.student, item.course, item.studentPath, item.action])), JSON.stringify([['學生甲', '課程甲', '/dt_admissions/301', '/courses/dt/101/lesson_reports?student_id=301'], ['學生乙', '課程乙', '/dt_admissions/302', '/courses/dt/101/lesson_reports?student_id=302']]))
  assert.equal(current[0].slot, '週六第 2 時段 (13:00 ~ 15:00)')
  assert.equal(todo.extractUnfilled(parse(read('fixtures/unfilled.html')), true).length, 0)
  assert.throws(() => todo.extractUnfilled(parse(read('fixtures/hours.html')), true), /版面已變更/)
  const days = todo.extractCalendar(parse(read('fixtures/calendar.html')), ['/courses/dt/101'])
  assert.equal(JSON.stringify(days.map(day => [day.label, day.entries.map(entry => [entry.time, entry.room, entry.classPath])])), JSON.stringify([['10/04 (Sun.)', [['10:00', '測試教室', '/courses/dt/101']]], ['10/05 (Mon.)', []]]))
  assert.equal(todo.extractCalendar(parse(read('fixtures/calendar.html')), ['/courses/dt/999'])[0].entries.length, 0)
  assert.equal(JSON.stringify(todo.extractHours(parse(read('fixtures/hours.html')))), JSON.stringify({ period: '2026年 9月', records: 1, total: null }))
  const attendance = todo.extractAttendance(parse(absentReports))
  assert.equal(attendance.week, '本週 (10/04)')
  assert.equal(JSON.stringify(attendance.items), JSON.stringify([{ student: '測試學生 A', status: 'pending', label: '待確認出席' }, { student: '測試學生 B', status: 'absent', label: '缺席' }]))
  assert.equal(todo.extractAttendance(parse(read('fixtures/reports.html'))).items.length, 0)
  dom.window.close()
})

test('overview leads with the weekly to-do and renders every section exceptions-first', async () => {
  const s = overview()
  const { result, view } = s.enhance()
  const root = s.doc.querySelector('.edulog-todo')
  assert.equal(s.doc.querySelector('#page-body > .content').firstElementChild, root)
  assert.equal(section(s.doc, 'reports').getAttribute('aria-busy'), 'true')
  await view.todo.ready
  assert.equal(texts(s.doc, 'reports', '.edulog-todo-main strong').join('|'), '學生丙|學生甲|學生乙')
  assert.equal(texts(s.doc, 'reports', '.edulog-badge').join('|'), '逾期未填|待補填|待補填')
  assert.equal(section(s.doc, 'reports').querySelector('.edulog-todo-count').textContent, '3')
  assert.equal(section(s.doc, 'reports').querySelector('.edulog-todo-action').getAttribute('href'), '/courses/dt/102/lesson_reports?student_id=309')
  assert.equal(texts(s.doc, 'schedule', '.edulog-todo-main strong').join('|'), '10/04 (Sun.) 10:00')
  assert.equal(texts(s.doc, 'schedule', '.edulog-todo-meta').join('|'), '測試班級 A · 測試教室')
  assert.equal(texts(s.doc, 'attendance', '.edulog-todo-main strong').join('|'), '測試學生 B|測試學生 A')
  assert.equal(texts(s.doc, 'attendance', '.edulog-badge').join('|'), '缺席|待確認出席')
  assert.match(section(s.doc, 'hours').textContent, /2026年 9月 1 筆鐘點紀錄/)
  assert.match(s.doc.querySelector('.edulog-todo-updated').textContent, /^更新於 \d\d:\d\d$/)
  assert.equal(root.querySelectorAll('table').length, 0)
  assert.ok(root.querySelectorAll('svg[aria-hidden="true"]').length >= 5)
  for (const request of s.requests) assert.equal(JSON.stringify([request.options.credentials, request.options.redirect]), '["same-origin","error"]')
  result.restore()
  assert.equal(s.doc.querySelector('.edulog-todo'), null)
  s.dom.window.close()
})

test('sections fail independently and retry without reloading the others', async () => {
  const responses = pages({ '/calendar': new Error('offline') })
  const s = overview(responses)
  const { view } = s.enhance()
  await view.todo.ready
  assert.match(section(s.doc, 'schedule').textContent, /讀取失敗/)
  assert.equal(texts(s.doc, 'reports', '.edulog-todo-main strong').length, 3)
  responses['/calendar'] = read('fixtures/calendar.html')
  const before = s.requests.length
  section(s.doc, 'schedule').querySelector('button').click()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(texts(s.doc, 'schedule', '.edulog-todo-main strong').join('|'), '10/04 (Sun.) 10:00')
  assert.equal(JSON.stringify(s.requests.slice(before).map(request => request.path)), '["/calendar"]')
  s.dom.window.close()
})

test('empty weeks show positive states and cached data renders without new requests', async () => {
  const s = overview(pages({ '/admissions/month_unfilled_report': read('fixtures/unfilled.html'), '/admissions/unfilled_report': read('fixtures/unfilled.html'), '/courses/dt/101/lesson_reports': read('fixtures/reports.html') }))
  const first = s.enhance()
  await first.view.todo.ready
  assert.match(section(s.doc, 'reports').textContent, /本週報告都填完了/)
  assert.match(section(s.doc, 'attendance').textContent, /本週沒有缺席或待確認出席/)
  first.result.restore()
  const count = s.requests.length
  const second = s.enhance()
  assert.equal(section(s.doc, 'reports').hasAttribute('aria-busy'), false)
  assert.match(section(s.doc, 'reports').textContent, /本週報告都填完了/)
  await second.view.todo.ready
  assert.equal(s.requests.length, count)
  s.doc.querySelector('.edulog-todo-refresh').click()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(s.requests.length > count)
  s.dom.window.close()
})

test('only the known provider pages can be read', async () => {
  const s = overview()
  await assert.rejects(s.w.edulogSiteTodo.readDoc('/admin'), /來源路徑尚未驗證/)
  await assert.rejects(s.w.edulogSiteTodo.readDoc('/courses/dt/101/lesson_reports?x=1'), /來源路徑尚未驗證/)
  await assert.rejects(s.w.edulogSiteTodo.readDoc('/my/hour').then(() => s.w.edulogSiteTodo.readDoc('/courses/dt/555/lesson_reports')), /暫時無法讀取/)
  s.dom.window.close()
})
