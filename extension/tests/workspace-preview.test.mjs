import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { splitBatches, validateBatches } from '../workspace-model.js'
import { bindingStillMatches } from '../history-sync.js'

// Exercise the real preview orchestration with isolated API/storage effects.
const script = readFileSync(new URL('../workspace.js', import.meta.url), 'utf8')
const previewScript = script.slice(script.indexOf('async function preview('), script.indexOf('function renderNoopSummary('))
const bindingScript=script.slice(script.indexOf('async function applyHistoryBindings('),script.indexOf('async function apply()'))
function bindingFixture() {
 const plan={historyId:'history',itemKey:'301:report:401',expectedFields:{content:'confirmed'},occurrence:{id:'occurrence',report:{version:1}},body:{key:'original-key',class_occurrence_id:'occurrence',overwrite:[]},status:'pending'},calls=[],saved=[]
 const context=vm.createContext({work:{historyBindings:[plan],needs:[]},generation:1,bindingStillMatches,save:async()=>saved.push(structuredClone(context.work)),api:async(operation,body)=>{
  calls.push({operation,body:structuredClone(body)})
  if(operation==='history-detail')return{version:4,content:'confirmed'}
  if(operation==='history-bind-preview')return{report_version:context.reportVersion??1}
  if(context.late)context.generation++
  if(context.fail){context.fail=false;const error=new Error('network');error.code='API_NETWORK_ERROR';throw error}
  return{classification:'updated',status:'linked'}
 }})
 vm.runInContext(bindingScript,context);return{plan,calls,saved,context,apply:()=>context.applyHistoryBindings()}
}
test('lost binding response retries the exact saved key and body without creating another preview',async()=>{
 const f=bindingFixture();f.context.fail=true;await assert.rejects(f.apply(),e=>e.code==='API_NETWORK_ERROR');assert.equal(f.plan.status,'previewed');await f.apply()
 const writes=f.calls.filter(c=>c.operation==='history-bind-apply');assert.deepEqual(writes[0].body,writes[1].body);assert.equal(writes[0].body.key,'original-key');assert.equal(writes[0].body.history_version,4);assert.equal(f.calls.filter(c=>c.operation==='history-bind-preview').length,1);assert.equal(f.plan.status,'done')
})
test('changed report version preserves saved history and requires rechecking instead of binding',async()=>{
 const f=bindingFixture();f.context.reportVersion=2;await f.apply();assert.equal(f.plan.status,'blocked');assert.equal(f.context.work.needs.length,1);assert.equal(f.calls.some(c=>c.operation==='history-bind-apply'),false)
})
test('a late binding response cannot update a changed work context',async()=>{
 const f=bindingFixture();f.context.late=true;await assert.rejects(f.apply(),e=>e.code==='API_RESPONSE_INVALID');assert.equal(f.plan.status,'previewed');assert.equal(f.plan.result,undefined);assert.equal(f.saved.length,1)
})
const row = n => ({source_id:String(n),target_id:`target-${n}`,overwrite:[],record:{kind:'course',data:{subject:'合成課程',stage:'初階'}}})
function previewFixture(work, rows) {
  const calls=[],saved=[],controls={apply:{disabled:false}}
  const context=vm.createContext({work,rows,splitBatches,validateBatches,integrationCapabilities:{enrollment_history_reports:true},refreshHistoryPlan:async()=>{},batchBytes:180000,previewResults:[{old:true}],mappingController:{resolveFieldRules:async()=>{},verifyReportRelationships:async()=>{}},prepareRows:()=>rows,$:id=>controls[id],save:async()=>saved.push(structuredClone(context.work)),renderNoopSummary:()=>calls.push({operation:'empty-summary'}),renderDifferences:()=>calls.push({operation:'render'}),notice(){},api:async(operation,body,extra)=>{
    calls.push({operation,body:structuredClone(body),extra})
    if(operation==='job')return{id:'new-job'}
    if(operation==='preview'){
      if(context.failure){const error=context.failure;context.failure=null;throw error}
      return context.results?.shift()||{rows:[],counts:{}}
    }
    return{}
  }})
  vm.runInContext(previewScript,context)
  return {context,calls,saved,controls,preview:reuse=>context.preview(reuse)}
}
const work = () => ({id:'local-work',type:'import',status:'collected',done:0,jobId:'old-job',batches:[{key:'old-key',rows:[row(1)]}],snapshot:{sourceOrigin:'https://corp.orangeapple.co',classId:'11'},destination:{course_ids:['course']},uiState:[{id:'student',value:'kept'}]})
test('no new data produces a review summary without cancelling or creating a server job',async()=>{
 const current=work(),original=structuredClone(current),f=previewFixture(current,[]);await f.preview(false);assert.deepEqual(current,original);assert.deepEqual(f.calls,[{operation:'empty-summary'}]);assert.equal(f.saved.length,0)
})

