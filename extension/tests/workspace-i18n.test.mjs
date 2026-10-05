import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

test('workspace locale translates existing and dynamic text, preserves new source text, and restores Chinese', async()=>{
  const source=readFileSync(new URL('../workspace-i18n.js',import.meta.url),'utf8').replace('export function initWorkspaceI18n','function initWorkspaceI18n')
  const dom=new JSDOM('<html lang="zh-Hant"><body><label for="workspace-locale">介面語言</label><select id="workspace-locale"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><h1>教學資料匯入</h1><input id="search" placeholder="姓名、課程或報名 ID…"><select data-source-raw-options="true"><option>選擇目標課程</option><option>出席</option></select><p id="status"></p><p class="source-evidence" id="raw">出席</p></body></html>',{runScripts:'outside-only'})
  const w=dom.window,listeners=[];w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'en'}),set:async()=>{}},onChanged:{addListener:fn=>listeners.push(fn)}}};w.eval(source+';initWorkspaceI18n()')
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(w.document.querySelector('h1').textContent,'Teaching data import');assert.equal(w.document.querySelector('label').textContent,'Interface language');assert.equal(w.document.getElementById('search').placeholder,'Name, course, or enrollment ID…');assert.equal(w.document.querySelector('[data-source-raw-options] option:nth-child(2)').textContent,'出席')
  w.document.getElementById('status').textContent='操作未完成';await new Promise(resolve=>setTimeout(resolve,0));assert.equal(w.document.getElementById('status').textContent,'Action incomplete')
  w.document.getElementById('raw').textContent='出席';await new Promise(resolve=>setTimeout(resolve,0));assert.equal(w.document.getElementById('raw').textContent,'出席')
  listeners[0]({edulogWorkspaceLocale:{newValue:'zh-TW'}},'local');assert.equal(w.document.querySelector('h1').textContent,'教學資料匯入');assert.equal(w.document.getElementById('status').textContent,'操作未完成');dom.window.close()
})

test('workspace locale falls back to browser language when extension storage is unavailable', async()=>{
  const source=readFileSync(new URL('../workspace-i18n.js',import.meta.url),'utf8').replace('export function initWorkspaceI18n','function initWorkspaceI18n')
  const dom=new JSDOM('<html lang="zh-Hant"><body><select id="workspace-locale"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><h1>教學資料匯入</h1></body></html>',{runScripts:'outside-only'})
  dom.window.eval(source+';initWorkspaceI18n()')
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(dom.window.document.getElementById('workspace-locale').value,'en')
  assert.equal(dom.window.document.querySelector('h1').textContent,'Teaching data import')
  dom.window.close()
})

test('dynamic review progress and issue guidance are translated in place',async()=>{
  const source=readFileSync(new URL('../workspace-i18n.js',import.meta.url),'utf8').replace('export function initWorkspaceI18n','function initWorkspaceI18n')
  const dom=new JSDOM('<html lang="zh-Hant"><body><select id="workspace-locale"><option value="zh-TW">繁體中文</option><option value="en">English</option></select><p id="count"></p><p id="issue"></p><p id="saved"></p></body></html>',{runScripts:'outside-only'})
  const w=dom.window;w.chrome={storage:{local:{get:async()=>({edulogWorkspaceLocale:'zh-TW'}),set:async()=>{}},onChanged:{addListener:()=>{}}}};w.eval(source+';initWorkspaceI18n()');await new Promise(resolve=>setTimeout(resolve,0))
  w.document.getElementById('count').textContent='待處理報告 2 份 · 問題 3 項 · 可同步 4 份';w.document.getElementById('issue').textContent='待處理問題 · 2 項';w.document.getElementById('saved').textContent='已記住：「出席」→「present」；套用範圍：Python。';await new Promise(resolve=>setTimeout(resolve,0))
  w.document.getElementById('workspace-locale').value='en';w.document.getElementById('workspace-locale').dispatchEvent(new w.Event('change'));await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(w.document.getElementById('count').textContent,'2 reports need attention · 3 issues · 4 ready to sync');assert.equal(w.document.getElementById('issue').textContent,'2 issues to resolve');assert.equal(w.document.getElementById('saved').textContent,'Saved mapping: "出席" → "present" · Scope: Python.')
  dom.window.close()
})
