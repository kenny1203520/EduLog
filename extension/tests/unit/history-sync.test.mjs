import test from 'node:test'
import assert from 'node:assert/strict'
import { planHistory, bindingStillMatches } from '../../workspace/history-sync.js'
import { mergeClearToken, mergeSignature } from '../../workspace/history-merge.js'
const record=(extra={})=>({kind:'report',enrollment_source_id:'301',source_id:'401',historyKey:'report:401',sourceClassId:'11',date:'2026-10-04',sourceFields:[{key:'content',label:'評語',type:'text',value:''}],data:{is_completed:false,class_participation:0,classroom_behavior:4.5,content:''},...extra})
const target=new Map([['301',{id:'enrollment',courseId:'course',name:'測試學生'}]])
const occurrence={id:'sunday-occurrence',class_session_id:'sunday-session',class_name:'週日班',occurrence_date:'2026-10-04',can_write:true}
const options={dateFrom:'1900-01-01',dateTo:'9999-12-31',sourceClassSessions:new Map([['11','sunday-session']])}
const plan=(records,archive=[],routes=[occurrence],settings=options)=>planHistory(records,target,new Map([['enrollment',archive]]),new Map([['enrollment',routes]]),settings)
test('transfer date routes to the effective Sunday occurrence without enrollment or occurrence writes',()=>{
 const [item]=plan([record()]);assert.equal(item.category,'bind');assert.equal(item.occurrence.class_session_id,'sunday-session');assert.equal(item.data.is_completed,false);assert.equal(item.data.class_participation,0);assert.equal(item.data.classroom_behavior,4.5);assert.equal(item.data.class_session_id,undefined)
 assert.equal(bindingStillMatches(item,{report_version:null}),true);assert.equal(bindingStillMatches(item,{report_version:2}),false)
 assert.equal(plan([record({date:'2026-10-03'})])[0].category,'history')
})
test('rows without a report ID are attendance evidence only, never report payloads',()=>{
 const r=record({source_id:null,historyKey:'evidence:hash',identityUnverified:true})
 const [item]=plan([r]);assert.equal(item.category,'system-excluded');assert.equal(item.attendanceEvidence,true);assert.equal(item.data,undefined);assert.equal(item.issues,undefined)
 const [verified]=plan([record()]);assert.equal(verified.data.identity_status,'verified');assert.equal(verified.data.source_report_id,'401');assert.equal(verified.data.source_key,'report:301:401')
 const [noLink]=plan([record()],[],[occurrence],{...options,syncFields:{external_link:false}});assert.equal(noLink.data.source_report_id,'401','identity does not depend on syncing the edit link to the lesson');assert.equal(noLink.includedFields.includes('external_link'),false)
})
test('same-day reports map to that day occurrences by reportId and lesson time; count mismatches are exceptions',()=>{
 const early={...occurrence,id:'early',start_time:'10:00:00'},late={...occurrence,id:'late',start_time:'14:00:00'}
 const items=plan([record({source_id:'410'}),record({source_id:'409'})],[],[late,early])
 assert.deepEqual(items.map(item=>[item.record.source_id,item.category,item.occurrence?.id]),[['410','bind','late'],['409','bind','early']])
 const mismatch=plan([record({source_id:'410'}),record({source_id:'409'})],[],[early])
 assert.ok(mismatch.every(item=>item.category==='needs'&&item.issues[0].code==='occurrence-mismatch'))
 const taken=plan([record({source_id:'410'})],[],[{...early,report:{id:'other',version:1,source_report_id:'999'}}])
 assert.equal(taken[0].category,'needs');assert.equal(taken[0].issues[0].code,'occurrence-mismatch');assert.match(taken[0].reason,/其他原站報告/)
})
test('class comes from the class page or report page, never from guesses; cross-class reports are exceptions',()=>{
 const [missing]=plan([record({sourceClassId:null})]);assert.equal(missing.category,'needs');assert.equal(missing.issues[0].code,'class')
 const [other]=plan([record({sourceClassId:'99',sourceClassBasis:'report-page'})]);assert.equal(other.category,'needs');assert.equal(other.issues[0].code,'class-other');assert.match(other.reason,/99/)
 assert.equal(plan([record({sourceClassId:'99',historyOnly:true})])[0].category,'history')
 assert.equal(plan([record({sourceClassId:null})],[],[])[0].category,'history','no EduLog lesson on that date needs no class decision')
 const [chosen]=plan([record({sourceClassId:null,historyOccurrenceId:occurrence.id})]);assert.equal(chosen.category,'bind')
 const [bound]=plan([record({sourceClassId:null})],[],[{...occurrence,report:{id:'report',version:2,source_report_id:'401',source_synced_version:2,source_synced_fields:{}}}]);assert.equal(bound.category,'bind','an existing reportId binding identifies the lesson by itself')
})
test('re-sync overwrites an untouched EduLog report and asks only when both sides changed',()=>{
 const synced={id:'report',version:3,source_report_id:'401',source_synced_version:3,source_synced_fields:{content:'old'},content:'old',is_completed:false,class_participation:0,classroom_behavior:4.5}
 const [untouched]=plan([record({data:{...record().data,content:'new'}})],[],[{...occurrence,report:synced}])
 assert.equal(untouched.category,'bind');assert.deepEqual(untouched.conflicts,[]);assert.ok(untouched.autoOverwrite.includes('content'))
 const edited={...synced,version:4,content:'EduLog edit'}
 const [both]=plan([record({data:{...record().data,content:'new'}})],[],[{...occurrence,report:edited}])
 assert.equal(both.category,'needs');assert.equal(both.issues[0].code,'both-changed');assert.deepEqual(both.conflicts,['content'])
 const confirmed=record({data:{...record().data,content:'new'},historyConflictConfirmed:true,historyConflictSignature:both.conflictSignature,historyOverwrite:['content']})
 assert.equal(plan([confirmed],[],[{...occurrence,report:edited}])[0].category,'bind')
 const [kept]=plan([record({data:{...record().data,content:'old'}})],[],[{...occurrence,report:edited}])
 assert.equal(kept.category,'linked');assert.match(kept.reason,/EduLog/)
 const [unknownBaseline]=plan([record({data:{...record().data,content:'new'}})],[],[{...occurrence,report:{...synced,source_synced_version:null,content:'EduLog edit'}}])
 assert.equal(unknownBaseline.category,'needs','a migrated link without a sync baseline never overwrites silently')
})
test('multiple legal occurrences and nonempty content conflicts require explicit choices',()=>{
 const two=[occurrence,{...occurrence,id:'other'}]
 assert.equal(plan([record()],[],two)[0].category,'needs')
 assert.equal(plan([record({historyOnly:true})],[],two)[0].category,'history')
 const conflict={...occurrence,report:{id:'report',version:3,content:'existing',is_completed:true}}
 const initial=plan([record()],[],[conflict])[0];assert.equal(initial.category,'needs')
 const confirmedRecord=record({historyConflictConfirmed:true,historyConflictSignature:initial.conflictSignature,historyOverwrite:['content']})
 const [confirmed]=plan([confirmedRecord],[],[conflict]);assert.equal(confirmed.category,'bind');assert.deepEqual(confirmed.conflicts,['is_completed','content']);assert.equal(bindingStillMatches(confirmed,{report_version:3}),true)
 const changedTarget=plan([confirmedRecord],[],[{...conflict,report:{...conflict.report,version:4}}])[0];assert.equal(changedTarget.category,'needs');assert.match(changedTarget.reason,/核對/)
})
test('stale preview fields require a fresh per-field decision and change the comparison signature',()=>{
 const route={...occurrence,report:{id:'report',version:4,content:'EduLog 現值',is_completed:false}},stale=record({data:{content:'來源內容'},staleReviewFields:['content'],historyFieldDecisions:{},historyOverwrite:[]})
 const [pending]=plan([stale],[],[route]);assert.equal(pending.category,'needs');assert.deepEqual(pending.staleReviewFields,['content']);assert.ok(pending.issues.some(issue=>issue.fieldKey==='content'&&/預覽失效/.test(issue.message)))
 const selected=record({data:{content:'來源內容'},historyFieldDecisions:{content:'source'},historyOverwrite:['content'],staleReviewFields:['content']}),[selectedPlan]=plan([selected],[],[route]),confirmed={...selected,historyConflictConfirmed:true,historyConflictSignature:selectedPlan.conflictSignature}
 assert.equal(plan([confirmed],[],[route])[0].category,'bind')
})
test('history-only still validates source identity and unresolved field mappings',()=>{
  const [item]=plan([record({historyOnly:true,sourceLearningStatusRaw:'unrecognized marker'})])
  assert.equal(item.category,'needs');assert.equal(item.issues[0].code,'mapping')
})
test('history-only decisions compare against saved history and confirm with the same current signature',()=>{
 const existing={id:'saved-history',report_date:'2026-10-04',source_admission_id:'301',source_key:'report:401',content:'old text',version:4}
 const [pending]=plan([record({historyOnly:true,data:{content:'new text'}})],[existing]);assert.equal(pending.category,'needs');assert.equal(pending.comparisonReport,existing);assert.deepEqual(pending.conflicts,['content'])
 const [confirmed]=plan([record({historyOnly:true,data:{content:'new text'},historyConflictConfirmed:true,historyConflictSignature:pending.conflictSignature,historyOverwrite:['content']})],[existing]);assert.equal(confirmed.category,'history');assert.equal(confirmed.data.content,'new text')
})
test('changed linked reports can be reviewed against their existing occurrence without changing the link',()=>{
 const existing={id:'saved-history',report_date:'2026-10-04',source_admission_id:'301',source_key:'report:401',linked_report_id:'report',content:'old text',version:4}
 const linkedOccurrence={...occurrence,report:{id:'report',version:3,content:'older text'}}
 const [pending]=plan([record({data:{content:'new text'}})],[existing],[linkedOccurrence]);assert.equal(pending.category,'needs');assert.equal(pending.boundExisting,true);assert.equal(pending.occurrence,undefined);assert.deepEqual(pending.conflicts,['content'])
 const [confirmed]=plan([record({data:{content:'new text'},historyConflictConfirmed:true,historyConflictSignature:pending.conflictSignature,historyOverwrite:['content']})],[existing],[linkedOccurrence]);assert.equal(confirmed.category,'bind');assert.equal(confirmed.occurrence.id,occurrence.id)
})
test('a changed already-bound history cannot be saved history-only and must reconcile its original occurrence',()=>{
 const existing={id:'saved-history',report_date:'2026-10-04',source_admission_id:'301',source_key:'report:401',linked_report_id:'report',content:'old history',version:4}
 const linked={...occurrence,report:{id:'report',version:3,content:'old lesson'}}
 const recordWithChoice=record({historyOnly:true,data:{content:'new text'}})
 const [blocked]=plan([recordWithChoice],[existing],[linked]);assert.equal(blocked.category,'needs');assert.equal(blocked.issues[0].id,'bound-history-reconcile');assert.equal(blocked.comparisonReport.id,'report')
 recordWithChoice.historyOnly=false
 const [review]=plan([recordWithChoice],[existing],[linked]);assert.equal(review.category,'needs');assert.deepEqual(review.conflicts,['content']);assert.equal(review.occurrence,undefined)
})
test('mixed text uses the exact source and chosen EduLog signature for the payload',()=>{
 const report={...occurrence,report:{id:'report',version:3,content:'old\nkeep'}}
 const r=record({data:{content:'keep\nnew'},historyMerge:{content:{signature:JSON.stringify(['keep\nnew','old\nkeep']),text:'old\nkeep\nnew'}},historyConflictConfirmed:true})
 const first=plan([r],[],[report])[0];r.historyConflictSignature=first.conflictSignature
 const [item]=plan([r],[],[report]);assert.equal(item.category,'bind');assert.equal(item.data.content,'old\nkeep\nnew');assert.equal(item.sourceData.content,'keep\nnew')
})
test('mixed empty text blocks history and occurrence payloads until the exact clear result is confirmed',()=>{
 const report={...occurrence,report:{id:'report',version:3,content:'keep this'}}
 const merge={signature:mergeSignature('', 'keep this'),text:''}
 const pendingRecord=record({data:{content:''},historyMerge:{content:merge},historyFieldDecisions:{content:'mixed'},historyOverwrite:['content']})
 const [pending]=plan([pendingRecord],[],[report]);assert.equal(pending.category,'needs');assert.equal(pending.mergeClearNeeds.includes('content'),true);assert.equal(pending.issues[0].code,'merge-clear')
 pendingRecord.historyMergeClearConfirmed={content:mergeClearToken(merge)}
 const [review]=plan([pendingRecord],[],[report]);assert.equal(review.category,'needs');assert.deepEqual(review.conflicts,['content']);pendingRecord.historyConflictConfirmed=true;pendingRecord.historyConflictSignature=review.conflictSignature
 const [confirmed]=plan([pendingRecord],[],[report]);assert.equal(confirmed.category,'bind');assert.equal(confirmed.data.content,'')
})
test('unread, changed linked and conflicting duplicate data cannot be silently imported',()=>{
 const [unread]=plan([record({sourceReadStatus:'failed'})]);assert.equal(unread.category,'needs');assert.equal(unread.issues[0].id,'source-read');assert.equal(unread.issues[0].target,'source')
 assert.equal(plan([record(),record()]).length,1)
 assert.equal(plan([record(),record({data:{content:'different'}})])[0].category,'needs')
 const linked={id:'archive',enrollment_id:'enrollment',report_date:'2026-10-04',source_fields:[{key:'content',label:'評語',text:''}],source_admission_id:'301',source_key:'report:401',linked_report_id:'report',is_completed:false,class_participation:0,classroom_behavior:4.5,content:'',external_link:'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit'}
 assert.equal(plan([record()],[linked])[0].category,'needs','unread bound report is not a verified no-op')
 assert.equal(plan([record()],[linked],[{...occurrence,report:{id:'report',is_completed:false,class_participation:0,classroom_behavior:4.5,content:''}}])[0].category,'linked')
 const changedLinked={...occurrence,report:{id:'report',version:3,content:''}}
 assert.equal(plan([record({data:{content:'changed'}})],[linked],[changedLinked])[0].category,'needs')
})

