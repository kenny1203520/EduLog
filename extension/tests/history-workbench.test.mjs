import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
import { retryHistoryWork } from '../workspace-model.js'
const source=readFileSync(new URL('../history-workbench.js',import.meta.url),'utf8').replace('export function','function')
function fixture() {
 const dom=new JSDOM('<section id="history-workbench"><input id="history-search"><select id="history-filter"><option value="needs">待處理</option><option value="all">全部</option></select><div id="history-items"></div><div id="history-editor"><button id="history-back">返回</button><div id="history-detail"></div></div><p id="history-empty"></p><p id="history-sync-summary"></p></section>',{runScripts:'outside-only'})
 const w=dom.window;w.scrollTo=()=>{};w.currentWork={id:'work'};w.eval(source+';window.view=createHistoryWorkbench({work:()=>currentWork,changed:()=>{},recheck:()=>{},labels:{},fields:()=>{}})')
 const item=(key,extra={})=>({key,record:{enrollment_source_id:key,date:'2026-10-04'},target:{id:'enrollment',name:'測試學生'},category:'needs',reason:'日期核對',...extra})
 return {w,dom,item,$:id=>w.document.getElementById(id)}
}
test('repeated mounting reuses one current control and pins the active completed item',()=>{
 const {w,dom,item,$}=fixture(),rows=[item('301'),item('302')];w.view.render(rows);const first=$('history-items').firstChild;first.click();first.focus();$('history-items').scrollTop=44
 w.view.render([item('301',{category:'history'}),item('302')]);w.view.render([item('301',{category:'history'}),item('302')])
 assert.equal($('history-items').children.length,2);assert.equal($('history-items').firstChild,first);assert.equal(first.hidden,false);assert.equal(w.document.activeElement,first);assert.equal($('history-items').scrollTop,44)
 $('history-search').value='no results';$('history-search').dispatchEvent(new w.Event('input'));assert.equal($('history-empty').hidden,false);dom.window.close()
})
test('restore validates item identity, retains per-work scroll and preserves draft focus on refresh',()=>{
 const {w,dom,item,$}=fixture();w.currentWork.historyUI={selected:'301',filter:'all',search:'',listScroll:55,editorScroll:66};w.view.render([item('301')]);assert.equal($('history-items').scrollTop,55);assert.equal($('history-editor').scrollTop,66)
 const control=[...$('history-detail').querySelectorAll('button')].find(b=>b.textContent==='重新核對此份紀錄');control.focus();w.view.refreshEditor();assert.equal(w.document.activeElement.textContent,'重新核對此份紀錄');assert.equal($('history-editor').scrollTop,66)
 w.view.render([]);assert.equal($('history-items').children.length,0);assert.match($('history-detail').textContent,/選擇需要處理/);dom.window.close()
})
test('repair uses a new job while preserving confirmed choices and original checkpoints',()=>{
 const previous={id:'original',jobId:'server-job',status:'partial_complete',done:1,revision:4,batches:[{key:'submitted'}],appliedBatchKeys:['submitted'],ids:{enrollment:'kept'},snapshot:{admissionPaths:['/dt_admissions/301'],records:[{historyOnly:true}]},history:{paths:['/dt_admissions/301'],next:1,checkpoints:{completed:true}},uiState:[{id:'enrollment-301',value:'confirmed'}]}
 const before=structuredClone(previous),next=retryHistoryWork(previous);assert.deepEqual(previous,before);assert.notEqual(next.id,previous.id);assert.equal(next.parentWorkId,previous.id);assert.equal(next.jobId,undefined);assert.equal(next.batches,undefined);assert.equal(next.done,0);assert.equal(next.history.next,0);assert.deepEqual(next.uiState,previous.uiState);assert.deepEqual(next.ids,previous.ids)
})
