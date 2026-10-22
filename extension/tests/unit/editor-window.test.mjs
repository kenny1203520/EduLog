import test from 'node:test'
import assert from 'node:assert/strict'
import { frontendBase, frontendOrigin, openEditor, readChannel, syncWebBridge } from '../../background/editor-window.js'

// A minimal chrome API: windows, tabs, session storage, permissions and dynamic content scripts.
function fakeChrome({ granted = true } = {}) {
  const calls = [], session = {}, registered = []
  let nextWindow = 50
  globalThis.chrome = {
    windows: {
      update: async (id, value) => { calls.push(['windows.update', id, value]) },
      create: async value => { calls.push(['windows.create', value]); return { id: nextWindow, tabs: [{ id: nextWindow++ * 10 }] } },
    },
    tabs: {
      get: async id => { if (id === 500) return { id, windowId: 50 }; throw new Error('closed') },
      update: async (id, value) => { calls.push(['tabs.update', id, value]) },
    },
    storage: { session: { get: async key => ({ [key]: session[key] }), set: async value => Object.assign(session, value) } },
    permissions: { contains: async () => granted },
    scripting: {
      getRegisteredContentScripts: async () => registered.slice(),
      registerContentScripts: async scripts => { registered.push(...scripts); calls.push(['register', scripts[0].matches[0]]) },
      unregisterContentScripts: async () => { registered.length = 0; calls.push(['unregister']) },
    },
  }
  return { calls, session, registered }
}
const sourceTab = { id: 7, windowId: 3, url: 'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit' }
const binding = { instance: 'https://api.example', userId: 'user-A' }

test('the web app base comes only from a plain settings URL', () => {
  assert.equal(frontendBase('https://web.example/edulog/dashboard/settings?tab=integrations'), 'https://web.example/edulog')
  assert.equal(frontendOrigin('https://web.example/edulog/dashboard/settings'), 'https://web.example')
  assert.equal(frontendBase(['https://', 'user:', 'pw@', 'web.example/dashboard/settings'].join('')), null)
  assert.equal(frontendBase('javascript:alert(1)//dashboard/settings'), null)
  assert.equal(frontendBase('https://web.example/elsewhere'), null)
})

test('wide screens tile the source window left and the editor right, and record one channel per source form', async () => {
  const { calls } = fakeChrome()
  const opened = await openEditor({ sourceTab, base: 'https://web.example/edulog', enrollmentId: 'e1', date: '2026-10-17', formId: 'f1', binding, screen: { left: 0, top: 0, width: 1920, height: 1040 } })
  assert.match(opened.channel, /^[a-f0-9]{32}$/)
  assert.equal(opened.bridge, true)
  assert.deepEqual(calls[0], ['windows.update', 3, { state: 'normal', left: 0, top: 0, width: 960, height: 1040 }])
  const created = calls.find(call => call[0] === 'windows.create')[1]
  assert.deepEqual([created.left, created.top, created.width, created.height], [960, 0, 960, 1040])
  const url = new URL(created.url)
  assert.equal(url.origin + url.pathname, 'https://web.example/edulog/dashboard/reports/e1')
  assert.equal(url.searchParams.get('date'), '2026-10-17')
  assert.equal(url.searchParams.get('source_fill'), opened.channel)
  const channel = await readChannel(opened.channel)
  assert.deepEqual([channel.sourceTabId, channel.sourcePath, channel.formId, channel.enrollmentId, channel.instance, channel.userId], [7, '/dt_admissions/301/reports/401/edit', 'f1', 'e1', 'https://api.example', 'user-A'])
  assert.equal(await readChannel('not-a-channel'), null)
})

test('opening again for the same form reuses the editor window and retires the old channel', async () => {
  const { calls } = fakeChrome()
  const first = await openEditor({ sourceTab, base: 'https://web.example', enrollmentId: 'e1', date: '2026-10-17', formId: 'f1', binding, screen: { left: 0, top: 0, width: 1920, height: 1040 } })
  const second = await openEditor({ sourceTab, base: 'https://web.example', enrollmentId: 'e1', date: '2026-10-17', formId: 'f1', binding, screen: { left: 0, top: 0, width: 1920, height: 1040 } })
  assert.equal(calls.filter(call => call[0] === 'windows.create').length, 1)
  assert.equal(calls.filter(call => call[0] === 'tabs.update').length, 1)
  assert.equal(await readChannel(first.channel), null)
  assert.ok(await readChannel(second.channel))
})

test('narrow screens open the editor without moving the source window', async () => {
  const { calls } = fakeChrome()
  await openEditor({ sourceTab, base: 'https://web.example', enrollmentId: 'e1', date: '2026-10-17', formId: 'f1', binding, screen: { left: 0, top: 0, width: 1024, height: 700 } })
  assert.equal(calls.some(call => call[0] === 'windows.update'), false)
  assert.deepEqual(Object.keys(calls.find(call => call[0] === 'windows.create')[1]).sort(), ['focused', 'type', 'url'])
})

test('the bridge follows the pairing: registered for the web origin, removed when disconnected or not permitted', async () => {
  const { calls, registered } = fakeChrome()
  await syncWebBridge({ status: 'connected', settingsUrl: 'https://web.example/edulog/dashboard/settings' })
  assert.deepEqual(registered.map(script => [script.matches[0], script.js[0]]), [['https://web.example/*', 'content/edulog-bridge.js']])
  await syncWebBridge({ status: 'connected', settingsUrl: 'https://web.example/edulog/dashboard/settings' })
  assert.equal(calls.filter(call => call[0] === 'register').length, 1, 'an unchanged pairing is left alone')
  await syncWebBridge({ status: 'not-connected' })
  assert.equal(registered.length, 0)
  const denied = fakeChrome({ granted: false })
  await syncWebBridge({ status: 'connected', settingsUrl: 'https://web.example/dashboard/settings' })
  assert.equal(denied.registered.length, 0)
})
