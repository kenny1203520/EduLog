import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// tests/fixtures/real-sidebar.html is de-identified but keeps the real teacher sidebar
// structure: class switcher dropdown, empty module groups, search, profile, logout, locales.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function page(path = '/courses/dt/101', { saturday = true, extraClasses = '' } = {}) {
  const dom = new JSDOM(read('fixtures/real-sidebar.html').replace('<div class="dropdown-menu teach-menu">', `<div class="dropdown-menu teach-menu">${extraClasses}`), { url: `https://corp.orangeapple.co${path}`, runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, original = w.document.body.outerHTML
  // Pin "today" so the 今天 mark is deterministic (2026-10-17 is a Saturday).
  if (saturday) w.eval("{ const Real = Date; globalThis.Date = class extends Real { constructor(...a) { super(...(a.length ? a : ['2026-10-17T09:00:00+08:00'])) } } }")
  for (const file of ['lexicon', 'model', 'navigation', 'workflows']) w.eval(read(`../sites/orange-apple/orange-apple-${file}.js`))
  w.eval(read('../sites/orange-apple/orange-apple.js'))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { dom, w, doc: w.document, view, result, original }
}
const classItems = doc => [...doc.querySelectorAll('.edulog-nav .edulog-nav-class')]

test('class names are shortened and parsed into weekday, time and place', () => {
  const { w, dom } = page()
  const parse = w.edulogSiteNavigation.parseClassName
  assert.equal(JSON.stringify(parse('樹林_非凡文理_201教室（菁英） - 週六 第 2 時段 (13:30 ~ 15:30)')), JSON.stringify({ primary: '週六 13:30–15:30', secondary: '201教室（菁英）', branch: '樹林 非凡文理', weekday: 6, start: '13:30', full: '樹林_非凡文理_201教室（菁英） - 週六 第 2 時段 (13:30 ~ 15:30)' }))
  assert.equal(parse('特殊班級名稱').primary, '特殊班級名稱')
  dom.window.close()
})

test('my classes are listed Monday first, with today and the current class marked', () => {
  const s = page()
  const items = classItems(s.doc)
  assert.equal(items.map(item => item.querySelector('strong').textContent).join('|'), '週六 10:00–12:00|週六 13:30–15:30|週日 10:00–12:00|特殊班級名稱')
  assert.equal(items[0].getAttribute('aria-current'), 'page')
  assert.equal(items[0].getAttribute('href'), '/courses/dt/101')
  assert.equal(items[0].title, '測試分校_文理_201教室（菁英） - 週六 第 1 時段 (10:00 ~ 12:00)')
  assert.equal(items[0].querySelector('.edulog-nav-class-place').textContent, '201教室（菁英）')
  assert.equal(items.filter(item => item.querySelector('.edulog-nav-today')).length, 2)
  assert.equal(items[2].querySelector('.edulog-nav-today'), null)
  s.dom.window.close()
})

test('work links, hidden empty modules, moved search and proxied account actions', () => {
  const s = page('/calendar')
  const sections = [...s.doc.querySelectorAll('.edulog-nav-heading')].map(node => node.textContent)
  assert.equal(sections.join('|'), '我的班級|工作')
  const work = [...s.doc.querySelectorAll('.edulog-nav-section')][1]
  assert.equal([...work.querySelectorAll('a')].map(a => `${a.textContent}:${a.getAttribute('href')}`).join('|'), '總覽:/|課程行事曆:/calendar|月未填寫列表:/admissions/month_unfilled_report')
  assert.equal(work.querySelector('[aria-current="page"]').textContent, '課程行事曆')
  assert.equal(s.doc.querySelector('.edulog-nav-search #search_students') !== null, true)
  assert.equal(s.doc.querySelector('#nav-teacher').hasAttribute('data-edulog-replaced'), true)
  assert.equal(s.doc.querySelector('.sidebar > .btn-group').hasAttribute('data-edulog-replaced'), true)
  const clicks = []
  for (const native of s.doc.querySelectorAll('a[data-method="delete"], .locale-selector a')) native.addEventListener('click', event => { event.preventDefault(); clicks.push(native.getAttribute('href')) })
  s.doc.querySelector('.edulog-nav-logout').click()
  ;[...s.doc.querySelectorAll('.edulog-nav-locales button')][2].click()
  assert.equal(JSON.stringify(clicks), JSON.stringify(['/employees/sign_out', '/locale?locale=en']))
  assert.equal(s.doc.querySelector('.edulog-nav-locales [aria-pressed="true"]').textContent, '繁體中文')
  assert.equal(s.doc.querySelector('.edulog-nav-footer > a').getAttribute('href'), '/my')
  s.dom.window.close()
})

test('module groups appear only when the provider gave them entries', () => {
  const dom = new JSDOM(read('fixtures/real-sidebar.html').replace('<div class="collapse" id="teaching-menu"><ul class="btn-toggle-nav list-unstyled"></ul>', '<div class="collapse" id="teaching-menu"><ul class="btn-toggle-nav list-unstyled"><li><a href="/teaching/plans">教案管理</a></li></ul>'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only' })
  const w = dom.window
  for (const file of ['lexicon', 'model', 'navigation', 'workflows']) w.eval(read(`../sites/orange-apple/orange-apple-${file}.js`))
  w.eval(read('../sites/orange-apple/orange-apple.js'))
  w.edulogSiteAdapter.enhancePage(w.document, {})
  assert.equal([...w.document.querySelectorAll('.edulog-nav-heading')].map(node => node.textContent).join('|'), '我的班級|工作|師資模組')
  dom.window.close()
})

test('pending counts other views computed show next to the class', () => {
  const dom = new JSDOM(read('fixtures/real-sidebar.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only' })
  const w = dom.window
  w.eval("globalThis.edulogClassPending = new Map([['/courses/dt/102', 3]])")
  for (const file of ['lexicon', 'model', 'navigation', 'workflows']) w.eval(read(`../sites/orange-apple/orange-apple-${file}.js`))
  w.eval(read('../sites/orange-apple/orange-apple.js'))
  w.edulogSiteAdapter.enhancePage(w.document, {})
  const count = w.document.querySelector('.edulog-nav-class[href="/courses/dt/102"] .edulog-nav-count')
  assert.equal(count.textContent, '3')
  assert.equal(count.getAttribute('aria-label'), '3 位待處理')
  dom.window.close()
})

test('drawer closes on Escape and the backdrop; restore returns the original page', () => {
  const s = page()
  s.doc.documentElement.setAttribute('data-edulog-nav-open', '')
  s.doc.dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'Escape' }))
  assert.equal(s.doc.documentElement.hasAttribute('data-edulog-nav-open'), false)
  s.doc.documentElement.setAttribute('data-edulog-nav-open', '')
  s.doc.querySelector('.edulog-nav-backdrop').click()
  assert.equal(s.doc.documentElement.hasAttribute('data-edulog-nav-open'), false)
  s.result.restore()
  s.doc.documentElement.removeAttribute('data-edulog-ui'); s.doc.documentElement.removeAttribute('data-edulog-page')
  assert.equal(s.doc.body.outerHTML, s.original)
  s.dom.window.close()
})

