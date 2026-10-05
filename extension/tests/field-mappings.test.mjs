import test from 'node:test'
import assert from 'node:assert/strict'
import { mappedReport } from '../import-field-mappings.js'
const m=globalThis.edulogFieldMappings
const select=(key,value,options)=>({key,type:'select',label:key,value,options:options.map(([value,label])=>({value,label,disabled:false}))})
const attendance=()=>select('attendance_status','attended',[['attended','出席'],['away','不出席']])
test('shared semantic equivalence preserves Chinese meanings without overwriting',()=>{
 const f=attendance();assert.equal(m.canonical(f),'present');assert.equal(m.equal(f,{attendance_status:'present'}),true);assert.equal(m.display(f,{attendance_status:'present'}),'出席');assert.equal(m.suggest(f,{attendance_status:'absent'}),'away')
 f.value='';assert.equal(m.equal(f,{attendance_status:'present'}),false)
})
test('global attendance mappings apply across course contexts while lessons stay course-scoped',()=>{
 const field=attendance(),rule={field_key:'attendance_status',source_value:'attended',canonical_value:'present',options_signature:m.signature(field),valid:true}
 const record={data:{},sourceFields:[field],fieldRules:[rule]}
 assert.equal(mappedReport(record,'course-a').data.attendance_status,'present');assert.equal(mappedReport(record,'course-b').data.attendance_status,'present')
 const lesson={key:'lesson_id',type:'select',value:'source-lesson',options:[{value:'source-lesson',label:'Lesson 3',disabled:false}]},scoped={data:{},sourceFields:[lesson],fieldRules:[{field_key:'lesson_id',source_value:'source-lesson',canonical_value:'lesson-a',course_id:'course-a',options_signature:m.signature(lesson),valid:true}]}
 assert.equal(mappedReport(scoped,'course-a',[{id:'lesson-a',course_id:'course-a'}]).data.lesson_id,'lesson-a');assert.equal(mappedReport(scoped,'course-b',[{id:'lesson-a',course_id:'course-a'}]).data.lesson_id,undefined)
})
test('false, zero, empty and verified half stars remain distinct',()=>{
 const complete=select('is_completed','no',[['yes','已完成'],['no','未完成']]);assert.equal(m.canonical(complete),false);assert.equal(m.suggest(complete,{is_completed:false}),'no');assert.equal(m.display(complete,{is_completed:false}),'課程未完成')
 const rating={...select('class_participation','0',[['0','0 星'],['9','4.5 星']]),type:'radio'};assert.equal(m.canonical(rating),0);assert.equal(m.suggest(rating,{class_participation:4.5}),'9');assert.equal(m.suggest({...rating,type:'select'},{class_participation:4.5}),'');assert.equal(m.empty(false),false);assert.equal(m.empty(0),false)
})
test('lesson display includes the real sequence without changing the lesson identity',()=>{
 const m=globalThis.edulogFieldMappings,lesson={id:'lesson-3',course_id:'course-a',sequence:3,title:'跳躍吧！小鳥'}
 assert.equal(m.lessonLabel(lesson),'Lesson 3 · 跳躍吧！小鳥')
 assert.equal(m.lessonLabel({id:'lesson-x',title:'跳躍吧！小鳥'}),'序號未提供 · 跳躍吧！小鳥')
 assert.deepEqual(globalThis.edulogFieldMappingUI.choices({key:'lesson_id'}, {}, [lesson]),[['lesson-3','Lesson 3 · 跳躍吧！小鳥']])
})
test('multiple source options never imply one reverse mapping; stale revisions are not used',()=>{
 const f=select('attendance_status','first',[['first','選項一'],['second','選項二']]),rules=f.options.map(o=>({field_key:f.key,source_value:o.value,canonical_value:'present',options_signature:m.signature(f)}))
 assert.equal(m.canonical(f,rules),'present');assert.equal(m.suggest(f,{attendance_status:'present'},rules),'')
 assert.equal(m.canonical(f,rules.map(r=>({...r,valid:false}))),undefined);assert.equal(m.canonical({...f,options:[...f.options,{value:'new',label:'新選項'}]},rules),undefined)
})
test('import mapping preserves authoritative blanks, false and half stars but blocks unresolved options',()=>{
 const record={data:{content:'',is_completed:true,class_participation:5},sourceFields:[attendance(),select('is_completed','no',[['no','未完成']]),{...select('class_participation','9',[['9','4.5 星']]),type:'radio'}]}
 const result=mappedReport(record,'course');assert.deepEqual(result.needs,[]);assert.equal(result.data.content,'');assert.equal(result.data.is_completed,false);assert.equal(result.data.class_participation,4.5)
 record.sourceFields.push(select('absence_reason','custom',[['custom','未知原因']]));assert.equal(mappedReport(record,'course').needs.length,1)
 record.sourceFields.at(-1).disabled=true;assert.equal(mappedReport(record,'course').needs.length,0)
})
test('manual choices and remembered lessons are limited to the selected course, source value and option signature',()=>{
 const field=select('lesson_id','native1',[['native1','原站教材']]),lesson={id:'edulog1',course_id:'courseA',title:'其他教材'},record={data:{},sourceFields:[field],fieldChoices:{courseId:'courseA',fields:{lesson_id:{value:lesson.id,sourceValue:field.value,signature:m.signature(field)}}}}
 assert.equal(mappedReport(record,'courseA',[lesson]).data.lesson_id,lesson.id);assert.equal(mappedReport(record,'courseB',[lesson]).needs.length,1)
 field.value='changed';assert.equal(mappedReport(record,'courseA',[lesson]).needs.length,1)
})
test('progress must preserve both endpoints and native option limits',()=>{
 const record={data:{},sourceFields:[select('progress_start','a',[['a','A']]),select('progress_end','b',[['b','B']])]}
 assert.equal(mappedReport(record,'course').data.progress_letter,'A-B');record.sourceFields[1].options[0].label='未知章節';assert.ok(mappedReport(record,'course').needs.length)
})

