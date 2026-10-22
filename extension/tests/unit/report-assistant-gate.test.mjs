import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../../app/node_modules/jsdom/lib/api.js'

// The report assistant leaves the native editor exactly as the site shows it until EduLog is
// connected, offers a class sync (not an error) for an unsynced student, opens the EduLog editor
// beside the form, and reviews a report sent back from it (回填) before anything is applied.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const settle = async (w, rounds = 8) => { for (let i = 0; i < rounds; i++) await new Promise(resolve => w.setTimeout(resolve, 0)) }

function editor({ status, lookup = null, collapsed = false }) {
  const dom = new JSDOM(read('../fixtures/real-report-editor.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, sent = [], listeners = []
  const store = { edulogAssistantCollapsed: collapsed }
  w.chrome = { storage: {
    local: { get: async key => ({ [key]: store[key] }), set: async value => { Object.assign(store, value) } },
    onChanged: { addListener: fn => listeners.push(fn) },
  } }
  const state = { status, details: {} }
  let fill = null
  w.edulogRuntime = { listen: handler => { fill = handler }, send: async message => {
    sent.push(message)
    if (message.type === 'get-edulog-integration-status') return state.status
    if (message.type === 'open-integration-workspace') return { opened: true }
    if (message.operation === 'lookup') return { data: lookup }
    if (message.operation === 'open-editor') return { data: state.open || { opened: true, bridge: true } }
    if (message.operation === 'detail') return { data: state.details[message.reportId] || null }
    return { data: null }
  } }
  const form = w.document.querySelector('form[action^="/dt_admissions/"]')
  const sourceForm = { formId: 'f1', fingerprint: 'fp', action: '/dt_admissions/9001/reports/7001', admissionId: '9001', reportId: '7001', title: '學生甲 課堂紀錄', date: '2026-10-17', dateInfo: {}, supplement: null, fields: [] }
  w.edulogSourceIntegration = { getForm: doc => doc?.contains?.(form) ? form : null, readForm: async () => sourceForm }
  w.eval(read('../../content/editor-prefill.js'))
  const change = async next => { state.status = next; for (const fn of listeners) fn({ edulogExtension: { newValue: {} } }, 'local'); await settle(w) }
  const sendFill = message => new Promise(resolve => { const keep = fill(message, {}, resolve); if (keep !== true) resolve(undefined) })
  return { dom, w, doc: w.document, sent, store, change, sourceForm, state, sendFill }
}
const connected = { status: 'connected', capabilities: { report_prefill: true } }
const assistant = doc => doc.querySelector('.edulog-editor-assistant')
const target = { studentId: 's1', enrollmentId: 'e1-0000-0000', courseId: 'c1', studentName: '學生甲', courseName: '測試課程', className: '週六班' }
const REPORT = '00000000-0000-4000-8000-000000000001'
const synced = (s, reports = []) => ({ connected: true, form: s.sourceForm, target, reports, settingsUrl: 'https://web.example/dashboard/settings', capabilities: {} })
async function withLookup(s, reply) {
  const original = s.w.edulogRuntime.send
  s.w.edulogRuntime = { ...s.w.edulogRuntime, send: async message => message.operation === 'lookup' ? { data: reply } : original(message) }
  assistant(s.doc).shadowRoot.querySelector('.refresh').click(); await settle(s.w)
  return assistant(s.doc).shadowRoot
}

test('not connected: the native editor stays exactly as the site shows it', async () => {
  const s = editor({ status: { status: 'not-connected' } })
  await settle(s.w)
  assert.equal(assistant(s.doc), null)
  assert.equal(s.doc.querySelector('.edulog-editor-layout'), null)
  assert.equal(s.doc.querySelector('.modal').hasAttribute('data-edulog-prefill'), false)
  assert.equal(s.doc.querySelector('[data-edulog-owned]'), null, 'no connect button or any other EduLog control')
  assert.equal(s.sent.some(message => message.type === 'integration-inline-prefill'), false)
  s.dom.window.close()
})

test('connected without the report_prefill capability also stays native', async () => {
  const s = editor({ status: { status: 'connected', capabilities: { report_prefill: false } } })
  await settle(s.w)
  assert.equal(assistant(s.doc), null)
  assert.equal(s.doc.querySelector('[data-edulog-owned]'), null)
  s.dom.window.close()
})

test('connecting later mounts the assistant; disconnecting removes it again', async () => {
  const s = editor({ status: { status: 'not-connected' }, lookup: null })
  await settle(s.w)
  assert.equal(assistant(s.doc), null)
  await s.change(connected)
  assert.ok(assistant(s.doc))
  await s.change({ status: 'revoked' })
  assert.equal(assistant(s.doc), null)
  assert.equal(s.doc.querySelector('[data-edulog-owned]'), null)
  s.dom.window.close()
})

test('connected but unsynced student: one line plus 同步本班, no error and no editor step', async () => {
  const s = editor({ status: connected })
  await settle(s.w)
  const root = await withLookup(s, { ...synced(s), target: null, settingsUrl: '' })
  const status = root.querySelector('[role=status]')
  assert.equal(status.textContent, '此學生尚未同步到 EduLog。同步本班後即可在 EduLog 編輯並回填。')
  assert.equal(status.dataset.error, 'false')
  assert.equal(root.querySelector('.sync-class').hidden, false)
  assert.equal(root.querySelector('.editor-step').hidden, true)
  root.querySelector('.sync-class').click(); await settle(s.w)
  assert.equal(JSON.stringify(s.sent.at(-1)), JSON.stringify({ type: 'open-integration-workspace', flow: 'import' }))
  s.dom.window.close()
})

test('在 EduLog 編輯 asks the background to open the editor beside the form, with the screen area', async () => {
  const s = editor({ status: connected })
  await settle(s.w)
  const root = await withLookup(s, synced(s))
  assert.match(root.querySelector('.editor-step').textContent, /EduLog 還沒有這天的報告/)
  root.querySelector('[data-open-editor]').click(); await settle(s.w)
  const open = s.sent.find(message => message.operation === 'open-editor')
  assert.equal(JSON.stringify([open.formId, open.fingerprint, Object.keys(open.screen).sort()]), JSON.stringify(['f1', 'fp', ['height', 'left', 'top', 'width']]))
  assert.match(root.querySelector('[role=status]').textContent, /已在右側視窗開啟 EduLog/)
  // Without permission for the web app, opening still works but 回填 cannot come back; say so.
  s.state.open = { opened: true, bridge: false }
  root.querySelector('[data-open-editor]').click(); await settle(s.w)
  assert.match(root.querySelector('[role=status]').textContent, /重新連線/)
  assert.equal(root.querySelector('[role=status]').dataset.error, 'true')
  s.dom.window.close()
})

test('a report sent back from the EduLog editor opens the review step; nothing is applied yet', async () => {
  const s = editor({ status: connected, collapsed: true })
  await settle(s.w)
  await withLookup(s, synced(s))
  s.state.details[REPORT] = { id: REPORT, version: 3, enrollment_id: target.enrollmentId, student_id: 's1', occurrence_date: '2026-10-17', student_name: '學生甲', course_name: '測試課程' }
  const reply = await s.sendFill({ type: 'edulog-fill-report', formId: 'f1', reportId: REPORT })
  await settle(s.w)
  assert.equal(JSON.stringify(reply), JSON.stringify({ ok: true }))
  const root = assistant(s.doc).shadowRoot
  assert.equal(assistant(s.doc).dataset.collapsed, 'false', 'a collapsed assistant opens for the review')
  assert.equal(root.querySelector('.review').hidden, false)
  assert.match(root.querySelector('.editor-step summary').textContent, /回填 EduLog 報告 · 2026-10-17/)
  assert.equal(s.sent.some(message => message.operation === 'apply'), false)
  // A request for another form (closed, or a different student) is refused.
  assert.equal(JSON.stringify(await s.sendFill({ type: 'edulog-fill-report', formId: 'other', reportId: REPORT })), JSON.stringify({ ok: false, reason: 'FORM_CLOSED' }))
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