const classLink = (id, name) => `<a class="dropdown-item" href="/courses/dt/${id}">${name}</a>`

test('the branch is added to the place only when classes are in more than one branch', () => {
  const s = page('/courses/dt/101', { extraClasses: classLink(201, '板橋分校_文理_201教室（菁英） - 週三 第 1 時段 (18:00 ~ 20:00)') })
  const places = classItems(s.doc).map(item => item.querySelector('.edulog-nav-class-place')?.textContent || '')
  assert.equal(places.join('|'), '板橋分校 文理 · 201教室（菁英）|測試分校 文理 · 201教室（菁英）|測試分校 文理 · 201教室（菁英）|測試分校 文理 · 201教室（菁英）|')
  s.dom.window.close()
})

test('more than six classes are grouped by weekday with today first, and counts update live', () => {
  const extra = [[301, '週一', '16:00'], [302, '週二', '16:00'], [303, '週三', '16:00'], [304, '週三', '18:00']].map(([id, day, time]) => classLink(id, `測試分校_文理_301教室 - ${day} 第 1 時段 (${time} ~ 18:00)`)).join('')
  const s = page('/courses/dt/101', { extraClasses: extra })
  assert.equal([...s.doc.querySelectorAll('.edulog-nav-day-heading')].map(node => node.textContent).join('|'), '週六（今天）|週一|週二|週三|週日|其他')
  assert.equal(s.doc.querySelector('.edulog-nav-day').querySelectorAll('.edulog-nav-class').length, 2)
  assert.equal(s.doc.querySelectorAll('.edulog-nav-today').length, 0, 'the group heading carries 今天')
  assert.equal(s.doc.querySelector('.edulog-nav-count'), null)
  s.w.edulogClassPending.set('/courses/dt/302', 4)
  s.w.edulogSiteNavigation.announcePending(s.doc)
  const count = s.doc.querySelector('a[href="/courses/dt/302"] .edulog-nav-count')
  assert.equal(count.textContent, '4')
  assert.equal(count.getAttribute('aria-label'), '4 位待處理')
  s.result.restore()
  assert.equal(s.doc.querySelector('.edulog-nav'), null)
  s.dom.window.close()
})

test('known menu links and module titles follow EduLog language, not the provider wording', async () => {
  const dom = new JSDOM(read('fixtures/real-sidebar.html').replace('<a class="nav-link" href="/">總覽</a>', '<a class="nav-link" href="/">總覽</a>').replace('<ul class="btn-toggle-nav list-unstyled"></ul>', '<ul class="btn-toggle-nav list-unstyled"><li><a href="/dt_admissions">剩餘課堂</a></li><li><a href="/x/unknown">原站自訂項目</a></li></ul>'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  for (const file of ['shared/ui-core.js', 'shared/ui-phrases.js']) w.eval(read(`../${file}`))
  await new Promise(resolve => setTimeout(resolve, 0))
  w.edulogUi.setLocale('en')
  for (const file of ['lexicon', 'model', 'navigation', 'workflows']) w.eval(read(`../sites/orange-apple/orange-apple-${file}.js`))
  w.eval(read('../sites/orange-apple/orange-apple.js'))
  w.edulogSiteAdapter.enhancePage(w.document, {})
  const labels = [...w.document.querySelectorAll('.edulog-nav-section')].map(section => [section.querySelector('h2').textContent, [...section.querySelectorAll(':scope > ul > li > a')].map(a => a.textContent)])
  assert.deepEqual(JSON.parse(JSON.stringify(labels.filter(([heading]) => heading !== 'My classes'))), [['Work', ['Overview', 'Course calendar', 'Monthly unfilled list']], ['Teaching', ['Remaining lessons', '原站自訂項目']]])
  dom.window.close()
})
