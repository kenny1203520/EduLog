import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
function fixture(){
 const dom=new JSDOM('<body></body>',{url:'https://corp.orangeapple.co/courses/dt/11',runScripts:'outside-only'}),w=dom.window
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.AbortSignal.timeout=()=>undefined
 for(const path of ['shared/source-date.js','shared/field-mappings.js','sites/orange-apple/orange-apple-integration.js'])w.eval(readFileSync(new URL('../'+path,import.meta.url),'utf8'))
 const pages=new Map(),calls=[];w.fetch=async(url,options)=>{calls.push({url,options});const html=pages.get(new URL(url).pathname);return{ok:html!==undefined,headers:{get:()=> 'text/html'},text:async()=>html||''}}
 return{dom,pages,calls,api:w.edulogSourceIntegration}
}
const table=rows=>`<div id="page-body"><div class="content"><table><tbody><tr><th>編號</th><th>上課日期</th><th>教學紀錄</th></tr>${rows}</tbody></table></div></div>`
const row=(id,date,content='')=>`<tr><td>1</td><td>${date}</td><td>${id?`<a href="/dt_admissions/301/reports/${id}/edit">編輯</a>`:''}<p>評語：${content}</p></td></tr>`
const editor=(id,date)=>`<html><body><script>throw Error('never executed')</script><form action="/dt_admissions/301/reports/${id}" data-date="${date}"><input type="hidden" name="authenticity_token" value="FORBIDDEN_LOGIN_SECRET"><select id="lesson_report_attendance_status"><option value="attended" selected>出席</option></select><select id="dt_admission_lesson_report_completion_status"><option value="no" selected>未完成</option></select><input type="radio" name="admission_lesson_report[participation_rating]" value="9" checked><input type="radio" name="admission_lesson_report[behavior_rating]" value="0" checked><textarea id="lesson_report_feedback"></textarea><textarea id="lesson_report_contact">聯絡欄教學文字</textarea><input type="checkbox" id="nothing"><input type="submit"></form></body></html>`
test('history reads each verified editor, even blank feedback, incomplete and zero-valued reports',async()=>{
 const {api,pages,calls,dom}=fixture();pages.set('/dt_admissions/301',table(row('401','2026/10/01','列表過時評語')+row('402','2026/10/02')+row('403','2020/01/01')));pages.set('/dt_admissions/301/reports/401/edit',editor('401','2026-10-01'));pages.set('/dt_admissions/301/reports/402/edit',editor('402','2026-10-02'))
 const records=await api.readHistory('/dt_admissions/301',{dateFrom:'2026-01-01',dateTo:'2026-12-31'})
 assert.equal(records.length,3);assert.equal(records[0].data.content,'','editor blank is authoritative over a stale list comment');assert.ok(records[0].sourceFieldConflicts.some(f=>f.key==='content'&&f.listValue==='列表過時評語'&&f.editValue==='空白'));assert.equal(records[0].data.is_completed,false);assert.equal(records[0].data.class_participation,4.5);assert.equal(records[0].data.classroom_behavior,0);assert.equal(records[1].sourceReadStatus,'complete');assert.equal(records[2].outsideRange,true)
 assert.equal(calls.length,3);assert.equal(records[0].data.external_link,'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit');assert.equal(JSON.stringify(records).includes('FORBIDDEN_LOGIN_SECRET'),false);assert.equal(JSON.stringify(records).includes('<html>'),false);assert.ok(records[0].sourceEvidence.length>1);dom.window.close()
})
test('selected class report resolves its exact full date from the matching native editor',async()=>{
 const {api,pages,calls,dom}=fixture();pages.set('/dt_admissions/301',table(row('401','10/04')));pages.set('/dt_admissions/301/reports/401/edit',editor('401','2026-10-04'))
 const resolved=await api.resolveSessionDate('/dt_admissions/301','https://corp.orangeapple.co/dt_admissions/301/reports/401/edit')
 assert.equal(resolved.date,'2026-10-04');assert.equal(resolved.reportId,'401');assert.equal(resolved.enrollmentId,'301')
 assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/dt_admissions/301','/dt_admissions/301/reports/401/edit'])
 await assert.rejects(api.resolveSessionDate('/dt_admissions/302','https://corp.orangeapple.co/dt_admissions/301/reports/401/edit'),error=>error.code==='SOURCE_REPORT_MISMATCH')
 dom.window.close()
})

