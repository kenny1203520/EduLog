import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
import { retryHistoryWork } from '../workspace-model.js'
const source=readFileSync(new URL('../history-workbench.js',import.meta.url),'utf8').replace('export function','function')
function fixture() {
 const dom=new JSDOM('<section id="history-workbench"><input id="history-search"><select id="history-filter"><option value="needs">待處理</option><option value="all">全部</option></select><div id="history-items"></div><div id="history-editor"><button id="history-back">返回</button><div id="history-detail"></div></div><p id="history-empty"></p><p id="history-sync-summary"></p></section>',{runScripts:'outside-only'})
 const w=dom.window;w.scrollTo=()=>{};w.currentWork={id:'work'};w.hookCounts={changed:0,uiChanged:0,recheck:0};w.eval(source+';window.view=createHistoryWorkbench({work:()=>currentWork,changed:()=>{hookCounts.changed++;window.view?.updateStatus()},uiChanged:()=>hookCounts.uiChanged++,recheck:()=>hookCounts.recheck++,labels:{},fields:(host)=>{const detail=host.ownerDocument.createElement("details");detail.dataset.reviewKey="mapping:attendance";detail.innerHTML="<summary>Mapping</summary><input value=kept>";host.append(detail)}})')
 const item=(key,extra={})=>({key,record:{enrollment_source_id:key,date:'2026-10-04'},target:{id:'enrollment',name:'測試學生'},category:'needs',reason:'日期核對',...extra})
 return {w,dom,item,$:id=>w.document.getElementById(id)}
}
test('repeated mounting reuses one current control and pins the active completed item',()=>{
 const {w,dom,item,$}=fixture(),rows=[item('301'),item('302')];w.view.render(rows);const first=w.document.querySelector('#history-items button');first.click();first.focus();$('history-items').scrollTop=44
 w.view.render([item('301',{category:'history'}),item('302')]);w.view.render([item('301',{category:'history'}),item('302')])
 assert.equal(w.document.querySelectorAll('#history-items button').length,2);assert.equal(w.document.querySelector('#history-items button'),first);assert.equal(first.hidden,false);assert.equal(w.document.activeElement,first);assert.equal($('history-items').scrollTop,44)
 $('history-search').value='no results';$('history-search').dispatchEvent(new w.Event('input'));assert.equal($('history-empty').hidden,false);dom.window.close()
})
test('restore validates item identity, retains per-work scroll and preserves draft focus on refresh',()=>{
 const {w,dom,item,$}=fixture();w.currentWork.historyUI={selected:'301',filter:'all',search:'',listScroll:55,editorScroll:66};w.view.render([item('301')]);assert.equal($('history-items').scrollTop,55);assert.equal($('history-editor').scrollTop,66)
 const control=[...$('history-detail').querySelectorAll('button')].find(b=>b.textContent==='重新核對此份紀錄');control.focus();w.view.refreshEditor();assert.equal(w.document.activeElement.textContent,'重新核對此份紀錄');assert.equal($('history-editor').scrollTop,66)
 w.view.render([]);assert.equal(w.document.querySelectorAll('#history-items button').length,0);assert.match($('history-detail').textContent,/選擇需要處理/);dom.window.close()
})
test('repair uses a new job while preserving confirmed choices and original checkpoints',()=>{
 const previous={id:'original',jobId:'server-job',status:'partial_complete',done:1,revision:4,batches:[{key:'submitted'}],appliedBatchKeys:['submitted'],ids:{enrollment:'kept'},snapshot:{admissionPaths:['/dt_admissions/301'],records:[{historyOnly:true}]},history:{paths:['/dt_admissions/301'],next:1,checkpoints:{completed:true}},uiState:[{id:'enrollment-301',value:'confirmed'}]}
 const before=structuredClone(previous),next=retryHistoryWork(previous);assert.deepEqual(previous,before);assert.notEqual(next.id,previous.id);assert.equal(next.parentWorkId,previous.id);assert.equal(next.jobId,undefined);assert.equal(next.batches,undefined);assert.equal(next.done,0);assert.equal(next.history.next,0);assert.deepEqual(next.uiState,previous.uiState);assert.deepEqual(next.ids,previous.ids)
})

