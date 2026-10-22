import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareStaleReviewBatchRefresh } from '../../workspace/history-review-batches.js'

function fixture(){
  const rows=['report-a','report-b'].map(source_id=>({source_id,target_id:`history-${source_id}`,overwrite:['content'],record:{kind:'history_report',data:{content:'old'}},history_reconciliation:{key:`reconcile-${source_id}`,class_occurrence_id:'lesson',overwrite:['content']}}))
  const work={id:'work',done:0,status:'failed',batches:[{key:'original-key',rows}],staleReviewRows:rows.map(row=>({batchKey:'original-key',source_id:row.source_id})),historyBindings:rows.map(row=>({itemKey:row.source_id,body:{...row.history_reconciliation}}))}
  const items=rows.map(row=>({key:row.source_id,category:'bind',data:{content:'reviewed'},record:{historyOverwrite:['content']},includedFields:['content'],occurrence:{id:'lesson',report:{id:'lesson-report',version:3},can_write:true}}))
  return {work,rows,items}
}
test('all rows and bindings stay untouched if a later report still needs review',()=>{
  const f=fixture(),before=structuredClone(f.work);f.items[1].category='needs';f.items[1].issueCode='mapping';f.items[1].issues=[{target:'field:lesson_id',fieldKey:'lesson_id'}]
  assert.throws(()=>prepareStaleReviewBatchRefresh(f.work,f.items),error=>error.code==='STALE_REPORT_REVIEW_REQUIRED'&&error.reviewIssues[0].source_id==='report-b')
  assert.deepEqual(f.work,before)
})
test('successful refresh commits every row together and retains original batch and reconciliation keys',()=>{
  const f=fixture(),before=structuredClone(f.work),commit=prepareStaleReviewBatchRefresh(f.work,f.items)
  assert.deepEqual(f.work,before);commit();assert.equal(f.work.batches[0].key,'original-key')
  for(const row of f.rows){assert.equal(row.record.data.content,'reviewed');assert.equal(row.history_reconciliation.key,`reconcile-${row.source_id}`)}
})
test('linked no-change reports require both readable matching history and lesson contents',()=>{
  const f=fixture();f.work.staleReviewRows=f.work.staleReviewRows.slice(0,1)
  const item=f.items[0];item.category='linked';item.target={id:'enrollment'};item.record.date='2026-10-04';item.sourceKey='report:1';item.data={content:'same',source_fields:[]}
  item.existing={id:f.rows[0].target_id,linked_report_id:'lesson-report',enrollment_id:'enrollment',report_date:item.record.date,source_key:item.sourceKey,content:'same',source_fields:[]}
  const route={id:'lesson',can_write:true,occurrence_date:item.record.date,report:{id:'lesson-report',content:'same',version:4}},routes=new Map([['enrollment',[route]]])
  prepareStaleReviewBatchRefresh(f.work,f.items,routes)();assert.equal(f.rows[0].record.data.content,'same');assert.equal(f.rows[0].history_reconciliation.key,'reconcile-report-a')
  for(const mutate of [()=>route.report.content='changed',()=>{route.report.content='same';route.can_write=false},()=>{route.can_write=true;item.existing.enrollment_id='other'}]){
    mutate();const before=structuredClone(f.work);assert.throws(()=>prepareStaleReviewBatchRefresh(f.work,f.items,routes),error=>error.code==='STALE_REPORT_REVIEW_REQUIRED');assert.deepEqual(f.work,before)
  }
})
test('missing reports and batch rows identify every blocker without silently choosing another report',()=>{
  const f=fixture();f.items=[];f.work.staleReviewRows.push({source_id:'missing',batchKey:'missing-batch'})
  assert.throws(()=>prepareStaleReviewBatchRefresh(f.work,f.items),error=>error.reviewIssues.length===3&&error.reviewIssues.at(-1).reason==='batch-missing')
})
test('already submitted and unknown outcomes cannot be changed by review refresh',()=>{
  for(const state of [{done:1},{appliedBatchKeys:['original-key']},{status:'outcome_unknown'}]){
    const f=fixture();Object.assign(f.work,state);const before=structuredClone(f.work)
    assert.throws(()=>prepareStaleReviewBatchRefresh(f.work,f.items),error=>['STALE_SUBMITTED_BATCH_IMMUTABLE','IMPORT_STATUS_UNKNOWN'].includes(error.code));assert.deepEqual(f.work,before)
  }
})
test('pending reports keep their original payload until decisions are saved and re-previewed',()=>{
  const f=fixture(),original=structuredClone(f.rows[0]);f.work.staleReviewPending=[{kind:'history_report',source_id:'report-a',field:'content'}]
  prepareStaleReviewBatchRefresh(f.work,f.items)();assert.deepEqual(f.rows[0],original);assert.equal(f.rows[1].record.data.content,'reviewed')
})
