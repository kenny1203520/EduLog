import test from 'node:test'
import assert from 'node:assert/strict'
import { forgetTab, frontendBase, frontendOrigin, openPanel, panelFailed, panelKey, preparePanel, readChannel } from '../../background/editor-panel.js'

// A minimal chrome API: side panel, session storage and permissions.
function fakeChrome({ granted = true } = {}) {
  const calls = [], session = {}
  globalThis.chrome = {
    sidePanel: {
      setOptions: async value => { calls.push(['setOptions', value]) },
      open: async value => { calls.push(['open', value]) },
    },
    storage: { session: {
      get: async key => ({ [key]: session[key] }),
      set: async value => { calls.push(['session.set', Object.keys(value)]); Object.assign(session, value) },
      remove: async key => { delete session[key] },
    } },
    permissions: { contains: async () => granted },
  }
  return { calls, session }
}
const sourceTab = { id: 7, windowId: 3, url: 'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit' }
const binding = { instance: 'https://api.example', userId: 'user-A' }
const prepare = (extra = {}) => preparePanel({ sourceTab, base: 'https://web.example/edulog', enrollmentId: 'e1', date: '2026-10-17', formId: 'f1', binding, label: '學生甲 · 週六班 · 2026-10-17', ...extra })

test('the web app base comes only from a plain settings URL', () => {
  assert.equal(frontendBase('https://web.example/edulog/dashboard/settings?tab=integrations'), 'https://web.example/edulog')
  assert.equal(frontendOrigin('https://web.example/edulog/dashboard/settings'), 'https://web.example')
  assert.equal(frontendBase(['https://', 'user:', 'pw@', 'web.example/dashboard/settings'].join('')), null)
  assert.equal(frontendBase('javascript:alert(1)//dashboard/settings'), null)
  assert.equal(frontendBase('https://web.example/elsewhere'), null)
})

test('opening calls sidePanel.open synchronously, for that tab only, showing loading first', () => {
  const { calls, session } = fakeChrome()
  const opening = openPanel(7)
  // Nothing may be awaited before open(): the browser allows it only during the click.
  const panel = calls.filter(call => call[0] !== 'session.set')
  assert.deepEqual(panel, [['setOptions', { tabId: 7, path: 'sidepanel/panel.html?tab=7', enabled: true }], ['open', { tabId: 7 }]])
  assert.equal(session[panelKey(7)].state, 'loading')
  return opening
})

test('preparing records one fill channel per source tab and hands the panel the editor address', async () => {
  const { session } = fakeChrome()
  const first = await prepare()
  assert.match(first.channel, /^[a-f0-9]{32}$/)
  assert.equal(first.access, true)
  const state = session[panelKey(7)]
  const url = new URL(state.url)
  assert.equal(url.origin + url.pathname, 'https://web.example/edulog/dashboard/reports/e1')
  assert.equal(url.searchParams.get('date'), '2026-10-17')
  assert.equal(url.searchParams.get('source_fill'), first.channel)
  assert.deepEqual([state.state, state.origin, state.channel, state.label], ['ready', 'https://web.example', first.channel, '學生甲 · 週六班 · 2026-10-17'])
  const channel = await readChannel(first.channel)
  assert.deepEqual([channel.sourceTabId, channel.sourcePath, channel.formId, channel.enrollmentId, channel.instance, channel.userId], [7, '/dt_admissions/301/reports/401/edit', 'f1', 'e1', 'https://api.example', 'user-A'])
  assert.equal('token' in channel, false, 'the channel never holds the extension token')
  const second = await prepare()
  assert.equal(await readChannel(first.channel), null, 'reopening retires the previous channel')
  assert.ok(await readChannel(second.channel))
  assert.equal(await readChannel('not-a-channel'), null)
})

test('without access to the web app origin, the panel asks for it instead of framing a signed-out app', async () => {
  const { session } = fakeChrome({ granted: false })
  const prepared = await prepare()
  assert.equal(prepared.access, false)
  assert.equal(session[panelKey(7)].state, 'no-access')
})

test('a failure is shown in the panel, and a closed tab takes its panel and channel with it', async () => {
  const { session } = fakeChrome()
  await panelFailed(7, '此學生尚未同步到 EduLog。')
  assert.deepEqual([session[panelKey(7)].state, session[panelKey(7)].message], ['error', '此學生尚未同步到 EduLog。'])
  const { channel } = await prepare()
  await forgetTab(7)
  assert.equal(session[panelKey(7)], undefined)
  assert.equal(await readChannel(channel), null)
})
