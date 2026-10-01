import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const adapterCode = read('../adapters/orange-apple.js')
const contentCode = read('../content.js')
const wait = () => new Promise(resolve => setTimeout(resolve, 140))
function fixture(name, path) {
  const dom = new JSDOM(read(`fixtures/${name}.html`), { url: `https://corp.orangeapple.co${path}`, runScripts: 'outside-only' })
  dom.window.eval(read('../adapters/orange-apple-workflows.js'))
  dom.window.eval(adapterCode)
  return dom
}
function start(dom, enabled = true) {
  const messages = [], listeners = []
  dom.window.chrome = { runtime: {
    sendMessage: async data => { messages.push(data); return data.type === 'get-ui-preferences' ? { enabled } : { enabled: data.enabled } },
    onMessage: { addListener: fn => listeners.push(fn) },
  } }
  dom.window.eval(read('../runtime-bridge.js'))
  dom.window.eval(read('../bootstrap.js'))
  dom.window.eval(read('../connection-ui.js'))
  dom.window.eval(read('../integration-ui.js'))
  dom.window.eval(contentCode)
  return { messages, listeners }
}
test('recognizes only sample-backed routes, including the homepage and underscore report route', () => {
  const dom = fixture('overview', '/')
  const adapter = dom.window.edulogSiteAdapter
  for (const path of ['/', '/courses/dt/101', '/courses/dt/101/lesson_reports']) assert.ok(adapter.matchPage(path))
  for (const path of ['/employees/sign_out', '/students/101', '/courses/dt/101/lesson-reports', '/courses/dt/101/delete']) assert.equal(adapter.matchPage(path), null)
  dom.window.close()
})
test('restores exactly the original DOM, edited values and native handlers', () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document
  const before = doc.documentElement.outerHTML
  const input = doc.querySelector('textarea'), checkbox = doc.querySelector('input[type=checkbox]')
  input.value = '尚未送出的內容'; checkbox.checked = true
  const action = doc.querySelector('a[href*="reports/401/edit"]')
  let clicks = 0
  action.addEventListener('click', e => { e.preventDefault(); clicks++ })
  const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  action.click()
  enhanced.restore()
  assert.equal(clicks, 1)
  assert.equal(doc.querySelector('textarea'), input)
  assert.equal(input.value, '尚未送出的內容')
  assert.equal(checkbox.checked, true)
  assert.equal(doc.documentElement.outerHTML, before)
  dom.window.close()
})
test('filters rows without changing the source hidden state and supports mobile detail expansion', () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document
  const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  const input = doc.querySelector('[data-edulog-search=students]')
  input.value = '不存在'; input.dispatchEvent(new dom.window.Event('input'))
  assert.equal(doc.querySelectorAll('#students-table [data-edulog-filtered]').length, 2)
  input.value = ''; input.dispatchEvent(new dom.window.Event('input'))
  const row = doc.querySelector('#students-table tbody tr'), button = row.querySelector('[data-edulog-expand]')
  button.click(); assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.ok(row.hasAttribute('data-edulog-expanded'))
  enhanced.restore()
  assert.equal(doc.querySelectorAll('#students-table tr[hidden]').length, 1)
  dom.window.close()
})
test('week selection preserves the source statuses and report links', () => {
  const dom = fixture('reports', '/courses/dt/101/lesson_reports'), doc = dom.window.document
  const source = [...doc.querySelectorAll('#reports tr')].map(row=>[...row.cells].slice(3).map(cell=>cell.textContent.replace('記錄','課堂記錄')))
  const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.equal(doc.querySelector('.edulog-week-tools [aria-pressed=true]').dataset.week, '4')
  doc.querySelector('.edulog-week-tools button').click()
  assert.equal(doc.querySelector('.edulog-week-tools [aria-pressed=true]').dataset.week, '3')
  assert.deepEqual([...doc.querySelectorAll('#reports tr')].map(row=>[...row.cells].slice(3).map(cell=>cell.textContent)), source)
  enhanced.restore(); dom.window.close()
})
test('standalone UI works without pairing and homepage shortcuts use source class links', async () => {
  const dom = fixture('overview', '/')
  const { messages } = start(dom)
  await wait()
  assert.equal(dom.window.document.documentElement.dataset.edulogUi, 'on')
  assert.equal(dom.window.document.querySelectorAll('.edulog-class-shortcuts a').length, 2)
  assert.deepEqual(messages.map(m => m.type), ['get-ui-preferences'])
  dom.window.close()
})
test('preference changes restore the original and re-enable without duplicates', async () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document
  const { listeners } = start(dom)
  await wait()
  listeners[0]({ type: 'ui-preferences-changed', enabled: false })
  assert.equal(doc.documentElement.hasAttribute('data-edulog-ui'), false)
  assert.equal(doc.documentElement.hasAttribute('style'), false)
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 0)
  listeners[0]({ type: 'ui-preferences-changed', enabled: true })
  await wait()
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 2)
  assert.equal(doc.querySelectorAll('#edulog-extension-root').length, 1)
  dom.window.close()
})
test('saved opt-out keeps the original UI and unrelated native overlays do not rebuild controls', async () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document
  const { listeners } = start(dom, false)
  await wait()
  assert.equal(doc.documentElement.hasAttribute('data-edulog-ui'), false)
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 0)
  listeners[0]({ type: 'ui-preferences-changed', enabled: true })
  const search = doc.querySelector('[data-edulog-search=students]')
  doc.querySelector('#remote_modal').append(doc.createElement('p'))
  await wait()
  assert.equal(doc.querySelector('[data-edulog-search=students]'), search)
  dom.window.close()
})
test('Turbo caching, source row updates and navigation remain reversible', async () => {
  const dom = fixture('reports', '/courses/dt/101/lesson_reports'), doc = dom.window.document
  const newSourceRow = doc.querySelector('#reports tbody tr').cloneNode(true)
  start(dom); await wait()
  const table = doc.querySelector('#reports')
  table.tBodies[0].append(newSourceRow)
  await wait()
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 1)
  assert.match(doc.querySelector('.edulog-table-tools [role=status]').textContent, /3 \/ 3/)
  doc.dispatchEvent(new dom.window.Event('turbo:before-cache'))
  assert.equal(doc.querySelector('#edulog-extension-root'), null)
  assert.equal(doc.documentElement.dataset.edulogUi, 'on')
  assert.equal(doc.documentElement.hasAttribute('data-edulog-pending'), true)
  doc.dispatchEvent(new dom.window.Event('turbo:load')); await wait()
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 1)
  dom.window.history.pushState({}, '', '/my')
  doc.dispatchEvent(new dom.window.Event('turbo:load')); await wait()
  assert.equal(doc.querySelector('#edulog-extension-root'), null)
  dom.window.close()
})