test('on-demand previous teaching reads only the newest substantive report for that enrollment and requires a full cutoff date',async()=>{
 const {api,pages,calls,dom}=fixture();pages.set('/dt_admissions/301',table(row('401','2026/10/01')+row('402','2026/10/02')+row('403','2026/10/03')));pages.set('/dt_admissions/301/reports/401/edit',editor('401','2026-10-01'));pages.set('/dt_admissions/301/reports/402/edit',editor('402','2026-10-02'));pages.set('/dt_admissions/301/reports/403/edit',editor('403','2026-10-03'))
 await assert.rejects(api.readPreviousTeaching('/dt_admissions/301','10/04'),error=>error.code==='SESSION_DATE_UNAVAILABLE')
 const result=await api.readPreviousTeaching('/dt_admissions/301','2026-10-04')
 assert.equal(result.status,'found');assert.equal(result.report.sourceId,'403');assert.equal(result.report.date,'2026-10-03');assert.equal(result.report.behavior,0)
 assert.deepEqual(calls.map(call=>new URL(call.url).pathname),['/dt_admissions/301','/dt_admissions/301/reports/403/edit'])
 dom.window.close()
})
test('individual failures retain evidence and successful records; retry reads only the failed editor',async()=>{
 const {api,pages,calls,dom}=fixture();pages.set('/dt_admissions/301',table(row('401','2026.10.01')+row('402','2026.10.02')));pages.set('/dt_admissions/301/reports/402/edit',editor('402','2026-10-02'))
 const records=await api.readHistory('/dt_admissions/301');assert.equal(records[0].sourceReadStatus,'failed');assert.equal(records[1].sourceReadStatus,'complete');assert.ok(records[0].sourceEvidence.length)
 pages.set('/dt_admissions/301/reports/401/edit',editor('401','2026-10-01'));const before=calls.length;assert.equal((await api.readReport(records[0])).sourceReadStatus,'complete');assert.equal(calls.length,before+1);dom.window.close()
})
test('unknown identity can only be supplied by a matching native form and confirmed full date',async()=>{
 const {api,pages,dom}=fixture();pages.set('/dt_admissions/301',table(row(null,'10/1','原文保留')));const [unknown]=await api.readHistory('/dt_admissions/301');assert.equal(unknown.source_id,null);assert.equal(unknown.date,null)
 await assert.rejects(api.readReport(unknown,'https://other.example/dt_admissions/301/reports/401/edit','2026-10-01'),/原站|不一致/)
 await assert.rejects(api.readReport(unknown,'/dt_admissions/999/reports/401/edit','2026-10-01'),/不一致/)
 pages.set('/dt_admissions/301/reports/401/edit',editor('401','2026-10-01'));const completed=await api.readReport(unknown,'/dt_admissions/301/reports/401/edit','2026-10-01');assert.equal(completed.source_id,'401');assert.equal(completed.date,'2026-10-01');assert.equal(completed.identityUnverified,false);assert.equal(completed.dateInfo.basis,'user_confirmed')
 await assert.rejects(api.readReport(unknown,'/dt_admissions/301/reports/401/edit','2026-10-02'),/日期/);pages.set('/dt_admissions/301/reports/401/edit',editor('402','2026-10-01'));await assert.rejects(api.readReport(unknown,'/dt_admissions/301/reports/401/edit'),/唯一/);dom.window.close()
})
test('duplicate history IDs merge evidence but conflicting dates never overwrite identity',async()=>{
 const {api,pages,dom}=fixture();pages.set('/dt_admissions/301',table(row('401','2026/10/01')+row('401','2026/10/02')));pages.set('/dt_admissions/301/reports/401/edit',editor('401','2026-10-01'))
 const records=await api.readHistory('/dt_admissions/301');assert.equal(records.length,1);assert.equal(records[0].sourceEvidence.length,2);assert.equal(records[0].sourceReadStatus,'failed');assert.match(records[0].needs[0],/矛盾/);dom.window.close()
})
test('history uses date headers rather than positional administrative columns',async()=>{
 const {api,pages,dom}=fixture();pages.set('/dt_admissions/301','<div id="page-body"><div class="content"><table><thead><tr><th>上課日期</th><th>行政項目</th><th>教學紀錄</th></tr></thead><tbody><tr><td>2026/10/01</td><td>2024/01/01</td><td><a href="/dt_admissions/301/reports/401/edit">編輯</a></td></tr></tbody></table></div></div>');pages.set('/dt_admissions/301/reports/401/edit',editor('401','2026-10-01'))
 const [r]=await api.readHistory('/dt_admissions/301');assert.equal(r.date,'2026-10-01');assert.equal(r.sourceReadStatus,'complete');dom.window.close()
})

