import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const wait = () => new Promise(resolve => setTimeout(resolve, 30))

for (const failure of ['sync', 'async', 'listener']) test(`invalidated ${failure}: preserves drafts and stops communications`, async () => {
  const dom = new JSDOM(read('fixtures/class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only' })
  const w = dom.window
  let calls = 0
  const fail = () => { throw new Error('Extension context invalidated.') }
  w.chrome = { runtime: { sendMessage() { calls++; return failure === 'async' ? Promise.reject(new Error('Extension context invalidated.')) : fail() }, onMessage: { addListener() { if (failure === 'listener') fail() } } } }
  for (const file of ['runtime-bridge.js', 'connection-ui.js', 'adapters/orange-apple-workflows.js', 'adapters/orange-apple.js', 'bootstrap.js', 'content.js']) w.eval(read(`../${file}`))
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
  const dom = new JSDOM('', { runScripts: 'outside-only' })
  let calls = 0
  dom.window.chrome = { runtime: { sendMessage() { return ++calls === 1 ? Promise.reject(new Error('Receiving end does not exist')) : Promise.resolve({ enabled: true }) } } }
  dom.window.eval(read('../runtime-bridge.js'))
  await assert.rejects(dom.window.edulogRuntime.send({}), error => error.code === 'BRIDGE_UNAVAILABLE')
  assert.equal(dom.window.edulogRuntime.invalidated, false)
  assert.equal((await dom.window.edulogRuntime.send({})).enabled, true)
  dom.window.close()
})

for (const state of ['not-connected', 'pending', 'pairing-expired', 'connected', 'expired', 'revoked', 'unavailable', 'forbidden']) test(`popup renders ${state}, independent UI preferences`, async () => {
  const dom = new JSDOM(read('../popup.html'), { url: 'https://extension.example/popup.html', runScripts: 'outside-only' })
  const w = dom.window
  const stored = { origin: 'http://localhost:5173', token: 'private-token', pending: state === 'pending' ? { expiresAt: new Date(Date.now() + 60000).toISOString(), authorizeUrl: 'http://localhost:5173/dashboard/settings?extension_pair=id' } : undefined }
  const opened = []
  w.chrome = { storage: { local: { get: async () => ({ edulogExtension: stored }), set: async () => assert.fail('Unexpected storage write') } }, runtime: { sendMessage: async data => data.type === 'get-ui-preferences' ? { enabled: false } : data.type === 'set-ui-preferences' ? { enabled: data.enabled } : { status: state, origin: stored.origin, settingsUrl: 'http://localhost:5173/dashboard/settings?tab=integrations', lastVerifiedAt: '2026-10-01T00:00:00Z' } }, tabs: { create: async value => opened.push(value) } }
  for (const file of ['runtime-bridge.js', 'connection-ui.js', 'popup.js']) w.eval(read(`../${file}`))
  await wait()
  const get = id => w.document.getElementById(id)
  assert.equal(get('connection-card').dataset.state, state)
  assert.equal(get('ui-enabled').disabled, false)
  assert.equal(get('ui-enabled').checked, false)
  assert.equal(get('pending-card').hidden, state !== 'pending')
  assert.equal(get('feature-list').hidden, state !== 'connected')
  assert.equal(get('server-form').hidden, !['not-connected', 'expired', 'revoked', 'pairing-expired'].includes(state))
  assert.equal(w.document.body.textContent.includes('private-token'), false)
  if (state === 'connected') {
    assert.match(get('feature-list').textContent, /目前版本尚未支援/)
    get('change').click(); get('instance').value = 'http://localhost:9999'; get('cancel').click()
    assert.equal(get('server-form').hidden, true)
    assert.equal(get('instance').value, stored.origin)
    assert.equal(stored.token, 'private-token')
  }
  if (state === 'pending') { get('open-approval').click(); await wait(); assert.equal(opened[0].url, stored.pending.authorizeUrl) }
  dom.window.close()
})