test('search and filter changes persist UI state without marking import data dirty',()=>{
 const {w,dom,item,$}=fixture();w.view.render([item('301')]);$('history-search').value='name';$('history-search').dispatchEvent(new w.Event('input',{bubbles:true}));$('history-filter').value='all';$('history-filter').dispatchEvent(new w.Event('change',{bubbles:true}))
 assert.equal(w.hookCounts.uiChanged,2);assert.equal(w.hookCounts.changed,0);assert.equal(w.hookCounts.recheck,0);assert.equal(w.currentWork.historyUI.search,'name');assert.equal(w.currentWork.historyUI.filter,'all');dom.window.close()
})

test('list editor conflict acknowledgement updates local state without a full recheck',()=>{
 const {w,dom,item,$}=fixture(),row=item('301',{record:{enrollment_source_id:'301',date:'2026-10-04',sourceFieldConflicts:[{key:'content',label:'評語',listValue:'清單內容',editValue:'報告頁內容'}]}});w.currentWork.historyUI={selected:'301'};w.view.render([row]);const acknowledgement=[...$('history-detail').querySelectorAll('.source-conflicts button')][0];assert.ok(acknowledgement);acknowledgement.click()
 assert.equal(row.record.sourceConflictAcknowledged,true);assert.equal(w.hookCounts.changed,1);assert.equal(w.hookCounts.recheck,0);assert.match($('history-detail').textContent,/已確認/);dom.window.close()
})

test('local mapping updates retain loaded editor controls, expansion, draft, focus, and scroll',()=>{
 const {w,dom,item,$}=fixture(),row=item('301');w.currentWork.historyUI={selected:'301'};w.view.render([row]);const mapping=$('history-detail').querySelector('[data-review-key="mapping:attendance"]'),input=mapping.querySelector('input');mapping.open=true;input.value='draft';input.focus();$('history-editor').scrollTop=37;row.category='bind';row.reason='Session confirmed';w.view.updateStatus([row]);assert.equal($('history-detail').querySelector('[data-review-key="mapping:attendance"]'),mapping);assert.equal(mapping.open,true);assert.equal(input.value,'draft');assert.equal(w.document.activeElement,input);assert.equal($('history-editor').scrollTop,37);assert.match($('history-detail').querySelector('[data-history-reason]').textContent,/Session confirmed/);dom.window.close()
})

test('narrow view keeps list and editor states and returns focus to the selected row',()=>{
 const {w,dom,item,$}=fixture();w.view.render([item('301')]);const row=w.document.querySelector('#history-items button');row.click();assert.equal($('history-workbench').dataset.mobileView,'editor');assert.equal(w.currentWork.historyUI.selected,'301');$('history-back').click();assert.equal($('history-workbench').dataset.mobileView,'list');assert.equal(w.document.activeElement,row);dom.window.close()
})

test('history reports group by reliable student or exact temporary name, then enrollment and course',()=>{
 const {w,dom,item,$}=fixture(),a=item('301',{target:{name:'同名學生'},record:{enrollment_source_id:'301',date:'2026-10-04',student_source_id:'student-a',sourceStudentName:'同名學生',sourceCourseLabel:'Python'}}),b=item('302',{target:{name:'同名學生'},record:{enrollment_source_id:'302',date:'2026-10-05',student_source_id:'student-b',sourceStudentName:'同名學生',sourceCourseLabel:'Scratch'}}),c=item('303',{target:{name:'暫時同組'},record:{enrollment_source_id:'303',date:'2026-10-06',sourceStudentName:'暫時同組',sourceCourseLabel:'Python'}}),d=item('304',{target:{name:'暫時同組'},record:{enrollment_source_id:'304',date:'2026-10-07',sourceStudentName:' 暫時同組 ',sourceCourseLabel:'Scratch'}})
 w.view.render([a,b,c,d]);assert.equal(w.document.querySelectorAll('#history-items .history-student-group').length,3);assert.equal(w.document.querySelectorAll('#history-items .history-student-group[data-student-group="student:student-a"] button').length,1);assert.equal(w.document.querySelectorAll('#history-items .history-student-group[data-student-group="student:student-b"] button').length,1);assert.equal(w.document.querySelectorAll('#history-items .history-student-group[data-student-group="name:暫時同組"] button').length,2);assert.match($('history-items').textContent,/依姓名暫時分組/);dom.window.close()
})
