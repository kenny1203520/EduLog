import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { labels, splitBatches, validateBatches, importBatchRequest } from '../workspace-model.js'
import { bindingStillMatches } from '../history-sync.js'

// Exercise the real preview orchestration with isolated API/storage effects.
const script = readFileSync(new URL('../workspace.js', import.meta.url), 'utf8')
const prepareScript = script.slice(script.indexOf('function prepareRows()'), script.indexOf('async function preview('))
const previewScript = script.slice(script.indexOf('async function preview('), script.indexOf('function renderNoopSummary('))
const applyScript = script.slice(script.indexOf('async function apply()'), script.indexOf('async function resumeImport()'))
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
  const calls=[],saved=[],controls={apply:{disabled:false},'preview-section':{hidden:false}}
  const context=vm.createContext({work,rows,labels,splitBatches,validateBatches,importBatchRequest,crypto:{randomUUID:(()=>{let n=0;return()=>`new-key-${++n}`})()},integrationCapabilities:{enrollment_history_reports:true},refreshHistoryPlan:async()=>{},batchBytes:180000,previewResults:[{old:true}],mappingController:{resolveFieldRules:async()=>{},verifyReportRelationships:async()=>{}},prepareRows:()=>rows,$:id=>controls[id],save:async()=>saved.push(structuredClone(context.work)),renderNoopSummary:()=>calls.push({operation:'empty-summary'}),renderDifferences:()=>calls.push({operation:'render'}),notice(){},api:async(operation,body,extra)=>{
    calls.push({operation,body:structuredClone(body),extra})
    if(['preview','apply'].includes(operation)&&Object.keys(body).some(key=>!['key','rows','dependencies'].includes(key)))throw Object.assign(new Error('Unrecognized key'),{code:'VALIDATION_FAILED'})
    if(operation==='job')return{id:'new-job'}
    if(operation==='preview'){
      if(context.failure){const error=context.failure;context.failure=null;throw error}
      return context.results?.shift()||{rows:[],counts:{}}
    }
    return{}
  }})
  vm.runInContext(`${prepareScript}\n${previewScript}`,context)
  context.prepareRows=()=>rows
  return {context,calls,saved,controls,preview:reuse=>context.preview(reuse)}
}
const work = () => ({id:'local-work',type:'import',status:'collected',done:0,jobId:'old-job',batches:[{key:'old-key',rows:[row(1)]}],snapshot:{sourceOrigin:'https://corp.orangeapple.co',classId:'11'},destination:{course_ids:['course']},uiState:[{id:'student',value:'kept'}]})
test('no new data produces a review summary without cancelling or creating a server job',async()=>{
 const current=work(),original=structuredClone(current),f=previewFixture(current,[]);await f.preview(false);assert.deepEqual(current,{...original,previewDirty:true});assert.deepEqual(f.calls,[{operation:'empty-summary'}]);assert.equal(f.saved.length,1);assert.equal(f.controls.apply.disabled,true)
})

test('invalid local rows never cancel the old job, replace its preview, or create a new one',async()=>{
  const current=work(),original=structuredClone(current),f=previewFixture(current,[row(1),{...row(1),target_id:'conflict'}])
  await assert.rejects(f.preview(false),e=>e.code==='SOURCE_ID_CONFLICT')
  assert.deepEqual(current,{...original,previewDirty:true});assert.equal(f.controls.apply.disabled,true);assert.equal(f.context.previewResults.length,0);assert.equal(f.calls.length,0);assert.equal(f.saved.length,1)
})

