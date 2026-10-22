import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../../app/node_modules/jsdom/lib/api.js'

// The report assistant leaves the native editor exactly as the site shows it until EduLog is
// connected. Connected, it is one card above the site's form: it offers a class sync (not an error)
// for an unsynced student, opens the EduLog editor beside the window, and lists only the fields a
// report sent back (回填) would change before anything is applied.
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
    if (message.operation === 'open-editor') return { data: state.open || { opened: true, access: true } }
    if (message.operation === 'detail') return { data: state.details[message.reportId] || null }
    if (message.operation === 'apply') { for (const item of message.input.fields) sourceForm.fields.find(f => f.key === item.key).value = item.value; return { data: { applied: message.input.fields.length } } }
    return { data: null }
  } }
  const form = w.document.querySelector('form[action^="/dt_admissions/"]')
  const sourceForm = { formId: 'f1', fingerprint: 'fp', action: '/dt_admissions/9001/reports/7001', admissionId: '9001', reportId: '7001', title: '學生甲 課堂紀錄', date: '2026-10-17', dateInfo: {}, supplement: null, fields: [] }
  w.edulogSourceIntegration = { getForm: doc => doc?.contains?.(form) ? form : null, readForm: async () => sourceForm, fieldNodes: () => [form.querySelector('textarea') || form] }
  w.eval(read('../../shared/field-mappings.js'))
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

test('在 EduLog 編輯 asks the background to open the side panel within the same click', async () => {
  const s = editor({ status: connected })
  await settle(s.w)
  const root = await withLookup(s, synced(s))
  assert.match(root.querySelector('.editor-step').textContent, /EduLog 還沒有這天的報告/)
  root.querySelector('[data-open-editor]').click()
  // The browser opens a side panel only during the click, so the request may not wait for anything.
  const open = s.sent.find(message => message.operation === 'open-editor')
  assert.equal(JSON.stringify([open.formId, open.fingerprint, 'screen' in open]), JSON.stringify(['f1', 'fp', false]))
  await settle(s.w)
  assert.match(root.querySelector('[role=status]').textContent, /側邊欄開啟.*回填到原站/)
  assert.equal(root.querySelector('section').dataset.state, 'waiting')
  assert.equal(root.querySelector('[data-open-editor]').textContent, '重新開啟 EduLog 側邊欄')
  // Without access to the web app origin, the panel asks for it; the card points there.
  s.state.open = { opened: true, access: false }
  root.querySelector('[data-open-editor]').click(); await settle(s.w)
  assert.match(root.querySelector('[role=status]').textContent, /允許存取 EduLog 網站/)
  s.dom.window.close()
})

const FIELDS = () => [
  { key: 'content', label: '學習表現', type: 'text', value: '', options: [] },
  { key: 'contact_notes', label: '聯絡欄', type: 'text', value: '舊的聯絡內容', options: [] },
  { key: 'class_notes', label: '內部紀錄', type: 'text', value: '', internal: true, options: [] },
  { key: 'absence_reason', label: '不出席原因', type: 'text', value: '原站原因', options: [] },
  { key: 'lesson_id', label: '學習課程', type: 'select', value: '', options: [{ value: '11', label: '另一份教材' }] },
  { key: 'progress_end', label: '章節終點', type: 'select', value: 'p2', options: [{ value: 'p2', label: 'B' }, { value: 'p3', label: 'C' }] },
]
const DETAIL = { id: REPORT, version: 3, enrollment_id: target.enrollmentId, student_id: 's1', occurrence_date: '2026-10-17', content: '今天表現很好', contact_notes: '新的聯絡內容', class_notes: '只給老師看', lesson_id: 'l1', lesson_name: '測試教材', progress_letter: 'B-C' }

test('回填 from the side panel overwrites the site form with the EduLog report; it is never submitted', async () => {
  const s = editor({ status: connected, collapsed: true })
  await settle(s.w)
  s.sourceForm.fields = FIELDS()
  await withLookup(s, synced(s))
  s.state.details[REPORT] = DETAIL
  const reply = await s.sendFill({ type: 'edulog-fill-report', formId: 'f1', reportId: REPORT })
  await settle(s.w)
  assert.equal(JSON.stringify(reply), JSON.stringify({ ok: true, applied: 4, skipped: 1 }))
  // Replacing site content and the internal note go in without a tick; an empty EduLog value never
  // clears the site, and an option without a verified mapping is left for the teacher.
  const sent = s.sent.filter(message => message.operation === 'apply').flatMap(message => message.input.fields)
  assert.equal(JSON.stringify(sent.map(f => [f.key, f.value, f.overwrite, f.includeInternal])), JSON.stringify([
    ['content', '今天表現很好', false, false], ['contact_notes', '新的聯絡內容', true, false],
    ['class_notes', '只給老師看', false, true], ['progress_end', 'p3', true, false],
  ]))
  assert.equal(s.sourceForm.fields.find(f => f.key === 'absence_reason').value, '原站原因')
  const root = assistant(s.doc).shadowRoot
  assert.equal(assistant(s.doc).dataset.collapsed, 'false', 'a collapsed assistant opens to show what was filled')
  assert.equal(root.querySelector('section').dataset.state, 'applied')
  const outcome = root.querySelector('.outcome').textContent
  assert.match(outcome, /已用 EduLog 內容覆蓋原站表單/)
  assert.match(outcome, /聯絡欄：舊的聯絡內容 → 新的聯絡內容/)
  assert.match(outcome, /需要在原站選擇：學習課程/)
  assert.ok(s.doc.querySelector('[data-edulog-filled=ok]'), 'filled site fields are marked')
  assert.equal(s.sent.some(message => /submit/i.test(JSON.stringify(message))), false)
  // A request for another form (closed, or a different student) is refused.
  assert.equal(JSON.stringify(await s.sendFill({ type: 'edulog-fill-report', formId: 'other', reportId: REPORT })), JSON.stringify({ ok: false, reason: 'FORM_CLOSED' }))
  s.dom.window.close()
})

