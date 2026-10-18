import test from 'node:test'
import assert from 'node:assert/strict'
import {workflowState,combineWorkRecords} from '../workspace/workflow-state.js'
test('visiting steps cannot mark them complete; partial transactions keep attention separate',()=>{
  assert.deepEqual(workflowState('import').available,[true,false,false,false])
  const work={type:'import',snapshot:{},history:{next:1,paths:['a','b']},jobId:'job',batches:[{},{}],done:0,status:'previewed'}
  const review=workflowState('import',{work,unresolved:2,previewCount:2});assert.equal(review.complete[0],false);assert.equal(review.complete[1],false);assert.equal(review.available[3],false)
  Object.assign(work,{done:2,status:'partial_complete'});assert.equal(workflowState('import',{work}).complete[2],true);assert.equal(workflowState('import',{work}).attention[3],true)
})
test('prefill results are manual submission, not server teaching-record completion',()=>{
  const state=workflowState('prefill',{work:{type:'prefill',status:'pending_confirmation'},form:{formId:'f',date:'2026-10-04'},report:{id:'r'}})
  assert.equal(state.available[3],true);assert.equal(state.complete[3],false)
})
test('history merges only exact server job identity and keeps remote-only/local-only and push sources',()=>{
  const rows=combineWorkRecords([{id:'local',type:'import',jobId:'same',status:'paused'},{id:'separate',type:'import',title:'same name',status:'collected'}],{imports:[{id:'same',status:'paused'},{id:'other',status:'complete'}],pushes:[{report_id:'r',status:'pending_confirmation'}]})
  assert.equal(rows.length,4);assert.equal(rows[0].remote.id,'same');assert.equal(rows[1].remote,null);assert.equal(rows[2].category,'done');assert.equal(rows[3].category,'attention')
})
test('work metadata joins only by stable local work id or verified server job id',()=>{
  const metadata=[{work_id:'local',server_job_id:'same',title:'Python 同步',pinned:true},{work_id:'remote-meta',server_job_id:'remote-job',title:'遠端工作'},{work_id:'summary-only',server_job_id:null,title:'本機草稿摘要'}]
  const rows=combineWorkRecords([{id:'local',type:'import',jobId:'same',status:'paused'},{id:'other',type:'import',title:'Python 同步',status:'collected'}],{imports:[{id:'same',status:'paused'},{id:'remote-job',status:'complete'}],pushes:[]},metadata)
  assert.equal(rows[0].metadata.title,'Python 同步');assert.equal(rows[0].metadata.pinned,true)
  assert.equal(rows[1].metadata,null,'same title must not merge unrelated work')
  assert.equal(rows[2].metadata.title,'遠端工作');assert.equal(rows[3].metadata.title,'本機草稿摘要')
})
