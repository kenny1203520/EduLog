import test from 'node:test'
import { siteFiles } from '../site-files.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from '../../../app/node_modules/jsdom/lib/api.js'
import { webcrypto } from 'node:crypto'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const wait = () => new Promise(resolve => setTimeout(resolve, 30))
const waitFor = async predicate => {
  const deadline = Date.now() + 1000
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(predicate(), 'expected condition to become true')
}
const pendingJsdomErrors = []
function trackedDom(...args) {
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => pendingJsdomErrors.push(error))
  return new JSDOM(args[0], { ...args[1], virtualConsole })
}
test.afterEach(async () => {
  await wait()
  assert.deepEqual(pendingJsdomErrors.splice(0), [], 'unexpected asynchronous JSDOM error')
})

test('pairing includes named installation metadata and blocks duplicate submission', async () => {
  const dom = trackedDom(read('../../popup/popup.html'), { url: 'https://extension.example/popup/popup.html', runScripts: 'outside-only' })
  const w = dom.window, stored = {}, requests = [], opened = []
  const installation = { installation_id: '11111111-1111-4111-8111-111111111111', device_name: 'Chrome · Windows', browser_name: 'Chrome', platform_name: 'Windows', extension_version: '0.1.0' }
  let finish
  Object.defineProperty(w, 'crypto', { value: webcrypto })
  w.TextEncoder = TextEncoder; w.AbortSignal = AbortSignal
  w.chrome = {
    storage: { local: { get: async () => stored, set: async value => Object.assign(stored, value) } },
    runtime: { sendMessage: async data => data.type === 'get-edulog-installation' ? installation : data.type === 'get-ui-preferences' ? { enabled: true } : { status: 'not-connected' } },
    permissions: { request: async () => true }, tabs: { create: async value => opened.push(value) },
  }
  w.fetch = async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return new Promise(resolve => { finish = resolve }) }
  for (const file of ['shared/runtime-bridge.js','shared/connection-ui.js','popup/popup.js']) w.eval(read(`../../${file}`))
  await wait()
  const get = id => w.document.getElementById(id)
  get('instance').value = 'http://localhost:5173'; get('device-name').value = 'Teaching laptop'
  get('server-form').dispatchEvent(new w.Event('submit', { cancelable: true }))
  await waitFor(() => requests.length === 1)
  get('server-form').dispatchEvent(new w.Event('submit', { cancelable: true }))
  assert.equal(requests.length, 1)
  assert.equal(get('device-name').disabled, true)
  assert.deepEqual({ ...requests[0].body, code_challenge: undefined }, { ...installation, device_name: 'Teaching laptop', code_challenge: undefined })
  assert.match(requests[0].body.code_challenge, /^[a-f0-9]{64}$/)
  finish({ ok: true, json: async () => ({ data: { id: 'pair', authorize_url: 'http://localhost:5173/dashboard/settings?extension_pair=pair', expires_at: new Date(Date.now()+60000).toISOString() } }) })
  await wait()
  assert.equal(get('connection-card').dataset.state, 'pending')
  assert.equal(opened[0].url, stored.edulogExtension.pending.authorizeUrl)
  assert.equal(get('device-name').disabled, false)
  dom.window.close()
})

for (const failure of ['sync', 'async', 'listener']) test(`invalidated ${failure}: preserves drafts and stops communications`, async () => {
  const dom = trackedDom(read('../fixtures/class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only' })
  const w = dom.window
  let calls = 0
  const fail = () => { throw new Error('Extension context invalidated.') }
  w.chrome = { runtime: { sendMessage() { calls++; return failure === 'async' ? Promise.reject(new Error('Extension context invalidated.')) : fail() }, onMessage: { addListener() { if (failure === 'listener') fail() } } } }
  for (const file of ['shared/runtime-bridge.js', 'shared/connection-ui.js', 'shared/integration-ui.js', 'sites/orange-apple/core/lexicon.js', 'sites/orange-apple/core/model.js', ...siteFiles('workflows'), 'sites/orange-apple/core/adapter.js', 'content/bootstrap.js', 'content/content.js']) w.eval(read(`../../${file}`))
  await wait()
  const draft = w.document.querySelector('textarea')
  draft.value = 'unsaved draft'
  const root = () => w.document.querySelector('#edulog-extension-root').shadowRoot
  assert.match(root().querySelector('.notice').textContent, /重新整理分頁/)
  const before = calls
  root().querySelector('.toggle').click(); await wait()
  assert.equal(w.document.querySelector('textarea'), draft)
  assert.equal(draft.value, 'unsaved draft')
  assert.match(root().querySelector('.notice').textContent, /偏好未儲存/)
  root().querySelector('.toggle').click(); await wait()
  root().querySelector('.integration').click(); await wait()
  root().querySelector('.settings').click(); await wait()
  assert.equal(calls, before)
  assert.equal(root().querySelectorAll('.notice').length, 1)
  assert.equal(w.document.documentElement.dataset.edulogUi, undefined)
  dom.window.close()
})

