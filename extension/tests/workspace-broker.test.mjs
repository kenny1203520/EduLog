import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import {webcrypto} from 'node:crypto'
function broker(fetchImpl, getStatus = async () => ({ status: 'connected' }), timers = {}, sourceHandler) {
  const id = 'a'.repeat(32), binding = { instance: 'http://localhost:3000', userId: 'user-A' }, settings = { origin: binding.instance, userId: binding.userId, token: 'trusted-secret' }
  const calls = [], tabs = [{ id: 1, url: 'https://corp.orangeapple.co/courses/dt/11', title: 'Class' }], rows = new Map(); let listener, changed
  const chrome = { runtime: { id, getURL: p => `chrome-extension://${id}/${p}`, onMessage: { addListener: fn => { listener = fn } } }, storage: { local: { get: async () => ({ edulogExtension: settings }) }, onChanged: { addListener: fn => { changed = fn } } }, tabs: { query: async () => tabs, get: async n => { if (!tabs.find(t => t.id === n)) throw new Error('closed'); return tabs.find(t => t.id === n) }, create: async t => calls.push(t), update: async () => {}, sendMessage: async (n, m) => { calls.push({ tab: n, ...m }); return { data: { classId: '11' } } } } }
  const workStore = { purge: async () => {}, list: async b => [...rows.values()].filter(r => r.instance === b.instance && r.userId === b.userId), get: async (n, b) => { const r = rows.get(n); return r?.instance === b.instance && r?.userId === b.userId ? r : null }, put: async (r, b) => { rows.set(r.id, { ...r, ...b }); return rows.get(r.id) } }
  if(sourceHandler)chrome.tabs.sendMessage=async(n,m)=>{calls.push({tab:n,...m});return sourceHandler(m)}
  const context = vm.createContext({ chrome, workStore, crypto:webcrypto, Intl, URL, AbortSignal, AbortController, TextEncoder, setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout, getStatus, fetch: fetchImpl || (async (url, options) => { calls.push({ url, ...options }); return { ok: true, headers: { get: () => null }, json: async () => ({ data: {} }) } }), edulogSiteAdapter: { matchesTeachingPage: p => /^\/courses\/dt\/\d+$/.test(p) } })
  vm.runInContext(readFileSync(new URL('../workspace-broker.js', import.meta.url), 'utf8').replace(/^import[^\n]*\n/gm, '').replace('export function', 'function') + '\ninstallWorkspaceBroker(getStatus)', context)
  const trusted = { id, url: `chrome-extension://${id}/workspace.html?flow=import` }, site = { id, url: tabs[0].url, tab: tabs[0] }
  return { send: (m, s = trusted) => new Promise(resolve => { const result = listener(m, s, resolve); if (!result) resolve(undefined) }), binding, calls, settings, tabs, rows, changed, site, trusted }
}
test('only the workspace can broker API/storage/source actions, and every action requires instance/user binding', async () => {
  const b = broker()
  assert.equal(await b.send({ type: 'workspace-api', operation: 'context', binding: b.binding }, b.site), undefined)
  assert.equal(await b.send({ type: 'workspace-init' }, { ...b.trusted, url: 'https://untrusted.example/' }), undefined)
  assert.match((await b.send({ type: 'workspace-api', operation: 'context' })).error.message, /缺少/)
  const result = await b.send({ type: 'workspace-init' }); assert.equal(result.data.binding.userId, 'user-A'); assert.equal(JSON.stringify(result).includes('trusted-secret'), false)
  assert.match((await b.send({ type: 'workspace-api', operation: 'context', binding: { ...b.binding, userId: 'another' } })).error.message, /已變更/)
})
test('fixed API routing keeps credentials in trusted worker; source messages carry no credential', async () => {
  const b = broker()
  await b.send({ type: 'workspace-api', operation: 'context', binding: b.binding })
  assert.equal(b.calls[0].url, 'http://localhost:3000/api/extension/v1/context')
  assert.equal(b.calls[0].headers.authorization, 'Bearer trusted-secret'); assert.equal(b.calls[0].credentials, 'omit')
  await b.send({ type: 'workspace-source', action: 'context', binding: b.binding, tabId: 1, sourcePath: '/courses/dt/11' })
  assert.equal(JSON.stringify(b.calls[1]).includes('trusted-secret'), false)
  assert.match((await b.send({ type: 'workspace-api', operation: '/api/users', binding: b.binding })).error.message, /不正確/)
  assert.match((await b.send({ type: 'workspace-source', action: 'context', binding: b.binding, tabId: 1, sourcePath: '/courses/dt/12' })).error.message, /已關閉或導覽/)
})
test('catalog and filtered report routes allow only bounded query fields', async () => {
  const b = broker()
  await b.send({ type:'workspace-api',operation:'catalog',binding:b.binding,query:{resource:'students',limit:50,search:'A',classroom_id:'room'} })
  assert.equal(b.calls[0].url,'http://localhost:3000/api/extension/v1/catalog?resource=students&limit=50&search=A&classroom_id=room')
  const forbidden = await b.send({ type:'workspace-api',operation:'catalog',binding:b.binding,query:{resource:'students',admin:true} })
  assert.match(forbidden.error.message,/查詢格式/)
})
test('validation fields and request IDs reach the workspace with bounded text-only diagnostics',async()=>{
  const b=broker(async()=>({ok:false,status:422,json:async()=>({error:{code:'VALIDATION_FAILED',message:'The request is invalid',request_id:'edulog-test',fields:{request:['Duplicate source IDs',null,{secret:'not text'}],invalid:'not an array',large:['x'.repeat(1000)]}}})}))
  const result=await b.send({type:'workspace-api',operation:'preview',jobId:'00000000-0000-4000-8000-000000000001',body:{rows:[]},binding:b.binding})
  assert.equal(result.error.code,'VALIDATION_FAILED');assert.equal(result.error.requestId,'edulog-test')
  assert.deepEqual(JSON.parse(JSON.stringify(result.error.fields)),{request:['Duplicate source IDs'],large:['x'.repeat(500)]})
})
test('reconciliation uses a fixed readonly route and rejects path injection or site senders',async()=>{
  const b=broker(),enrollmentId='00000000-0000-4000-8000-000000000001'
  await b.send({type:'workspace-api',operation:'reconcile',binding:b.binding,enrollmentId,query:{limit:50}})
  assert.equal(b.calls[0].url,`http://localhost:3000/api/extension/v1/enrollments/${enrollmentId}/reconciliation?limit=50`);assert.equal(b.calls[0].method,'GET')
  assert.match((await b.send({type:'workspace-api',operation:'reconcile',binding:b.binding,enrollmentId:'../../users'})).error.message,/識別碼/)
  assert.equal(await b.send({type:'workspace-api',operation:'reconcile',binding:b.binding,enrollmentId},b.site),undefined)
})
test('a user cancellation aborts only the matching read request', async () => {
  const b = broker((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once:true })))
  const requestId = '11111111-1111-4111-8111-111111111111'
  const pending = b.send({ type:'workspace-api',operation:'catalog',binding:b.binding,requestId,query:{resource:'students'} })
  await new Promise(resolve => setTimeout(resolve, 0))
  await b.send({ type:'workspace-cancel-read',binding:b.binding,requestId })
  const response = await pending
  assert.equal(response.error.code,'READ_CANCELLED')
})
test('the 30 second API deadline includes connection verification and never sends an API call after expiry', async () => {
  const timers = [], b = broker(undefined, () => new Promise(() => {}), { setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length }, clearTimeout: () => {} })
  const pending = b.send({ type:'workspace-api', operation:'catalog', binding:b.binding, query:{resource:'students'} })
  assert.equal(timers[0].delay, 30000)
  timers[0].callback()
  const response = await pending
  assert.equal(response.error.code, 'API_TIMEOUT')
  assert.equal(b.calls.length, 0)
})
test('history and prefill commands are restricted to a stored work and its original tab/form', async () => {
  const b = broker()
  const message = { type:'workspace-source',action:'history',binding:b.binding,tabId:1,sourcePath:'/courses/dt/11',workId:'job',historyPath:'/dt_admissions/301' }
  assert.match((await b.send(message)).error.message,/不屬於/)
  b.rows.set('job',{id:'job',...b.binding,sourceTab:1,sourcePath:'/courses/dt/11',snapshot:{admissionPaths:['/dt_admissions/301']}})
  assert.equal((await b.send(message)).data.classId,'11')
  assert.match((await b.send({...message,historyPath:'/dt_admissions/999'})).error.message,/不屬於/)
  const apply={...message,action:'apply',input:{formId:'form',fingerprint:'hash'}}
  assert.match((await b.send(apply)).error.message,/不屬於/)
  b.rows.set('job',{id:'job',...b.binding,type:'prefill',status:'applying',sourceTab:1,sourcePath:'/courses/dt/11',form:{formId:'form',fingerprint:'hash'}})
  assert.equal((await b.send(apply)).data.classId,'11')
  assert.match((await b.send({...apply,input:{...apply.input,formId:'another'}})).error.message,/不屬於/)
})
test('closing a source preserves collected work, navigation rejects further matching actions', async () => {
  const b=broker(); b.tabs.length=0
  assert.equal((await b.send({type:'workspace-check-source',binding:b.binding,tabId:1,sourcePath:'/courses/dt/11'})).data.closed,true)
  b.tabs.push({id:1,url:'https://corp.orangeapple.co/courses/dt/12'})
  assert.match((await b.send({type:'workspace-check-source',binding:b.binding,tabId:1,sourcePath:'/courses/dt/11'})).error.message,/已導覽/)
})
test('history editor reads require an owned checkpoint and preserve the stored source evidence',async()=>{
 const b=broker(),record={kind:'report',source_id:'401',enrollment_source_id:'301',evidenceKey:'301:1',dateRaw:'10/1'}
 b.rows.set('job',{id:'job',...b.binding,sourceTab:1,sourcePath:'/courses/dt/11',snapshot:{admissionPaths:['/dt_admissions/301'],records:[]},history:{checkpoints:{'/dt_admissions/301':{records:[record],next:0}}}})
 const message={type:'workspace-source',action:'history-report',binding:b.binding,tabId:1,sourcePath:'/courses/dt/11',workId:'job',historyPath:'/dt_admissions/301',input:{evidenceKey:'301:1',editUrl:'/dt_admissions/301/reports/401/edit',confirmedDate:'2026-10-01'}}
 assert.ok((await b.send(message)).data);assert.match((await b.send({...message,input:{...message.input,evidenceKey:'other'}})).error.message,/不屬於/)
 b.tabs.length=0;assert.equal((await b.send(message)).error.code,'SOURCE_CLOSED')
})
test('inline candidates use authoritative student/course across enrollments and preserve scoped pagination',async()=>{
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,queries=[]
  const form={formId:'f1',fingerprint:'hash',admissionId:'301',reportId:'401',date:'2024-06-15'}
  const b=broker(async url=>{const u=new URL(url);queries.push(u);const data=u.pathname.endsWith('/resolve')?{memories:[{valid:true,target_id:id(1),student_id:id(2),course_id:id(3)}]}:u.pathname.includes('/enrollments/')?{student_id:id(2),course_id:id(3)}:{reports:[],next_cursor:null};return{ok:true,json:async()=>({data})}},async()=>({status:'connected',capabilities:{nearest_report_candidates:true}}),{},async()=>({data:form}))
  const cursor=`n1|${'a'.repeat(32)}|2|0|2024-06-13|${id(4)}`
  const reply=await b.send({type:'integration-inline-prefill',operation:'candidates',formId:'f1',fingerprint:'hash',query:{group:'same-course',cursor}},b.site)
  assert.equal(reply.data.anchor_date,'2024-06-15');const query=queries.at(-1).searchParams
  assert.equal(query.get('sort'),'nearest');assert.equal(query.get('student_id'),id(2));assert.equal(query.get('course_id'),id(3));assert.equal(query.has('enrollment_id'),false);assert.equal(query.get('cursor'),cursor)
  await b.send({type:'integration-inline-prefill',operation:'candidates',query:{group:'other-course'}},b.site)
  assert.equal(queries.at(-1).searchParams.get('exclude_course_id'),id(3))
  assert.equal(JSON.stringify(b.calls).includes('trusted-secret'),false)
  const stale=await b.send({type:'integration-inline-prefill',operation:'candidates',formId:'another',query:{group:'same-course'}},b.site);assert.match(stale.error.message,/已變更/)
})
test('temporary target answers are permission checked; templates with unknown date cannot apply',async()=>{
  const id='00000000-0000-4000-8000-000000000001',form={formId:'f1',fingerprint:'hash',admissionId:'301',reportId:'401',date:null}
  let supplementSent=false
  const b=broker(async url=>({ok:false,status:403,json:async()=>({error:{code:'PERMISSION_DENIED',message:'No access'}})}),undefined,{},async m=>{if(m.type==='integration-supplement')supplementSent=true;return{data:form}})
  const reply=await b.send({type:'integration-inline-prefill',operation:'supplement',input:{enrollmentId:id}},b.site)
  assert.equal(reply.error.code,'PERMISSION_DENIED');assert.equal(supplementSent,false)
  const old=await b.send({type:'integration-inline-prefill',operation:'candidates',query:{group:'same-course'}},b.site);assert.match(old.error.message,/1000123/)
})
test('temporary enrollment answers cannot be reused across EduLog instances',async()=>{
  const id='00000000-0000-4000-8000-000000000001',form={formId:'f1',fingerprint:'hash',admissionId:'301',reportId:'401',date:'2024-10-04',supplement:{enrollmentId:id,binding:{instance:'https://other.example',userId:'other'}}}
  const b=broker(async()=>({ok:true,json:async()=>({data:{memories:[],source_links:[]}})}),async()=>({status:'connected',capabilities:{nearest_report_candidates:true}}),{},async()=>({data:form}))
  const reply=await b.send({type:'integration-inline-prefill',operation:'candidates',query:{group:'same-course'}},b.site)
  assert.match(reply.error.message,/確認目標學生/);assert.equal(b.calls.some(c=>c.url?.includes('/enrollments/')),false)
})
