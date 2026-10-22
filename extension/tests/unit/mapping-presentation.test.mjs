import test from 'node:test'
import assert from 'node:assert/strict'
import {frontendUrl, sourceUrl, statusLabel, enrollmentLabel, displayDate, sourceName, mergeEvidence, scheduleLabel,sessionLabel,enrollmentDifferences,canMapEnrollmentAcrossSession,legacyCourse,reportMatchesReconciliation} from '../../workspace/mapping-presentation.js'
import {JSDOM} from '../../../app/node_modules/jsdom/lib/api.js'
import {evidenceDetails} from '../../workspace/mapping-view.js'

test('report reconciliation blocks moved sources, unknown results and superseded or wrong-date targets',()=>{
  const transfer={source_occurrence_id:'old',source_date:'2026-10-01',source_class_session_id:'class-a',target_occurrence_id:'new',target_date:'2026-10-02',target_class_session_id:'class-b',is_effective_target:true}
  const details={transfers:[transfer]},source={occurrenceId:'old',date:'2026-10-01',sessionId:'class-a'},target={occurrenceId:'new',date:'2026-10-02',sessionId:'class-b'}
  assert.equal(reportMatchesReconciliation(details,source),false)
  assert.equal(reportMatchesReconciliation(details,{...source,occurrenceId:'proposed-new-occurrence'}),false)
  assert.equal(reportMatchesReconciliation(details,target),true)
  assert.equal(reportMatchesReconciliation(details,{...target,date:'2026-10-03'}),false)
  assert.equal(reportMatchesReconciliation(details,{...target,sessionId:'class-a'}),false)
  assert.equal(reportMatchesReconciliation({transfers:[{...transfer,is_effective_target:false}]},target),false)
  assert.equal(reportMatchesReconciliation({transfers:[{...transfer,cancelled_at:'2026-10-02'}]},source),true)
  for(const data of [null,{error:'offline',transfers:[]},{next_cursor:'more',transfers:[]},{transfers:[{...transfer,source_date:null}]}])assert.equal(reportMatchesReconciliation(data,target),false)
  assert.equal(reportMatchesReconciliation({transfers:[]},source),true)
})
test('mapping links use only a validated frontend settings URL and retain prefix and custom port',()=>{
  const id='00000000-0000-4000-8000-000000000004'
  assert.equal(frontendUrl('http://localhost:5173/edulog/dashboard/settings?tab=integrations',`/dashboard/student/${id}`),`http://localhost:5173/edulog/dashboard/student/${id}`)
  assert.equal(frontendUrl('https://web.example:8443/school/dashboard/settings',`/dashboard/reports/${id}`),`https://web.example:8443/school/dashboard/reports/${id}`)
  for(const value of [null,'http://localhost:3000','https://api.example/api','javascript:alert(1)','https://user:secret@web.example/dashboard/settings','http://web.example/dashboard/settings'])assert.equal(frontendUrl(value,`/dashboard/student/${id}`),null)
  assert.equal(frontendUrl('https://web.example/dashboard/settings','/dashboard/student/../../settings'),null)
  assert.equal(sourceUrl('https://corp.orangeapple.co','/dt_admissions/301?secret=x#info'),'https://corp.orangeapple.co/dt_admissions/301')
  assert.equal(sourceUrl('https://corp.orangeapple.co','https://evil.example/dt_admissions/301'),null)
})
test('statuses and dates are readable without masking unknown original codes',()=>{
  assert.deepEqual(['regular','trial','completed','dropped','other'].map(statusLabel),['正式','試聽','已完成','已退選','未辨識狀態'])
  assert.match(enrollmentLabel({id:'abcd1234-9999',status:'regular',start_date:'2026-02-02'}),/^正式 · 2026\/2\/2 · #abcd1234$/)
  for(const date of ['2026-02-30','invalid',null])assert.equal(displayDate(date),'日期未提供')
})
test('weekend and multi-rule schedules distinguish same-name classes, including Sunday zero',()=>{
  const sunday={id:'abcd1234',name:'同名班',day_of_week:0,start_time:'09:00:00',end_time:'10:00:00'}
  assert.equal(sessionLabel(sunday),'同名班 · 週日 09:00–10:00 · #abcd1234')
  assert.equal(scheduleLabel({...sunday,schedule_rules:[{schedule_kind:'weekly',day_of_week:6,start_time:'14:00',end_time:'16:00'},{schedule_kind:'weekly',day_of_week:0,start_time:'09:00',end_time:'10:00'}]}),'週六 14:00–16:00、週日 09:00–10:00')
  assert.equal(scheduleLabel({}),'尚未設定時段');assert.equal(scheduleLabel({schedule_rules:[{schedule_kind:'monthly',day_of_month:5,start_time:'09:00',end_time:'10:00'}]}),'每月 5 日 09:00–10:00')
  assert.match(scheduleLabel({schedule_rules:[{schedule_kind:'specific_dates',occurrence_date:'2026-10-02',start_time:'09:00',end_time:'10:00'}]}),/2026\/10\/2/)
  assert.equal(frontendUrl('https://web.example:8443/prefix/dashboard/settings','/dashboard/classrooms/session/abcd1234'),'https://web.example:8443/prefix/dashboard/classrooms/session/abcd1234')
})
test('relationship mismatches and old grade evidence are identified without guessing a transfer',()=>{
  assert.deepEqual(enrollmentDifferences({student_id:'s',course_id:'c2',class_session_id:'other'},{student:'s',course:'c',session:'current'}),['班級不一致','課程不一致'])
  assert.equal(canMapEnrollmentAcrossSession({student_id:'s',course_id:'c',class_session_id:'other'},{student:'s',course:'c'}),true)
  assert.equal(canMapEnrollmentAcrossSession({student_id:'other',course_id:'c',class_session_id:'other'},{student:'s',course:'c'}),false)
  assert.equal(canMapEnrollmentAcrossSession({student_id:'s',course_id:'other',class_session_id:'other'},{student:'s',course:'c'}),false)
  const row={sourceCourseLabel:'高二',sourceEvidence:[{fields:[{key:'course_name',label:'年級',text:'高二'}]}]}
  assert.equal(legacyCourse(row,{}),true);assert.equal(legacyCourse(row,{extractionVersion:2}),false)
})
test('evidence merges provenance and fields; unknown admissions retain an identifiable source summary',()=>{
  const entry={sourcePath:'/courses/dt/11',table:'reports',row:1,fields:[{key:'student_name',text:'來源文字'}]}
  const merged=mergeEvidence([entry],[{...entry,fields:[{key:'course_name',text:'課程文字'}]}])
  assert.equal(merged.length,1);assert.equal(merged[0].fields.length,2)
  assert.equal(sourceName({source_id:'301',sourceEvidence:merged}),'來源文字')
  assert.equal(sourceName({source_id:'302'}),'來源報名 #302')
})
test('source evidence is collapsed plain text, merges duplicate origins and supports older snapshots',()=>{
  const dom=new JSDOM('');const before=globalThis.document;globalThis.document=dom.window.document
  try{
    const entry={sourcePath:'/courses/dt/11',table:'reports',row:1,capturedAt:'invalid',fields:[{key:'student_name',label:'學生',text:'<img src=x onerror=alert(1)>'}]}
    const detail=evidenceDetails([{sourceEvidence:[entry]},{sourceEvidence:[{...entry,fields:[{key:'course_name',label:'課程',text:'原文'}]}]}])
    assert.equal(detail.open,false);assert.equal(detail.querySelectorAll('section').length,1);assert.equal(detail.querySelectorAll('dd').length,2);assert.equal(detail.querySelector('img'),null);assert.match(detail.textContent,/<img/)
    assert.match(evidenceDetails([{}]).textContent,/此工作尚未保留擷取原文/)
  }finally{globalThis.document=before;dom.window.close()}
})
