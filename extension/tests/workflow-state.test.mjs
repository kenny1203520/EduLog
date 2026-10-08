import test from 'node:test'
import assert from 'node:assert/strict'
import {workflowState,combineWorkRecords} from '../workflow-state.js'
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
