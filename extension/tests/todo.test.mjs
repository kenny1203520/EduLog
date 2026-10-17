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
  // Reports are grouped by class (from each fill link), overdue groups first.
  assert.equal(texts(s.doc, 'reports', '.edulog-todo-group-head strong').join('|'), '測試班級 B|測試班級 A')
  assert.equal(texts(s.doc, 'reports', '.edulog-todo-group-head .edulog-todo-meta').join('|'), '逾期 1|待補填 2')
  assert.equal(texts(s.doc, 'reports', '.edulog-todo-name').join('|'), '學生丙|學生甲|學生乙')
  assert.equal(texts(s.doc, 'reports', '.edulog-badge').join('|'), '逾期未填|待補填|待補填')
  assert.equal(section(s.doc, 'reports').querySelector('.edulog-todo-count').textContent, '3')
  assert.equal(section(s.doc, 'reports').querySelector('.edulog-todo-group-head .edulog-todo-action').getAttribute('href'), '/courses/dt/102/lesson_reports')
  assert.equal(section(s.doc, 'reports').querySelector('.edulog-todo-fill').getAttribute('href'), '/courses/dt/102/lesson_reports?student_id=309')
  assert.equal(texts(s.doc, 'schedule', '.edulog-todo-main strong').join('|'), '10/04 (Sun.) 10:00')
  assert.equal(texts(s.doc, 'schedule', '.edulog-todo-meta').join('|'), '測試班級 A · 測試教室')
  assert.equal(section(s.doc, 'attendance').querySelector('h3 span').textContent, '本週點名與出席')
  assert.equal(texts(s.doc, 'attendance', '.edulog-todo-group-head strong').join('|'), '測試班級 A')
  assert.equal(texts(s.doc, 'attendance', '.edulog-todo-group-head .edulog-todo-meta').join('|'), '待點名 1 · 缺席 1')
  assert.equal(texts(s.doc, 'attendance', '.edulog-todo-name').join('|'), '測試學生 B|測試學生 A')
  assert.equal(texts(s.doc, 'attendance', '.edulog-badge').join('|'), '缺席|待確認出席')
  assert.equal(section(s.doc, 'attendance').querySelectorAll('.edulog-todo-action').length, 1, 'one link per class, not per student')
  assert.match(section(s.doc, 'hours').textContent, /2026年 9月 1 筆鐘點紀錄/)
  assert.match(s.doc.querySelector('.edulog-todo-updated').textContent, /^更新於 \d\d:\d\d$/)
  assert.equal(root.querySelectorAll('table').length, 0)
  assert.ok(root.querySelectorAll('svg[aria-hidden="true"]').length >= 5)
  for (const request of s.requests) assert.equal(JSON.stringify([request.options.credentials, request.options.redirect]), '["same-origin","error"]')
  result.restore()
  assert.equal(s.doc.querySelector('.edulog-todo'), null)
  assert.equal(s.doc.querySelectorAll('svg.edulog-icon, [data-edulog-owned]').length, 0, 'icons inside the view must not survive restore')
  s.dom.window.close()
})