test('rows without report IDs keep their list values but only become attendance evidence; no content or row identity',async()=>{
 const {api,pages,dom}=fixture()
 const record='<tr><td>1</td><td>2026/10/04</td><td><label>評語：</label><p></p><label>聯絡欄：</label><p>保留\n段落</p><label>課程進度：</label><span>未完成</span><label>課程參與：</label><span>0</span><label>課堂表現：</label><span>4.5</span><label>最新課程階段：</label><span>Lesson 13</span></td><td>FORBIDDEN_ADMIN</td></tr>'
 pages.set('/dt_admissions/301',table(record+record))
 const all=await api.readHistory('/dt_admissions/301'),records=all.filter(r=>r.kind==='report'),[attendance]=all.filter(r=>r.kind==='attendance')
 assert.equal(records.length,2,'identical rows are not merged by content');assert.equal(records[0].source_id,null);assert.equal(records[0].historyKey,undefined);assert.equal(records[0].evidenceKey,undefined)
 assert.deepEqual([attendance.enrollment_source_id,attendance.date,attendance.attendance_count],['301','2026-10-04',2])
 assert.equal(records[0].data.content,'');assert.equal(records[0].data.class_participation,0);assert.equal(records[0].data.classroom_behavior,4.5);assert.equal(records[0].data.is_completed,false)
 assert.equal(records[0].sourceLessonLabel,'Lesson 13');assert.equal(JSON.stringify(records).includes('FORBIDDEN_ADMIN'),false)
 dom.window.close()
})

test('history keeps dates in wrapper divs and parses the real assessment columns separately',async()=>{
 const {api,pages,dom}=fixture()
 const html=`<div id="page-body"><div class="content"><div id="admission-data"><ul><li><strong>學生：</strong><a href="/students/9981">林同學</a></li><li><strong>課程名稱：</strong>菁英_Python程式開發班(dt-python)</li></ul></div><table><thead><tr><th>堂次</th><th>日期</th><th>啟用進度</th><th>課程進度</th><th>出席狀況</th><th>學習評估</th><th>寄送時未填寫</th></tr></thead><tbody><tr><td>7</td><td><div class="text-success">2026-07-25</div></td><td>Lesson 1</td><td>L1</td><td>出席試聽</td><td><div class="row"><div class="col-sm-6"><span>5</span></div><div class="col-sm-6"><span>4.5</span></div></div><div class="row"><div class="col-sm-4"><strong>最新課程階段：</strong>&nbsp;Lesson&nbsp;1</div><div class="col-sm-4"><strong>課程進度：</strong>完整完成</div></div><label>評語：</label><p>第一段評語</p><p>第二段評語</p><label>聯絡欄：</label><p></p><label>紀錄：</label><p>能跟上進度</p><p>內部筆記第一段</p><p>內部筆記第二段</p></td><td><button>管理</button></td></tr></tbody></table></div></div>`
 pages.set('/dt_admissions/301',html)
 const [r]=await api.readHistory('/dt_admissions/301')
 assert.equal(r.date,'2026-07-25');assert.equal(r.sourceSessionOrdinal,'7');assert.equal(r.sourceCourseName,'菁英_Python程式開發班');assert.equal(r.sourceCourseCode,'dt-python')
 assert.equal(r.data.attendance_status,'present');assert.equal(r.data.class_participation,5);assert.equal(r.data.classroom_behavior,4.5);assert.equal(r.data.is_completed,true)
 assert.equal(r.sourceLessonSequence,1);assert.equal(r.sourceFields.find(f=>f.key==='lesson_id').value,'lesson:1')
 assert.equal(r.sourceStudentName,'林同學');assert.equal(r.student_source_id,'9981')
 assert.equal(r.data.content,'第一段評語\n第二段評語');assert.equal(r.data.contact_notes,'')
 assert.equal(r.sourceLearningStatus,'on_track');assert.equal(r.sourceLearningStatusRaw,'能跟上進度');assert.equal(r.sourceInternalNotes,'內部筆記第一段\n內部筆記第二段')
 assert.equal(JSON.stringify(r).includes('管理'),false);dom.window.close()
})

