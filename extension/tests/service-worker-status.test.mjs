import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

function worker(extraCapabilities = {}) {
  const extensionId = 'a'.repeat(32), listeners = {}, changes = [], stored = { edulogExtension: { origin:'https://edulog.example', token:'secret-token', userId:'user-a', tokenExpiresAt:'2099-01-01T00:00:00.000Z' } }
  let fetchCount = 0
  const chrome = {
    runtime:{ id:extensionId, getURL:path=>`chrome-extension://${extensionId}/${path}`, onInstalled:{addListener(){}}, onMessage:{addListener(fn){listeners.runtime=fn}} },
    storage:{ onChanged:{addListener(fn){changes.push(fn)}}, local:{setAccessLevel:async()=>{},get:async()=>structuredClone(stored),set:async values=>{const old=structuredClone(stored.edulogExtension);Object.assign(stored,values);for(const fn of changes)fn({edulogExtension:{oldValue:old,newValue:structuredClone(stored.edulogExtension)}},'local')}} },
  }
  const source=readFileSync(new URL('../service-worker.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'')+'\n'
  const context=vm.createContext({chrome,URL,Date,AbortSignal,fetch:async()=>{fetchCount++;await new Promise(resolve=>setTimeout(resolve,5));return{ok:true,json:async()=>({data:{user_id:'user-a',settings_url:'https://edulog.example/dashboard/settings?tab=integrations',connection:{installation_id:'installation-a',device_name:'Test device'},capabilities:{teaching_data_import:true,report_prefill:true,catalog_v1:true,...extraCapabilities},integration_limits:{batch_bytes:180000}}})}},globalThis:null,installWorkspaceBroker(){},edulogSiteAdapter:{id:'orange-apple',matchesHost:()=>true,matchesTeachingPage:()=>true},edulogInstallation:{load:async()=>({})},setTimeout,clearTimeout})
  context.globalThis=context
  vm.runInContext(source,context)
  const send=(force=false)=>new Promise(resolve=>listeners.runtime({type:'get-edulog-integration-status',force},{id:extensionId,url:`chrome-extension://${extensionId}/popup.html`},resolve))
  return{send,getFetchCount:()=>fetchCount,stored}
}

test('connection verification coalesces concurrent checks and caches success briefly',async()=>{
  const w=worker(), [a,b]=await Promise.all([w.send(),w.send()])
  assert.equal(a.status,'connected');assert.equal(b.status,'connected');assert.equal(w.getFetchCount(),1)
  await w.send();assert.equal(w.getFetchCount(),1)
  await w.send(true);assert.equal(w.getFetchCount(),2)
  assert.equal(w.stored.edulogExtension.userId,'user-a')
})

test('verified server capabilities reach the workspace without enabling unsupported servers',async()=>{
  const upgraded=await worker({student_enrollment_catalog:true,enrollment_reconciliation:true}).send()
  assert.equal(upgraded.capabilities.student_enrollment_catalog,true)
  assert.equal(upgraded.capabilities.enrollment_reconciliation,true)
  const legacy=await worker().send()
  assert.equal(legacy.capabilities.student_enrollment_catalog,false)
  assert.equal(legacy.capabilities.enrollment_reconciliation,false)
  const malformed=await worker({student_enrollment_catalog:'true',enrollment_reconciliation:1}).send()
  assert.equal(malformed.capabilities.student_enrollment_catalog,false)
  assert.equal(malformed.capabilities.enrollment_reconciliation,false)
})
