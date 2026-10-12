import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from '../../app/node_modules/jsdom/lib/api.js'
test('all review queue statuses translate through the real language table',async()=>{
  const dom=new JSDOM('<body><p id="status"></p></body>',{runScripts:'outside-only'}),w=dom.window
  w.eval(readFileSync(new URL('../ui-core.js',import.meta.url),'utf8'));await new Promise(resolve=>setTimeout(resolve,0))
  const keys=['work.staleQueueItemSaving','work.staleQueueItemSaved','work.staleQueueItemPending','work.staleQueueProgress','work.staleQueueComplete','work.reviewSaveChanged','work.reviewSaveWait']
  for(const locale of ['zh-TW','en']){w.edulogUi.setLocale(locale);for(const key of keys){w.edulogUi.text(w.document.getElementById('status'),key,{count:2,reports:1,fields:2,matched:1});assert.notEqual(w.document.getElementById('status').textContent,key)}}
  assert.match(w.edulogUi.t('work.staleQueueItemSaving'),/Saving/);w.edulogUi.setLocale('zh-TW');assert.match(w.edulogUi.t('work.staleQueueItemSaving'),/正在保存/);dom.window.close()
})
test('keyed shared language updates controls in place, preserves source text and input state',async()=>{
  const dom=new JSDOM('<body><button id="apply"></button><input value="保留草稿"><p data-source-raw>出席</p></body>',{runScripts:'outside-only'})
  const w=dom.window,listeners=[],sent=[]
  w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'zh-TW'})},onChanged:{addListener:fn=>listeners.push(fn)}}}
  w.edulogRuntime={send:async msg=>{sent.push(msg);return {language:msg.language}}}
  for(const file of ['ui-core.js','ui-messages.js'])w.eval(readFileSync(new URL('../'+file,import.meta.url),'utf8'))
  await new Promise(r=>setTimeout(r,0))
  const button=w.document.getElementById('apply'),input=w.document.querySelector('input');input.focus();input.setSelectionRange(1,2)
  w.edulogUi.text(button,'assistant.apply',{count:3,overwrite:1});w.edulogUiLegacy.watch(w.document.body)
  await w.edulogUi.saveLocale('en')
  assert.equal(button.textContent,'Apply 3 fields · overwrite 1');assert.equal(w.document.activeElement,input);assert.equal(input.value,'保留草稿');assert.equal(input.selectionStart,1);assert.equal(w.document.querySelector('[data-source-raw]').textContent,'出席')
  assert.equal(sent[0].language,'en');assert.equal(sent[0].type,'set-ui-preferences')
  listeners[0]({edulogWorkspaceLocale:{newValue:'zh-TW'}},'local');assert.equal(button.textContent,'套用 3 個欄位 · 覆寫 1 個');dom.window.close()
})

test('history preview validation messages are localized with report details',async()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'})
  const w=dom.window
  w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'zh-TW'})},onChanged:{addListener:()=>{}}}}
  w.eval(readFileSync(new URL('../ui-core.js',import.meta.url),'utf8'))
  await new Promise(r=>setTimeout(r,0))
  const zhUnknown=w.edulogUi.t('work.historyUnknownCategory',{key:'報告 7',category:'unexpected'})
  const zhReference=w.edulogUi.t('work.historyInvalidReference',{sourceId:'報告 8'})
  assert.match(zhUnknown,/報告 7/);assert.match(zhUnknown,/unexpected/)
  assert.match(zhReference,/報告 8/)
  assert.match(w.edulogUi.t('work.previewFailed'),/差異核對失敗/)
  w.edulogUi.setLocale('en')
  assert.match(w.edulogUi.t('work.historyUnknownCategory',{key:'Report 7',category:'unexpected'}),/Report 7/)
  assert.match(w.edulogUi.t('work.historyInvalidReference',{sourceId:'Report 8'}),/Report 8/)
  assert.match(w.edulogUi.t('work.previewFailed'),/Difference check failed/)
  dom.window.close()
})