test('attendance action URLs are lookup evidence only and empty rows are classified as unfilled',async()=>{
 const {api,pages,calls,dom}=fixture()
 const html=`<div id="page-body"><div class="content"><div id="admission-data"><ul><li><strong>學生：</strong><a href="/students/9981">林同學</a></li><li><strong>課程名稱：</strong>菁英_Python程式開發班(dt-python)</li></ul></div><table><thead><tr><th>堂次</th><th>日期</th><th>啟用進度</th><th>課程進度</th><th>出席狀況</th><th>學習評估</th><th>寄送時未填寫</th></tr></thead><tbody><tr><td>2</td><td><div>2026-10-24</div></td><td colspan="2"></td><td><a href="/dt/admissions/lesson_reports/attendance_status?report_ids%5B%5D=6422189&amp;type=1">設為不出席</a></td><td colspan="2"></td></tr></tbody></table></div></div>`
 pages.set('/dt_admissions/301',html)
 const [record]=await api.readHistory('/dt_admissions/301')
 assert.equal(record.sourceRowType,'unfilled');assert.equal(record.source_id,null);assert.equal(record.sourceLookupReportId,'6422189');assert.equal(record.data.attendance_status,undefined);assert.equal(record.sourceFields.length,0)
 assert.equal(calls.length,1,'the lookup action is never followed and no guessed editor request is made')
 dom.window.close()
})

test('previous-admission rows are included only after matching the original admission student and course',async()=>{
 const {api,pages,dom}=fixture()
 const current=`<div id="page-body"><div class="content"><div id="admission-data"><ul><li><strong>學生：</strong><a href="/students/9981">林同學</a></li><li><strong>課程名稱：</strong>菁英_JavaScript程式開發班(dt-js2)</li></ul></div><table><thead><tr><th>堂次</th><th>日期</th><th>啟用進度</th><th>課程進度</th><th>出席狀況</th><th>學習評估</th></tr></thead><tbody><tr><td>前一<br>報名</td><td>2026-05-09</td><td></td><td>L8</td><td><a href="/dt/admissions/lesson_reports/attendance_status?report_ids%5B%5D=701&amp;type=1">設為不出席</a></td><td>評語：已完成</td><td><a href="/dt_admissions/200/reports/700/edit">編輯</a></td></tr></tbody></table></div></div>`
 pages.set('/dt_admissions/301',current)
 pages.set('/dt_admissions/200',`<div id="admission-data"><ul><li><strong>學生：</strong><a href="/students/9981">林同學</a></li><li><strong>課程名稱：</strong>菁英_Python程式開發班(dt-python)</li></ul></div>`)
 const [record]=await api.readHistory('/dt_admissions/301',{listOnly:true})
 assert.equal(record.sourceRowType,'previous-admission');assert.equal(record.enrollment_source_id,'200');assert.equal(record.sourceAdmissionContextVerified,true);assert.equal(record.student_source_id,'9981');assert.equal(record.sourceCourseCode,'dt-python');assert.equal(record.source_id,'700');assert.equal(record.sourceLookupReportId,'701');assert.equal(record.data.attendance_status,undefined)
 pages.set('/dt_admissions/200',`<div id="admission-data"><ul><li><strong>學生：</strong><a href="/students/9999">不同學生</a></li><li><strong>課程名稱：</strong>菁英_Python程式開發班(dt-python)</li></ul></div>`)
 const [mismatch]=await api.readHistory('/dt_admissions/301',{listOnly:true});assert.equal(mismatch.sourceRowType,'other-admission');assert.equal(mismatch.sourceAdmissionContextVerified,false)
 dom.window.close()
})

test('history column lookup expands colspan on both headers and rows',async()=>{
 const {api,pages,dom}=fixture()
 const html=`<div id="page-body"><div class="content"><table><thead><tr><th>堂次</th><th>日期</th><th colspan="2">課程資料</th><th>出席狀況</th><th colspan="2">學習評估</th></tr><tr><th></th><th></th><th>啟用進度</th><th>課程進度</th><th></th><th></th><th></th></tr></thead><tbody><tr><td>1</td><td>2026-07-25</td><td colspan="2">Lesson 2</td><td>出席</td><td colspan="2"><label>評語：</label><p>欄位正確</p></td></tr></tbody></table></div></div>`
 pages.set('/dt_admissions/301',html)
 const [record]=await api.readHistory('/dt_admissions/301')
 assert.equal(record.date,'2026-07-25');assert.equal(record.data.attendance_status,'present');assert.equal(record.data.content,'欄位正確')
 dom.window.close()
})

