import test from 'node:test'
import assert from 'node:assert/strict'
import {readHistoryWork} from '../history-reader.js'
const record=(id)=>({kind:'report',source_id:id,enrollment_source_id:'1',date:'2026-10-01',evidenceKey:id,data:{}})
const fixture=()=>({id:'work',history:{paths:['/dt_admissions/1','/dt_admissions/2'],next:0},snapshot:{records:[]},dateFrom:'2026-01-01',dateTo:'2026-12-31'})
test('closed source pauses at its checkpoint; resuming does not reread completed reports',async()=>{
 const work=fixture(),calls=[];let closed=true,saves=0
 const hooks={current:()=>true,paused:()=>false,save:async()=>saves++,progress:()=>{},merge:(a,b)=>[...a,...b],source:async(action,input)=>{calls.push([action,input.historyPath,input.input?.reportId]);if(action==='history')return input.historyPath.endsWith('/1')?[record('a'),record('b')]:[];if(input.input.reportId==='b'&&closed)throw Object.assign(new Error('closed'),{code:'SOURCE_CLOSED'});return record(input.input.reportId)}}
 await readHistoryWork(work,hooks);assert.equal(work.status,'paused-extraction');assert.equal(work.history.checkpoints['/dt_admissions/1'].next,1);assert.equal(work.history.issues.length,0)
 closed=false;await readHistoryWork(work,hooks);assert.equal(work.status,'collected');assert.equal(work.history.next,2);assert.equal(calls.filter(c=>c[2]==='a').length,1);assert.equal(work.history.reportCount,2);assert.ok(saves>3)
})
test('retrying one failed history list never revisits completed students',async()=>{
 const work=fixture(),calls=[];let fail=true
 const hooks={current:()=>true,paused:()=>false,save:async()=>{},progress:()=>{},merge:(a,b)=>[...a,...b],source:async(action,input)=>{calls.push(input.historyPath);if(action==='history'&&input.historyPath.endsWith('/1')&&fail)throw new Error('denied');return action==='history'?[record(input.historyPath)]:record(input.input.reportId)}}
 await readHistoryWork(work,hooks);assert.equal(work.history.issues.length,1);const other=calls.filter(p=>p.endsWith('/2')).length
 fail=false;await readHistoryWork(work,hooks,'/dt_admissions/1');assert.equal(work.history.issues.length,0);assert.equal(work.history.next,2);assert.equal(calls.filter(p=>p.endsWith('/2')).length,other)
})

test('a checkpoint save failure is not treated as a source failure and resumes without a second list read',async()=>{
 const work=fixture(),calls=[];let saves=0,allowSave=false
 const hooks={current:()=>true,paused:()=>false,save:async()=>{saves++;if(saves===2&&!allowSave)throw Object.assign(new Error('storage full'),{code:'WORK_STORAGE_FULL'})},progress:()=>{},merge:(a,b)=>[...a,...b],source:async(action,input)=>{calls.push([action,input.historyPath,input.input?.reportId]);if(action==='history')return input.historyPath.endsWith('/1')?[record('a'),record('b')]:[];return record(input.input.reportId)}}
 await assert.rejects(readHistoryWork(work,hooks),error=>error.code==='WORK_STORAGE_FULL')
 assert.equal(work.status,'paused-extraction');assert.equal(work.collectionSaveError,'WORK_STORAGE_FULL');assert.equal(work.history.next,0);assert.equal(work.history.issues.length,0);assert.equal(work.history.checkpoints['/dt_admissions/1'].next,0);assert.deepEqual(calls,[['history','/dt_admissions/1',undefined]])
 allowSave=true;await readHistoryWork(work,hooks)
 assert.equal(work.status,'collected');assert.equal(work.history.next,2);assert.equal(calls.filter(call=>call[0]==='history'&&call[1].endsWith('/1')).length,1);assert.equal(calls.filter(call=>call[0]==='history-report').length,2);assert.equal(work.snapshot.records.length,2)
})
test('late source responses cannot mutate a replaced work',async()=>{
 const work=fixture();let current=true
 await readHistoryWork(work,{current:()=>current,paused:()=>false,save:async()=>{},progress:()=>{},merge:()=>{throw Error('must not merge')},source:async()=>{current=false;return[record('late')]}})
 assert.equal(work.snapshot.records.length,0);assert.equal(work.history.next,0);assert.equal(Object.keys(work.history.checkpoints).length,0)
})
test('legacy checkpoints resume at the saved report index',async()=>{
 const work=fixture();work.history.queue=[record('a'),record('b')];work.history.nextReport=1;const calls=[]
 await readHistoryWork(work,{current:()=>true,paused:()=>false,save:async()=>{},progress:()=>{},merge:(a,b)=>[...a,...b],source:async(action,input)=>{calls.push(action==='history'?input.historyPath:input.input.reportId);return action==='history'?[]:record(input.input.reportId)}})
 assert.deepEqual(calls,['b','/dt_admissions/2']);assert.equal(work.history.queue,undefined);assert.equal(work.history.next,2)
})

