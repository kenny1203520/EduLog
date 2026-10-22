import test from 'node:test'
import assert from 'node:assert/strict'
import { courseIdentity, admissionIdentity, classifyAdmissionIdentityChange, groupCourses, rankCandidates, mergeRecords } from '../../workspace/mapping-core.js'
test('course rules distinguish identities, exact labels and unknown admissions',()=>{
  const rows=[{kind:'enrollment',source_id:'1',source_course_id:'9',sourceCourseLabel:'A'},{kind:'enrollment',source_id:'2',sourceCourseLabel:'A'},{kind:'enrollment',source_id:'3',sourceCourseLabel:' A '},{kind:'enrollment',source_id:'4'},{kind:'enrollment',source_id:'5'}]
  assert.equal(groupCourses(rows).length,4);assert.equal(courseIdentity(rows[0]),'id:9');assert.equal(groupCourses(rows)[1].rows.length,2)
  assert.notEqual(admissionIdentity({...rows[1],student_source_id:'1'}),admissionIdentity({...rows[1],student_source_id:'2'}))
})
test('corp course codes use a separate identity namespace from numeric route IDs',()=>{
 assert.equal(courseIdentity({sourceCourseCode:'dt-python',source_course_id:'code:dt-python'}),'code:dt-python')
 assert.notEqual(courseIdentity({sourceCourseCode:'dt-python'}),courseIdentity({source_course_id:'dt-python'}))
})
test('identity enrichment is reused only with a verified student or course link',()=>{
 const label=JSON.stringify(['student-1','label:Python']),code=JSON.stringify(['student-1','code:dt-python'])
 assert.equal(classifyAdmissionIdentityChange(label,code), 'conflict')
 assert.equal(classifyAdmissionIdentityChange(label,code,{courseLinkedToExisting:true,sameCourseLabel:true}), 'enriched')
 assert.equal(classifyAdmissionIdentityChange(label,code,{courseLinkedToExisting:true,sameCourseLabel:false}), 'conflict')
 const missingStudent=JSON.stringify([null,'code:dt-python']),knownStudent=JSON.stringify(['student-1','code:dt-python'])
 assert.equal(classifyAdmissionIdentityChange(missingStudent,knownStudent), 'conflict')
 assert.equal(classifyAdmissionIdentityChange(missingStudent,knownStudent,{studentLinkedToExisting:true}), 'enriched')
 assert.equal(classifyAdmissionIdentityChange(JSON.stringify(['student-2','code:dt-python']),knownStudent,{studentLinkedToExisting:true}), 'conflict')
 assert.equal(classifyAdmissionIdentityChange(label,JSON.stringify(['student-1','code:dt-scratch']),{courseLinkedToExisting:true}), 'conflict')
})
test('deterministic candidates rank exact names but never select or merge duplicates',()=>{
  const rows=[{id:'2',name:'同名'},{id:'3',name:'其他'},{id:'1',name:'同名'}]
  assert.deepEqual(rankCandidates(rows,'同名').map(r=>r.id),['1','2','3']);assert.equal(rows.length,3)
})
test('later admission and history data enrich identity without removing captured fields',()=>{
  const rows=mergeRecords([{kind:'enrollment',source_id:'301',student_source_id:null,sourceCourseLabel:'',data:{external_link:'source'}},{kind:'enrollment',source_id:'302',student_source_id:'101',data:{}}],[{kind:'enrollment',source_id:'301',student_source_id:'101',sourceStudentName:'測試學生',sourceCourseLabel:'課程 A',data:{start_date:'2026-01-01'}}])
  assert.equal(rows.length,2);assert.equal(rows[0].student_source_id,'101');assert.equal(rows[0].data.external_link,'source');assert.equal(rows[1].source_id,'302')
})
test('reports merge by reportId alone and keep the class page class; rows without IDs are never merged',()=>{
  const classPage={kind:'report',source_id:'401',enrollment_source_id:'301',sourceClassId:'11',sourceClassBasis:'class-page',data:{external_link:'a'},sourceEvidence:[]}
  const fromHistory={kind:'report',source_id:'401',enrollment_source_id:'301',historyKey:'report:301:401',sourceClassId:'77',sourceClassBasis:'report-page',data:{content:'full'},sourceEvidence:[]}
  const loose={kind:'report',source_id:null,enrollment_source_id:'301',date:'2026-10-04',data:{content:'x'}}
  const rows=mergeRecords([classPage],[fromHistory,loose,{...loose}])
  assert.equal(rows.filter(r=>r.source_id==='401').length,1);const merged=rows.find(r=>r.source_id==='401')
  assert.equal(merged.sourceClassId,'11');assert.equal(merged.sourceClassBasis,'class-page');assert.equal(merged.data.content,'full');assert.equal(merged.data.external_link,'a')
  assert.equal(rows.filter(r=>!r.source_id).length,2)
  const attendance=mergeRecords([{kind:'attendance',source_id:'attendance:301:2026-10-04',attendance_count:1}],[{kind:'attendance',source_id:'attendance:301:2026-10-04',attendance_count:2}])
  assert.equal(attendance.length,1);assert.equal(attendance[0].attendance_count,2)
})
