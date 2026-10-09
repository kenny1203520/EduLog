import test from 'node:test'
import assert from 'node:assert/strict'
import { fingerprintReport } from '../report-skip-decisions.js'
import { createReportSkipController } from '../report-skip-controller.js'

test('report fingerprints distinguish missing, blank, zero, false and half-star values',async()=>{
 const base={enrollment_source_id:'12',source_id:'34',date:'2026-10-04',sourceFields:[{key:'class_participation',value:0},{key:'is_completed',value:false},{key:'content',value:''}]}
 const a=await fingerprintReport(base,{instance:'https://edulog.example'}),b=await fingerprintReport({...base,sourceFields:[{key:'class_participation',value:0.5},{key:'is_completed',value:false},{key:'content',value:''}]},{instance:'https://edulog.example'}),c=await fingerprintReport({...base,sourceFields:[{key:'class_participation',value:0},{key:'is_completed',value:false}]},{instance:'https://edulog.example'})
 assert.notEqual(a.content_fingerprint,b.content_fingerprint);assert.notEqual(a.content_fingerprint,c.content_fingerprint)
})

test('changing whether internal notes may be read does not change the public report fingerprint',async()=>{
 const record={enrollment_source_id:'12',source_id:'34',date:'2026-10-04',sourceFields:[{key:'content',value:'lesson'},{key:'class_notes',value:'private note',internal:true}]}
 const withInternal=await fingerprintReport(record,{includeInternal:true,instance:'https://edulog.example'}),withoutInternal=await fingerprintReport(record,{includeInternal:false,instance:'https://edulog.example'})
 assert.equal(withInternal.content_fingerprint,withoutInternal.content_fingerprint)
 assert.notEqual(withInternal.field_fingerprints.class_notes,undefined);assert.equal(withoutInternal.field_fingerprints.class_notes,undefined)
})

test('unchanged local skip stays skipped; changed content requires a decision after reread',async()=>{
 const record={kind:'report',enrollment_source_id:'12',source_id:'34',date:'2026-10-04',sourceFields:[{key:'content',value:'original'}]}
 const work={snapshot:{records:[record]},history:{lastSourceReadAt:100}}
 const hooks={getWork:()=>work,targets:()=>new Map(),instance:()=> 'https://edulog.example',api:async()=>({items:[]}),capable:()=>false,identity:r=>`${r.enrollment_source_id}:report:${r.source_id}`,changed:async()=>true,recompute(){},save:async()=>true}
 const controller=createReportSkipController(hooks),fp=await fingerprintReport(record,{instance:'https://edulog.example'})
 Object.assign(record,{sourceSkipped:true,skipDecision:{status:'local-skip',confirmedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),fingerprint:fp.content_fingerprint,contextFingerprint:fp.context_fingerprint,fieldFingerprints:fp.field_fingerprints}})
 await controller.resolve();assert.equal(record.sourceSkipped,true)
 record.sourceFields[0].value='changed';work.history.lastSourceReadAt=101;await controller.resolve();assert.equal(record.sourceSkipped,false);assert.equal(record.skipDecision.reason,'content_changed')
})

test('changing the mapped enrollment or effective occurrence requests a new skip decision without rereading source',async()=>{
 const record={kind:'report',enrollment_source_id:'12',source_id:'34',date:'2026-10-04',sourceFields:[{key:'content',value:'same'}]}
 const work={snapshot:{records:[record]}}
 let mapped={id:'enrollment-a',courseId:'course-a'},routes=new Map([['enrollment-a',[{id:'occurrence-a',occurrence_date:'2026-10-04',class_session_id:'session-a'}]]])
 const hooks={getWork:()=>work,targets:()=>new Map([['12',mapped]]),routes:()=>routes,instance:()=> 'https://edulog.example',api:async()=>{throw new Error('context review must be local')},capable:()=>true,identity:r=>`${r.enrollment_source_id}:report:${r.source_id}`,changed:async()=>true,recompute(){},save:async()=>true}
 const controller=createReportSkipController(hooks),before=await fingerprintReport(record,{instance:'https://edulog.example',target:{...mapped,classSessionId:[{id:'occurrence-a',class_session_id:'session-a'}]}})
 record.sourceSkipped=true;record.skipDecision={status:'skip',revision:'prior',contextFingerprint:before.context_fingerprint,fingerprint:before.content_fingerprint}
 mapped={id:'enrollment-b',courseId:'course-b'};routes=new Map([['enrollment-b',[{id:'occurrence-b',occurrence_date:'2026-10-04',class_session_id:'session-b'}]]])
 assert.equal(await controller.refreshContext(work),1);assert.equal(record.sourceSkipped,false);assert.equal(record.skipDecision.status,'review');assert.equal(record.skipDecision.reason,'context_changed')
})

