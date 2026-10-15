import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
import { splitBatches, validateBatches, workspaceErrorMessage, isUnsupportedReportEvidencePathValidation, suggestedValue, plainText } from '../workspace-model.js'
function adapter(html, pathname = '/courses/dt/11') {
  const dom = new JSDOM(html, { url: `https://corp.orangeapple.co${pathname}`, runScripts: 'outside-only' })
  Object.defineProperty(dom.window, 'crypto', { value: webcrypto }); dom.window.TextEncoder = TextEncoder
  dom.window.eval(readFileSync(new URL('../source-date.js', import.meta.url), 'utf8'))
  dom.window.eval(readFileSync(new URL('../field-mappings.js', import.meta.url), 'utf8'))
  dom.window.eval(readFileSync(new URL('../adapters/orange-apple-integration.js', import.meta.url), 'utf8'))
  return { dom, doc: dom.window.document, api: dom.window.edulogSourceIntegration }
}
const source = `<div id="page-body"><div class="content"><h2>測試班級</h2><table id="reports"><tbody>
<tr><td><a href="/admissions/comments/301/edit_teacher">同名學生</a><a href="/students/101/accounts">帳號</a><a href="/dt_admissions/301">紀錄</a></td><td><a href="/dt_admissions/301/reports/401/edit">已啟用</a></td></tr>
<tr><td><a href="/admissions/comments/302/edit_teacher">同名學生</a><a href="/students/102/accounts">帳號</a><a href="/dt_admissions/302">紀錄</a></td><td><a href="/dt_admissions/302/reports/402/edit">2026/10/02</a></td></tr>
<tr><td><a href="/admissions/comments/303/edit_teacher">無 ID 學生</a></td></tr></tbody></table><input type="hidden" name="csrf_token" value="secret"><p>聯絡資料不擷取</p></div></div>`
test('standalone report edit URLs resolve their native form and expose prefill without class import', async()=>{
  const html=readFileSync(new URL('fixtures/report-editor.html',import.meta.url),'utf8')
  const {api,doc,dom}=adapter(html,'/dt_admissions/274452/reports/6558413/edit')
  const form=await api.readForm(doc),context=api.context(doc)
  assert.equal(form.admissionId,'274452');assert.equal(form.reportId,'6558413')
  assert.equal(context.reportOpen,true);assert.equal(context.classId,null)
  assert.equal(context.capabilities.report_prefill,true);assert.equal(context.capabilities.current_class_import,false)
  dom.window.close()
})
test('report date answers survive reopen with unchanged history evidence, but expire on new evidence', async()=>{
  const fixture=readFileSync(new URL('fixtures/report-modal.html',import.meta.url),'utf8')
  const html=`<table id="reports"><tr><th>學生</th><th>課程</th><th>本週(10/04)</th></tr><tr><td>學生甲</td><td>課程甲</td><td><a href="/dt_admissions/301/reports/401/edit">記錄</a></td></tr></table>${fixture}`
  const {api,doc,dom}=adapter(html)
  const entry=doc.querySelector('#reports a');entry.addEventListener('click',e=>e.preventDefault());entry.click()
  dom.window.AbortSignal.timeout=()=>undefined
  dom.window.fetch=async()=>({ok:true,url:'https://corp.orangeapple.co/dt_admissions/301',headers:{get:()=> 'text/html'},text:async()=>`<div id="page-body"><div class="content"><table><tr><td>1</td><td>2024年10月4日</td><td><a href="/dt_admissions/301/reports/401/edit">記錄</a></td></tr><tr><td>2</td><td>2026/10/04</td><td><a href="/dt_admissions/301/reports/402/edit">其他報告</a></td></tr></table></div></div>`})
  const historical=await api.resolveFormDate(doc);assert.equal(historical.date,'2024-10-04','only the same report ID may supply the year')
  await api.supplementForm(doc,{formId:historical.formId,fingerprint:historical.fingerprint,date:'2024-10-04'})
  const oldForm=doc.querySelector('form');oldForm.closest('.modal').remove();doc.body.insertAdjacentHTML('beforeend',fixture);entry.click()
  const reopened=await api.readForm(doc);assert.notEqual(reopened.formId,historical.formId);assert.equal(reopened.dateInfo.basis,'user_confirmed');assert.equal(reopened.date,'2024-10-04')
  doc.querySelector('#reports th:last-child').textContent='本週(10/05)';entry.click()
  const changed=await api.readForm(doc);assert.equal(changed.supplement,null);assert.equal(changed.date,null)
  dom.window.close()
})
test('ambiguous years and conflicting source evidence require explicit date confirmation without native edits',async()=>{
  const fixture=readFileSync(new URL('fixtures/report-modal.html',import.meta.url),'utf8')
  const {api,doc,dom}=adapter(`<table id="reports"><tr><th>學生</th><th>課程</th><th>本週(10/04)</th></tr><tr><td>學生甲</td><td>課程甲 (2024/09/01 - 2026/12/01)</td><td><a href="/dt_admissions/301/reports/401/edit">記錄</a></td></tr></table>${fixture}`)
  const entry=doc.querySelector('#reports a');entry.addEventListener('click',e=>e.preventDefault());entry.click()
  let form=await api.readForm(doc);assert.equal(form.date,null)
  const before=doc.querySelector('#lesson_report_feedback').value
  await assert.rejects(api.supplementForm(doc,{formId:form.formId,fingerprint:form.fingerprint,date:'2025-02-29'}),/有效/)
  doc.querySelector('.modal-title').textContent='學生甲 · 2024.10.05';form=await api.readForm(doc);assert.equal(form.dateInfo.conflict,true)
  await assert.rejects(api.supplementForm(doc,{formId:form.formId,fingerprint:form.fingerprint,date:'2024-10-04'}),/矛盾/)
  const answered=await api.supplementForm(doc,{formId:form.formId,fingerprint:form.fingerprint,date:'2024-10-04',conflictAcknowledged:true})
  assert.equal(answered.dateInfo.basis,'user_confirmed');assert.equal(answered.dateInfo.conflict,true);assert.equal(doc.querySelector('#lesson_report_feedback').value,before)
  dom.window.close()
})
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
test('history extraction retains complete and incomplete evidence without inventing dates', () => {
  const html = `<div id="page-body"><div class="content"><table><tbody><tr><td>1</td><td>2026/10/02</td><td><a href="/dt_admissions/301/reports/401/edit">記錄</a><p>評語：第一段\n第二段</p></td></tr><tr><td>2</td><td>10/03</td><td><a href="/dt_admissions/301/reports/402/edit">記錄</a></td></tr></tbody></table></div></div>`
  const { api, doc, dom } = adapter(html); const rows = api.extractHistory(doc, '301')
  assert.equal(rows.length, 2); assert.equal(rows[0].data.content, '第一段\n第二段'); assert.equal(rows[1].date,null); assert.equal(api.extractHistory(doc, '999').length, 0); dom.window.close()
})
test('real name spans and course spans enrich duplicate admissions; absolute action URLs are excluded',()=>{
  const html=`<div id="page-body"><div class="content"><h2>班級</h2><table id="students-table"><tbody><tr><td><span>學生甲</span><a href="/admissions/comments/301/edit_teacher"></a></td><td><span>課程甲</span><div class="text-danger">行政提示</div></td></tr></tbody></table><table id="reports"><tbody><tr><td><span>學生甲</span><a class="admission-comment" href="https://corp.orangeapple.co/admissions/comments/301/edit_teacher"></a><a href="https://corp.orangeapple.co/students/101/accounts">帳號</a><a href="/dt_admissions/301">完整紀錄</a></td><td><span>課程甲</span><div>未完成</div></td></tr><tr><td><span>學生甲</span><a href="/students/101/accounts">帳號</a><a href="/dt_admissions/302">完整紀錄</a></td><td><span>課程乙</span></td></tr></tbody></table></div></div>`
  const {api,doc,dom}=adapter(html);const s=api.extractClass(doc,'/courses/dt/11'),students=s.records.filter(r=>r.kind==='student'),admissions=s.records.filter(r=>r.kind==='enrollment')
  assert.equal(students.length,1);assert.equal(students[0].data.name,'學生甲');assert.equal(admissions.length,2);assert.equal(admissions[0].student_source_id,'101');assert.equal(admissions[0].sourceCourseLabel,'課程甲');assert.equal(admissions[1].sourceCourseLabel,'課程乙');assert.equal(s.issues.length,0);assert.deepEqual(Array.from(s.admissionPaths),['/dt_admissions/301','/dt_admissions/302']);dom.window.close()
})
test('direct cell text is identifiable, duplicate evidence merges and action/contact secrets are excluded',()=>{
  const html=`<div id="page-body"><div class="content"><h2>測試班級</h2><table id="students-table"><tbody><tr><td>學生甲<a href="/admissions/comments/301/edit_teacher"></a><button>備註按鈕</button><div class="admission-comment-box">秘密備註</div></td><td>課程甲<div class="dropdown">選單操作</div></td><td>電話秘密</td></tr></tbody></table><table id="reports"><tbody><tr><td><span>學生甲</span><a href="/students/101/accounts">帳號操作</a><a href="/dt_admissions/301">完整紀錄</a></td><td><span>課程甲</span></td><td><a href="/dt_admissions/301/reports/401/edit">2026/10/02 記錄操作</a></td></tr><tr><td>未知學生<a href="/dt_admissions/302">完整紀錄</a></td><td>未知課程<button>操作</button></td></tr></tbody></table><input type="hidden" value="登入秘密"></div></div>`
  const {api,doc,dom}=adapter(html),s=api.extractClass(doc,'/courses/dt/11'),r=s.records.find(r=>r.kind==='enrollment'&&r.source_id==='301')
  assert.equal(r.sourceStudentName,'學生甲');assert.equal(r.sourceCourseLabel,'課程甲');assert.equal(r.student_source_id,'101');assert.equal(r.sourceEvidence.length,2)
  const unknown=s.records.find(r=>r.kind==='enrollment'&&r.source_id==='302');assert.equal(unknown.sourceStudentName,'未知學生');assert.equal(unknown.sourceCourseLabel,'未知課程');assert.equal(unknown.student_source_id,null)
  const evidence=JSON.stringify(s.records.map(r=>r.sourceEvidence));for(const word of ['秘密','帳號操作','完整紀錄','記錄操作','選單操作','備註按鈕'])assert.equal(evidence.includes(word),false,word)
  dom.window.close()
})
test('actual roster headers distinguish grade, per-admission courses and registration dates',()=>{
  const html=`<div id="page-body"><div class="content"><h2>測試班</h2><table id="students-table"><tbody><tr><th>勾選</th><th>姓名</th><th>年級</th><th>課程</th><th>訂單狀態</th><th>報名時間</th></tr>
  ${[['301','甲課程'],['302','乙課程']].map(([id,course])=>`<tr><td><input type="checkbox"></td><td>學生甲<a class="admission-comment" href="/admissions/comments/${id}/edit_teacher"></a><a href="/students/101/accounts">帳號</a></td><td>高二</td><td>${course}<div>未完成</div></td><td>已付款</td><td>2026/08/22 21:07<div>預計開課日期 2026/11/29</div></td></tr>`).join('')}
  <tr><td></td><td>學生乙<a class="admission-comment" href="/admissions/comments/303/edit_teacher"></a></td><td>高二</td><td>丙課程</td><td>已付款</td><td><div>預計開課日期 2026/11/29</div></td></tr></tbody></table></div></div>`
  const {api,doc,dom}=adapter(html),snapshot=api.extractClass(doc,'/courses/dt/11'),rows=snapshot.records.filter(r=>r.kind==='enrollment')
  assert.deepEqual(Array.from(rows,r=>r.sourceCourseLabel),['甲課程','乙課程','丙課程']);assert.equal(snapshot.records.filter(r=>r.kind==='student').length,1)
  assert.equal(rows[0].sourceGrade,'高二');assert.equal(rows[0].data.start_date,'2026-08-22');assert.equal(rows[0].data.status,undefined);assert.equal(rows[2].data.start_date,undefined)
  assert.equal(rows[0].sourceEvidence[0].fields.find(f=>f.key==='course_name').label,'課程');assert.equal(snapshot.extractionVersion,2);dom.window.close()
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
test('native option changes stop partial apply and report the fields already changed',async()=>{
 const {api,doc,dom}=adapter(readFileSync(new URL('fixtures/report-modal.html',import.meta.url),'utf8'))
 const target=await api.readForm(doc),attendance=doc.querySelector('#lesson_report_attendance_status'),completion=doc.querySelector('#dt_admission_lesson_report_completion_status')
 const option=[...completion.options].find(o=>o.value&&!o.disabled);assert.ok(option)
 attendance.addEventListener('change',()=>completion.replaceChildren())
 await assert.rejects(api.applyForm(doc,{formId:target.formId,reportId:target.reportId,fingerprint:target.fingerprint,fields:[{key:'is_completed',value:option.value},{key:'attendance_status',value:'attended'}]}),error=>{assert.equal(error.code,'SOURCE_PARTIAL_APPLY');assert.deepEqual(Array.from(error.appliedFields),['attendance_status']);return true})
 assert.equal(attendance.value,'attended');assert.equal(doc.querySelector('input[type=checkbox]').checked,false);dom.window.close()
})
test('batch count and payload limits, verified rating options and plain paragraphs', () => {
  assert.deepEqual(splitBatches(Array.from({ length: 121 }, (_, n) => ({ n }))).map(b => b.rows.length), [50, 50, 21])
  assert.throws(() => splitBatches([{ data: 'x'.repeat(200000) }]), /單筆/)
  const student = { target_id: 'student', record: { kind: 'student', data: { name: '測試' } } }
  const enrollment = { record: { kind: 'enrollment', data: { student_id: 'student' } } }
  const grouped = splitBatches([...Array.from({ length: 49 }, (_, n) => ({ n })), student, enrollment])
  assert.deepEqual(grouped.map(b => b.rows.length), [49, 2])
  assert.deepEqual(grouped[1].rows, [student, enrollment])
  assert.equal(suggestedValue({ key: 'class_participation', type:'radio', options: [{ value: '9' }] }, { class_participation: 4.5 }), '9')
  assert.equal(suggestedValue({ key: 'class_participation', type:'radio', options: [{ value: '8' }] }, { class_participation: 4.5 }), '')
  const { dom, doc } = adapter(''); assert.equal(plainText('<p>甲</p><p>乙</p><script>bad</script>', doc), '甲\n乙'); dom.window.close()
})
test('order-independent student dependencies never reuse an earlier enrollment', () => {
  const student = {source_id:'s1',target_id:'target-s1',overwrite:[],record:{kind:'student',data:{name:'合成學生'}}}
  const enrollment = n => ({source_id:`e${n}`,target_id:`target-e${n}`,overwrite:[],record:{kind:'enrollment',data:{student_id:'target-s1',course_id:`course${n}`}}})
  const first = enrollment(1), second = enrollment(2)
  for (const rows of [[first,student,second],[second,first,student],[student,first,second]]) {
    const batches = splitBatches([...Array.from({length:49},(_,n)=>({n})),...rows])
    assert.deepEqual(batches.map(b=>b.rows.length),[49,3])
    assert.equal(batches.flatMap(b=>b.rows).filter(r=>r===first).length,1)
    assert.equal(batches.flatMap(b=>b.rows).filter(r=>r===second).length,1)
    assert.equal(batches[1].rows[0],student)
    validateBatches(batches)
  }
})
test('attachment-shaped mixed admissions normalize to 24 unique rows without merging courses', () => {
  const students = Array.from({length:11},(_,n)=>({source_id:`s${n}`,target_id:`student${n}`,overwrite:[],record:{kind:'student',data:{name:`合成學生 ${n}`}}}))
  const admissions = Array.from({length:12},(_,n)=>({source_id:String(277332+n),target_id:`admission${n}`,overwrite:[],record:{kind:'enrollment',data:{student_id:`student${n%11}`,course_id:`course${n%3}`}}}))
  const rows = [{source_id:'6332',target_id:'class',overwrite:[],record:{kind:'class_session',data:{name:'合成班級'}}},admissions[0],...students,...admissions]
  assert.equal(rows.length,25)
  const batches=splitBatches(rows),flat=batches.flatMap(b=>b.rows)
  assert.equal(flat.length,24);assert.equal(flat.filter(r=>r.record.kind==='enrollment').length,12)
  for(const student of students)assert.ok(batches.some(b=>b.rows.includes(student)&&b.rows.some(r=>r.record.kind==='enrollment'&&r.record.data.student_id===student.target_id)))
  assert.equal(new Set(flat.map(r=>`${r.record.kind}:${r.source_id}`)).size,24)
})
test('identical duplicates collapse, conflicting identities stop, and saved checkpoints are only validated', () => {
  const row={source_id:'101',target_id:'student',overwrite:[],record:{kind:'student',data:{name:'測試'}}}
  const same={record:{data:{name:'測試'},kind:'student'},overwrite:[],target_id:'student',source_id:'101'}
  const other={...row,record:{kind:'course',data:{subject:'程式'}}}
  assert.equal(splitBatches([row,same,other]).flatMap(b=>b.rows).length,2)
  assert.throws(()=>splitBatches([row,{...row,target_id:'another'}]),e=>e.code==='SOURCE_ID_CONFLICT'&&/學生來源 ID 101/.test(e.message))
  const saved=[{key:'checkpoint1',rows:[row]},{key:'checkpoint2',rows:[same]}],before=JSON.stringify(saved)
  assert.throws(()=>validateBatches(saved),e=>e.code==='DUPLICATE_SOURCE_IDS')
  assert.equal(JSON.stringify(saved),before)
})
test('student dependency groups respect complete request byte limits', () => {
  const student={source_id:'s1',target_id:'s1',record:{kind:'student',data:{name:'合成'}}},enrollment={source_id:'e1',target_id:'e1',record:{kind:'enrollment',data:{student_id:'s1'}}}
  const envelope=rows=>new TextEncoder().encode(JSON.stringify({key:'0'.repeat(36),rows})).byteLength
  assert.throws(()=>splitBatches([enrollment,student],envelope([student,enrollment])-1),/學生／報名組合/)
  const batches=splitBatches([enrollment,student],envelope([student,enrollment]))
  assert.equal(batches.length,1);assert.equal(envelope(batches[0].rows),envelope([student,enrollment]))
})
test('validation errors have Chinese guidance while original details remain available', () => {
  const error={code:'VALIDATION_FAILED',message:'The request is invalid',fields:{request:['Duplicate source IDs']}}
  assert.match(workspaceErrorMessage(error),/重複來源 ID/)
  assert.match(workspaceErrorMessage({...error,fields:{request:['Unrecognized key']}}),/未通過驗證/)
  assert.equal(error.fields.request[0],'Duplicate source IDs')
})
test('cross-batch capability errors use the shared localized recovery guidance', () => {
  const original=globalThis.edulogUi
  globalThis.edulogUi={t:key=>key==='error.importDependenciesUnavailable'?'localized recovery':'unexpected'}
  assert.equal(workspaceErrorMessage({code:'IMPORT_DEPENDENCIES_UNAVAILABLE',message:'raw server detail'}),'localized recovery')
  globalThis.edulogUi=original
})
test('old servers get a specific route-contract update message without treating other validation as an upgrade issue',()=>{
  const error={code:'VALIDATION_FAILED',fields:{'rows.25.record.data.source_evidence.0.source_path':['Invalid string']}}
  const rows=Array.from({length:26},()=>({record:{kind:'history_report',data:{source_evidence:[]}}}))
  rows[25].record.data.source_evidence=[{source_path:'/courses/dt/4773/lesson_reports'}]
  assert.equal(isUnsupportedReportEvidencePathValidation(error,rows),true)
  assert.match(workspaceErrorMessage({...error,code:'SOURCE_PATH_CONTRACT_UNSUPPORTED'}),/migration 1000140/)
  rows[25].record.data.source_evidence[0].source_path='https://corp.orangeapple.co/courses/dt/4773/lesson_reports'
  assert.equal(isUnsupportedReportEvidencePathValidation(error,rows),false)
  assert.equal(isUnsupportedReportEvidencePathValidation({...error,fields:{'rows.25.record.data.source_evidence.0.table':['Invalid string']}},rows),false)
  assert.equal(isUnsupportedReportEvidencePathValidation({...error,code:'PREVIEW_STALE'},rows),false)
})
