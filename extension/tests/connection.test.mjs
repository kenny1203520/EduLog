import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from '../../app/node_modules/jsdom/lib/api.js'
import { webcrypto } from 'node:crypto'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const wait = () => new Promise(resolve => setTimeout(resolve, 30))
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
  const dom = trackedDom(read('../popup.html'), { url: 'https://extension.example/popup.html', runScripts: 'outside-only' })
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
  for (const file of ['runtime-bridge.js','connection-ui.js','integration-ui.js','popup.js']) w.eval(read(`../${file}`))
  await wait()
  const get = id => w.document.getElementById(id)
  get('instance').value = 'http://localhost:5173'; get('device-name').value = 'Teaching laptop'
  get('server-form').dispatchEvent(new w.Event('submit', { cancelable: true }))
  await wait()
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
  const dom = trackedDom(read('fixtures/class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only' })
  const w = dom.window
  let calls = 0
  const fail = () => { throw new Error('Extension context invalidated.') }
  w.chrome = { runtime: { sendMessage() { calls++; return failure === 'async' ? Promise.reject(new Error('Extension context invalidated.')) : fail() }, onMessage: { addListener() { if (failure === 'listener') fail() } } } }
  for (const file of ['runtime-bridge.js', 'connection-ui.js', 'integration-ui.js', 'adapters/orange-apple-workflows.js', 'adapters/orange-apple.js', 'bootstrap.js', 'content.js']) w.eval(read(`../${file}`))
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
  dom.window.eval(read('../runtime-bridge.js'))
  await assert.rejects(dom.window.edulogRuntime.send({}), error => error.code === 'BRIDGE_UNAVAILABLE')
  assert.equal(dom.window.edulogRuntime.invalidated, false)
  assert.equal((await dom.window.edulogRuntime.send({})).enabled, true)
  dom.window.close()
})

for (const state of ['not-connected', 'pending', 'pairing-expired', 'connected', 'expired', 'revoked', 'unavailable', 'forbidden']) test(`popup renders ${state}, independent UI preferences`, async () => {
  const dom = trackedDom(read('../popup.html'), { url: 'https://extension.example/popup.html', runScripts: 'outside-only' })
  const w = dom.window
  const stored = { origin: 'http://localhost:5173', token: 'private-token', pending: state === 'pending' ? { expiresAt: new Date(Date.now() + 60000).toISOString(), authorizeUrl: 'http://localhost:5173/dashboard/settings?extension_pair=id' } : undefined }
  const opened = []
  w.chrome = { storage: { local: { get: async () => ({ edulogExtension: stored }), set: async () => assert.fail('Unexpected storage write') } }, runtime: { sendMessage: async data => data.type === 'get-edulog-installation' ? { installation_id: '11111111-1111-4111-8111-111111111111', device_name: 'Test browser', browser_name: 'Chrome', platform_name: 'Windows', extension_version: '0.1.0' } : data.type === 'get-ui-preferences' ? { enabled: false } : data.type === 'set-ui-preferences' ? { enabled: data.enabled } : { status: state, origin: stored.origin, settingsUrl: 'http://localhost:5173/dashboard/settings?tab=integrations', lastVerifiedAt: '2026-10-01T00:00:00Z' } }, tabs: { create: async value => opened.push(value) } }
  for (const file of ['runtime-bridge.js', 'connection-ui.js', 'integration-ui.js', 'popup.js']) w.eval(read(`../${file}`))
  await wait()
  const get = id => w.document.getElementById(id)
  assert.equal(get('connection-card').dataset.state, state)
  assert.equal(get('ui-enabled').disabled, false)
  assert.equal(get('ui-enabled').checked, false)
  assert.equal(get('pending-card').hidden, state !== 'pending')
  assert.equal(get('feature-list').hidden, false)
  assert.equal(get('server-form').hidden, !['not-connected', 'expired', 'revoked', 'pairing-expired'].includes(state))
  assert.equal(w.document.body.textContent.includes('private-token'), false)
  if (state === 'connected') {
    assert.match(get('feature-list').textContent, /此操作未就緒/)
    get('change').click(); get('instance').value = 'http://localhost:9999'; get('cancel').click()
    assert.equal(get('server-form').hidden, true)
    assert.equal(get('instance').value, stored.origin)
    assert.equal(stored.token, 'private-token')
  }
  if (state === 'pending') { get('open-approval').click(); await wait(); assert.equal(opened[0].url, stored.pending.authorizeUrl) }
  dom.window.close()
})