test('transient bridge rejection permits retry', async () => {
  const dom = trackedDom('', { runScripts: 'outside-only' })
  let calls = 0
  dom.window.chrome = { runtime: { sendMessage() { return ++calls === 1 ? Promise.reject(new Error('Receiving end does not exist')) : Promise.resolve({ enabled: true }) } } }
  dom.window.eval(read('../../shared/runtime-bridge.js'))
  await assert.rejects(dom.window.edulogRuntime.send({}), error => error.code === 'BRIDGE_NO_RECEIVER' && error.cause?.message === 'Receiving end does not exist')
  assert.equal(dom.window.edulogRuntime.invalidated, false)
  assert.equal((await dom.window.edulogRuntime.send({})).enabled, true)
  dom.window.close()
})

test('bridge preserves safe classifications for channel closure and oversized messages', async () => {
  for (const [message, code] of [
    ['A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received', 'BRIDGE_CHANNEL_CLOSED'],
    ['Message length exceeded maximum allowed length.', 'BRIDGE_MESSAGE_TOO_LARGE'],
  ]) {
    const dom = trackedDom('', { runScripts: 'outside-only' })
    dom.window.chrome = { runtime: { sendMessage: async () => { throw new Error(message) } } }
    dom.window.eval(read('../../shared/runtime-bridge.js'))
    await assert.rejects(dom.window.edulogRuntime.send({}), error => error.code === code && error.cause?.message === message && !error.message.includes(message))
    dom.window.close()
  }
})

const POPUP_SCRIPTS = ['shared/runtime-bridge.js', 'sites/orange-apple/core/lexicon.js', 'shared/connection-ui.js', 'popup/popup.js']
function popup({ state, stored = { origin: 'http://localhost:5173', token: 'private-token' }, tab = null, capabilities = {}, work = 0 }) {
  const dom = trackedDom(read('../../popup/popup.html'), { url: 'https://extension.example/popup/popup.html', runScripts: 'outside-only' })
  const w = dom.window, opened = [], sent = []
  w.chrome = {
    storage: { local: { get: async () => ({ edulogExtension: stored }), set: async () => assert.fail('Unexpected storage write') } },
    runtime: { sendMessage: async data => { sent.push(data); return data.type === 'get-edulog-installation' ? { installation_id: '11111111-1111-4111-8111-111111111111', device_name: 'Test browser', browser_name: 'Chrome', platform_name: 'Windows', extension_version: '0.1.0' } : data.type === 'get-ui-preferences' ? { enabled: false } : data.type === 'set-ui-preferences' ? { enabled: data.enabled } : data.type === 'get-integration-work-summary' ? { count: work } : data.type === 'open-integration-workspace' ? { opened: true } : { status: state, origin: stored.origin, capabilities, settingsUrl: 'http://localhost:5173/dashboard/settings?tab=integrations', lastVerifiedAt: '2026-10-01T00:00:00Z' } } },
    tabs: { create: async value => opened.push(value), query: async () => tab ? [tab] : [] },
  }
  for (const file of POPUP_SCRIPTS) w.eval(read(`../../${file}`))
  return { dom, w, opened, sent, get: id => w.document.getElementById(id) }
}
const visiblePrimaries = doc => [...doc.querySelectorAll('.btn-primary')].filter(button => !button.closest('[hidden]'))

for (const state of ['not-connected', 'pending', 'pairing-expired', 'connected', 'expired', 'revoked', 'unavailable', 'forbidden']) test(`popup renders ${state}, independent UI preferences`, async () => {
  const stored = { origin: 'http://localhost:5173', token: 'private-token', pending: state === 'pending' ? { expiresAt: new Date(Date.now() + 60000).toISOString(), authorizeUrl: 'http://localhost:5173/dashboard/settings?extension_pair=id' } : undefined }
  const { dom, w, opened, get } = popup({ state, stored })
  await wait()
  assert.equal(get('connection-card').dataset.state, state)
  assert.equal(get('ui-enabled').disabled, false)
  assert.equal(get('ui-enabled').checked, false)
  assert.equal(get('pending-card').hidden, state !== 'pending')
  // Connected shows one action area; every other state shows the pairing path instead.
  assert.equal(get('feature-list').hidden, state !== 'connected')
  assert.equal(get('work-row').hidden, state !== 'connected')
  assert.equal(get('server-form').hidden, !['not-connected', 'expired', 'revoked', 'pairing-expired'].includes(state))
  assert.equal(get('state-badge').dataset.tone, { connected: 'ok', pending: 'warn', 'pairing-expired': 'warn', expired: 'warn', revoked: 'warn', unavailable: 'danger', forbidden: 'danger', 'not-connected': 'neutral' }[state])
  assert.equal(get('retry').hidden, !['unavailable', 'forbidden'].includes(state))
  assert.equal(w.document.body.textContent.includes('private-token'), false)
  assert.ok(visiblePrimaries(w.document).length <= 1, 'at most one primary button is visible')
  if (state === 'not-connected') assert.equal(get('pair-label').textContent, '連接 EduLog')
  if (state === 'connected') {
    assert.equal(get('feature-hint').hidden, true, 'the workspace needs no capability')
    assert.equal(get('primary-label').textContent, '開啟工作台')
    get('change').click(); get('instance').value = 'http://localhost:9999'; get('cancel').click()
    assert.equal(get('server-form').hidden, true)
    assert.equal(get('instance').value, stored.origin)
    assert.equal(stored.token, 'private-token')
  }
  if (state === 'pending') { get('open-approval').click(); await wait(); assert.equal(opened[0].url, stored.pending.authorizeUrl) }
  dom.window.close()
})

