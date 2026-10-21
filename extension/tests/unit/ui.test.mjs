import test from 'node:test'
import { siteFiles } from '../site-files.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../../app/node_modules/jsdom/lib/api.js'

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const adapterCode = read('../../sites/orange-apple/core/adapter.js')
const contentCode = read('../../content/content.js')
const wait = () => new Promise(resolve => setTimeout(resolve, 140))
test('class summary is idle until requested and failed reads can be retried', async () => {
  const dom=fixture('reports','/courses/dt/101/lesson_reports'),doc=dom.window.document,view={}
  const enhanced=dom.window.edulogSiteAdapter.enhancePage(doc,view)
  const section=doc.querySelector('.edulog-class-history-tools'),progress=section.querySelectorAll('p')[1],button=section.querySelector('button')
  assert.equal(progress.hidden,true)
  view.loadClassHistory=async()=>{throw new Error('offline')}
  button.disabled=false;button.click();await wait()
  assert.equal(progress.hidden,false)
  assert.equal(button.disabled,false)
  assert.ok([...progress.querySelectorAll('span')].some(el=>!el.hidden&&el.textContent==='讀取失敗'))
  view.loadClassHistory=async()=>({done:1,total:1,failed:0})
  button.click();await wait()
  assert.equal(button.disabled,false)
  assert.ok([...progress.querySelectorAll('span')].some(el=>!el.hidden&&el.textContent==='讀取完成；成功'))
  enhanced.restore();dom.window.close()
})
function fixture(name, path) {
  const dom = new JSDOM(read(`../fixtures/${name}.html`), { url: `https://corp.orangeapple.co${path}`, runScripts: 'outside-only' })
  for (const file of siteFiles('lexicon', 'model', 'session-cards')) dom.window.eval(read(`../../${file}`))
  for (const file of siteFiles('workflows')) dom.window.eval(read(`../../${file}`))
  dom.window.eval(adapterCode)
  return dom
}
function start(dom, enabled = true, pages = undefined, status = undefined) {
  const messages = [], listeners = []
  dom.window.chrome = { runtime: {
    sendMessage: async data => {
      messages.push(data)
      if (data.type === 'get-ui-preferences') return { enabled, pages }
      if (status && data.type === 'get-edulog-integration-status') return status
      if (data.type === 'open-integration-workspace') return { opened: true }
      return { enabled: data.enabled }
    },
    onMessage: { addListener: fn => listeners.push(fn) },
  } }
  dom.window.eval(read('../../shared/runtime-bridge.js'))
  dom.window.eval(read('../../content/bootstrap.js'))
  dom.window.eval(read('../../shared/connection-ui.js'))
  dom.window.eval(read('../../shared/integration-ui.js'))
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
  assert.equal(doc.querySelector('#reports').dataset.edulogWeekMode, 'single')
  assert.equal(doc.querySelector('[data-edulog-report-region]').dataset.edulogReportMode, 'single')
  assert.equal(doc.querySelector('.edulog-week-tools [data-week][aria-pressed=true]').dataset.week, '4')
  for(const row of doc.querySelectorAll('#reports tr[data-edulog-report-row]')){
    assert.equal(row.cells[4].hasAttribute('data-edulog-week-selected'),true,'the default week is projected during initial render')
    assert.equal(row.cells[3].hasAttribute('data-edulog-week-selected'),false)
    assert.equal(row.cells[5].hasAttribute('data-edulog-week-cell'),true)
  }
  doc.querySelector('.edulog-week-tools [data-report-mode=compare]').click()
  assert.equal(doc.querySelector('[data-edulog-report-region]').dataset.edulogReportMode, 'compare')
  doc.querySelector('.edulog-week-tools [data-week="3"]').click()
  assert.equal(doc.querySelector('.edulog-week-tools [data-week][aria-pressed=true]').dataset.week, '3')
  const visibleSource=[...doc.querySelectorAll('#reports tr:not([data-edulog-last-teaching-row])')].map(row=>[...row.cells].slice(3).map(cell=>{const clone=cell.cloneNode(true);clone.querySelectorAll('[data-edulog-owned]').forEach(node=>node.remove());return clone.textContent}))
  assert.deepEqual(visibleSource, source)
  enhanced.restore(); dom.window.close()
})
test('non-session students are reachable through their own filter chip for the selected week', () => {
  const dom=fixture('reports','/courses/dt/101/lesson_reports'),doc=dom.window.document
  const enhanced=dom.window.edulogSiteAdapter.enhancePage(doc)
  const reportRows=[...doc.querySelectorAll('#reports tbody tr[data-edulog-report-row]')]
  assert.equal(reportRows.length,2)
  doc.querySelector('.edulog-week-tools [data-week=\"5\"]')?.click()
  const otherRows=reportRows.filter(row=>row.getAttribute('data-edulog-session-rank')==='other')
  assert.equal(otherRows.length,1,'the selected week determines which students are outside this session')
  assert.equal(otherRows[0].hasAttribute('data-edulog-filtered'),true,'non-session rows are collapsed from the active list')
  const chip=doc.querySelector('[data-chip="other"]')
  assert.equal(chip.querySelector('.edulog-chip-count').textContent,'1')
  chip.click()
  assert.equal(chip.getAttribute('aria-pressed'),'true')
  assert.equal(otherRows[0].hasAttribute('data-edulog-filtered'),false)
  assert.equal(reportRows.filter(row=>row!==otherRows[0]).every(row=>row.hasAttribute('data-edulog-filtered')),true)
  enhanced.restore();dom.window.close()
})
test('standalone UI works without pairing and homepage shortcuts use source class links', async () => {
  const dom = fixture('overview', '/')
  const { messages } = start(dom)
  await wait()
  assert.equal(dom.window.document.documentElement.dataset.edulogUi, 'on')
  assert.equal(dom.window.document.querySelectorAll('.edulog-class-shortcuts a').length, 2)
  // Only reads: the theme preference and the connection status behind the toolbar's dot.
  assert.deepEqual(messages.map(m => m.type), ['get-ui-preferences', 'get-edulog-integration-status'])
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
  assert.equal(doc.querySelector('[data-chip="all"] .edulog-chip-count').textContent, '3')
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
const toolbarPart = (doc, selector) => doc.querySelector('#edulog-extension-root').shadowRoot.querySelector(selector)
test('a page kind saved as original stays native and can be switched back from the toolbar', async () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document
  const { messages } = start(dom, true, { class: 'original' })
  await wait()
  assert.equal(doc.documentElement.hasAttribute('data-edulog-ui'), false)
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 0)
  assert.equal(doc.querySelector('#edulog-extension-root').dataset.enabled, 'false')
  const pageMode = toolbarPart(doc, '.page-mode')
  assert.equal(pageMode.hidden, false)
  assert.equal(pageMode.getAttribute('role'), 'switch')
  assert.equal(pageMode.getAttribute('aria-checked'), 'false')
  assert.equal(pageMode.querySelector('.switch-label').textContent, '本頁套用 EduLog')
  assert.equal(toolbarPart(doc, '.integration').classList.contains('fab'), true, 'original pages show one floating EduLog button')
  assert.equal(toolbarPart(doc, '.bar'), null)
  pageMode.click(); await wait()
  assert.equal(doc.documentElement.dataset.edulogUi, 'on')
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 2)
  assert.equal(JSON.stringify(messages.at(-1)), '{"type":"set-ui-preferences","page":"class","pageMode":"enhanced"}')
  toolbarPart(doc, '.page-mode').click(); await wait()
  assert.equal(doc.documentElement.hasAttribute('data-edulog-ui'), false)
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 0)
  assert.equal(JSON.stringify(messages.at(-1)), '{"type":"set-ui-preferences","page":"class","pageMode":"original"}')
  dom.window.close()
})
test('the per-page choice is hidden when the theme is off and other page kinds stay enhanced', async () => {
  const off = fixture('class', '/courses/dt/101')
  start(off, false); await wait()
  assert.equal(toolbarPart(off.window.document, '.page-mode').hidden, true)
  off.window.close()
  const other = fixture('class', '/courses/dt/101'), doc = other.window.document
  const { listeners } = start(other, true, { reports: 'original' }); await wait()
  assert.equal(doc.documentElement.dataset.edulogUi, 'on')
  listeners[0]({ type: 'ui-preferences-changed', enabled: true, pages: { class: 'original' } }); await wait()
  assert.equal(doc.documentElement.hasAttribute('data-edulog-ui'), false)
  other.window.close()
})
test('unrecognised provider structure keeps the native page and explains it in the toolbar', async () => {
  const dom = fixture('reports', '/courses/dt/101/lesson_reports'), doc = dom.window.document
  doc.querySelector('#reports').remove()
  start(dom); await wait()
  assert.equal(doc.documentElement.hasAttribute('data-edulog-ui'), false)
  assert.equal(doc.querySelectorAll('[data-edulog-owned]:not(#edulog-extension-root)').length, 0)
  assert.equal(doc.querySelector('#edulog-extension-root').dataset.enabled, 'false')
  assert.match(toolbarPart(doc, '.notice').textContent, /原站版面可能已更新/)
  assert.equal(toolbarPart(doc, '.page-mode').hidden, true)
  dom.window.close()
})

