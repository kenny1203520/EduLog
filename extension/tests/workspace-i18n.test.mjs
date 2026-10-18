import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

test('workspace locale translates existing and dynamic text, preserves new source text, and restores Chinese', async()=>{
  const source=readFileSync(new URL('../workspace/workspace-i18n.js',import.meta.url),'utf8').replace('export function initWorkspaceI18n','function initWorkspaceI18n')
  const dom=new JSDOM('<html lang="zh-Hant"><body><label for="workspace-locale">介面語言</label><select id="workspace-locale"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><h1>教學資料匯入</h1><input id="search" placeholder="姓名、課程或報名 ID…"><select data-source-raw-options="true"><option>選擇目標課程</option><option>出席</option></select><p id="status"></p><p class="source-evidence" id="raw">出席</p></body></html>',{runScripts:'outside-only'})
  const w=dom.window,listeners=[];w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'en'}),set:async()=>{}},onChanged:{addListener:fn=>listeners.push(fn)}}};w.eval(source+';initWorkspaceI18n()')
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(w.document.querySelector('h1').textContent,'Import data');assert.equal(w.document.querySelector('label').textContent,'Language');assert.equal(w.document.getElementById('search').placeholder,'Name, course, or enrollment ID…');assert.equal(w.document.querySelector('[data-source-raw-options] option:nth-child(2)').textContent,'出席')
  w.document.getElementById('status').textContent='操作未完成';await new Promise(resolve=>setTimeout(resolve,0));assert.equal(w.document.getElementById('status').textContent,'Action incomplete')
  w.document.getElementById('raw').textContent='出席';await new Promise(resolve=>setTimeout(resolve,0));assert.equal(w.document.getElementById('raw').textContent,'出席')
  listeners[0]({edulogWorkspaceLocale:{newValue:'zh-TW'}},'local');assert.equal(w.document.querySelector('h1').textContent,'教學資料匯入');assert.equal(w.document.getElementById('status').textContent,'操作未完成');dom.window.close()
})

test('workspace locale falls back to browser language when extension storage is unavailable', async()=>{
  const source=readFileSync(new URL('../workspace/workspace-i18n.js',import.meta.url),'utf8').replace('export function initWorkspaceI18n','function initWorkspaceI18n')
  const dom=new JSDOM('<html lang="zh-Hant"><body><select id="workspace-locale"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><h1>教學資料匯入</h1></body></html>',{runScripts:'outside-only'})
  dom.window.eval(source+';initWorkspaceI18n()')
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(dom.window.document.getElementById('workspace-locale').value,'en')
  assert.equal(dom.window.document.querySelector('h1').textContent,'Import data')
  dom.window.close()
})

test('dynamic review progress and issue guidance are translated in place',async()=>{
  const source=readFileSync(new URL('../workspace/workspace-i18n.js',import.meta.url),'utf8').replace('export function initWorkspaceI18n','function initWorkspaceI18n')
  const dom=new JSDOM('<html lang="zh-Hant"><body><select id="workspace-locale"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><p id="count"></p><p id="issue"></p><p id="saved"></p></body></html>',{runScripts:'outside-only'})
  const w=dom.window;w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'zh-TW'}),set:async()=>{}},onChanged:{addListener:()=>{}}}};w.eval(source+';initWorkspaceI18n()');await new Promise(resolve=>setTimeout(resolve,0))
  w.document.getElementById('count').textContent='待處理報告 2 份 · 問題 3 項 · 可同步 4 份';w.document.getElementById('issue').textContent='待處理問題 · 2 項';w.document.getElementById('saved').textContent='已記住：「出席」→「present」；套用範圍：Python。';await new Promise(resolve=>setTimeout(resolve,0))
  w.document.getElementById('workspace-locale').value='en';w.document.getElementById('workspace-locale').dispatchEvent(new w.Event('change'));await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(w.document.getElementById('count').textContent,'2 reports need attention · 3 issues · 4 ready to sync');assert.equal(w.document.getElementById('issue').textContent,'2 issues to resolve');assert.equal(w.document.getElementById('saved').textContent,'Saved mapping: "出席" → "present" · Scope: Python.')
  dom.window.close()
})

test('stale import recovery messages translate their reason and restore the source-language text',async()=>{
  const source=readFileSync(new URL('../workspace/workspace-i18n.js',import.meta.url),'utf8').replace('export function initWorkspaceI18n','function initWorkspaceI18n')
  const dom=new JSDOM('<html lang="zh-Hant"><body><select id="workspace-locale"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><p id="title"></p><p id="detail"></p></body></html>',{runScripts:'outside-only'})
  const w=dom.window;w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'zh-TW'}),set:async()=>{}},onChanged:{addListener:()=>{}}}};w.eval(source+';initWorkspaceI18n()');await new Promise(resolve=>setTimeout(resolve,0))
  const title=w.document.getElementById('title'),detail=w.document.getElementById('detail')
  title.textContent='同步受阻，預覽已失效';detail.textContent='目前批次尚未提交；已知成功批次保留。原因：EduLog 目標資料已更新。工作資料列數不等於報告數。';await new Promise(resolve=>setTimeout(resolve,0))
  w.document.getElementById('workspace-locale').value='en';w.document.getElementById('workspace-locale').dispatchEvent(new w.Event('change'));await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(title.textContent,'Sync blocked; preview is stale');assert.equal(detail.textContent,'The current batch was not submitted; confirmed successful batches remain saved. Reason: EduLog target data changed. Work rows are not report counts.')
  w.document.getElementById('workspace-locale').value='zh-TW';w.document.getElementById('workspace-locale').dispatchEvent(new w.Event('change'));await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(title.textContent,'同步受阻，預覽已失效');assert.match(detail.textContent,/目標資料已更新/);dom.window.close()
})
test('saved history result counts translate in both known and legacy states',async()=>{
  const source=readFileSync(new URL('../workspace/workspace-i18n.js',import.meta.url),'utf8').replace('export function initWorkspaceI18n','function initWorkspaceI18n')
  const dom=new JSDOM('<html lang="zh-Hant"><body><select id="workspace-locale"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><p id="status"></p></body></html>',{runScripts:'outside-only'}),w=dom.window
  w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'en'}),set:async()=>{}},onChanged:{addListener:()=>{}}}}
  w.eval(source+';initWorkspaceI18n()');await new Promise(resolve=>setTimeout(resolve,0))
  const status=w.document.getElementById('status')
  status.textContent='\u5df2\u78ba\u8a8d\u4fdd\u5b58\u6b77\u53f2 25 \u4efd\uff1b\u5176\u4e2d 18 \u4efd\u5df2\u7d81\u5b9a\u8ab2\u6b21\u3002';await new Promise(resolve=>setTimeout(resolve,0));assert.equal(status.textContent,'Confirmed saved history: 25 reports; 18 are linked to class sessions.')
  status.textContent='\u5df2\u78ba\u8a8d\u4fdd\u5b58\u6b77\u53f2 25 \u4efd\u4ee5\u4e0a\uff0c\u90e8\u5206\u820a\u5de5\u4f5c\u6210\u679c\u5f85\u4f3a\u670d\u5668\u6838\u5c0d\uff1b\u5176\u4e2d 18 \u4efd\u5df2\u7d81\u5b9a\u8ab2\u6b21\u3002';await new Promise(resolve=>setTimeout(resolve,0));assert.equal(status.textContent,'At least 25 history reports are confirmed; 18 are linked to class sessions. Some legacy results still need server verification.')
  dom.window.close()
})