for (const [kind, url, label, flow, capability] of [
  ['class', 'https://corp.orangeapple.co/courses/dt/1024', '同步本班', 'import', 'teaching_data_import'],
  ['report', 'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit', '預填本報告', 'prefill', 'report_prefill'],
  ['other', 'https://corp.orangeapple.co/admissions', '開啟工作台', 'import', null],
  ['other', undefined, '開啟工作台', 'import', null],
]) test(`connected popup offers one action for a ${kind} tab (${url || 'no readable URL'})`, async () => {
  const { dom, w, get, sent } = popup({ state: 'connected', tab: { url, title: '初階程式 A 班 | 橘子蘋果' }, capabilities: { teaching_data_import: true, report_prefill: true }, work: 3 })
  await wait()
  assert.equal(get('connection-card').dataset.context, kind)
  assert.equal(get('primary-label').textContent, label)
  assert.equal(get('primary-action').disabled, false)
  assert.equal(get('open-workspace').hidden, kind !== 'class')
  assert.equal(get('state-label').textContent, '已連線')
  assert.equal(get('work-count').textContent, '3')
  assert.equal(visiblePrimaries(w.document).length, 1)
  if (kind === 'class') assert.equal(get('context-title').textContent, '初階程式 A 班')
  get('primary-action').click(); await wait()
  assert.deepEqual(sent.filter(message => message.type === 'open-integration-workspace').map(message => message.flow), [flow])
  get('open-work').click(); await wait()
  assert.equal(sent.filter(message => message.type === 'open-integration-workspace').at(-1).flow, 'work')
  if (capability) {
    const limited = popup({ state: 'connected', tab: { url }, capabilities: {} })
    await wait()
    assert.equal(limited.get('primary-action').disabled, true)
    assert.equal(limited.get('feature-hint').hidden, false)
    limited.dom.window.close()
  }
  dom.window.close()
})

test('theme, language and server details live behind the gear', async () => {
  const { dom, get } = popup({ state: 'connected', tab: { url: 'https://corp.orangeapple.co/courses/dt/1024' } })
  await wait()
  assert.equal(get('settings-view').hidden, true)
  get('open-settings-panel').click()
  assert.equal(get('settings-view').hidden, false)
  assert.equal(get('main-view').hidden, true)
  assert.equal(get('server-value').textContent, 'http://localhost:5173')
  get('change').click()
  assert.equal(get('settings-view').hidden, true)
  assert.equal(get('server-form').hidden, false)
  assert.equal(get('feature-list').hidden, true)
  dom.window.close()
})

test('page context reuses the site lexicon patterns', () => {
  const dom = trackedDom('', { runScripts: 'outside-only' })
  for (const file of ['sites/orange-apple/core/lexicon.js', 'shared/connection-ui.js']) dom.window.eval(read(`../../${file}`))
  const { pageContext, tabHeading } = dom.window.edulogConnectionUi
  assert.deepEqual({ ...pageContext('https://corp.orangeapple.co/courses/dt/12/') }, { kind: 'class', supported: true, classId: '12' })
  assert.deepEqual({ ...pageContext('https://corp.orangeapple.co/dt_admissions/3/reports/4/edit') }, { kind: 'report', supported: true, admissionId: '3', reportId: '4' })
  assert.equal(pageContext('https://corp.orangeapple.co/courses/dt/12/lesson_reports').kind, 'other')
  assert.equal(pageContext('https://evil.example/courses/dt/12').supported, false)
  assert.equal(pageContext(undefined).kind, 'other')
  assert.equal(tabHeading('初階程式 A 班 - 橘子蘋果'), '初階程式 A 班')
  dom.window.close()
})