test('a report for another date is not filled automatically; it opens the review instead', async () => {
  const s = editor({ status: connected })
  await settle(s.w)
  s.sourceForm.fields = FIELDS()
  await withLookup(s, synced(s))
  s.state.details[REPORT] = { ...DETAIL, occurrence_date: '2026-10-10' }
  const reply = await s.sendFill({ type: 'edulog-fill-report', formId: 'f1', reportId: REPORT })
  await settle(s.w)
  assert.equal(JSON.stringify(reply), JSON.stringify({ ok: true, applied: 0, skipped: 0, review: true }))
  const root = assistant(s.doc).shadowRoot
  assert.equal(root.querySelector('section').dataset.state, 'review')
  assert.ok(root.querySelector('[data-mismatch]'))
  assert.equal(s.sent.some(message => message.operation === 'apply'), false)
  s.dom.window.close()
})

test('when the report is unavailable, 回填 replies with the reason', async () => {
  const s = editor({ status: connected })
  await settle(s.w)
  await withLookup(s, synced(s))
  assert.equal(JSON.stringify(await s.sendFill({ type: 'edulog-fill-report', formId: 'f1', reportId: REPORT })), JSON.stringify({ ok: false, reason: 'REPORT_UNAVAILABLE' }))
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
  assert.equal(assistant(next.doc).shadowRoot.querySelector('.assistant-body').hidden, true)
  assert.ok(assistant(next.doc).nextElementSibling.matches('form'), 'the card sits right above the untouched site form')
  next.dom.window.close()
  s.dom.window.close()
})

test('picked on the card, the review lists only changed fields; replacing site content or an internal note needs its own tick', async () => {
  const s = editor({ status: connected })
  await settle(s.w)
  s.sourceForm.fields = [
    { key: 'content', label: '學習表現', type: 'text', value: '', options: [] },
    { key: 'contact_notes', label: '聯絡欄', type: 'text', value: '舊的聯絡內容', options: [] },
    { key: 'class_notes', label: '內部紀錄', type: 'text', value: '', internal: true, options: [] },
    { key: 'absence_reason', label: '不出席原因', type: 'text', value: '', options: [] },
    { key: 'progress_start', label: '章節起點', type: 'text', value: 'B', options: [] },
  ]
  const root = await withLookup(s, synced(s, [{ id: REPORT, enrollment_id: target.enrollmentId, occurrence_date: '2026-10-17' }]))
  s.state.details[REPORT] = { id: REPORT, version: 3, enrollment_id: target.enrollmentId, student_id: 's1', occurrence_date: '2026-10-17', content: '今天表現很好', contact_notes: '新的聯絡內容', class_notes: '只給老師看', progress_letter: 'B-C' }
  ;[...root.querySelectorAll('.editor-step button')].find(button => button.textContent === '直接回填這天的 EduLog 報告').click(); await settle(s.w)
  const rows = Object.fromEntries([...root.querySelectorAll('.field')].map(row => [row.dataset.fieldKey, row]))
  assert.deepEqual(Object.keys(rows), ['content', 'contact_notes', 'class_notes'], 'unchanged and empty fields are folded away')
  assert.match(root.querySelector('.same summary').textContent, /^2 個欄位/)
  assert.equal(rows.content.querySelector('[data-include]').checked, true, 'new content starts ticked')
  assert.equal(rows.contact_notes.dataset.kind, 'overwrite')
  assert.equal(rows.contact_notes.querySelector('[data-include]').checked, false, 'replacing site content starts unticked')
  assert.match(rows.contact_notes.querySelector('.old').textContent, /舊的聯絡內容/)
  assert.match(rows.contact_notes.querySelector('.new').textContent, /新的聯絡內容/)
  assert.equal(rows.class_notes.querySelector('[data-include]').checked, false, 'internal notes start unticked')
  const apply = root.querySelector('[data-apply]')
  assert.equal(apply.textContent, '套用 1 個欄位')
  rows.contact_notes.querySelector('[data-include]').click(); await settle(s.w)
  assert.equal(apply.textContent, '套用 2 個欄位（覆寫 1）')
  apply.click(); await settle(s.w)
  const sent = s.sent.find(message => message.operation === 'apply').input.fields
  assert.equal(JSON.stringify(sent.map(f => [f.key, f.overwrite, Boolean(f.includeInternal)])), JSON.stringify([['content', false, false], ['contact_notes', true, false]]))
  assert.equal(root.querySelector('section').dataset.state, 'applied')
  assert.match(root.querySelector('.outcome').textContent, /已填入原站表單/)
  assert.ok(s.doc.querySelector('[data-edulog-filled=ok]'), 'the filled site field is marked')
  await s.change({ status: 'revoked' })
  assert.equal(s.doc.querySelector('[data-edulog-filled]'), null, 'marks go away with the assistant')
  s.dom.window.close()
})