test('matching source and history still expose a changed bound lesson for a fresh decision',()=>{
 const source=record(),[original]=plan([source]),history={...original.data,id:'archive',version:3,linked_report_id:'report'},route={...occurrence,report:{...source.data,id:'report',version:5,content:'new EduLog text'}}
 const [pending]=plan([source],[history],[route]);assert.equal(pending.category,'needs');assert.equal(pending.comparisonReport,route.report);assert.ok(pending.conflicts.includes('content'))
 source.historyFieldDecisions={content:'keep'};source.historyConflictConfirmed=true;source.historyConflictSignature=plan([source],[history],[route])[0].conflictSignature
 const [reviewed]=plan([source],[history],[route]);assert.equal(reviewed.category,'bind');assert.equal(reviewed.record.historyFieldDecisions.content,'keep');assert.equal(reviewed.record.historyOverwrite?.includes('content')||false,false);assert.equal(reviewed.occurrence.id,route.id)
 assert.equal(plan([record()],[history],[{...route,can_write:false}])[0].category,'needs')
})

test('company history preview compares the mapped enrollment lesson entry, not the report primary projection',()=>{
 const report={...occurrence,id:'shared-occurrence',report:{id:'shared-report',version:8,primary_lesson_entry_id:'entry-a',lesson_id:'lesson-a',is_completed:true,progress_letter:'C',lesson_entries:[
  {id:'entry-a',enrollment_id:'enrollment-a',course_id:'course-a',lesson_id:'lesson-a',is_completed:true,progress_letter:'C'},
  {id:'entry-b',enrollment_id:'enrollment',course_id:'course',lesson_id:'lesson-b',is_completed:false,progress_letter:'B'}
 ]}}
 const source=record({historyOccurrenceId:'shared-occurrence',sourceFields:[{key:'lesson_id',label:'課次',type:'stage',value:'lesson:2',options:[]},{key:'content',label:'評語',type:'text',value:'本週內容'}],data:{is_completed:true,progress_letter:'C',content:'本週內容'}})
 const [review]=plan([source],[],[report],{...options,lessons:[{id:'lesson-b',course_id:'course',sequence:2,title:'Lesson B'}]})
 assert.equal(review.category,'needs')
 assert.deepEqual(review.conflicts,['is_completed','progress_letter'])
 source.historyConflictConfirmed=true;source.historyConflictSignature=review.conflictSignature
 const [item]=plan([source],[],[report],{...options,lessons:[{id:'lesson-b',course_id:'course',sequence:2,title:'Lesson B'}]})
 assert.equal(item.category,'bind')
 assert.deepEqual(item.lessonSyncTarget,{enrollment_id:'enrollment',enrollment_name:'測試學生',course_id:'course',lesson_id:'lesson-b',lesson_name:'Lesson B',entry_id:'entry-b',primary:false})
 assert.deepEqual(item.conflicts,['is_completed','progress_letter'])
 assert.equal(item.comparisonReport.lesson_id,'lesson-b')
})

