import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
import { retryHistoryWork } from '../workspace-model.js'
import { createHistoryWorkbench as createHistoryWorkbenchModule } from '../history-workbench.js'
const source='"use strict";\n'+readFileSync(new URL('../review-ui.js',import.meta.url),'utf8').replaceAll('export function','function')+'\n'+readFileSync(new URL('../history-merge.js',import.meta.url),'utf8').replaceAll('export function','function')+'\n'+readFileSync(new URL('../history-workbench.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace('export function','function')
function fixture() {
 const dom=new JSDOM('<section id="history-workbench"><p id="history-action-count"></p><button id="history-next-issue"></button><button id="history-next-report"></button><input id="history-search"><select id="history-filter"><option value="needs">待處理</option><option value="all">全部</option></select><div id="history-batch-review"></div><div id="history-items"></div><div id="history-editor"><button id="history-back">返回</button><div id="history-detail"></div></div><p id="history-empty"></p><p id="history-sync-summary"></p></section>',{runScripts:'outside-only'})
 const w=dom.window;w.scrollTo=()=>{};w.currentWork={id:'work',snapshot:{records:[]},staleReviewRows:[]};w.currentPlan=[];w.hookCounts={changed:0,uiChanged:0,recheck:0,backSummary:0,staleConfirm:0,staleFields:[],saveResult:true};w.eval(source+';window.view=createHistoryWorkbench({work:()=>currentWork,record:item=>currentWork.snapshot.records.find(r=>r.enrollment_source_id===item.record.enrollment_source_id)||item.record,item:key=>currentPlan.find(i=>i.key===key),changed:()=>{hookCounts.changed++;window.view?.updateStatus();return hookCounts.saveResult},staleFields:item=>item.record.staleReviewFields||[],hasStaleReview:item=>currentWork.staleReviewRows.some(row=>row.source_id===item.key),staleDecision:()=>"source",confirmStaleReview:async(item,fields)=>{hookCounts.staleConfirm++;hookCounts.staleFields=fields;return true},backToSummary:()=>hookCounts.backSummary++,uiChanged:()=>hookCounts.uiChanged++,recheck:()=>hookCounts.recheck++,labels:{},fields:(host)=>{const detail=host.ownerDocument.createElement("details");detail.dataset.reviewKey="mapping:attendance";detail.innerHTML="<summary>Mapping</summary><input value=kept>";host.append(detail)}})')
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

test('list editor conflict acknowledgement updates local state without a full recheck',async()=>{
 const {w,dom,item,$}=fixture(),row=item('301',{record:{enrollment_source_id:'301',date:'2026-10-04',sourceFieldConflicts:[{key:'content',label:'評語',listValue:'清單內容',editValue:'報告頁內容'}]}});w.currentWork.historyUI={selected:'301'};w.view.render([row]);const acknowledgement=[...$('history-detail').querySelectorAll('.source-conflicts button')][0];assert.ok(acknowledgement);await acknowledgement.onclick()
 assert.equal(row.record.sourceConflictAcknowledged,true);assert.equal(w.hookCounts.changed,1);assert.equal(w.hookCounts.recheck,0);assert.match($('history-detail').textContent,/已確認/);dom.window.close()
})

test('conflict confirmation updates the current cloned draft, saves locally, and sends no recheck',async()=>{
 const {w,dom,item,$}=fixture(),row=item('301',{record:{kind:'report',enrollment_source_id:'301',date:'2026-10-04'},data:{content:'來源評語'},occurrence:{id:'occ-1',report:{content:'EduLog 評語',version:7}},conflicts:['content'],conflictSignature:'signed-current-values'});w.currentWork.historyUI={selected:'301'};w.currentWork.snapshot.records=[row.record];w.currentPlan=[row];w.view.render([row]);const control=$('history-detail').querySelector('[data-issue-target="conflict-confirm"]');assert.ok(control);const stored=structuredClone(w.currentWork.snapshot);w.currentWork.snapshot=stored;w.currentPlan=[{...row,record:stored.records[0]}];await control.onclick();assert.equal(stored.records[0].historyConflictConfirmed,true);assert.equal(stored.records[0].historyConflictSignature,'signed-current-values');assert.equal(w.hookCounts.changed,1);assert.equal(w.hookCounts.recheck,0);assert.match(control.textContent,/已保存核對決定/);assert.match(control.nextElementSibling.textContent,/請更新差異/);dom.window.close()
})
test('stale summary navigation reveals the report, offers every decision, and restores the prior filters',()=>{
 const {w,dom,item,$}=fixture(),report=item('301',{staleReviewFields:['content'],record:{kind:'report',enrollment_source_id:'301',date:'2026-10-04',sourceStudentName:'林老師學生',sourceCourseLabel:'Scratch 課程',staleReviewFields:['content']},category:'needs',reason:'預覽失效後需重新確認',data:{content:'來源文字'},sourceData:{content:'來源文字'},comparisonReport:{content:'EduLog 文字'},occurrence:{id:'session',report:{content:'EduLog 文字'}},conflicts:['content'],issues:[{id:'conflict:content',target:'conflict:content',fieldKey:'content',message:'預覽失效後重新確認'}]});w.currentWork.historyUI={filter:'needs',search:'原搜尋',reason:'conflict',listScroll:0,selected:''};w.currentPlan=[report];w.view.render([report]);assert.equal(w.view.focusReport('301','content'),true);assert.equal($('history-filter').value,'all');assert.equal($('history-search').value,'');assert.equal(w.view.selectedKey(),'301');const choice=$('history-detail').querySelector('[data-issue-target="conflict:content"]');assert.ok(choice);assert.equal(choice.value,'');assert.deepEqual([...choice.options].map(option=>option.value),['','keep','source','mixed','skip']);assert.match($('history-detail').textContent,/預覽失效前的選擇/);assert.ok([...$('history-detail').querySelectorAll('button')].some(button=>button.textContent==='下一份待確認'));assert.equal(w.view.restoreListState(),true);assert.equal($('history-filter').value,'needs');assert.equal($('history-search').value,'原搜尋');assert.equal(w.view.selectedKey(),'');dom.window.close()
})
test('a resolved stale report keeps the return-to-summary action until its preview is refreshed',()=>{
 const {w,dom,item,$}=fixture(),row=item('301',{record:{enrollment_source_id:'301',date:'2026-10-04',staleReviewFields:[]}});w.currentWork.staleReviewRows=[{source_id:'301',batchKey:'batch-1'}];w.currentWork.historyUI={selected:'301'};w.currentPlan=[row];w.view.render([row]);$('history-items').querySelector('button').click();assert.ok([...$('history-detail').querySelectorAll('button')].some(button=>button.textContent.includes('返回同步摘要')));const back=[...$('history-detail').querySelectorAll('button')].find(button=>button.textContent.includes('返回同步摘要'));back.click();assert.equal(w.hookCounts.backSummary,1);dom.window.close()
})

test('single-report confirmation stays local in a 600-report work',async()=>{
 const {w,dom,item,$}=fixture(),rows=Array.from({length:600},(_,index)=>item(String(index+1),{record:{kind:'report',enrollment_source_id:String(index+1),date:'2026-10-04'}})),selected=rows[299];selected.data={content:'來源內容'};selected.occurrence={id:'occ-300',report:{content:'EduLog內容',version:2}};selected.conflicts=['content'];selected.conflictSignature='large-work-signature';w.currentWork.historyUI={selected:selected.key};w.currentWork.snapshot.records=rows.map(row=>row.record);w.currentPlan=rows;w.view.render(rows);const control=$('history-detail').querySelector('[data-issue-target="conflict-confirm"]');assert.ok(control);const stored=structuredClone(w.currentWork.snapshot);w.currentWork.snapshot=stored;w.currentPlan=rows.map(row=>({...row,record:stored.records.find(record=>record.enrollment_source_id===row.record.enrollment_source_id)}));await control.onclick();assert.equal(stored.records[299].historyConflictConfirmed,true);assert.equal(w.hookCounts.changed,1);assert.equal(w.hookCounts.recheck,0);dom.window.close()
})

test('failed draft save keeps the conflict choice and reports a retryable state',async()=>{
 const {w,dom,item,$}=fixture(),row=item('301',{record:{kind:'report',enrollment_source_id:'301',date:'2026-10-04'},data:{content:'來源'},occurrence:{id:'occ-1',report:{content:'目標',version:2}},conflicts:['content'],conflictSignature:'current'});w.currentWork.historyUI={selected:'301'};w.currentWork.snapshot.records=[row.record];w.currentPlan=[row];w.view.render([row]);w.hookCounts.saveResult=false;const control=$('history-detail').querySelector('[data-issue-target="conflict-confirm"]');await control.onclick();assert.equal(w.currentWork.snapshot.records[0].historyConflictConfirmed,true);assert.match(control.nextElementSibling.textContent,/保存失敗/);assert.equal(control.disabled,false);assert.equal(w.hookCounts.recheck,0);dom.window.close()
})

test('local mapping updates retain loaded editor controls, expansion, draft, focus, and scroll',()=>{
 const {w,dom,item,$}=fixture(),row=item('301');w.currentWork.historyUI={selected:'301'};w.view.render([row]);const mapping=$('history-detail').querySelector('[data-review-key="mapping:attendance"]'),input=mapping.querySelector('input');mapping.open=true;input.value='draft';input.focus();$('history-editor').scrollTop=37;row.category='bind';row.reason='Session confirmed';w.view.updateStatus([row]);assert.equal($('history-detail').querySelector('[data-review-key="mapping:attendance"]'),mapping);assert.equal(mapping.open,true);assert.equal(input.value,'draft');assert.equal(w.document.activeElement,input);assert.equal($('history-editor').scrollTop,37);assert.match($('history-detail').querySelector('[data-history-reason]').textContent,/Session confirmed/);dom.window.close()
})

test('progress separates report counts from issue counts and navigation waits for an explicit action',()=>{
 const {w,dom,item,$}=fixture(),a=item('301',{issues:[{id:'date',message:'Date needed',target:'date'},{id:'mapping:lesson',message:'Lesson needed',target:'source'}]}),b=item('302',{issues:[{id:'identity',message:'Confirm identity',target:'source'}]}),ready=item('303',{category:'bind',issues:[]})
 w.view.render([a,b,ready]);assert.match($('history-action-count').textContent,/待處理報告 2 份 · 問題 3 項 · 可同步 1 份/);assert.equal(w.currentWork.historyUI.selected,'');$('history-next-report').click();assert.equal(w.currentWork.historyUI.selected,'301');$('history-next-issue').click();assert.equal($('history-detail').querySelector('[data-issue-id="date"]')!==null,true);$('history-next-issue').click();assert.equal($('history-detail').querySelector('[data-issue-id="mapping:lesson"]')!==null,true);dom.window.close()
})

test('narrow view keeps list and editor states and returns focus to the selected row',()=>{
 const {w,dom,item,$}=fixture();w.view.render([item('301')]);const row=w.document.querySelector('#history-items button');row.click();assert.equal($('history-workbench').dataset.mobileView,'editor');assert.equal(w.currentWork.historyUI.selected,'301');$('history-back').click();assert.equal($('history-workbench').dataset.mobileView,'list');assert.equal(w.document.activeElement,row);dom.window.close()
})

test('history reports group by reliable student or exact temporary name, then enrollment and course',()=>{
 const {w,dom,item,$}=fixture(),a=item('301',{target:{name:'同名學生'},record:{enrollment_source_id:'301',date:'2026-10-04',student_source_id:'student-a',sourceStudentName:'同名學生',sourceCourseLabel:'Python'}}),b=item('302',{target:{name:'同名學生'},record:{enrollment_source_id:'302',date:'2026-10-05',student_source_id:'student-b',sourceStudentName:'同名學生',sourceCourseLabel:'Scratch'}}),c=item('303',{target:{name:'暫時同組'},record:{enrollment_source_id:'303',date:'2026-10-06',sourceStudentName:'暫時同組',sourceCourseLabel:'Python'}}),d=item('304',{target:{name:'暫時同組'},record:{enrollment_source_id:'304',date:'2026-10-07',sourceStudentName:' 暫時同組 ',sourceCourseLabel:'Scratch'}})
 w.view.render([a,b,c,d]);assert.equal(w.document.querySelectorAll('#history-items .history-student-group').length,3);assert.equal(w.document.querySelectorAll('#history-items .history-student-group[data-student-group="student:student-a"] button').length,1);assert.equal(w.document.querySelectorAll('#history-items .history-student-group[data-student-group="student:student-b"] button').length,1);assert.equal(w.document.querySelectorAll('#history-items .history-student-group[data-student-group="name:暫時同組"] button').length,2);assert.match($('history-items').textContent,/依姓名暫時分組/);dom.window.close()
})

test('automatic exclusions are summarized separately and can be inspected without per-row sync controls',()=>{
 const {w,dom,item,$}=fixture(),items=[
  item('301',{category:'unfilled',reason:'原站尚未填寫'}),
  item('302',{category:'other-admission',reason:'前一報名無法確認'}),
  item('303',{category:'system-excluded',reason:'日期不在範圍'})
 ]
 w.view.render(items)
 const details=$('history-auto-exclusions');assert.ok(details);assert.equal(details.querySelectorAll('.history-exclusion-filter').length,3);assert.match($('history-auto-exclusions-summary').textContent,/3/)
 const filter=[...details.querySelectorAll('.history-exclusion-filter')].find(button=>button.textContent.includes('尚未填寫'));filter.click();assert.equal($('history-filter').value,'unfilled');assert.equal($('history-items').querySelector('[data-key="301"]').hidden,false)
 $('history-items').querySelector('[data-key="301"]').click();assert.match($('history-detail').textContent,/原站尚未填寫/);assert.equal($('history-detail').querySelector('.mapping-actions'),null)
 assert.match($('history-action-count').textContent,/待處理報告 0 份/);dom.window.close()
})

test('batch field decisions explicitly enable a per-report source override or exclude only that field',()=>{
 const {w,dom,item,$}=fixture(),a=item('301',{record:{enrollment_source_id:'301',date:'2026-10-04',syncFieldOverrides:{attendance_status:false}},data:{attendance_status:'present'},occurrence:{report:{attendance_status:'absent'}},conflicts:['attendance_status']}),b=item('302',{record:{enrollment_source_id:'302',date:'2026-10-05'},data:{attendance_status:'present'},occurrence:{report:{attendance_status:'absent'}},conflicts:['attendance_status']})
 w.view.render([a,b]);const decision=$('history-batch-review').querySelector('select');decision.value='source';decision.dispatchEvent(new w.Event('change'));$('history-batch-review').querySelector('button').click();assert.equal(a.record.syncFieldOverrides.attendance_status,true);assert.equal(b.record.syncFieldOverrides.attendance_status,true);assert.deepEqual(Array.from(a.record.historyOverwrite),['attendance_status'])
 w.view.render([a,b]);const skip=$('history-batch-review').querySelector('select');skip.value='skip';skip.dispatchEvent(new w.Event('change'));$('history-batch-review').querySelector('button').click();assert.equal(a.record.syncFieldOverrides.attendance_status,false);assert.equal(b.record.syncFieldOverrides.attendance_status,false);assert.deepEqual(Array.from(a.record.historyOverwrite),[]);dom.window.close()
})

test('mixed text keeps target edits by default, lets the teacher select source additions, and preserves manual text',()=>{
 const {w,dom,item,$}=fixture(),row=item('301',{record:{kind:'report',enrollment_source_id:'301',date:'2026-10-04'},data:{content:'共同內容\n來源新增'},occurrence:{id:'occ-1',report:{content:'共同內容\nEduLog 保留',version:4}},conflicts:['content']});w.currentWork.historyUI={selected:'301'};w.currentWork.snapshot.records=[row.record];w.currentPlan=[row];w.view.render([row]);const mode=$('history-detail').querySelector('[data-issue-target="conflict:content"]');mode.value='mixed';mode.dispatchEvent(new w.Event('change',{bubbles:true}));const target=[...$('history-detail').querySelectorAll('[data-merge-line]')].find(box=>box.closest('label')?.textContent.includes('EduLog 原有')),source=[...$('history-detail').querySelectorAll('[data-merge-line]')].find(box=>box.closest('label')?.textContent.includes('來源新增')),textarea=$('history-detail').querySelector('[data-merge-text="content"]');assert.equal(target.checked,true);assert.equal(source.checked,false);source.checked=true;source.dispatchEvent(new w.Event('change',{bubbles:true}));assert.match(textarea.value,/來源新增/);textarea.value='老師調整後內容';textarea.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(row.record.historyMerge.content.text,'老師調整後內容');assert.equal(row.record.historyMerge.content.edited,true);dom.window.close()
})

test('empty mixed text requires an explicit clear confirmation and saves its signature',()=>{
 const {w,dom,item,$}=fixture(),row=item('301',{record:{kind:'report',enrollment_source_id:'301',date:'2026-10-04'},data:{content:'來源'},occurrence:{id:'occ-1',report:{content:'EduLog 保留',version:4}},conflicts:['content']});w.currentWork.historyUI={selected:'301'};w.currentWork.snapshot.records=[row.record];w.currentPlan=[row];w.view.render([row]);const mode=$('history-detail').querySelector('[data-issue-target="conflict:content"]');mode.value='mixed';mode.dispatchEvent(new w.Event('change',{bubbles:true}));const editor=$('history-detail').querySelector('[data-merge-text="content"]');editor.value='';editor.dispatchEvent(new w.Event('input',{bubbles:true}));const confirmation=$('history-detail').querySelector('[data-merge-clear-confirm="content"]');assert.ok(confirmation);assert.equal(confirmation.closest('label').hidden,false);assert.equal(row.record.historyMergeClearConfirmed?.content,undefined);confirmation.checked=true;confirmation.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(row.record.historyMergeClearConfirmed.content,JSON.stringify([row.record.historyMerge.content.signature,'']));assert.equal(w.hookCounts.changed,3);dom.window.close()
})

test('async history updates refresh the active editor controls without switching reports',()=>{
 const {w,dom,item,$}=fixture(),row=item('301',{record:{kind:'report',enrollment_source_id:'301',date:'2026-10-04'},data:{content:'來源'},occurrence:{id:'occ-1',report:{content:'目標',version:1}},conflicts:['content']});w.currentWork.historyUI={selected:'301'};w.currentWork.snapshot.records=[row.record];w.currentPlan=[row];w.view.render([row]);row.candidates=[{id:'occ-2',class_name:'週日班',occurrence_date:'2026-10-04'},{id:'occ-3',class_name:'週三班',occurrence_date:'2026-10-04'}];row.occurrence.report.version=2;w.currentPlan=[row];w.view.updateStatus([row]);assert.equal($('history-detail').querySelector('[data-issue-target="occurrence"]')?.options.length,3);assert.equal(w.view.selectedKey(),'301');dom.window.close()
})

test('the original strict ES module opens and refreshes a selected report without an undeclared signature',()=>{
 const {w,dom,item,$}=fixture(),previous={document:globalThis.document,window:globalThis.window,Option:globalThis.Option},row=item('strict-301',{record:{kind:'report',enrollment_source_id:'strict-301',date:'2026-10-04'},data:{content:'source'},occurrence:{id:'occ-1',report:{content:'target',version:1}},conflicts:['content']})
 globalThis.document=w.document;globalThis.window=w;globalThis.Option=w.Option
 try{
  const view=createHistoryWorkbenchModule({work:()=>w.currentWork,record:candidate=>w.currentWork.snapshot.records.find(record=>record.enrollment_source_id===candidate.record.enrollment_source_id)||candidate.record,item:key=>w.currentPlan.find(candidate=>candidate.key===key),changed:async()=>true,uiChanged(){},recheck(){},labels:{},fieldLabel:key=>key})
  w.currentWork.snapshot.records=[row.record];w.currentPlan=[row];view.render([row]);w.document.querySelector('#history-items button').click()
  row.data.content='updated source';view.updateStatus([row])
  assert.match($('history-detail').textContent,/updated source/)
 }finally{if(previous.document===undefined)delete globalThis.document;else globalThis.document=previous.document;if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;if(previous.Option===undefined)delete globalThis.Option;else globalThis.Option=previous.Option;dom.window.close()}
})