test('explicit holidays without teaching content are system exclusions, while saved attendance remains a report',async()=>{
 const {api,pages,dom}=fixture()
 const html=`<div id="page-body"><div class="content"><table><thead><tr><th>堂次</th><th>日期</th><th>啟用進度</th><th>課程進度</th><th>出席狀況</th><th>學習評估</th></tr></thead><tbody><tr><td>--</td><td>2026-09-26</td><td></td><td></td><td>休假日</td><td></td></tr><tr><td>10</td><td>2026-10-10</td><td></td><td></td><td>不出席</td><td></td></tr></tbody></table></div></div>`
 pages.set('/dt_admissions/301',html)
 const all=await api.readHistory('/dt_admissions/301',{listOnly:true}),records=all.filter(r=>r.kind==='report')
 assert.equal(records.length,2);assert.equal(records[0].sourceRowType,'system-excluded');assert.equal(records[1].sourceRowType,'report');assert.equal(records[1].data.attendance_status,'absent')
 assert.deepEqual(Array.from(all).filter(r=>r.kind==='attendance').map(r=>[r.date,r.attendance_count,r.absent_count]),[['2026-10-10',1,1]],'holidays are not attendance evidence')
 dom.window.close()
})

test('class comes from the listing class page first, then the report page lesson session, never the admission current class',async()=>{
 const {api,pages,dom}=fixture()
 const classPage='<div id="page-body"><div class="content"><h2>週日班</h2><table id="reports"><tbody><tr><td><a href="/dt_admissions/301">報名</a><a href="/students/101">學生甲</a></td><td>課程</td><td><a href="/dt_admissions/301/reports/401/edit" data-date="2026-10-04">編輯</a></td></tr></tbody></table></div></div>'
 const admission='<div id="page-body"><div class="content"><div id="admission-data"><ul><li>學生：<a href="/students/101">學生甲</a></li><li>梯次/節次：<a href="/courses/dt/55">目前節次</a></li></ul></div><table><tbody><tr><th>編號</th><th>上課日期</th><th>教學紀錄</th></tr>'+row('401','2026/10/04')+row('402','2026/10/11')+row('403','2026/10/18')+'</tbody></table></div></div>'
 const withSession=(id,date,classId)=>editor(id,date).replace('<form',`<div class="report-meta"><span>學習紀錄節次：</span><a href="/courses/dt/${classId}">週六班</a></div><form`)
 pages.set('/courses/dt/11/lesson_reports',classPage);pages.set('/dt_admissions/301',admission)
 pages.set('/dt_admissions/301/reports/401/edit',withSession('401','2026-10-04','77'));pages.set('/dt_admissions/301/reports/402/edit',withSession('402','2026-10-11','77'));pages.set('/dt_admissions/301/reports/403/edit',editor('403','2026-10-18'))
 dom.window.document.body.innerHTML='<div id="page-body"><div class="content"><h2>週日班</h2></div></div>'
 const snapshot=await api.collect(dom.window.document,{history:false})
 const listed=snapshot.records.find(r=>r.kind==='report'&&r.source_id==='401');assert.equal(listed.sourceClassId,'11');assert.equal(listed.sourceClassBasis,'class-page')
 const history=await api.readHistory('/dt_admissions/301'),byId=Object.fromEntries(history.filter(r=>r.kind==='report').map(r=>[r.source_id,r]))
 assert.equal(byId['402'].sourceClassId,'77');assert.equal(byId['402'].sourceClassBasis,'report-page')
 assert.equal(byId['403'].sourceClassId,null,'the admission current class (梯次/節次) is never used');assert.equal(byId['403'].sourceClassBasis,null)
 const reread=await api.readReport({...listed,sourceFields:[],data:{external_link:'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit'}})
 assert.equal(reread.sourceClassId,'11','the listing class page outranks the report page');assert.equal(reread.sourceReportClassId,'77')
 dom.window.close()
})