const connected = { status: 'connected', origin: 'https://edulog.example.com', capabilities: { teaching_data_import: true, report_prefill: true }, settingsUrl: 'https://edulog.example.com/settings', lastVerifiedAt: '2026-10-19T06:02:00Z' }
test('theme off shows one floating button whose panel holds the page switch, main action, connection and settings', async () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document
  const { messages } = start(dom, false, undefined, connected)
  await wait()
  const host = doc.querySelector('#edulog-extension-root')
  assert.equal(host.dataset.enabled, 'false')
  assert.equal(host.shadowRoot.querySelectorAll('button.integration').length, 1)
  assert.equal(toolbarPart(doc, '.fab-dot').dataset.tone, 'ok')
  assert.equal(toolbarPart(doc, '.integration').getAttribute('aria-label'), 'EduLog（已連線）')
  const panel = toolbarPart(doc, '.panel'), trigger = toolbarPart(doc, '.integration')
  assert.equal(panel.hidden, true)
  trigger.click(); await wait()
  assert.equal(panel.hidden, false)
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  // With the theme off the theme switch takes the page switch's place; the per-page choice stays hidden.
  assert.equal(toolbarPart(doc, '.switch-slot .toggle').getAttribute('aria-checked'), 'false')
  assert.equal(toolbarPart(doc, '.page-mode').hidden, true)
  const primary = toolbarPart(doc, '.panel-primary')
  assert.equal(primary.hidden, false)
  assert.equal(primary.textContent, '同步本班')
  assert.equal(toolbarPart(doc, '.panel .status').textContent, 'edulog.example.com')
  assert.equal(toolbarPart(doc, '.settings').hidden, false)
  primary.click(); await wait()
  assert.deepEqual(messages.filter(m => m.type === 'open-integration-workspace').map(m => m.flow), ['import'])
  panel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }))
  assert.equal(panel.hidden, true)
  assert.equal(host.shadowRoot.activeElement, trigger, 'Esc returns focus to the button')
  trigger.click(); await wait()
  doc.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true, composed: true }))
  assert.equal(panel.hidden, true, 'a click outside closes the panel')
  dom.window.close()
})
test('the report editor offers prefill; a disconnected page explains how to connect instead', async () => {
  const report = fixture('report-editor', '/dt_admissions/301/reports/401/edit')
  const sent = start(report, false, undefined, connected).messages
  await wait()
  toolbarPart(report.window.document, '.integration').click(); await wait()
  const primary = toolbarPart(report.window.document, '.panel-primary')
  assert.equal(primary.textContent, '預填本報告')
  primary.click(); await wait()
  assert.deepEqual(sent.filter(m => m.type === 'open-integration-workspace').map(m => m.flow), ['prefill'])
  report.window.close()
  const offline = fixture('class', '/courses/dt/101'), doc = offline.window.document
  start(offline, false, undefined, { status: 'not-connected' }); await wait()
  assert.equal(toolbarPart(doc, '.fab-dot').dataset.tone, 'neutral')
  toolbarPart(doc, '.integration').click(); await wait()
  assert.equal(toolbarPart(doc, '.panel-primary').hidden, true)
  assert.match(toolbarPart(doc, '.panel .status-meta').textContent, /EduLog 圖示/)
  offline.window.close()
})
test('theme on shows the toolbar with one primary action and the panel behind "more"', async () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document
  start(dom, true, undefined, connected); await wait()
  assert.equal(toolbarPart(doc, '.fab'), null)
  const primary = toolbarPart(doc, '.bar .primary')
  assert.equal(primary.hidden, false)
  assert.equal(primary.textContent, '同步本班')
  assert.equal(toolbarPart(doc, '.bar .conn').dataset.tone, 'ok')
  toolbarPart(doc, '.integration').click(); await wait()
  assert.equal(toolbarPart(doc, '.panel-primary').hidden, true, 'the toolbar already carries the primary action')
  assert.equal(toolbarPart(doc, '.page-mode').getAttribute('aria-checked'), 'true')
  assert.equal(toolbarPart(doc, '.toggle-slot .toggle').getAttribute('aria-checked'), 'true')
  toolbarPart(doc, '.page-mode').click(); await wait()
  assert.equal(doc.documentElement.hasAttribute('data-edulog-ui'), false)
  assert.equal(toolbarPart(doc, '.integration').classList.contains('fab'), true)
  dom.window.close()
})