test('failed previews retain the new job and choices, and can regenerate without applying anything',async()=>{
  const current=work(),f=previewFixture(current,[row(1),row(2)])
  f.context.failure=Object.assign(new Error('Duplicate source IDs'),{code:'VALIDATION_FAILED'})
  await assert.rejects(f.preview(false),/Duplicate source IDs/)
  assert.equal(current.jobId,'new-job');assert.equal(current.previewDirty,true);assert.equal(current.done,0)
  assert.deepEqual(current.uiState,[{id:'student',value:'kept'}]);assert.equal(f.controls.apply.disabled,true)
  assert.equal(f.saved[1].batches[0].key,current.batches[0].key,'keys are saved before the preview request')
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
test('saved preview fingerprints stay local when existing batches are checked again',async()=>{
  const dependency={key:'parent-key',fingerprint:'a'.repeat(64)}
  const current={...work(),batches:[{key:'saved-key',rows:[row(2)],previewFingerprint:'b'.repeat(64),dependencies:[dependency]}]}
  const f=previewFixture(current,[]);f.context.results=[{rows:[],counts:{}}]
  await f.preview(true)
  const request=f.calls.find(call=>call.operation==='preview').body
  assert.deepEqual(Object.keys(request),['key','rows','dependencies'])
  assert.equal(request.dependencies[0].fingerprint,dependency.fingerprint)
  assert.equal(current.batches[0].previewFingerprint,'b'.repeat(64))
  assert.equal(current.previewDirty,false)
})
test('a fingerprint returned by preview can flow through later apply without entering the API body',async()=>{
  const current=work(),preview=previewFixture(current,[row(8)])
  preview.context.results=[{rows:[],counts:{},batch_fingerprint:'e'.repeat(64)}]
  await preview.preview(false)
  assert.equal(current.batches[0].previewFingerprint,'e'.repeat(64))
  const persisted=structuredClone(current.batches[0]),calls=[],controls={pause:{},'cancel-work':{},mapping:{},'preview-section':{}}
  const context=vm.createContext({work:{type:'import',status:'previewed',previewDirty:false,jobId:current.jobId,done:0,batchCount:1,batches:[persisted],needs:[]},previewResults:[{batchIndex:0,rows:[]}],generation:1,paused:false,cancelRequested:false,importBatchRequest,send:async()=>({closed:false}),api:async(operation,body)=>{calls.push({operation,body:structuredClone(body)});if(operation==='apply'&&Object.keys(body).some(key=>!['key','rows','dependencies'].includes(key)))throw Object.assign(new Error('Unrecognized key'),{code:'VALIDATION_FAILED'});return{}},save:async()=>{},progress(){},finalizeImport:async()=>{},notice(){},stage(){},$:id=>controls[id]})
  vm.runInContext(applyScript,context);await context.apply()
  assert.equal(calls.filter(call=>call.operation==='apply').length,1)
  assert.equal(Object.hasOwn(calls.find(call=>call.operation==='apply').body,'previewFingerprint'),false)
  assert.equal(persisted.previewFingerprint,'e'.repeat(64))
})
test('a failed resume check invalidates the old summary and preserves the uncertain checkpoint',async()=>{
  const current={...work(),status:'outcome_unknown',batches:[{key:'uncertain-key',rows:[row(9)],previewFingerprint:'f'.repeat(64)}]}
  const f=previewFixture(current,[]);f.context.failure=Object.assign(new Error('Unrecognized key'),{code:'VALIDATION_FAILED'})
  await assert.rejects(f.preview(true),e=>e.code==='VALIDATION_FAILED')
  assert.equal(current.previewDirty,true);assert.equal(f.controls.apply.disabled,true);assert.equal(f.controls['preview-section'].hidden,true);assert.equal(f.context.previewResults.length,0)
  assert.equal(current.status,'outcome_unknown');assert.equal(current.jobId,'old-job');assert.equal(current.batches[0].key,'uncertain-key')
  assert.equal(current.previewError.code,'VALIDATION_FAILED')
})
test('apply projects a saved batch without changing its local checkpoint metadata',async()=>{
  const batch={key:'saved-key',rows:[row(1)],previewFingerprint:'c'.repeat(64),dependencies:[{key:'parent-key',fingerprint:'d'.repeat(64)}]}
  const calls=[],controls={pause:{},'cancel-work':{},mapping:{},'preview-section':{}}
  const context=vm.createContext({work:{type:'import',status:'previewed',previewDirty:false,jobId:'job',done:0,batchCount:1,batches:[batch],needs:[]},previewResults:[{batchIndex:0,rows:[]}],generation:1,paused:false,cancelRequested:false,importBatchRequest,send:async()=>({closed:false}),api:async(operation,body)=>{calls.push({operation,body:structuredClone(body)});if(['preview','apply'].includes(operation)&&Object.keys(body).some(key=>!['key','rows','dependencies'].includes(key)))throw Object.assign(new Error('Unrecognized key'),{code:'VALIDATION_FAILED'});return{}},save:async()=>{},progress(){},finalizeImport:async()=>{},notice(){},stage(){},$:id=>controls[id]})
  vm.runInContext(applyScript,context);await context.apply()
  assert.deepEqual(calls.filter(call=>call.operation==='apply'),[{operation:'apply',body:{key:'saved-key',rows:batch.rows,dependencies:batch.dependencies}}])
  assert.equal(batch.previewFingerprint,'c'.repeat(64))
})

test('malformed legacy batches stop before the API and are never silently normalized during resume',async()=>{
  const current={...work(),done:1,batches:[{key:'committed',rows:[row(1)]},{key:'remaining',rows:[row(1)]}]}
  const original=JSON.stringify(current),f=previewFixture(current,[])
  await assert.rejects(f.preview(true),e=>e.code==='DUPLICATE_SOURCE_IDS')
  assert.equal(JSON.stringify(current),JSON.stringify({...JSON.parse(original),previewDirty:true}));assert.equal(f.calls.length,0)
})
test('an invalid reference is preserved as a blocked row while the valid rows receive a fresh preview',async()=>{
  const current=work(),rows=[row(1),row(2)],f=previewFixture(current,rows)
  const failure=Object.assign(new Error('reference failed'),{code:'INVALID_REFERENCE',fields:{'rows.course.1.lesson_id':['LESSON_COURSE_MISMATCH']}})
  f.context.failure=failure;f.context.results=[{rows:[{kind:'course',source_id:'2',status:'added',before:{},after:{subject:'A'}}],counts:{added:1}}]
  await f.preview(false)
  assert.equal(current.blockedRows.length,1);assert.equal(current.blockedRows[0].source_id,'1')
  assert.deepEqual(current.batches[0].rows.map(item=>item.source_id),['2'])
  assert.equal(current.status,'previewed');assert.equal(current.previewDirty,false)
  assert.equal(f.calls.filter(call=>call.operation==='preview').length,2)
  assert.equal(f.controls.apply.disabled,false)
})
test('history batches carry a fingerprinted dependency on an enrollment batch',async()=>{
  const current=work(),studentId='student-1',enrollmentId='enrollment-1'
  const enrollment={source_id:'301',target_id:enrollmentId,overwrite:[],record:{kind:'enrollment',data:{student_id:studentId,course_id:'course',class_session_id:'session'}}}
  const histories=Array.from({length:52},(_,i)=>({source_id:`history-${i}`,target_id:`history-target-${i}`,overwrite:[],record:{kind:'history_report',data:{enrollment_id:enrollmentId,report_date:'2026-10-04'}}}))
  const rows=[enrollment,...histories],f=previewFixture(current,rows)
  f.context.results=Array.from({length:2},(_,i)=>({rows:[],counts:{},batch_fingerprint:`${String(i+1).repeat(64)}`}))
  await f.preview(false)
  const historyBatches=current.batches.filter(batch=>batch.rows.some(item=>item.record.kind==='history_report'))
  assert.equal(historyBatches.filter(batch=>batch.dependencies?.length===1).length,1)
  assert.ok(historyBatches.find(batch=>batch.dependencies?.length===1).dependencies[0].fingerprint==='1'.repeat(64))
  assert.ok(current.batches[0].rows.some(item=>item.record.kind==='enrollment'))
  assert.equal(f.calls.filter(call=>call.operation==='preview')[1].body.dependencies[0].fingerprint,'1'.repeat(64))
})

function classifiedHistoryFixture(items) {
  const enrollment={kind:'enrollment',source_id:'301',student_source_id:'student-source',sourceStudentName:'測試學生',sourceCourseLabel:'測試課程',data:{external_link:'https://corp.orangeapple.co/dt_admissions/301'}}
  const work={id:'classified-work',type:'import',status:'collected',done:0,previewDirty:false,ids:{},includeInternalNotes:false,history:{paths:[],next:0},snapshot:{sourceOrigin:'https://corp.orangeapple.co',classId:'class-source',records:[enrollment]}}
  const controls={'include-internal-notes':{checked:false},'enrollment-course-301':{value:'course'},'class-session':{value:'session'},classroom:{value:'room'},'start-301':{value:'2026-01-01'},'status-301':{value:'active'},'enrollment-301':{value:'enrollment-target'},apply:{disabled:false},'preview-section':{hidden:false}}
  const calls=[],saved=[]
  const context=vm.createContext({work,historyPlan:items,context:{class_sessions:[{id:'session',course_ids:['course'],name:'Class',start_date:'2026-01-01',day_of_week:1,start_time:'10:00',end_time:'12:00'}],courses:[{id:'course',display_name:'Test course'}],enrollments:[{id:'enrollment-target',class_session_id:'old-session'}],permissions:{}},mappingController:{validateRow:()=>true,courseRows:()=>[],studentSelect:()=>({value:'student-target'}),resolveFieldRules:async()=>{}},integrationCapabilities:{enrollment_history_reports:true},generation:1,crypto:{randomUUID:(()=>{let n=0;return()=>`generated-${++n}`})()},$:id=>controls[id],admissionIdentity:()=>({}),idFor:(kind,id)=>`${kind}-${id}`,labels,splitBatches,validateBatches,importBatchRequest,batchBytes:180000,previewResults:[],refreshHistoryPlan:async()=>{},save:async()=>{saved.push(structuredClone(work))},saveWorkMetadata:async()=>{},renderNoopSummary(){},renderDifferences(){},stage(){},notice(){},api:async(operation,body)=>{calls.push({operation,body:structuredClone(body)});if(operation==='job')return{id:'new-job'};if(operation==='preview')return{rows:[],counts:{},batch_fingerprint:'a'.repeat(64)};return{}}})
  vm.runInContext(`${prepareScript}\n${previewScript}`,context)
  return{context,work,calls,saved,controls,preview:()=>context.preview(false)}
}
const historyItem=(category,key,extra={})=>({key,category,reason:`${category} reason`,record:{kind:'report',enrollment_source_id:'301',source_id:key,date:'2026-10-04'},...extra})
test('preview assembles and submits only valid history categories while keeping exclusions and unknowns out of report rows',async()=>{
  const valid=historyItem('history','history-1',{data:{enrollment_id:'enrollment-target',report_date:'2026-10-04',content:'saved comment'},includedFields:['content']})
  const items=[historyItem('unfilled','unfilled-1'),historyItem('other-admission','other-1'),historyItem('system-excluded','excluded-1'),valid,historyItem('new-unrecognized-category','unknown-1')]
  const f=classifiedHistoryFixture(items);await f.preview()
  const allRows=f.work.batches.flatMap(batch=>batch.rows),historyRows=allRows.filter(row=>row.record.kind==='history_report')
  assert.equal(historyRows.length,1);assert.equal(historyRows[0].source_id,'history-1');assert.equal(historyRows[0].record.data.enrollment_id,'enrollment-target')
  assert.match(f.work.needs.join(' '),/new-unrecognized-category/)
  assert.equal(f.calls.filter(call=>call.operation==='preview').length,1);assert.equal(f.work.previewDirty,false)
})
test('history rows missing required references fail before preview without replacing saved batches',async()=>{
  const malformed={...row(2),record:{kind:'history_report',data:undefined}},current={...work(),batches:[{key:'saved-batch',rows:[malformed]}],jobId:'saved-job',done:0}
  const f=previewFixture(current,[])
  await assert.rejects(f.preview(true),e=>e.code==='HISTORY_REFERENCE_INVALID')
  assert.equal(current.batches[0].key,'saved-batch');assert.equal(current.jobId,'saved-job');assert.equal(f.calls.length,0)
})
