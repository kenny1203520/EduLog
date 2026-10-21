import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from '../../../app/node_modules/jsdom/lib/api.js'
test('all review queue statuses translate through the real language table',async()=>{
  const dom=new JSDOM('<body><p id="status"></p></body>',{runScripts:'outside-only'}),w=dom.window
  w.eval(readFileSync(new URL('../../shared/ui-core.js',import.meta.url),'utf8'));await new Promise(resolve=>setTimeout(resolve,0))
  const keys=['work.staleQueueItemSaving','work.staleQueueItemSaved','work.staleQueueItemPending','work.staleQueueProgress','work.staleQueueComplete','work.reviewSaveChanged','work.reviewSaveWait','work.interfaceFailed','work.interfaceRetry','work.retryRecovery','work.staleCauseUnknown','work.staleReasonFingerprint','work.staleReasonTargetChanged','work.staleReasonOccurrenceChanged','work.staleReasonPreviewMissing','work.serverPathUpgradeTitle','error.reportPagePathServerUpgrade']
  for(const locale of ['zh-TW','en']){w.edulogUi.setLocale(locale);for(const key of keys){w.edulogUi.text(w.document.getElementById('status'),key,{count:2,reports:1,fields:2,matched:1});assert.notEqual(w.document.getElementById('status').textContent,key)}}
  assert.match(w.edulogUi.t('work.staleQueueItemSaving'),/Saving/);w.edulogUi.setLocale('zh-TW');assert.match(w.edulogUi.t('work.staleQueueItemSaving'),/正在保存/);dom.window.close()
})
test('keyed shared language updates controls in place, preserves source text and input state',async()=>{
  const dom=new JSDOM('<body><button id="apply"></button><input value="保留草稿"><p data-source-raw>出席</p></body>',{runScripts:'outside-only'})
  const w=dom.window,listeners=[],sent=[]
  w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'zh-TW'})},onChanged:{addListener:fn=>listeners.push(fn)}}}
  w.edulogRuntime={send:async msg=>{sent.push(msg);return {language:msg.language}}}
  for(const file of ['shared/ui-core.js','shared/ui-messages.js'])w.eval(readFileSync(new URL('../../'+file,import.meta.url),'utf8'))
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
  w.eval(readFileSync(new URL('../../shared/ui-core.js',import.meta.url),'utf8'))
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
test('import stepper has three translated steps',async()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window
  w.eval(readFileSync(new URL('../../shared/ui-core.js',import.meta.url),'utf8'));await new Promise(resolve=>setTimeout(resolve,0))
  w.edulogUi.setLocale('zh-TW');assert.deepEqual(['work.import1','work.import2','work.import3'].map(key=>w.edulogUi.t(key)),['讀取','確認','完成']);assert.equal(w.edulogUi.t('work.import4'),'work.import4')
  w.edulogUi.setLocale('en');assert.deepEqual(['work.import1','work.import2','work.import3'].map(key=>w.edulogUi.t(key)),['Read','Confirm','Done']);assert.equal(w.edulogUi.t('work.applyBatches'),'Confirm and sync');dom.window.close()
})
test('auto language follows the teaching site; a fixed choice does not',async()=>{
  const dom=new JSDOM('<body><p id="label"></p></body>',{runScripts:'outside-only'}),w=dom.window,listeners=[]
  w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'auto',edulogSourceLocale:'zh-TW'})},onChanged:{addListener:fn=>listeners.push(fn)}}}
  for(const file of ['shared/ui-core.js','shared/ui-phrases.js'])w.eval(readFileSync(new URL('../../'+file,import.meta.url),'utf8'))
  await new Promise(r=>setTimeout(r,0))
  const label=w.document.getElementById('label');w.edulogUi.text(label,'ui.language')
  assert.equal(w.edulogUi.preference,'auto');assert.equal(w.edulogUi.locale,'zh-TW');assert.equal(label.textContent,'介面語言')
  w.edulogUi.setSourceLocale('zh-CN');assert.equal(w.edulogUi.locale,'zh-CN');assert.equal(label.textContent,'界面语言')
  w.edulogUi.setSourceLocale('en');assert.equal(label.textContent,'Language')
  w.edulogUi.setLocale('zh-TW');w.edulogUi.setSourceLocale('zh-CN');assert.equal(w.edulogUi.locale,'zh-TW');assert.equal(label.textContent,'介面語言')
  dom.window.close()
})
test('inline phrases translate wording but never the data passed in',async()=>{
  const dom=new JSDOM('<body></body>',{runScripts:'outside-only'}),w=dom.window
  for(const file of ['shared/ui-core.js','shared/ui-phrases.js'])w.eval(readFileSync(new URL('../../'+file,import.meta.url),'utf8'))
  await new Promise(r=>setTimeout(r,0))
  const ui=w.edulogUi,params={name:'林國華'}
  ui.setLocale('zh-TW');assert.equal(ui.tx('顯示 {name} 的聯絡電話',params),'顯示 林國華 的聯絡電話')
  ui.setLocale('zh-CN');assert.equal(ui.tx('顯示 {name} 的聯絡電話',params),'显示 林國華 的联络电话')
  ui.setLocale('en');assert.equal(ui.tx('顯示 {name} 的聯絡電話',params),"Show 林國華's phone")
  // Wording without a phrase falls back to the zh-TW source instead of a blank.
  assert.equal(ui.tx('沒有英文的句子'),'沒有英文的句子')
  dom.window.close()
})