test('sections fail independently and retry without reloading the others', async () => {
  const responses = pages({ '/calendar': new Error('offline') })
  const s = overview(responses)
  const { view } = s.enhance()
  await view.todo.ready
  assert.match(section(s.doc, 'schedule').textContent, /讀取失敗/)
  assert.equal(texts(s.doc, 'reports', '.edulog-todo-name').length, 3)
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
  assert.match(section(s.doc, 'attendance').textContent, /已上課的班級都點完名，也沒有缺席/)
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

test('attendance exceptions are read from the real icon-based session markup', () => {
  const { w, dom } = overview()
  const doc = new w.DOMParser().parseFromString(read('fixtures/real-class.html'), 'text/html')
  const result = w.edulogSiteTodo.extractAttendance(doc)
  assert.equal(result.week, '本週(10/17)')
  assert.equal(JSON.stringify(result.items.map(item => [item.student, item.status, item.label])), JSON.stringify([['學生甲', 'pending', '尚未點名'], ['學生丙', 'absent', '缺席']]))
  dom.window.close()
})

// Many classes in two branches (de-identified, generated): one taught today with 7 students
// waiting for attendance, one later this week, one earlier with an absence, the rest on Sunday (not started).
const sessionCell = (id, tone) => `<td class="this_week">第 3 週(L3)<turbo-frame id="report_status_${id}"><div class="d-grid gap-2"><a class="btn btn-xs btn-block ${tone === 'secondary' ? 'btn-default' : 'btn-success'}" href="/dt_admissions/${id}/reports/${id}/edit">課堂記錄</a></div><span class="text-${tone}"><i class="fa fa-user"></i></span>&nbsp;<span class="text-success"><i class="fa fa-pencil"></i></span>&nbsp;<span class="text-success"><i class="fa fa-question-circle"></i></span>&nbsp;<span class="text-success"><i class="fa fa-commenting"></i></span></turbo-frame></td>`
function classReports(date, tones) {
  const rows = tones.map((tone, index) => `<tr><td><span>學生${index + 1}</span><a class="admission-comment" data-admission-id="${9000 + index}" href="/admissions/comments/${9000 + index}/edit_teacher"><div class="admission-comment-box"> </div></a></td><td><span>測試課程</span></td><td>1/0/0</td>${sessionCell(7000 + index, tone)}</tr>`).join('')
  return `<!doctype html><body><div id="page-body"><div class="content"><table id="reports"><thead><tr><th>學生</th><th>課程</th><th>出席統計</th><th>本週<br>(${date})</th></tr></thead><tbody>${rows}</tbody></table></div></div></body>`
}
function manyClasses() {
  const classes = [[401, '樹林_文理_201教室', '週四', '10:00'], [402, '樹林_文理_202教室', '週六', '10:00'], [403, '板橋_文理_201教室', '週二', '10:00']]
  for (let id = 404; id <= 422; id++) classes.push([id, '樹林_文理_301教室', '週日', '16:00'])
  const links = classes.map(([id, place, day, time]) => `<a href="/courses/dt/${id}">${place} - ${day} 第 1 時段 (${time} ~ 18:00)</a>`).join('')
  const html = read('fixtures/overview.html').replace(/<div class="dropdown-menu teach-menu">.*?<\/div>/, `<div class="dropdown-menu teach-menu">${links}</div>`)
  const responses = pages({
    '/courses/dt/401/lesson_reports': classReports('10/15', Array(7).fill('secondary')),
    '/courses/dt/402/lesson_reports': classReports('10/17', ['secondary', 'secondary', 'secondary']),
    '/courses/dt/403/lesson_reports': classReports('10/13', ['danger', 'success']),
  })
  for (let id = 404; id <= 422; id++) responses[`/courses/dt/${id}/lesson_reports`] = classReports('10/18', ['success'])
  const dom = new JSDOM(html, { url: 'https://corp.orangeapple.co/', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, requests = []
  // Thursday 2026-10-15 12:00: the Thursday class has started, the Saturday class has not.
  w.eval("{ const Real = Date; globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : ['2026-10-15T12:00:00+08:00'])) } static now() { return new Real('2026-10-15T12:00:00+08:00').getTime() } } }")
  w.fetch = async url => { const path = new URL(url).pathname; requests.push(path); const body = responses[path]; return body === undefined ? { ok: false, headers: { get: () => 'text/html' }, text: async () => '' } : { ok: true, headers: { get: () => 'text/html' }, text: async () => body } }
  for (const file of ['lexicon', 'model', 'todo', 'session-cards', 'navigation', 'workflows']) w.eval(read(`../adapters/orange-apple-${file}.js`))
  w.eval(read('../adapters/orange-apple.js'))
  w.edulogSiteTodo.clearCache()
  return { dom, w, doc: w.document, requests }
}

test('many classes: grouped by class, only started sessions count, today first, reads capped at 20', async () => {
  const s = manyClasses()
  const view = {}
  s.w.edulogSiteAdapter.enhancePage(s.doc, view)
  await view.todo.ready
  const attendance = section(s.doc, 'attendance')
  assert.equal(texts(s.doc, 'attendance', '.edulog-todo-group-head strong').join('|'), '週四 10:00–18:00|週二 10:00–18:00')
  assert.equal(texts(s.doc, 'attendance', '.edulog-todo-group-head .edulog-todo-meta').join('|'), '樹林 文理 · 201教室 · 待點名 7|板橋 文理 · 201教室 · 缺席 1')
  assert.ok(attendance.querySelector('.edulog-todo-group[data-today]'))
  const first = attendance.querySelector('.edulog-todo-group')
  assert.equal([...first.querySelectorAll('.edulog-todo-group-item')].filter(row => !row.hidden).length, 5)
  const more = first.querySelector('.edulog-todo-more')
  assert.equal(more.textContent, '顯示其餘 2 位')
  more.click()
  assert.equal([...first.querySelectorAll('.edulog-todo-group-item')].filter(row => !row.hidden).length, 7)
  assert.equal(more.getAttribute('aria-expanded'), 'true')
  assert.equal(attendance.querySelector('.edulog-todo-count').textContent, '8')
  assert.equal(texts(s.doc, 'attendance', '.edulog-todo-note').join('|'), '只檢查了 20 / 22 個班。|18 個班本週還沒上課，開始上課後才會列入。')
  // Today and earlier-this-week classes are read first; the last two calm classes are skipped.
  const classReads = s.requests.filter(path => path.startsWith('/courses/dt/')).map(path => path.split('/')[3])
  assert.equal(classReads.slice(0, 2).join(','), '401,403')
  assert.equal(classReads.length, 20)
  assert.equal(classReads.includes('422'), false)
  // The navigation shows the same counts; the class that has not started counts as nothing due.
  assert.equal(s.w.edulogClassPending.get('/courses/dt/401'), 7)
  assert.equal(s.w.edulogClassPending.get('/courses/dt/402'), 0)
  assert.equal(s.doc.querySelector('.edulog-nav a[href="/courses/dt/401"] .edulog-nav-count').textContent, '7')
  s.dom.window.close()
})
