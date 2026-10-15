import test from 'node:test'
import assert from 'node:assert/strict'
import { createReviewSaveCoordinator } from '../history-review-save.js'

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
function fixture(){
  const record={historyFieldDecisions:{content:'mixed'},historyMerge:{content:{text:'整理草稿'}},staleReviewFields:['content']}
  const owner={id:'original',staleReviewPending:[{kind:'history_report',source_id:'report',field:'content'},{kind:'history_report',source_id:'other',field:'is_completed'}]},item={key:'report',record}
  const state={work:owner,stamp:0,removed:false,saving:new Set(),saved:0,failed:[],writes:[],refresh:async()=>{},persist:async()=>true}
  const coordinator=createReviewSaveCoordinator({work:()=>state.work,record:()=>state.removed?undefined:record,stamp:()=>state.stamp,
    refresh:()=>state.refresh(),saving:(work,key,fields)=>fields.length?state.saving.add(work.id+key):state.saving.delete(work.id+key),
    prepare:(work,live,key,fields,resolved)=>({
      project:current=>({...current,staleReviewPending:current.staleReviewPending.filter(row=>!resolved.includes(row)),record:{...live,staleReviewFields:[]}}),
      commit:()=>{work.staleReviewPending=work.staleReviewPending.filter(row=>!resolved.includes(row));live.staleReviewFields=[]}
    }),
    save:async options=>{const payload=options?.projectWork?options.projectWork(state.work):state.work;state.writes.push(structuredClone(payload));return state.persist()},
    saved:()=>state.saved++,failed:error=>state.failed.push(error.code)
  })
  return {record,owner,item,state,coordinator,confirm:()=>coordinator.confirm(item,['content'])}
}
test('pending fields remain visible until durable save; the stored draft contains the confirmed decision',async()=>{
  const f=fixture(),storage=deferred();f.state.persist=()=>storage.promise;const pending=f.confirm();await Promise.resolve();
  assert.equal(f.coordinator.isSaving(f.owner),true);assert.equal(f.owner.staleReviewPending.length,2);assert.deepEqual(f.record.staleReviewFields,['content'])
  assert.equal(f.state.writes[0].staleReviewPending.length,1);assert.equal(f.state.writes[0].record.historyMerge.content.text,'整理草稿')
  storage.resolve(true);assert.equal(await pending,true);assert.equal(f.owner.staleReviewPending.length,1);assert.equal(f.state.saving.size,0);assert.equal(f.state.saved,1)
})
test('failed persistence retains decisions, mixed text, pending fields and a retry path',async()=>{
  const f=fixture();f.state.persist=async()=>{throw Object.assign(new Error('offline'),{code:'WORK_SAVE_FAILED'})}
  assert.equal(await f.confirm(),false);assert.equal(f.state.saving.size,0);assert.equal(f.owner.staleReviewPending.length,2);assert.equal(f.record.historyMerge.content.text,'整理草稿')
  f.state.persist=async()=>true;assert.equal(await f.confirm(),true);assert.equal(f.state.saved,1)
})
test('a newer recheck supersedes a waiting save without losing the pending field or leaking saving state',async()=>{
  const f=fixture(),read=deferred();f.state.refresh=()=>read.promise;const pending=f.confirm();f.state.stamp++;read.resolve()
  assert.equal(await pending,false);assert.equal(f.state.saving.size,0);assert.equal(f.state.writes.length,0);assert.equal(f.owner.staleReviewPending.length,2)
})
test('edits during persistence stay unconfirmed and are repaired on disk without overwriting the newer choices',async()=>{
  const f=fixture(),storage=deferred();let calls=0;f.state.persist=()=>++calls===1?storage.promise:Promise.resolve(true)
  const pending=f.confirm();await Promise.resolve();f.record.historyMerge.content.text='新的整理草稿';f.record.historyFieldDecisions.content='keep';f.state.stamp++;storage.resolve(true)
  assert.equal(await pending,false);assert.equal(f.state.saved,0);assert.equal(f.state.saving.size,0);assert.equal(f.owner.staleReviewPending.length,2)
  assert.equal(f.state.writes.length,2);assert.equal(f.state.writes[1].staleReviewPending.length,2);assert.equal(f.record.historyFieldDecisions.content,'keep')
})
test('switching work during persistence cleans only the original operation and never saves the new work',async()=>{
  const f=fixture(),storage=deferred();f.state.persist=()=>storage.promise;const pending=f.confirm();await Promise.resolve();f.state.work={id:'next',staleReviewPending:[]};storage.resolve(true)
  assert.equal(await pending,false);assert.equal(f.state.saving.size,0);assert.equal(f.state.writes.length,1);assert.equal(f.state.saved,0);assert.equal(f.owner.staleReviewPending.length,2)
})
test('duplicate clicks do not create concurrent commits for the same report',async()=>{
  const f=fixture(),read=deferred();f.state.refresh=()=>read.promise;const pending=f.confirm();assert.equal(await f.confirm(),false);read.resolve();assert.equal(await pending,true);assert.equal(f.state.writes.length,1)
})

test('a report removed during refresh cannot clear its pending decision or write an orphaned snapshot',async()=>{
  const f=fixture(),read=deferred();f.state.refresh=()=>read.promise;const pending=f.confirm();f.state.removed=true;read.resolve()
  assert.equal(await pending,false);assert.equal(f.state.saving.size,0);assert.equal(f.state.writes.length,0);assert.equal(f.owner.staleReviewPending.length,2)
})
