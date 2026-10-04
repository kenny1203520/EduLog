import test from 'node:test'
import assert from 'node:assert/strict'
import { courseIdentity, admissionIdentity, groupCourses, rankCandidates, mergeRecords } from '../mapping-core.js'
test('course rules distinguish identities, exact labels and unknown admissions',()=>{
  const rows=[{kind:'enrollment',source_id:'1',source_course_id:'9',sourceCourseLabel:'A'},{kind:'enrollment',source_id:'2',sourceCourseLabel:'A'},{kind:'enrollment',source_id:'3',sourceCourseLabel:' A '},{kind:'enrollment',source_id:'4'},{kind:'enrollment',source_id:'5'}]
  assert.equal(groupCourses(rows).length,4);assert.equal(courseIdentity(rows[0]),'id:9');assert.equal(groupCourses(rows)[1].rows.length,2)
  assert.notEqual(admissionIdentity({...rows[1],student_source_id:'1'}),admissionIdentity({...rows[1],student_source_id:'2'}))
})
test('corp course codes use a separate identity namespace from numeric route IDs',()=>{
 assert.equal(courseIdentity({sourceCourseCode:'dt-python',source_course_id:'code:dt-python'}),'code:dt-python')
 assert.notEqual(courseIdentity({sourceCourseCode:'dt-python'}),courseIdentity({source_course_id:'dt-python'}))
})
test('deterministic candidates rank exact names but never select or merge duplicates',()=>{
  const rows=[{id:'2',name:'同名'},{id:'3',name:'其他'},{id:'1',name:'同名'}]
  assert.deepEqual(rankCandidates(rows,'同名').map(r=>r.id),['1','2','3']);assert.equal(rows.length,3)
})
test('later admission and history data enrich identity without removing captured fields',()=>{
  const rows=mergeRecords([{kind:'enrollment',source_id:'301',student_source_id:null,sourceCourseLabel:'',data:{external_link:'source'}},{kind:'enrollment',source_id:'302',student_source_id:'101',data:{}}],[{kind:'enrollment',source_id:'301',student_source_id:'101',sourceStudentName:'測試學生',sourceCourseLabel:'課程 A',data:{start_date:'2026-01-01'}}])
  assert.equal(rows.length,2);assert.equal(rows[0].student_source_id,'101');assert.equal(rows[0].data.external_link,'source');assert.equal(rows[1].source_id,'302')
})