test('batch continue-skip uses revision checks in chunks of at most 50 and saves locally once',async()=>{
 const records=Array.from({length:51},(_,i)=>({kind:'report',enrollment_source_id:String(100+i),source_id:String(200+i),date:'2026-10-04',sourceFields:[{key:'content',value:`row ${i}`}],skipDecision:{status:'review',revision:`revision-${i}`} }))
 const work={snapshot:{records}},calls=[],hooks={getWork:()=>work,targets:()=>new Map(),instance:()=> 'https://edulog.example',api:async(_name,payload)=>{calls.push(payload);return {items:payload.items.map((row,index)=>({revision:`new-${index}`,confirmed_at:'2026-10-10T00:00:00Z',expires_at:'2026-11-09T00:00:00Z'}))}},capable:()=>true,identity:r=>`${r.enrollment_source_id}:report:${r.source_id}`,changed:async()=>true,recompute(){},save:async()=>true}
 const controller=createReportSkipController(hooks),items=records.map(record=>({key:hooks.identity(record),record}))
 assert.equal(await controller.continueSkipping(items),true)
 assert.deepEqual(calls.map(call=>call.items.length),[50,1]);assert.equal(records.filter(record=>record.sourceSkipped&&record.skipDecision.status==='skip').length,51)
})

test('a successful reread resolves 600 skipped reports in batches of 50 without losing their state',async()=>{
  const records=Array.from({length:600},(_,index)=>({kind:'report',enrollment_source_id:String(1000+index),source_id:String(9000+index),date:'2026-10-01',sourceFields:[],sourceSkipped:true,skipDecision:{status:'local-skip',fingerprint:'prior'}}))
  const owner={id:'large-work',snapshot:{records},history:{lastSourceReadAt:Date.now()}}
  const sizes=[]
  const controller=createReportSkipController({getWork:()=>owner,targets:()=>new Map(),routes:()=>new Map(),instance:()=> 'http://localhost:5173',capable:()=>true,identity:record=>`${record.enrollment_source_id}:${record.source_id}`,api:async(_operation,payload)=>{sizes.push(payload.items.length);return{items:payload.items.map(item=>({...item,status:'skipped',revision:'revision',confirmed_at:'2026-10-01T00:00:00Z',expires_at:'2026-10-31T00:00:00Z'}))}},recompute(){},save:async()=>true})
  assert.equal(await controller.resolve(owner),600)
  assert.deepEqual(sizes,Array(12).fill(50))
  assert.ok(records.every(record=>record.sourceSkipped&&record.skipDecision.status==='skip'))
})

test('a failed single-report skip keeps the report unchanged and allows retry',async()=>{
  const record={kind:'report',enrollment_source_id:'12',source_id:'34',date:'2026-10-04',sourceFields:[]}
  const owner={snapshot:{records:[record]}}
  let calls=0
  const controller=createReportSkipController({getWork:()=>owner,targets:()=>new Map(),instance:()=> 'https://edulog.example',capable:()=>true,identity:r=>`${r.enrollment_source_id}:${r.source_id}`,api:async()=>{calls++;if(calls===1)throw new Error('offline');return{items:[{revision:'next',confirmed_at:'2026-10-04T00:00:00Z',expires_at:'2026-11-03T00:00:00Z'}]}},changed:async()=>true})
  const item={key:'12:34',record}
  assert.equal(await controller.setSkip(item,true),false)
  assert.equal(record.sourceSkipped,undefined)
  assert.equal(await controller.setSkip(item,true),true)
  assert.equal(record.sourceSkipped,true)
  assert.equal(calls,2)
})
