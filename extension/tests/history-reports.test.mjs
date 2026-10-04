import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
function fixture(){
 const dom=new JSDOM('<body></body>',{url:'https://corp.orangeapple.co/courses/dt/11',runScripts:'outside-only'}),w=dom.window
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.AbortSignal.timeout=()=>undefined
 for(const path of ['source-date.js','field-mappings.js','adapters/orange-apple-integration.js'])w.eval(readFileSync(new URL('../'+path,import.meta.url),'utf8'))
 const pages=new Map(),calls=[];w.fetch=async(url,options)=>{calls.push({url,options});const html=pages.get(new URL(url).pathname);return{ok:html!==undefined,headers:{get:()=> 'text/html'},text:async()=>html||''}}
 return{dom,pages,calls,api:w.edulogSourceIntegration}
}
const table=rows=>`<div id="page-body"><div class="content"><table><tbody><tr><th>編號</th><th>上課日期</th><th>教學紀錄</th></tr>${rows}</tbody></table></div></div>`
const row=(id,date,content='')=>`<tr><td>1</td><td>${date}</td><td>${id?`<a href="/dt_admissions/301/reports/${id}/edit">編輯</a>`:''}<p>評語：${content}</p></td></tr>`
const editor=(id,date)=>`<html><body><script>throw Error('never executed')</script><form action="/dt_admissions/301/reports/${id}" data-date="${date}"><input type="hidden" name="authenticity_token" value="FORBIDDEN_LOGIN_SECRET"><select id="lesson_report_attendance_status"><option value="attended" selected>出席</option></select><select id="dt_admission_lesson_report_completion_status"><option value="no" selected>未完成</option></select><input type="radio" name="admission_lesson_report[participation_rating]" value="9" checked><input type="radio" name="admission_lesson_report[behavior_rating]" value="0" checked><textarea id="lesson_report_feedback"></textarea><textarea id="lesson_report_contact">聯絡欄教學文字</textarea><input type="checkbox" id="nothing"><input type="submit"></form></body></html>`
test('history reads each verified editor, even blank feedback, incomplete and zero-valued reports',async()=>{
 const {api,pages,calls,dom}=fixture();pages.set('/dt_admissions/301',table(row('401','2026/10/01','列表過時評語')+row('402','2026/10/02')+row('403','2020/01/01')));pages.set('/dt_admissions/301/reports/401/edit',editor('401','2026-10-01'));pages.set('/dt_admissions/301/reports/402/edit',editor('402','2026-10-02'))
 const records=await api.readHistory('/dt_admissions/301',{dateFrom:'2026-01-01',dateTo:'2026-12-31'})
 assert.equal(records.length,3);assert.equal(records[0].data.content,'','editor blank is authoritative over a stale list comment');assert.equal(records[0].data.is_completed,false);assert.equal(records[0].data.class_participation,4.5);assert.equal(records[0].data.classroom_behavior,0);assert.equal(records[1].sourceReadStatus,'complete');assert.equal(records[2].outsideRange,true)
 assert.equal(calls.length,3);assert.equal(records[0].data.external_link,'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit');assert.equal(JSON.stringify(records).includes('FORBIDDEN_LOGIN_SECRET'),false);assert.equal(JSON.stringify(records).includes('<html>'),false);assert.ok(records[0].sourceEvidence.length>1);dom.window.close()
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

test('full list teaching values survive without report IDs; exact evidence dedupes',async()=>{
 const {api,pages,dom}=fixture()
 const record='<tr><td>1</td><td>2026/10/04</td><td><label>評語：</label><p></p><label>聯絡欄：</label><p>保留\n段落</p><label>課程進度：</label><span>未完成</span><label>課程參與：</label><span>0</span><label>課堂表現：</label><span>4.5</span><label>最新課程階段：</label><span>Lesson 13</span></td><td>FORBIDDEN_ADMIN</td></tr>'
 pages.set('/dt_admissions/301',table(record+record))
 const records=await api.readHistory('/dt_admissions/301')
 assert.equal(records.length,1);assert.equal(records[0].source_id,null);assert.match(records[0].historyKey,/^evidence:[a-f0-9]{64}$/)
 assert.equal(records[0].data.content,'');assert.equal(records[0].data.class_participation,0);assert.equal(records[0].data.classroom_behavior,4.5);assert.equal(records[0].data.is_completed,false)
 assert.equal(records[0].sourceLessonLabel,'Lesson 13');assert.equal(JSON.stringify(records).includes('FORBIDDEN_ADMIN'),false)
 dom.window.close()
})