test('learning status round-trips as a separate class note marker without inferring prose',()=>{
 const value=m.composeClassNotes('on_track','原有內部筆記')
 assert.match(value,/\[corp\.learning_status:on_track\]/)
 assert.deepEqual(m.splitClassNotes(value),{status:'on_track',rawStatus:'能跟上進度',notes:'原有內部筆記',marked:true,invalid:false})
 assert.equal(m.splitClassNotes('學生能跟上進度，這週完成 Lesson 1。').status,null)
 assert.equal(m.splitClassNotes('[corp.learning_status:on_track]\n其他文字\n[/corp.learning_status]').invalid,true)
 assert.equal(m.splitClassNotes(`${value}\n\n${value}`).invalid,true)
 assert.equal(m.composeClassNotes(null,'',''), '')
})

test('lesson stages auto-map only to one lesson with the same sequence in the confirmed course',()=>{
 const record={data:{},sourceLessonLabel:'Lesson 2',sourceFields:[{key:'lesson_id',label:'最新課程階段',type:'stage',value:'lesson:2',options:[{value:'lesson:2',label:'Lesson 2',disabled:false}]}]}
 const lessons=[{id:'a',course_id:'courseA',sequence:1},{id:'b',course_id:'courseA',sequence:2},{id:'other',course_id:'courseB',sequence:2}]
 assert.equal(mappedReport(record,'courseA',lessons).data.lesson_id,'b')
 assert.deepEqual(mappedReport(record,'courseA',lessons).needs,[])
 assert.equal(mappedReport(record,'courseB',lessons).data.lesson_id,'other')
 lessons.push({id:'duplicate',course_id:'courseA',sequence:2})
 assert.ok(mappedReport(record,'courseA',lessons).needs.some(reason=>reason.includes('多個教材候選')))
})
