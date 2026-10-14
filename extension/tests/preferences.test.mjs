import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function worker(fetchImpl = async () => { throw new Error('offline') }) {
  const storage = { edulogExtension: { token: 'test-secret', origin: 'http://localhost:3000', settingsUrl: 'http://localhost:5173/dashboard/settings?tab=integrations' } }
  const broadcasts = [], opened = []
  let listener
  const id = 'a'.repeat(32)
  const chrome = {
    runtime: { id, getURL: path => `chrome-extension://${id}/${path}`, getManifest: () => ({ version: '0.1.0' }), onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn } } },
    storage: { local: { get: async key => ({ [key]: storage[key] }), set: async items => Object.assign(storage, items), setAccessLevel: async () => {} } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://corp.orangeapple.co/' }, { id: 2, url: 'https://corp.orangeapple.co/my' }, { id: 3, url: 'https://untrusted.example/' }],
      sendMessage: async (tab, message) => broadcasts.push({ tab, message }),
      create: async options => opened.push(options),
    },
  }
  const context = vm.createContext({ chrome, URL, AbortSignal, fetch: fetchImpl, installWorkspaceBroker() {}, crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' }, navigator: { platform: 'Win32', userAgent: 'Chrome' } })
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
  for (const file of ['lexicon', 'model']) vm.runInContext(read(`../adapters/orange-apple-${file}.js`), context)
  vm.runInContext(read('../adapters/orange-apple.js'), context)
  vm.runInContext(read('../installation.js'), context)
  vm.runInContext(read('../service-worker.js').replace(/^import[^\n]*\n/gm, ''), context)
  const send = (message, sender) => new Promise(resolve => listener(message, sender, resolve))
  return { storage, broadcasts, opened, listener, send, popup: { id, url: `chrome-extension://${id}/popup.html` }, site: { id, url: 'https://corp.orangeapple.co/' } }
}
test('UI preference defaults on without pairing and persists only non-secret settings', async () => {
  const w = worker()
  delete w.storage.edulogExtension
  assert.equal((await w.send({ type: 'get-ui-preferences' }, w.site)).enabled, true)
  const response = await w.send({ type: 'set-ui-preferences', enabled: false }, w.popup)
  assert.equal(response.enabled, false)
  assert.equal((await w.send({ type: 'get-ui-preferences' }, w.site)).enabled, false)
  assert.equal(w.broadcasts.length, 2)
  assert.equal(w.broadcasts[0].tab, 1)
  assert.equal(w.broadcasts[1].tab, 2)
  assert.equal(JSON.stringify(w.storage.edulogUiPreferences), '{"orange-apple":{"enabled":false}}')
})

test('shared language is bounded and does not toggle the website theme',async()=>{
  const w=worker();await w.send({type:'set-ui-preferences',enabled:false},w.popup)
  const result=await w.send({type:'set-ui-preferences',language:'en'},w.site)
  assert.equal(result.language,'en');assert.equal(result.enabled,false);assert.equal(w.storage.edulogWorkspaceLocale,'en')
  assert.equal((await w.send({type:'set-ui-preferences',language:'fr'},w.popup)).error,'INVALID_LANGUAGE')
  assert.equal(w.storage.edulogWorkspaceLocale,'en');assert.equal(w.storage.edulogExtension.token,'test-secret')
})

test('verification refreshes legacy frontend URL and exposes no credentials', async () => {
  const w = worker(async () => ({ ok: true, json: async () => ({ data: { user_id: 'user', settings_url: 'https://web.example:8443/edulog/dashboard/settings?tab=integrations' } }) }))
  w.storage.edulogExtension.tokenExpiresAt = '2099-01-01T00:00:00Z'
  const result = await w.send({ type: 'get-edulog-integration-status' }, w.popup)
  assert.equal(result.status, 'connected')
  assert.equal(result.settingsUrl, 'https://web.example:8443/edulog/dashboard/settings?tab=integrations')
  assert.equal(w.storage.edulogExtension.settingsUrl, result.settingsUrl)
  assert.ok(result.lastVerifiedAt)
  assert.equal(JSON.stringify(result).includes('test-secret'), false)
})

test('legacy adoption binds only the authenticated token and keeps identity out of content status', async () => {
  const calls = []
  const w = worker(async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => ({ data: { user_id: 'user', connection: { installation_id: calls.length === 1 ? null : '11111111-1111-4111-8111-111111111111', device_name: 'Teaching laptop' } } }) }
  })
  w.storage.edulogExtension.tokenExpiresAt = '2099-01-01T00:00:00Z'
  const status = await w.send({ type: 'get-edulog-integration-status' }, w.site)
  assert.equal(status.status, 'connected')
  assert.equal(status.deviceName, 'Teaching laptop')
  assert.equal(calls[1].options.method, 'PATCH')
  assert.match(calls[1].url, /\/v1\/installation$/)
  assert.equal(JSON.parse(calls[1].options.body).installation_id, w.storage.edulogInstallation.installation_id)
  assert.equal(JSON.stringify(status).includes('installation_id'), false)
  assert.equal(JSON.stringify(status).includes('test-secret'), false)
  let responded = false
  assert.equal(w.listener({ type: 'get-edulog-installation' }, w.site, () => { responded = true }), undefined)
  assert.equal(responded, false)
})