test('a corrected linked occurrence needs explicit reconfirmation and cannot be rebound to a different source report',()=>{
 const originalSource=record({historyOccurrenceId:occurrence.id,data:{...record().data,lesson_id:'lesson-b',is_completed:false,progress_letter:'B',content:'old text'}})
 const [original]=plan([originalSource],[],[occurrence]);const history={...original.data,id:'saved-history',version:4,linked_report_id:'report'}
 const moved={...occurrence,id:'corrected-occurrence',occurrence_date:'2026-10-11',report:{...original.data,id:'report',version:6,source_report_id:'401',source_synced_version:6,source_synced_fields:{content:'old text'},lesson_entries:[{id:'entry',enrollment_id:'enrollment',course_id:'course',lesson_id:'lesson-b',is_completed:false,progress_letter:'B'}]}}
 const source=record({historyOccurrenceId:'corrected-occurrence',data:{...record().data,lesson_id:'lesson-b',is_completed:false,progress_letter:'B',content:'new text'}})
 const [pending]=plan([source],[history],[moved],{...options,lessons:[{id:'lesson-b',course_id:'course',title:'Lesson B'}]})
 assert.equal(pending.category,'needs')
 assert.equal(pending.issues[0].code,'linked-target-reconfirm')
 assert.equal(pending.occurrence,undefined)
 source.historyOccurrenceConfirmation=pending.targetConfirmationOptions['corrected-occurrence']
 const [confirmed]=plan([source],[history],[moved],{...options,lessons:[{id:'lesson-b',course_id:'course',title:'Lesson B'}]})
 assert.equal(confirmed.category,'bind')
 assert.equal(confirmed.occurrence.id,'corrected-occurrence')
 assert.equal(confirmed.reconfirmedTarget,true)
 const staleTarget={...moved,report:{...moved.report,version:7}}
 assert.equal(plan([source],[history],[staleTarget])[0].issues[0].code,'linked-target-reconfirm','a report version change invalidates the stored target confirmation')
 const other={...moved,id:'different-report-occurrence',report:{...moved.report,id:'different-report',source_report_id:'999'}}
 source.historyOccurrenceId='different-report-occurrence'
 source.historyOccurrenceConfirmation=JSON.stringify({occurrence_id:'different-report-occurrence'})
 assert.equal(plan([source],[history],[moved,other])[0].issues[0].code,'linked-target-reconfirm')
})
test('list/editor disagreements wait for explicit confirmation before course-report binding',()=>{
 const conflict={key:'content',label:'學習表現',listValue:'舊列表',editValue:'已儲存內容'}
 assert.equal(plan([record({sourceFieldConflicts:[conflict]})])[0].category,'needs')
 const [confirmed]=plan([record({sourceFieldConflicts:[conflict],sourceConflictAcknowledged:true})])
 assert.equal(confirmed.category,'bind');assert.equal(confirmed.data.content,'')
})
test('two sources for one occurrence require review unless one is saved as history only',()=>{
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

test('placeholder and unverified previous-enrollment rows are categorized without teacher-action issues or payloads',()=>{
 const [unfilled,other]=plan([
  record({sourceRowType:'unfilled',sourceLookupReportId:'6422189',data:{},sourceFields:[]}),
  record({sourceRowType:'other-admission',sourceRowReason:'前一報名學生無法確認',enrollment_source_id:'200'})
 ])
 assert.equal(unfilled.category,'unfilled');assert.equal(unfilled.issues,undefined);assert.equal(unfilled.data,undefined)
 assert.equal(other.category,'other-admission');assert.equal(other.issues,undefined);assert.equal(other.data,undefined)
})

test('verified previous-admission rows route through their original enrollment while holidays and range exclusions stay grouped',()=>{
 const admissions=new Map([['301',{id:'current',courseId:'course',name:'目前學生'}],['200',{id:'previous',courseId:'older-course',name:'目前學生'}]])
 const [previous,holiday,outside]=planHistory([
  record({enrollment_source_id:'200',historyKey:'report:200:401',sourceRowType:'previous-admission',sourceAdmissionContextVerified:true,sourceCourseCode:'dt-python'}),
  record({source_id:'402',historyKey:'report:402',sourceRowType:'system-excluded',sourceRowReason:'休假日，沒有教學資料'}),
  record({source_id:'403',historyKey:'report:403',date:'1800-01-01'})
 ],admissions,new Map([['previous',[]]]),new Map([['previous',[occurrence]]]),options)
 assert.equal(previous.category,'bind');assert.equal(previous.target.id,'previous')
 assert.equal(holiday.category,'system-excluded');assert.equal(holiday.data,undefined);assert.equal(outside.category,'system-excluded');assert.equal(outside.data,undefined)
})

test('sync field preferences exclude payload and raw source text; report exceptions override saved defaults',()=>{
 const source={...record({sourceFields:[{key:'content',label:'評語',type:'text',value:'來源文字'}],data:{content:'來源文字',attendance_status:'present',is_completed:false}})}
 const [excluded]=plan([source],[],[occurrence],{...options,syncFields:{content:false,attendance_status:true,is_completed:true}})
 assert.equal(excluded.data.content,undefined);assert.equal(excluded.data.source_fields.some(f=>f.key==='content'),false);assert.equal(excluded.data.attendance_status,'present');assert.equal(excluded.includedFields.includes('content'),false)
 const [override]=plan([{...source,syncFieldOverrides:{content:true}}],[],[occurrence],{...options,syncFields:{content:false,attendance_status:true,is_completed:true}})
 assert.equal(override.data.content,'來源文字');assert.equal(override.includedFields.includes('content'),true)
 const [none]=plan([{...source,syncFieldOverrides:{content:false,attendance_status:false,is_completed:false,progress_letter:false,lesson_id:false,absence_reason:false,class_participation:false,classroom_behavior:false,contact_notes:false,class_notes:false,external_link:false}}],[],[occurrence],{...options,syncFields:Object.fromEntries(['content','attendance_status','is_completed','progress_letter','lesson_id','absence_reason','class_participation','classroom_behavior','contact_notes','class_notes','external_link'].map(k=>[k,false]))})
 assert.equal(none.category,'system-excluded');assert.match(none.reason,/未選取任何可同步欄位/)
})