test('history student identity conflicts are preserved per report and block silent grouping',async()=>{
 const work=fixture(),enrollment={kind:'enrollment',source_id:'1',student_source_id:'student-a',sourceStudentName:'同名學生',data:{}},records=[{kind:'report',source_id:null,enrollment_source_id:'1',student_source_id:'student-b',sourceStudentName:'同名學生',date:'2026-10-01',evidenceKey:'a',data:{}},{kind:'report',source_id:null,enrollment_source_id:'1',student_source_id:'student-a',sourceStudentName:'同名學生',date:'2026-10-02',evidenceKey:'b',data:{}}]
 work.snapshot.records=[enrollment]
 await readHistoryWork(work,{current:()=>true,paused:()=>false,save:async()=>{},progress:()=>{},merge:(a,b)=>[...a,...b],source:async action=>action==='history'?records:undefined})
 assert.equal(enrollment.sourceStudentConflict,true);assert.equal(records[0].sourceStudentIdentityConflict,true);assert.equal(records[1].sourceStudentIdentityConflict,undefined);assert.deepEqual(enrollment.sourceStudentIdConflictValues,['student-a','student-b'])
})

test('evidence-only history is retained and explicit reread scans modified editors',async()=>{
 const work=fixture();let version=1,listReads=0
 const hooks={current:()=>true,paused:()=>false,save:async()=>{},progress:()=>{},merge:(a,b)=>[...a.filter(r=>r.evidenceKey!==b[0].evidenceKey),...b],source:async(action)=>{
  if(action==='history'){listReads++;return[{...record(null),evidenceKey:'evidence:stable',historyKey:'evidence:stable',data:{content:String(version)}}]}
  throw Error('no fabricated editor link')
 }}
 await readHistoryWork(work,hooks);assert.equal(work.snapshot.records.length,1);assert.equal(work.history.issues.length,0)
 version=2;await readHistoryWork(work,hooks,'/dt_admissions/1');assert.equal(listReads,3);assert.equal(work.snapshot.records[0].data.content,'2')
})

test('verified previous-admission history creates a local source enrollment for the original course',async()=>{
 const work=fixture(),report={kind:'report',source_id:'old-report',enrollment_source_id:'2',sourceRowType:'previous-admission',sourceAdmissionContextVerified:true,student_source_id:'student-7',sourceStudentName:'林同學',sourceCourseName:'Python',sourceCourseLabel:'菁英_Python程式開發班(dt-python)',sourceCourseCode:'dt-python',date:'2026-06-01',evidenceKey:'previous:old-report',data:{}}
 await readHistoryWork(work,{current:()=>true,paused:()=>false,save:async()=>{},progress:()=>{},merge:(a,b)=>[...a.filter(x=>!(x.kind===b[0].kind&&x.source_id===b[0].source_id)),...b],source:async action=>action==='history'?[report]:report})
 const previous=work.snapshot.records.find(row=>row.kind==='enrollment'&&row.source_id==='2')
 const storedReport=work.snapshot.records.find(row=>row.kind==='report')
 assert.ok(previous);assert.equal(previous.student_source_id,'student-7');assert.equal(previous.sourceCourseCode,'dt-python');assert.equal(previous.data.external_link,'https://corp.orangeapple.co/dt_admissions/2');assert.equal(storedReport.enrollment_source_id,'2');assert.equal(storedReport.sourceHistoryPath,'/dt_admissions/1')
})