test('a superseded legacy verification cannot adopt over the new local pairing', async () => {
  let calls = 0
  const w = worker(async () => {
    calls++
    w.storage.edulogExtension = { ...w.storage.edulogExtension, token: 'new-secret' }
    return { ok: true, json: async () => ({ data: { user_id: 'user', connection: { installation_id: null } } }) }
  })
  w.storage.edulogExtension.tokenExpiresAt = '2099-01-01T00:00:00Z'
  const result = await w.send({ type: 'get-edulog-integration-status' }, w.popup)
  assert.equal(result.status, 'stale')
  assert.equal(calls, 1)
  assert.equal(w.storage.edulogExtension.token, 'new-secret')
})

test('network failure retains pairing and revoked credentials are distinguished', async () => {
  const w = worker()
  w.storage.edulogExtension.tokenExpiresAt = '2099-01-01T00:00:00Z'
  assert.equal((await w.send({ type: 'get-edulog-integration-status' }, w.site)).status, 'unavailable')
  assert.equal(w.storage.edulogExtension.token, 'test-secret')
  const revoked = worker(async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 'EXTENSION_AUTH_INVALID', request_id: 'request-123' } }) }))
  revoked.storage.edulogExtension.tokenExpiresAt = '2099-01-01T00:00:00Z'
  const result = await revoked.send({ type: 'get-edulog-integration-status' }, revoked.popup)
  assert.equal(result.status, 'revoked')
  assert.equal(result.diagnostic.requestId, 'request-123')
})

test('late verification cannot overwrite a newer pairing', async () => {
  let complete
  const w = worker(() => new Promise(resolve => { complete = resolve }))
  w.storage.edulogExtension.tokenExpiresAt = '2099-01-01T00:00:00Z'
  const result = w.send({ type: 'get-edulog-integration-status' }, w.popup)
  await new Promise(resolve => setTimeout(resolve, 0))
  w.storage.edulogExtension = { origin: 'https://new.example', token: 'new-token' }
  complete({ ok: true, json: async () => ({ data: { user_id: 'user', settings_url: 'https://old.example/dashboard/settings' } }) })
  assert.equal((await result).status, 'stale')
  assert.equal(w.storage.edulogExtension.token, 'new-token')
  assert.equal(w.storage.edulogExtension.settingsUrl, undefined)
})
test('rejects untrusted/unknown pages and never exposes tokens to content scripts', async () => {
  const w = worker()
  for (const url of ['https://untrusted.example/', 'https://corp.orangeapple.co/unknown', 'http://corp.orangeapple.co/']) {
    assert.equal(w.listener({ type: 'set-ui-preferences', enabled: false }, { url }, () => assert.fail('Unexpected response')), undefined)
  }
  const result = await w.send({ type: 'set-ui-preferences', enabled: true }, w.site)
  assert.equal(JSON.stringify(result).includes('test-secret'), false)
  assert.equal(JSON.stringify(w.broadcasts).includes('test-secret'), false)
  assert.equal(w.storage.edulogExtension.token, 'test-secret')
})
test('settings links use the paired frontend address rather than API port', async () => {
  const w = worker()
  assert.equal((await w.send({ type: 'open-edulog-settings' }, w.site)).opened, true)
  assert.equal(w.opened[0].url, 'http://localhost:5173/dashboard/settings?tab=integrations')
  delete w.storage.edulogExtension.settingsUrl
  assert.equal((await w.send({ type: 'open-edulog-settings' }, w.site)).opened, false)
  assert.equal(w.opened.length, 1)
})

test('per-page original mode is bounded, broadcast and removed when switched back', async () => {
  const w = worker()
  const saved = await w.send({ type: 'set-ui-preferences', page: 'reports', pageMode: 'original' }, w.site)
  assert.equal(saved.enabled, true)
  assert.equal(JSON.stringify(saved.pages), '{"reports":"original"}')
  assert.equal(JSON.stringify(w.broadcasts.at(-1).message), '{"type":"ui-preferences-changed","enabled":true,"pages":{"reports":"original"}}')
  await w.send({ type: 'set-ui-preferences', enabled: false }, w.popup)
  assert.equal(JSON.stringify(w.storage.edulogUiPreferences), '{"orange-apple":{"enabled":false,"pages":{"reports":"original"}}}')
  assert.equal((await w.send({ type: 'set-ui-preferences', page: 'admin', pageMode: 'original' }, w.site)).error, 'INVALID_PAGE_MODE')
  assert.equal((await w.send({ type: 'set-ui-preferences', page: 'class', pageMode: 'hidden' }, w.site)).error, 'INVALID_PAGE_MODE')
  const cleared = await w.send({ type: 'set-ui-preferences', page: 'reports', pageMode: 'enhanced' }, w.site)
  assert.equal(JSON.stringify(cleared.pages), '{}')
  assert.equal(JSON.stringify(w.storage.edulogUiPreferences), '{"orange-apple":{"enabled":false}}')
})
