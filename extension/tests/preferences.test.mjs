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
    runtime: { id, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn } } },
    storage: { local: { get: async key => ({ [key]: storage[key] }), set: async items => Object.assign(storage, items), setAccessLevel: async () => {} } },
    tabs: {
      query: async () => [{ id: 1, url: 'https://corp.orangeapple.co/' }, { id: 2, url: 'https://corp.orangeapple.co/my' }, { id: 3, url: 'https://untrusted.example/' }],
      sendMessage: async (tab, message) => broadcasts.push({ tab, message }),
      create: async options => opened.push(options),
    },
  }
  const context = vm.createContext({ chrome, URL, AbortSignal, fetch: fetchImpl })
  const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
  vm.runInContext(read('../adapters/orange-apple.js'), context)
  vm.runInContext(read('../service-worker.js').replace(/^import[^\n]*\n/, ''), context)
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
