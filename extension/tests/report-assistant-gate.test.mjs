import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// The report assistant must leave the native editor alone until EduLog is connected,
// and must offer a class sync (not an error) when the student is not synced yet.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const settle = async (w, rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => w.setTimeout(resolve, 0)) }

function editor({ status, lookup = null, collapsed = false }) {
  const dom = new JSDOM(read('fixtures/real-report-editor.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, sent = [], listeners = []
  const store = { edulogAssistantCollapsed: collapsed }
  w.chrome = { storage: {
    local: { get: async key => ({ [key]: store[key] }), set: async value => { Object.assign(store, value) } },
    onChanged: { addListener: fn => listeners.push(fn) },
  } }
  const state = { status }
  w.edulogRuntime = { send: async message => {
    sent.push(message)
    if (message.type === 'get-edulog-integration-status') return state.status
    if (message.type === 'open-integration-workspace') return { opened: true }
    if (message.operation === 'lookup') return { data: lookup }
    return { data: null }
  } }
  const form = w.document.querySelector('form[action^="/dt_admissions/"]')
  const sourceForm = { formId: 'f1', fingerprint: 'fp', action: '/dt_admissions/9001/reports/7001', admissionId: '9001', reportId: '7001', title: '學生甲 課堂紀錄', date: '2026-10-17', dateInfo: {}, supplement: null, fields: [] }
  w.edulogSourceIntegration = { getForm: doc => doc?.contains?.(form) ? form : null, readForm: async () => sourceForm }
  w.eval(read('../editor-prefill.js'))
  const change = async next => { state.status = next; for (const fn of listeners) fn({ edulogExtension: { newValue: {} } }, 'local'); await settle(w) }
  return { dom, w, doc: w.document, sent, store, change, sourceForm }
}
const connected = { status: 'connected', capabilities: { report_prefill: true } }
const assistant = doc => doc.querySelector('.edulog-editor-assistant')
const gate = doc => doc.querySelector('.edulog-prefill-gate')

test('not connected: no assistant panel, only a small connect button in the modal header', async () => {
  const s = editor({ status: { status: 'not-connected' } })
  await settle(s.w)
  assert.equal(assistant(s.doc), null)
  assert.equal(s.doc.querySelector('.edulog-editor-layout'), null)
  assert.equal(s.doc.querySelector('.modal').hasAttribute('data-edulog-prefill'), false)
  assert.ok(gate(s.doc)?.closest('.modal-header'))
  assert.equal(gate(s.doc).textContent, '連接 EduLog 以啟用報告助手')
  assert.equal(s.sent.some(message => message.type === 'integration-inline-prefill'), false)
  gate(s.doc).click(); await settle(s.w)
  assert.equal(JSON.stringify(s.sent.at(-1)), JSON.stringify({ type: 'open-integration-workspace', flow: 'prefill' }))
  s.dom.window.close()
})

test('connected without the report_prefill capability stays gated', async () => {
  const s = editor({ status: { status: 'connected', capabilities: { report_prefill: false } } })
  await settle(s.w)
  assert.equal(assistant(s.doc), null)
  assert.ok(gate(s.doc))
  s.dom.window.close()
})

test('connecting later mounts the assistant and removes the gate', async () => {
  const s = editor({ status: { status: 'not-connected' }, lookup: null })
  await settle(s.w)
  assert.ok(gate(s.doc))
  await s.change(connected)
  assert.equal(gate(s.doc), null)
  assert.ok(assistant(s.doc))
  await s.change({ status: 'revoked' })
  assert.equal(assistant(s.doc), null)
  assert.ok(gate(s.doc))
  s.dom.window.close()
})

test('connected but unsynced student: one line plus 同步本班, no error and no empty steps', async () => {
  const s = editor({ status: connected })
  await settle(s.w)
  const root = assistant(s.doc).shadowRoot
  // The lookup stub returns no data until a reply is configured; give it an unsynced reply and recheck.
  const reply = { connected: true, form: s.sourceForm, target: null, reports: [], settingsUrl: '', capabilities: {} }
  const original = s.w.edulogRuntime.send
  s.w.edulogRuntime = { send: async message => message.operation === 'lookup' ? { data: reply } : original(message) }
  root.querySelector('.refresh').click(); await settle(s.w)
  const status = root.querySelector('[role=status]')
  assert.equal(status.textContent, '此學生尚未同步到 EduLog。同步本班後即可預填。')
  assert.equal(status.dataset.error, 'false')
  assert.equal(root.querySelector('.sync-class').hidden, false)
  assert.equal(root.querySelector('.candidates').hidden, true)
  assert.equal(root.querySelector('.questions').open, false)
  root.querySelector('.sync-class').click(); await settle(s.w)
  assert.equal(JSON.stringify(s.sent.at(-1)), JSON.stringify({ type: 'open-integration-workspace', flow: 'import' }))
  s.dom.window.close()
})

test('collapse state is remembered and restored on the next editor', async () => {
  const s = editor({ status: connected })
  await settle(s.w)
  const collapse = [...assistant(s.doc).shadowRoot.querySelectorAll('header button')].find(button => button.textContent === '收合助手')
  collapse.click(); await settle(s.w)
  assert.equal(s.store.edulogAssistantCollapsed, true)
  const next = editor({ status: connected, collapsed: true })
  await settle(next.w)
  assert.equal(assistant(next.doc).dataset.collapsed, 'true')
  assert.equal(next.doc.querySelector('.edulog-editor-layout').hidden, true)
  next.dom.window.close()
  s.dom.window.close()
})
