import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
import { splitBatches, suggestedValue, plainText } from '../workspace-model.js'
function adapter(html, pathname = '/courses/dt/11') {
  const dom = new JSDOM(html, { url: `https://corp.orangeapple.co${pathname}`, runScripts: 'outside-only' })
  Object.defineProperty(dom.window, 'crypto', { value: webcrypto }); dom.window.TextEncoder = TextEncoder
  dom.window.eval(readFileSync(new URL('../adapters/orange-apple-integration.js', import.meta.url), 'utf8'))
  return { dom, doc: dom.window.document, api: dom.window.edulogSourceIntegration }
}
const source = `<div id="page-body"><div class="content"><h2>測試班級</h2><table id="reports"><tbody>
<tr><td><a href="/admissions/comments/301/edit_teacher">同名學生</a><a href="/students/101/accounts">帳號</a><a href="/dt_admissions/301">紀錄</a></td><td><a href="/dt_admissions/301/reports/401/edit">已啟用</a></td></tr>
<tr><td><a href="/admissions/comments/302/edit_teacher">同名學生</a><a href="/students/102/accounts">帳號</a><a href="/dt_admissions/302">紀錄</a></td><td><a href="/dt_admissions/302/reports/402/edit">2026/10/02</a></td></tr>
<tr><td><a href="/admissions/comments/303/edit_teacher">無 ID 學生</a></td></tr></tbody></table><input type="hidden" name="csrf_token" value="secret"><p>聯絡資料不擷取</p></div></div>`
test('source capture requires reliable identity, keeps same names distinct and never invents dates/content', () => {
  const { api, dom, doc } = adapter(source), snapshot = api.extractClass(doc, '/courses/dt/11')
  assert.equal(snapshot.records.filter(r => r.kind === 'student').length, 2)
  assert.equal(snapshot.records.find(r => r.source_id === '401').date, null)
  assert.equal(snapshot.records.find(r => r.source_id === '402').date, '2026-10-02')
  assert.equal(snapshot.records.find(r => r.source_id === '401').data.content, undefined)
  assert.equal(snapshot.records.find(r => r.source_id === '401').data.is_completed, undefined)
  assert.equal(snapshot.issues.length, 1)
  assert.equal(JSON.stringify(snapshot).includes('secret'), false)
  assert.equal(JSON.stringify(snapshot).includes('聯絡資料'), false)
  assert.throws(() => api.extractClass(doc, '/students/101'), /無法辨識/)
  dom.window.close()
})
test('history extraction retains paragraphs only with explicit report identity and full date', () => {
  const html = `<div id="page-body"><div class="content"><table><tbody><tr><td>1</td><td>2026/10/02</td><td><a href="/dt_admissions/301/reports/401/edit">記錄</a><p>評語：第一段\n第二段</p></td></tr><tr><td>2</td><td>10/03</td><td><a href="/dt_admissions/301/reports/402/edit">記錄</a></td></tr></tbody></table></div></div>`
  const { api, doc, dom } = adapter(html); const rows = api.extractHistory(doc, '301')
  assert.equal(rows.length, 1); assert.equal(rows[0].data.content, '第一段\n第二段'); assert.equal(api.extractHistory(doc, '999').length, 0); dom.window.close()
})
test('real name spans and course spans enrich duplicate admissions; absolute action URLs are excluded',()=>{
  const html=`<div id="page-body"><div class="content"><h2>班級</h2><table id="students-table"><tbody><tr><td><span>學生甲</span><a href="/admissions/comments/301/edit_teacher"></a></td><td><span>課程甲</span><div class="text-danger">行政提示</div></td></tr></tbody></table><table id="reports"><tbody><tr><td><span>學生甲</span><a class="admission-comment" href="https://corp.orangeapple.co/admissions/comments/301/edit_teacher"></a><a href="https://corp.orangeapple.co/students/101/accounts">帳號</a><a href="/dt_admissions/301">完整紀錄</a></td><td><span>課程甲</span><div>未完成</div></td></tr><tr><td><span>學生甲</span><a href="/students/101/accounts">帳號</a><a href="/dt_admissions/302">完整紀錄</a></td><td><span>課程乙</span></td></tr></tbody></table></div></div>`
  const {api,doc,dom}=adapter(html);const s=api.extractClass(doc,'/courses/dt/11'),students=s.records.filter(r=>r.kind==='student'),admissions=s.records.filter(r=>r.kind==='enrollment')
  assert.equal(students.length,1);assert.equal(students[0].data.name,'學生甲');assert.equal(admissions.length,2);assert.equal(admissions[0].student_source_id,'101');assert.equal(admissions[0].sourceCourseLabel,'課程甲');assert.equal(admissions[1].sourceCourseLabel,'課程乙');assert.equal(s.issues.length,0);assert.deepEqual(Array.from(s.admissionPaths),['/dt_admissions/301','/dt_admissions/302']);dom.window.close()
})
test('prefill requires current form fingerprint, explicit overwrite and internal opt-in; never submits or confirms', async () => {
  const { api, doc, dom } = adapter(readFileSync(new URL('fixtures/report-modal.html', import.meta.url), 'utf8'))
  const target = await api.readForm(doc), form = doc.querySelector('form'), feedback = doc.querySelector('#lesson_report_feedback')
  let submits = 0, changes = 0; form.addEventListener('submit', () => submits++); feedback.addEventListener('change', () => changes++)
  const input = { formId: target.formId, reportId: target.reportId, fingerprint: target.fingerprint, fields: [{ key: 'content', value: '預填文字' }] }
  await assert.rejects(api.applyForm(doc, input), /覆寫/)
  await assert.rejects(api.applyForm(doc, { ...input, fields: [{ key: 'class_notes', value: '內部' }] }), /內部/)
  await assert.rejects(api.applyForm(doc, { ...input, fields: [{ key: 'is_completed', value: 'guessed', overwrite: true }] }), /選項/)
  const result = await api.applyForm(doc, { ...input, fields: [{ key: 'content', value: '第一段\n\n第二段', overwrite: true }] })
  assert.equal(result.status, 'pending_confirmation'); assert.equal(feedback.value, '第一段\n\n第二段'); assert.equal(changes, 1)
  assert.equal(doc.querySelector('#nothing').checked, false); assert.equal(submits, 0)
  await assert.rejects(api.applyForm(doc, input), /已變更/)
  const current = await api.readForm(doc)
  form.remove(); doc.body.insertAdjacentHTML('beforeend', readFileSync(new URL('fixtures/report-modal.html', import.meta.url), 'utf8'))
  await assert.rejects(api.applyForm(doc, { ...input, fingerprint: current.fingerprint }), /已變更/)
  dom.window.close()
})
test('dependent native select events are dispatched; validation rejects disabled fields before any writes', async () => {
  const { api, doc, dom } = adapter(readFileSync(new URL('fixtures/report-modal.html', import.meta.url), 'utf8'))
  const target = await api.readForm(doc), attendance = doc.querySelector('#lesson_report_attendance_status'); let events = 0
  attendance.addEventListener('change', () => { events++; doc.querySelector('#lesson_report_reason').disabled = false })
  const base = { formId: target.formId, reportId: target.reportId, fingerprint: target.fingerprint }
  await assert.rejects(api.applyForm(doc, { ...base, fields: [{ key: 'attendance_status', value: 'absent' }, { key: 'absence_reason', value: 'other' }] }), /不可預填/)
  assert.equal(attendance.value, '')
  await api.applyForm(doc, { ...base, fields: [{ key: 'attendance_status', value: 'absent' }] }); assert.equal(events, 1); assert.equal(doc.querySelector('#lesson_report_reason').disabled, false)
  dom.window.close()
})
test('batch count and payload limits, verified rating options and plain paragraphs', () => {
  assert.deepEqual(splitBatches(Array.from({ length: 121 }, (_, n) => ({ n }))).map(b => b.rows.length), [50, 50, 21])
  assert.throws(() => splitBatches([{ data: 'x'.repeat(200000) }]), /單筆/)
  const student = { target_id: 'student', record: { kind: 'student', data: { name: '測試' } } }
  const enrollment = { record: { kind: 'enrollment', data: { student_id: 'student' } } }
  const grouped = splitBatches([...Array.from({ length: 49 }, (_, n) => ({ n })), student, enrollment])
  assert.deepEqual(grouped.map(b => b.rows.length), [49, 2])
  assert.deepEqual(grouped[1].rows, [student, enrollment])
  assert.equal(suggestedValue({ key: 'class_participation', options: [{ value: '9' }] }, { class_participation: 4.5 }), '9')
  assert.equal(suggestedValue({ key: 'class_participation', options: [{ value: '8' }] }, { class_participation: 4.5 }), '')
  const { dom, doc } = adapter(''); assert.equal(plainText('<p>甲</p><p>乙</p><script>bad</script>', doc), '甲\n乙'); dom.window.close()
})
