import test from 'node:test'
import assert from 'node:assert/strict'
import { planHistory, bindingStillMatches } from '../history-sync.js'
const record=(extra={})=>({kind:'report',enrollment_source_id:'301',source_id:'401',historyKey:'report:401',date:'2026-10-04',sourceFields:[{key:'content',label:'評語',type:'text',value:''}],data:{is_completed:false,class_participation:0,classroom_behavior:4.5,content:''},...extra})
const target=new Map([['301',{id:'enrollment',courseId:'course',name:'測試學生'}]])
const occurrence={id:'sunday-occurrence',class_session_id:'sunday-session',class_name:'週日班',occurrence_date:'2026-10-04',can_write:true}
const options={dateFrom:'1900-01-01',dateTo:'9999-12-31'}
const plan=(records,archive=[],routes=[occurrence])=>planHistory(records,target,new Map([['enrollment',archive]]),new Map([['enrollment',routes]]),options)
test('transfer date routes to the effective Sunday occurrence without enrollment or occurrence writes',()=>{
 const [item]=plan([record()]);assert.equal(item.category,'bind');assert.equal(item.occurrence.class_session_id,'sunday-session');assert.equal(item.data.is_completed,false);assert.equal(item.data.class_participation,0);assert.equal(item.data.classroom_behavior,4.5);assert.equal(item.data.class_session_id,undefined)
 assert.equal(bindingStillMatches(item,{report_version:null}),true);assert.equal(bindingStillMatches(item,{report_version:2}),false)
 assert.equal(plan([record({date:'2026-10-03'})])[0].category,'history')
})
test('missing report identity is honest evidence-only history; same-day changes require confirmation',()=>{
 const r=record({source_id:null,historyKey:'evidence:hash',identityUnverified:true})
 const [item]=plan([r]);assert.equal(item.data.identity_status,'evidence_only');assert.equal(item.data.source_report_id,undefined);assert.equal(item.data.external_link,undefined)
 const existing={source_admission_id:'301',source_key:'evidence:older',report_date:r.date}
 assert.equal(plan([r],[existing])[0].category,'needs')
 assert.notEqual(plan([{...r,historyDuplicateConfirmed:true}],[existing])[0].category,'needs')
})
test('multiple legal occurrences and nonempty content conflicts require explicit choices',()=>{
 const two=[occurrence,{...occurrence,id:'other'}]
 assert.equal(plan([record()],[],two)[0].category,'needs')
 assert.equal(plan([record({historyOnly:true})],[],two)[0].category,'history')
 const conflict={...occurrence,report:{id:'report',version:3,content:'existing',is_completed:true}}
 assert.equal(plan([record()],[],[conflict])[0].category,'needs')
 const [confirmed]=plan([record({historyConflictConfirmed:true,historyOverwrite:['content']})],[],[conflict]);assert.equal(confirmed.category,'bind');assert.deepEqual(confirmed.conflicts,['is_completed','content']);assert.equal(bindingStillMatches(confirmed,{report_version:3}),true)
})
test('unread, changed linked and conflicting duplicate data cannot be silently imported',()=>{
 assert.equal(plan([record({sourceReadStatus:'failed'})])[0].category,'needs')
 assert.equal(plan([record(),record()]).length,1)
 assert.equal(plan([record(),record({data:{content:'different'}})])[0].category,'needs')
 const linked={id:'archive',report_date:'2026-10-04',source_fields:[{key:'content',label:'評語',text:''}],source_admission_id:'301',source_key:'report:401',linked_report_id:'report',is_completed:false,class_participation:0,classroom_behavior:4.5,content:'',external_link:'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit'}
 assert.equal(plan([record()],[linked])[0].category,'linked')
 assert.equal(plan([record({data:{content:'changed'}})],[linked])[0].category,'needs')
})
test('list/editor disagreements wait for explicit confirmation before course-report binding',()=>{
 const conflict={key:'content',label:'學習表現',listValue:'舊列表',editValue:'已儲存內容'}
 assert.equal(plan([record({sourceFieldConflicts:[conflict]})])[0].category,'needs')
 const [confirmed]=plan([record({sourceFieldConflicts:[conflict],sourceConflictAcknowledged:true})])
 assert.equal(confirmed.category,'bind');assert.equal(confirmed.data.content,'')
})
test('same-day ambiguous identities and two sources for one occurrence require review',()=>{
 const unknown=record({source_id:null,historyKey:'evidence:first',identityUnverified:true})
 assert.ok(plan([unknown,{...unknown,historyKey:'evidence:second'}]).every(i=>i.category==='needs'))
 assert.ok(plan([record(),record({source_id:'402',historyKey:'report:402'})]).every(i=>i.category==='needs'))
 const one=plan([record(),record({source_id:'402',historyKey:'report:402',historyOnly:true})]);assert.equal(one[0].category,'bind');assert.equal(one[1].category,'history')
})
test('internal notes are separately selected and unknown fields never enter history payloads',()=>{
 const [item]=plan([record({data:{password:'blocked'},sourceInternalNotes:'private',sourceFields:[{key:'password',label:'Password',value:'blocked'},{key:'class_notes',label:'內部',value:'private',internal:true}]})]);assert.equal(item.data.password,undefined);assert.equal(item.data.class_notes,undefined);assert.deepEqual(item.data.source_fields,[])
})
test('remembered course context can inspect a report before its enrollment is confirmed, without making a write payload',()=>{
 const unconfirmed=new Map([['301',{id:null,courseId:'course',name:'測試學生',eligible:false}]]),[item]=planHistory([record()],unconfirmed,new Map(),new Map(),options)
 assert.equal(item.category,'needs');assert.match(item.reason,/課程與教材可先核對/);assert.equal(item.data,undefined);assert.equal(item.target.courseId,'course')
})
test('a report with a conflicting source student identity remains review-only',()=>{
 const [item]=plan([record({sourceStudentIdentityConflict:true})]);assert.equal(item.category,'needs');assert.match(item.reason,/學生身份與來源報名不同/);assert.equal(item.occurrence,undefined)
})