test('invalid local rows never cancel the old job, replace its preview, or create a new one',async()=>{
  const current=work(),original=structuredClone(current),f=previewFixture(current,[row(1),{...row(1),target_id:'conflict'}])
  await assert.rejects(f.preview(false),e=>e.code==='SOURCE_ID_CONFLICT')
  assert.deepEqual(current,original);assert.equal(f.calls.length,0);assert.equal(f.saved.length,0)
  assert.equal(f.context.previewResults[0].old,true)
})

test('failed previews retain the new job and choices, and can regenerate without applying anything',async()=>{
  const current=work(),f=previewFixture(current,[row(1),row(2)])
  f.context.failure=Object.assign(new Error('Duplicate source IDs'),{code:'VALIDATION_FAILED'})
  await assert.rejects(f.preview(false),/Duplicate source IDs/)
  assert.equal(current.jobId,'new-job');assert.equal(current.previewDirty,true);assert.equal(current.done,0)
  assert.deepEqual(current.uiState,[{id:'student',value:'kept'}]);assert.equal(f.controls.apply.disabled,true)
  assert.equal(f.saved[0].batches[0].key,current.batches[0].key,'keys are saved before the preview request')
  await f.preview(false)
  assert.equal(current.status,'previewed');assert.equal(current.previewDirty,false)
  assert.equal(f.calls.filter(c=>c.operation==='job').length,2);assert.equal(f.calls.some(c=>c.operation==='apply'),false)
})

test('committed and uncertain write checkpoints cannot be regenerated, including a zero-checkpoint unknown write',async()=>{
  for(const properties of [{done:1,status:'paused'},{done:0,status:'outcome_unknown'},{done:0,status:'applying'},{done:0,status:'failed'}]){
    const current={...work(),...properties},before=structuredClone(current),f=previewFixture(current,[row(2)])
    await assert.rejects(f.preview(false),/檢查並續傳/)
    assert.deepEqual(current,before);assert.equal(f.calls.length,0)
  }
})

test('resume keeps original keys and rows, skips completed batches and checks uncertain batches before retry',async()=>{
  const current={...work(),done:1,status:'outcome_unknown',batches:[{key:'committed',rows:[row(1)]},{key:'uncertain',rows:[row(2)]},{key:'remaining',rows:[row(3)]}]}
  const before=JSON.stringify(current.batches),f=previewFixture(current,[])
  f.context.results=[{applied:1},{rows:[],counts:{}}]
  await f.preview(true)
  assert.equal(JSON.stringify(current.batches),before);assert.equal(current.done,2)
  assert.deepEqual(f.calls.filter(c=>c.operation==='preview').map(c=>c.body.key),['uncertain','remaining'])
  assert.equal(f.calls.some(c=>['job','job-status','apply'].includes(c.operation)),false)
  assert.equal(f.context.previewResults[0].batchIndex,2)
})

test('malformed legacy batches stop before the API and are never silently normalized during resume',async()=>{
  const current={...work(),done:1,batches:[{key:'committed',rows:[row(1)]},{key:'remaining',rows:[row(1)]}]}
  const original=JSON.stringify(current),f=previewFixture(current,[])
  await assert.rejects(f.preview(true),e=>e.code==='DUPLICATE_SOURCE_IDS')
  assert.equal(JSON.stringify(current),original);assert.equal(f.calls.length,0)
})
