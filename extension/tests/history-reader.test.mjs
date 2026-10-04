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
