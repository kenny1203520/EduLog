import { loadPlaywright, browserTargets, fileURLToPath } from './browser-runtime.mjs'
// Synthetic UI verification in installed Chrome/Edge; no live site/API writes.
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'
const { chromium } = await loadPlaywright(process.argv.slice(2).find(arg => !arg.startsWith('--')))
const editorOnly=process.argv.includes('--editor-only')
const inlineOnly=process.argv.includes('--inline-only')
const root = new URL('../', import.meta.url), output = new URL('artifacts/workspace/', import.meta.url); mkdirSync(output, { recursive: true })
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1)
  if (name === 'editor-fixture.html') { res.setHeader('Content-Type','text/html; charset=utf-8'); res.end('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>'); return }
  if (!/^(?:[a-z0-9-]+\/)*[a-z0-9.-]+$/.test(name)) { res.writeHead(404).end(); return }
  try { const content = readFileSync(new URL(name, root)); res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(content) } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const mock = () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, store = new Map()
  const catalog = { classrooms:[{id:id(1),name:'測試教室'}],courses:[{id:id(2),display_name:'測試課程'}],class_sessions:[{id:id(3),name:'測試班級',classroom_id:id(1),course_ids:[id(2)],start_time:'09:00:00',end_time:'10:00:00',start_date:'2026-01-01',day_of_week:5}],students:[],enrollments:[],occurrences:[],report_targets:[],source_links:[],lessons:[],permissions:{course_create:true,classroom_scopes:[{id:id(1),class_create:true}],session_scopes:[{id:id(3),student_create:true,enrollment_create:true,occurrence_create:true,report_create:true}]} }
  const native = {formId:'native-form',action:'/dt_admissions/301/reports/401',admissionId:'301',reportId:'401',title:'測試學生 A 課堂紀錄',date:'2026-10-02',fingerprint:'a'.repeat(64),sourceReportUrl:'https://corp.orangeapple.co/dt_admissions/301/reports/401',fields:[{key:'attendance_status',label:'出席',type:'select',value:'',options:[{value:'attended',label:'出席'},{value:'absent',label:'不出席'}]},{key:'content',label:'學習表現',type:'text',value:'原站草稿',options:[]},{key:'class_notes',label:'內部紀錄',internal:true,type:'text',value:'',options:[]}]}
  const report = {id:id(5),version:1,student_name:'測試學生 A',course_name:'測試課程',occurrence_date:'2026-10-02',updated_at:'2026-10-02T00:00:00Z',content:'EduLog 評語',attendance_status:'present',is_completed:true,class_notes:'內部文字',completeness:{isMissing:true}}
  window.testCalls=[]; window.appliedRows=[]; window.failWorkSaves??=0; window.chrome={runtime:{sendMessage:async m=>{
    window.testCalls.push(m)
    if(m.type==='workspace-init')return{data:{binding:{instance:'http://localhost:3000',userId:id(8)},status:{status:'connected',capabilities:{teaching_data_import:true,report_prefill:true,catalog_v1:true,mapping_memory:true,multi_course_import:true,enrollment_history_reports:true,per_occurrence_report_routing:true}},tabs:new URL(location.href).searchParams.has('empty')?[]:[{id:10,title:'測試班級',path:'/courses/dt/11',url:'https://corp.orangeapple.co/courses/dt/11'}]}}
    if(m.type==='workspace-store-authorize'){if(m.action==='put'&&window.failWorkSaves>0){window.failWorkSaves--;return{error:{code:'WORK_STORAGE_FULL',message:'此瀏覽器的工作儲存空間不足。請移除不需要的本機工作草稿後重試。'}}}return{data:{instance:'http://localhost:3000',userId:id(8),action:m.action,workId:m.workId,revision:m.revision}}}
    if(m.type==='workspace-store'){ if(m.action==='list')return{data:[...store.values()]};if(m.action==='get')return{data:store.get(m.id)};if(window.failWorkSaves>0){window.failWorkSaves--;return{error:{code:'WORK_STORAGE_FULL',message:'此瀏覽器的工作儲存空間不足。請移除不需要的本機工作草稿後重試。'}}}let w=structuredClone(m.work);if(['complete','cancelled'].includes(w.status)){delete w.snapshot;delete w.batches}w.updatedAt=Date.now();store.set(w.id,w);return{data:w} }
    if(m.type==='workspace-check-source')return{data:{closed:false}}
    if(m.type==='workspace-cancel-read')return{data:true}
    if(m.type==='workspace-source'){
      if(m.action==='context')return{data:{sourceOrigin:'https://corp.orangeapple.co',classId:'11',title:'測試班級',reportOpen:true}}
      if(m.action==='collect')return{data:{sourceOrigin:'https://corp.orangeapple.co',sourcePath:'/courses/dt/11',classId:'11',title:'測試班級',records:[{kind:'student',source_id:'101',data:{name:'測試學生 A',external_link:'https://corp.orangeapple.co/students/101'}},{kind:'enrollment',source_id:'301',student_source_id:'101',sourceCourseLabel:'原站課程 A',data:{external_link:'https://corp.orangeapple.co/dt_admissions/301'},needs:['報名日期']}],issues:[],admissionPaths:[]}}
      if(m.action==='form')return{data:native}
      if(m.action==='apply')return{data:{applied:m.input.fields.length,target:{fingerprint:'b'.repeat(64)},status:'pending_confirmation'}}
    }
    if(m.type==='workspace-api'){
      if(m.operation==='catalog'){
        if(m.query.resource==='permissions')return{data:m.query.class_session_id?{session:{student_create:true,enrollment_create:true,occurrence_create:true,report_create:true}}:{course_create:true,classroom:{class_create:true,student_create:true,enrollment_create:true,occurrence_create:true,report_create:true}}}
        return{data:{items:catalog[m.query.resource]||[],next_cursor:null,limit:50}}
      }
      if(m.operation==='resolve')return{data:{source_links:[],targets:[]}}
      if(m.operation==='context')return{data:catalog}
      if(m.operation==='job')return{data:{id:id(9)}}
      if(m.operation==='preview')return{data:{rows:m.body.rows.map(r=>({kind:r.record.kind,source_id:r.source_id,status:window.previewConflict&&r.record.kind==='enrollment'?'conflict':'added',before:window.previewConflict&&r.record.kind==='enrollment'?{...r.record.data,status:'trial'}:{},after:r.record.data})),counts:{added:m.body.rows.length}}}
      if(m.operation==='apply'){window.appliedRows.push(...m.body.rows);return{data:{applied:m.body.rows.length}}}
      if(m.operation==='complete')return{data:{status:'complete',verified:true}}
      if(m.operation==='import-info')return{data:{job:{status:'complete'},roster_date:'2026-10-03',batches:[],roster:{enrollments:window.appliedRows.filter(r=>r.record.kind==='enrollment').map(r=>({id:r.target_id,class_session_id:r.record.data.class_session_id,status:r.record.data.status,start_date:r.record.data.start_date}))}}}
      if(m.operation==='reports')return{data:{reports:[report],next_cursor:null}}
      if(m.operation==='work')return{data:{imports:[],pushes:[]}}
      return{data:{status:'pending_confirmation'}}
    }
    return{data:true}
  },onMessage:{addListener(){}}},action:{openPopup:async()=>{}}}
}
try {
  for (const [name, launchOptions] of browserTargets()) {
    const browser = await chromium.launch(launchOptions)
    try {
      if(!inlineOnly){
      for(const flow of ['import','work']){
        const emptyPage=await browser.newPage(),startupErrors=[]
        emptyPage.on('pageerror',error=>startupErrors.push(error.message))
        await emptyPage.addInitScript(()=>{window.unhandledRejections=[];window.addEventListener('unhandledrejection',event=>window.unhandledRejections.push(String(event.reason)))})
        await emptyPage.addInitScript(mock); await emptyPage.goto(`http://127.0.0.1:${port}/workspace/workspace.html?empty=1&flow=${flow}`); await emptyPage.locator('#workspace').waitFor({state:'visible'})
        await emptyPage.locator(`#${flow}-view`).waitFor({state:'visible'})
        await emptyPage.waitForFunction(()=>document.querySelector('#workspace')?.getAttribute('aria-busy')!=='true')
        assert.equal(await emptyPage.locator('#collect').isDisabled(),true,`${name} ${flow}: import remains unavailable without a source`)
        assert.equal(await emptyPage.locator('#prefill-view').count(),0,`${name} ${flow}: the prefill flow is gone from the workspace`)
        assert.equal(await emptyPage.evaluate(()=>testCalls.some(m=>m.type==='workspace-api'&&['context','catalog','reports'].includes(m.operation))),false,`${name} ${flow}: no source scoped requests`)
        assert.deepEqual(startupErrors,[],`${name} ${flow}: no uncaught startup errors`)
        assert.deepEqual(await emptyPage.evaluate(()=>unhandledRejections),[],`${name} ${flow}: no unhandled startup rejections`)
        console.log(`PASS ${name}: ${flow} entry initializes safely with no source tab`); await emptyPage.close()
      }
      if(!editorOnly&&!inlineOnly){
        const retryPage=await browser.newPage({viewport:{width:390,height:800}}),retryErrors=[]
        retryPage.on('pageerror',error=>retryErrors.push(error.message));await retryPage.addInitScript(()=>{window.failWorkSaves=1;window.unhandledRejections=[];window.addEventListener('unhandledrejection',event=>window.unhandledRejections.push(String(event.reason)))});await retryPage.addInitScript(mock);await retryPage.goto(`http://127.0.0.1:${port}/workspace/workspace.html?source=10`);await retryPage.locator('#workspace').waitFor({state:'visible'}).catch(async()=>{const state=await retryPage.evaluate(()=>({body:document.body.innerText,diagnostic:document.querySelector('#diagnostic')?.textContent,errors:window.unhandledRejections,calls:window.testCalls}));throw new Error('Workspace startup failed: '+JSON.stringify({state,retryErrors}))});await retryPage.locator('#collect').click().catch(async()=>{const state=await retryPage.evaluate(()=>({body:document.body.innerText,hidden:['import-view','collect','mapping'].map(id=>[id,document.querySelector('#'+id)?.hidden]),source:document.querySelector('#source-label')?.textContent,errors:window.unhandledRejections,calls:window.testCalls}));throw new Error('Collect control unavailable: '+JSON.stringify({state,retryErrors}))});await retryPage.locator('#retry-history-save').waitFor({state:'visible'});assert.match(await retryPage.locator('#draft-status').textContent(),/草稿保存失敗|Draft save failed/);assert.equal(await retryPage.evaluate(()=>testCalls.filter(call=>call.type==='workspace-store-authorize'&&call.action==='put').length),1);assert.equal(await retryPage.evaluate(()=>testCalls.filter(call=>call.type==='workspace-store-authorize'&&('work'in call||'snapshot'in call)).length),0,'draft body must not cross the runtime messaging boundary');const failedSaveList=await retryPage.evaluate(async()=>{const{workStore}=await import('/shared/work-store.js');return workStore.list({instance:'http://localhost:3000',userId:'00000000-0000-4000-8000-000000000008'})});assert.equal(failedSaveList.length,0,'failed save must not appear as a persisted work');await retryPage.locator('#retry-history-save').click();await retryPage.locator('#mapping').waitFor({state:'visible'});assert.equal(await retryPage.locator('#retry-history-save').isVisible(),false);assert.ok(await retryPage.evaluate(()=>testCalls.filter(call=>call.type==='workspace-store-authorize'&&call.action==='put').length)>=2);const persistedRetry=await retryPage.evaluate(async()=>{const{workStore}=await import('/shared/work-store.js');return workStore.list({instance:'http://localhost:3000',userId:'00000000-0000-4000-8000-000000000008'})});assert.equal(persistedRetry.length,1);assert.equal(persistedRetry[0].__summary,true);assert.equal('snapshot'in persistedRetry[0],false);assert.equal('batches'in persistedRetry[0],false);assert.ok(persistedRetry[0].hasSnapshot);const fullRetry=await retryPage.evaluate(async()=>{const{workStore}=await import('/shared/work-store.js');const owner={instance:'http://localhost:3000',userId:'00000000-0000-4000-8000-000000000008'};return workStore.get((await workStore.list(owner))[0].id,owner)});assert.ok(fullRetry.snapshot?.records?.length);assert.deepEqual(retryErrors,[]);assert.deepEqual(await retryPage.evaluate(()=>unhandledRejections),[]);console.log(`PASS ${name}: failed first draft save pauses; explicit retry saves via local segmented storage without exposing draft payload`);await retryPage.close()
      }
      const storagePage = await browser.newPage(), storageErrors = []
      storagePage.on('pageerror', error => storageErrors.push(error.message))
      await storagePage.goto(`http://127.0.0.1:${port}/workspace/workspace.css`)
      const checks = await storagePage.evaluate(async () => {
        const { workStore } = await import('/shared/work-store.js'), owner = { instance: 'https://test.invalid', userId: 'user-a' }, other = { ...owner, userId: 'user-b' }
        const results = [], check = (name, value) => results.push({ name, passed: !!value })
        await new Promise((resolve, reject) => { const deletion = indexedDB.deleteDatabase('edulog-integration-work'); deletion.onsuccess = resolve; deletion.onerror = () => reject(deletion.error); deletion.onblocked = () => reject(new Error('work database stayed open before legacy upgrade')) })
        await new Promise((resolve, reject) => { const opening = indexedDB.open('edulog-integration-work', 1); opening.onupgradeneeded = () => opening.result.createObjectStore('work', { keyPath: 'id' }); opening.onerror = () => reject(opening.error); opening.onsuccess = () => { const database = opening.result, tx = database.transaction('work', 'readwrite'); tx.objectStore('work').put({ id: 'legacy-work', instance: owner.instance, userId: owner.userId, revision: 1, expiresAt: Date.now() + 86400000, status: 'paused', snapshot: { records: [{ kind: 'report', data: { content: 'legacy draft' } }] } }); tx.oncomplete = () => { database.close(); resolve() }; tx.onerror = () => reject(tx.error) } })
        const legacy = await workStore.get('legacy-work', owner)
        check('version 1 inline draft remains readable', legacy?.snapshot?.records?.[0]?.data?.content === 'legacy draft')
        const migrated = await workStore.put(legacy, owner)
        check('legacy draft converts on save without data loss', migrated.snapshot.records[0].data.content === legacy.snapshot.records[0].data.content && !!migrated.updatedAt)
        const row = { id: 'storage-test', revision: 2, status: 'paused', history: {checkpoints:{private:{records:['private']}}}, snapshot: { records: ['private'] }, batches: [1], form: { value: 'draft' }, prefill: { value: 'draft' }, report: { id: 'test' }, uiState: [1] }
        const saved = await workStore.put(row, owner)
        check('seven-day expiry', saved.expiresAt <= Date.now() + 7 * 86400000)
        check('wrong user isolated', await workStore.get(row.id, other) === null && (await workStore.list(other)).length === 0)
        check('wrong instance isolated', await workStore.get(row.id, { ...owner, instance: 'https://other.invalid' }) === null)
        let blocked = false; try { await workStore.put(row, other) } catch { blocked = true }; check('owner replacement rejected', blocked)
        check('late revision ignored', (await workStore.put({ ...saved, revision: 1, status: 'complete' }, owner)).status === 'paused')
        const done = await workStore.put({ ...saved, revision: 3, status: 'complete', expiresAt: saved.expiresAt + 86400000 }, owner)
        check('expiry cannot extend', done.expiresAt === saved.expiresAt)
        check('completed payload cleared', ['history','snapshot','batches','sourceRosterEntries','form','prefill','report','uiState'].every(key => !(key in done)))
        const cancelled = await workStore.put({ ...row, id: 'cancelled', status: 'cancelled' }, owner)
        check('cancelled payload cleared', !cancelled.snapshot && !cancelled.form && !cancelled.history)
        const pending = await workStore.put({ ...row, id: 'pending', status: 'pending_confirmation', push: { id: 'metadata' } }, owner)
        check('pending native form cleared', !pending.form && !pending.prefill && pending.push.id === 'metadata')
        await workStore.put({ id: 'expired', status: 'paused', expiresAt: Date.now() - 1 }, owner)
        check('expired invisible', await workStore.get('expired', owner) === null)
        await workStore.purge()
        check('purge preserves active works', (await workStore.list(owner)).length === 4)
        await new Promise((resolve, reject) => {
          const deletion = indexedDB.deleteDatabase('edulog-integration-work')
          deletion.onsuccess = resolve
          deletion.onerror = () => reject(deletion.error)
          deletion.onblocked = () => reject(new Error('work database stayed open during delete'))
        })
        const reopened = await Promise.all(Array.from({length: 3}, (_, index) => workStore.put({ id: `reopened-${index}`, status: 'paused' }, owner)))
        check('closed database connection reopens for parallel operations', reopened.length === 3 && (await workStore.list(owner)).filter(row => row.id.startsWith('reopened-')).length === 3)
        const paragraph = '學生能跟上進度；評語保留原文。'.repeat(420)
        const historyRecords = Array.from({ length: 600 }, (_, index) => ({ kind: 'report', source_id: `report-${index}`, enrollment_source_id: 'large-admission', date: '2026-10-01', evidenceKey: `large-${index}`, data: { attendance_status: 'absent', absence_reason: 'other', class_participation: 0.5, classroom_behavior: 0, is_completed: false, content: paragraph, class_notes: '內部紀錄\n' + paragraph }, sourceFields: [{ key: 'content', value: paragraph, type: 'text' }], sourceEvidence: [{ sourcePath: '/dt_admissions/large-admission', table: 'reports', row: index, fields: [{ label: '評語', text: paragraph }] }] }))
        const large = { id: 'large-history', revision: 1, status: 'paused-extraction', history: { paths: ['/dt_admissions/large-admission'], next: 0, reportCount: 73, checkpoints: { '/dt_admissions/large-admission': { records: structuredClone(historyRecords), next: 73 } } }, snapshot: { records: [{ kind: 'enrollment', source_id: 'large-admission', data: { name: '學生甲' } }, ...historyRecords] } }
        const largeCharacters = JSON.stringify(large).length
        check('large fixture exceeds the former four million character limit', largeCharacters > 4_000_000)
        const largeSaved = await workStore.put(large, owner), largeLoaded = await workStore.get(large.id, owner), largeListed = (await workStore.list(owner)).find(item => item.id === large.id)
        check('more than 600 source reports and checkpoints restore from segments while list stays compact', largeLoaded.snapshot.records.length === 601 && largeLoaded.history.checkpoints['/dt_admissions/large-admission'].records.length === 600 && largeListed.__summary === true && !('snapshot' in largeListed) && largeListed.hasSnapshot && largeListed.id === largeLoaded.id)
        check('false zero half-star internal notes and source evidence survive', largeLoaded.snapshot.records[1].data.classroom_behavior === 0 && largeLoaded.snapshot.records[1].data.is_completed === false && largeLoaded.snapshot.records[1].data.class_participation === 0.5 && largeLoaded.snapshot.records[1].data.class_notes.includes('內部紀錄') && largeLoaded.snapshot.records[1].sourceEvidence[0].fields[0].text === paragraph)
        const dbHandle = await new Promise((resolve, reject) => { const opening = indexedDB.open('edulog-integration-work', 2); opening.onerror = () => reject(opening.error); opening.onsuccess = () => resolve(opening.result) }), payloadRows = await new Promise((resolve, reject) => { const req = dbHandle.transaction('payloads').objectStore('payloads').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
        check('large work is split into bounded payload chunks', payloadRows.filter(part => part.workId === large.id).length > 1 && payloadRows.filter(part => part.workId === large.id).every(part => part.data.byteLength <= 512 * 1024)); dbHandle.close()
        let failChunk = true; const originalPut = IDBObjectStore.prototype.put
        IDBObjectStore.prototype.put = function (...args) { if (this.name === 'payloads' && failChunk) { failChunk = false; throw new DOMException('simulated quota', 'QuotaExceededError') } return originalPut.apply(this, args) }
        let failedWrite; try { await workStore.put({ ...large, revision: 2, snapshot: { records: [{ kind: 'report', data: { content: 'new version' } }] } }, owner) } catch (error) { failedWrite = error } finally { IDBObjectStore.prototype.put = originalPut }
        const afterFailedWrite = await workStore.get(large.id, owner)
        check('failed chunk transaction reports quota and keeps prior complete draft', failedWrite?.code === 'WORK_STORAGE_FULL' && afterFailedWrite.revision === 1 && afterFailedWrite.snapshot.records.length === 601)
        await new Promise((resolve, reject) => { const req = indexedDB.open('edulog-integration-work', 2); req.onerror = () => reject(req.error); req.onsuccess = () => { const db = req.result, tx = db.transaction('payloads', 'readwrite'); tx.objectStore('payloads').delete([large.id, 1]); tx.oncomplete = () => { db.close(); resolve() }; tx.onerror = () => reject(tx.error) } })
        let corrupt; try { await workStore.get(large.id, owner) } catch (error) { corrupt = error }
        check('missing segment is reported as corrupt data', corrupt?.code === 'WORK_DATA_CORRUPT')
        await workStore.put(large, owner)
        check('re-saving the live draft repairs missing segments', (await workStore.get(large.id, owner)).snapshot.records.length === 601)
        await workStore.delete(large.id, owner)
        check('deleting work also removes all payload segments', !(await workStore.list(owner)).some(item => item.id === large.id) && !(await new Promise((resolve, reject) => { const opening = indexedDB.open('edulog-integration-work', 2); opening.onerror = () => reject(opening.error); opening.onsuccess = () => { const db = opening.result, req = db.transaction('payloads').objectStore('payloads').getAll(); req.onsuccess = () => { const remains = req.result.some(part => part.workId === large.id); db.close(); resolve(remains) }; req.onerror = () => reject(req.error) } })))
        return results
      })
      assert.deepEqual(checks.filter(c => !c.passed), []); assert.deepEqual(storageErrors, [])
      console.log(`PASS ${name}: ${checks.length} IndexedDB ownership, retention, checkpoint and cleanup checks`); await storagePage.close()
      }
      for (const width of ((editorOnly||inlineOnly)?[360]:[360,1440])) {
        const editorPage=await browser.newPage({viewport:{width,height:900}}),editorErrors=[]
        editorPage.setDefaultTimeout(5000); editorPage.setDefaultNavigationTimeout(5000)
        editorPage.on('pageerror',error=>editorErrors.push(error.message))
        await editorPage.goto(`http://127.0.0.1:${port}/editor-fixture.html`,{waitUntil:'domcontentloaded',timeout:5000})
        await editorPage.evaluate(()=>{
          const form={formId:'native-form',reportId:'source-report-1',admissionId:'source-enrollment-1',date:'2026-10-02',fingerprint:'a'.repeat(64),title:'來源學生課堂紀錄',fields:[
            {key:'attendance_status',label:'出席',type:'select',value:'',options:[{value:'present',label:'出席'},{value:'absent',label:'缺席'}]},
            {key:'content',label:'學習表現',type:'text',value:'原站草稿',options:[]},
            {key:'class_notes',label:'教師內部紀錄',type:'text',value:'',internal:true,options:[]}
          ]}
          globalThis.editorCalls=[];globalThis.sourceSubmitted=0
          document.body.innerHTML='<div class="modal"><form id="source-report-form"><button type="submit">原站送出</button></form></div>'
          document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();globalThis.sourceSubmitted++})
          globalThis.edulogSourceIntegration={getForm:doc=>doc.querySelector('#source-report-form'),readForm:async()=>structuredClone(form)}
          globalThis.edulogRuntime={send:async message=>{if(message.type==='get-edulog-integration-status')return{status:'connected',capabilities:{report_prefill:true}};
            editorCalls.push(message)
            if(message.type==='open-integration-workspace')return{data:true}
            if(message.operation==='lookup')return{data:{connected:true,form:structuredClone(form),target:{enrollmentId:'target-enrollment',studentId:'target-student',studentName:'目標學生',className:'目標班級',courseName:'測試課程'},reports:[{id:'target-report',version:4,student_id:'target-student',student_name:'目標學生',enrollment_id:'target-enrollment',course_name:'測試課程',occurrence_date:'2026-10-02',updated_at:'2026-10-03T00:00:00Z',attendance_status:'present',content:'EduLog 學習摘要',class_notes:'內部文字',is_completed:false,completeness:{isMissing:false}}]}}
            if(message.operation==='detail')return{data:{id:'target-report',version:4,student_id:'target-student',student_name:'目標學生',enrollment_id:'target-enrollment',course_name:'測試課程',occurrence_date:'2026-10-02',updated_at:'2026-10-03T00:00:00Z',attendance_status:'present',content:'EduLog 學習摘要',class_notes:'內部文字',is_completed:false,completeness:{isMissing:false}}}
            if(message.operation==='apply')return{data:{applied:message.fields?.length||message.input?.fields?.length||1,recordSaved:true}}
            return{data:{reports:[]}}
          }}
          const Observer=globalThis.MutationObserver;globalThis.editorObserverCalls=0
          globalThis.MutationObserver=class extends Observer{constructor(callback){super((records,observer)=>{globalThis.editorObserverCalls++;if(globalThis.editorObserverCalls>20){observer.disconnect();globalThis.editorObserverLoop=true;return}callback(records,observer)})}}
        })
        await editorPage.addScriptTag({url:`http://127.0.0.1:${port}/shared/field-mappings.js`});await editorPage.addScriptTag({url:`http://127.0.0.1:${port}/shared/field-mapping-ui.js`});await editorPage.addScriptTag({url:`http://127.0.0.1:${port}/content/editor-prefill.js`})
        try { await editorPage.waitForFunction(()=>document.querySelector('aside[data-edulog-owned]')?.shadowRoot?.querySelector('[role=status]')?.textContent.includes('原站表單不會自動送出'),undefined,{timeout:5000}) }
        catch { throw new Error(`${name} ${width}: editor did not settle; errors=${JSON.stringify(editorErrors)}`) }
        assert.equal(await editorPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} ${width}: embedded editor overflow`)
        const defaults=await editorPage.evaluate(()=>{const root=document.querySelector('aside[data-edulog-owned]')?.shadowRoot,include=key=>root?.querySelector(`[data-key="${key}"]`)?.closest('.field')?.querySelector('[data-include]');return{attendance:include('attendance_status')?.checked,content:include('content')?.checked,internal:include('class_notes')?.checked,internalConsent:root?.querySelector('[data-internal]')?.checked}})
        assert.deepEqual(defaults,{attendance:true,content:false,internal:false,internalConsent:false})
        console.log(`CHECK ${name} ${width}: defaults checked`)
        await editorPage.locator('aside[data-edulog-owned]').evaluate(el=>{const root=el.shadowRoot;root.querySelector('[data-key="attendance_status"]').closest('.field').querySelector('[data-include]').checked=false;root.querySelector('[data-key="content"]').closest('.field').querySelector('[data-include]').checked=true;root.querySelector('[data-key="content"]').closest('.field').querySelector('[data-overwrite]').checked=true})
        await editorPage.locator('aside[data-edulog-owned]').evaluate(el=>el.shadowRoot.querySelector('.actions .primary').click())
        await editorPage.waitForFunction(()=>editorCalls.some(call=>call.operation==='apply'))
        assert.equal(await editorPage.evaluate(()=>sourceSubmitted),0,`${name}: prefill must never submit native form`)
        const appliedFields=await editorPage.evaluate(()=>editorCalls.find(call=>call.operation==='apply').input.fields)
        assert.deepEqual(appliedFields.map(field=>field.key),['content'])
        assert.deepEqual(editorErrors,[])
        console.log(`PASS ${name} ${width}: embedded source-editor preview, per-field overwrite, internal-note opt-in and no auto-submit`)
        await editorPage.close()
      }
      for (const width of ((editorOnly||inlineOnly)?[]:[360,390,768,1024,1200,1440,1920])) {
      const page = await browser.newPage({viewport:{width,height:900}}), errors=[]; page.on('pageerror',e=>errors.push(e.message)); await page.addInitScript(()=>{window.unhandledRejections=[];window.addEventListener('unhandledrejection',event=>window.unhandledRejections.push(String(event.reason)))}); await page.addInitScript(mock)
      if(width===1440)await page.addInitScript(()=>{window.previewConflict=true})
      await page.goto(`http://127.0.0.1:${port}/workspace/workspace.html?source=10`); await page.locator('#workspace').waitFor({state:'visible'})
      const zh=await page.evaluate(()=>edulogUi.locale==='zh-TW')
      const idle=()=>page.waitForFunction(()=>document.querySelector('#workspace').getAttribute('aria-busy')!=='true')
      const overflow=async label=>{const wide=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth?[]:[...document.querySelectorAll("body *")].filter(n=>n.getBoundingClientRect().right>innerWidth+1&&n.children.length===0).slice(0,8).map(n=>`${n.tagName.toLowerCase()}${n.id?"#"+n.id:""}.${n.className}: ${(n.textContent||n.value||"").trim().slice(0,60)}`));assert.deepEqual(wide,[],`${name} ${width}: ${label} overflow`)}
      // 1 讀取: the current tab's class is preselected; advanced settings stay collapsed.
      await page.locator('#class-list input[type=radio]').first().waitFor()
      assert.equal(await page.locator('#class-list input[type=radio]:checked').count(),1,`${name} ${width}: current class preselected`)
      assert.equal(await page.locator('#import-advanced').evaluate(n=>n.open),false,`${name} ${width}: advanced settings collapsed`)
      await overflow('read step'); await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-read.png`,output))})
      await page.locator('#import-advanced summary').click(); await page.locator('#read-history').uncheck(); await page.locator('#collect').click(); await page.locator('#mapping').waitFor({state:'visible'}); await idle()
      // 2 確認: only exceptions, decided inline; the mapping workbench stays inside the closed advanced drawer.
      assert.equal(await page.locator('#advanced-drawer').isVisible(),false,`${name} ${width}: full mapping list is not exposed`)
      await page.locator('[data-exception-key="class-target"]').waitFor()
      const row=page.locator('[data-exception-key="enrollment:301"]')
      await row.waitFor()
      assert.equal(await row.getAttribute('data-tone'),'danger',`${name} ${width}: missing start date marked`)
      assert.equal(await row.locator('.err').count()>0,true,`${name} ${width}: missing data shown in red`)
      assert.equal(await page.locator('#sync').isDisabled(),true,`${name} ${width}: unresolved exceptions block syncing instead of being skipped`)
      await overflow('confirm step')
      await page.locator('[data-exception-key="class-target"] [data-ctl=classroom]').selectOption('00000000-0000-4000-8000-000000000001'); await idle()
      await page.waitForFunction(()=>document.querySelector('[data-exception-key="class-target"] [data-ctl=session] option[value="00000000-0000-4000-8000-000000000003"]'))
      await page.locator('[data-exception-key="class-target"] [data-ctl=session]').selectOption('00000000-0000-4000-8000-000000000003'); await idle()
      await page.waitForFunction(()=>{const b=document.querySelector('[data-exception-key="enrollment:301"] [data-ctl=seg-new]');return b&&!b.disabled})
      await page.locator('[data-exception-key="enrollment:301"] [data-ctl=seg-new]').click()
      await page.waitForFunction(()=>document.querySelector('#student-101')?.value==='new'&&document.querySelector('#enrollment-301')?.value==='new')
      assert.equal(await page.locator('#status-301').inputValue(),'regular',`${name} ${width}: new enrollments default to the regular status`)
      assert.equal(await page.locator('[data-exception-key="enrollment:301"] [data-ctl=confirm]').count(),0,`${name} ${width}: new students are not confirmed separately`)
      assert.equal(await page.evaluate(()=>[...document.querySelectorAll('#mapping button')].filter(b=>b.dataset.originalLabel==='確認並記住此報名'&&!b.hidden).length),0,`${name} ${width}: no confirm-and-remember for new items`)
      assert.equal(await page.locator('#review-301').isChecked(),true,`${name} ${width}: choosing 新建 confirms the independent enrollment`)
      await page.locator('[data-exception-key="enrollment:301"] [data-ctl=start]').fill('2026-01-01'); await page.locator('[data-exception-key="enrollment:301"] [data-ctl=start]').dispatchEvent('change')
      await page.waitForFunction(()=>document.querySelector('#start-301')?.value==='2026-01-01')
      if(await page.locator('[data-exception-key="enrollment:301"] [data-ctl=course]').count())await page.locator('[data-exception-key="enrollment:301"] [data-ctl=course]').selectOption('00000000-0000-4000-8000-000000000002')
      await page.waitForFunction(()=>document.querySelector('#enrollment-course-301')?.value)
      await page.waitForFunction(()=>!document.querySelector('#sync').disabled).catch(async()=>{throw new Error('sync stays disabled: '+JSON.stringify(await page.evaluate(()=>({summary:document.querySelector('#review-action-summary').textContent,error:document.querySelector('#mapping-error-301')?.textContent,review:document.querySelector('#review-301')?.checked}))))})
      assert.equal(await page.locator('#review-301').isChecked(), true, `${name} ${width}: new enrollment confirmation retained`)
      await page.waitForFunction(()=>document.querySelector('[data-exception-key="enrollment:301"]')?.dataset.tone==='ok').catch(()=>{throw new Error(`${name} ${width}: fixed row stays listed as resolved`)})
      // Detail drawer and the advanced drawer.
      await page.locator('[data-exception-key="enrollment:301"] [data-ctl=detail]').click(); await page.locator('#detail-drawer').waitFor({state:'visible'})
      assert.match(await page.locator('#detail-title').textContent(),/測試學生 A/)
      await overflow('detail drawer'); await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-detail.png`,output))})
      await page.keyboard.press('Escape'); await page.locator('#detail-drawer').waitFor({state:'hidden'})
      await page.locator('#open-advanced').click(); await page.locator('#advanced-drawer').waitFor({state:'visible'})
      assert.equal(await page.locator('#mapping-workbench').isVisible(),true,`${name} ${width}: full student/enrollment list lives in the advanced drawer`)
      await overflow('advanced drawer'); await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-advanced.png`,output))})
      await page.locator('#advanced-apply').click(); await page.locator('#advanced-drawer').waitFor({state:'hidden'})
      if (width === 390) {
        await page.waitForFunction(async () => { const id=testCalls.findLast(m=>m.type==='workspace-store-authorize'&&m.action==='put')?.workId;if(!id)return false;const {workStore}=await import('/shared/work-store.js');const owner={instance:'http://localhost:3000',userId:'00000000-0000-4000-8000-000000000008'};const saved=await workStore.get(id,owner);return saved?.uiState?.find(s=>s.id==='status-301'&&s.value==='regular')&&saved?.uiState?.find(s=>s.id==='start-301'&&s.value==='2026-01-01')})
        await page.locator('[data-flow=work]').click(); await idle(); await page.locator('[data-work-primary]').first().click(); await idle(); await page.waitForFunction(()=>document.querySelector('#mapping')&&!document.querySelector('#mapping').hidden,{timeout:10000}).catch(async()=>{const state=await page.evaluate(()=>({notice:document.querySelector('#notice')?.textContent,operation:document.querySelector('#operation-detail')?.textContent,calls:testCalls.slice(-8)}));throw new Error('Work resume did not show mapping: '+JSON.stringify(state))})
        for (const [id, value] of [['classroom','00000000-0000-4000-8000-000000000001'],['class-session','00000000-0000-4000-8000-000000000003'],['student-101','new'],['enrollment-301','new'],['enrollment-course-301','00000000-0000-4000-8000-000000000002'],['start-301','2026-01-01'],['status-301','regular']]) assert.equal(await page.locator(`#${id}`).inputValue(), value, `${name}: restores ${id}`)
        assert.equal(await page.evaluate(()=>appliedRows.length),0,'continue review restores mapping but performs no teaching-data writes')
        await page.waitForFunction(()=>!document.querySelector('#sync').disabled)
      }
      await page.evaluate(()=>{window.statusNode=document.querySelector('#status-301')})
      await page.locator('[data-flow=work]').click(); await idle(); await page.locator('[data-flow=import]').click()
      assert.equal(await page.locator('#mapping').isVisible(),true,'return to the confirm step')
      assert.equal(await page.evaluate(()=>statusNode===document.querySelector('#status-301')),true,'flow switching keeps the mapping controls')
      await page.evaluate(()=>edulogUi.setLocale('en'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
      assert.equal(await page.locator('#sync-label').textContent(),'Confirm & sync')
      await overflow('confirm step in English')
      await page.evaluate(locale=>edulogUi.setLocale(locale),zh?'zh-TW':'en');await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
      await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-confirm.png`,output)),fullPage:true})
      // One click: preview and write unless something needs a decision.
      await page.locator('#sync').click(); await idle()
      if(width===1440){
        await page.locator('#preview-section').waitFor({state:'visible'})
        assert.equal(await page.evaluate(()=>testCalls.filter(m=>m.operation==='apply').length),0,'a conflict stops before any write')
        assert.equal(await page.locator('#diff-list details').count()>0,true)
        await overflow('interrupt'); await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-interrupt.png`,output))})
        await page.locator('#apply').click(); await idle()
      }
      await page.locator('#import-progress').waitFor({state:'visible'})
      assert.equal(await page.evaluate(()=>testCalls.filter(m=>m.operation==='apply').length),1)
      assert.equal(await page.evaluate(()=>testCalls.filter(m=>m.operation==='preview').length),1,'one preview before the write')
      assert.deepEqual(await page.evaluate(()=>appliedRows.filter(r=>r.record.kind==='enrollment').map(r=>[r.record.data.status,r.record.data.start_date])),[['regular','2026-01-01']])
      assert.equal(await page.locator('#done-tiles .tile').count(),5); assert.equal(await page.locator('#done-tiles .tile b').first().textContent(),'1')
      await overflow('done step'); await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-done.png`,output))})
      await page.locator('[data-flow=work]').click(); await page.locator('#work-view').waitFor({state:'visible'}); await page.waitForFunction(()=>document.querySelector('#work-count').textContent.trim().length>0)
      assert.equal(await page.locator('#work-list .group-head').count()>=1,true)
      await page.locator('[data-work-view]').first().click(); await page.locator('#work-detail').waitFor({state:'visible'}); await overflow('work detail')
      await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-log.png`,output))})
      assert.deepEqual(errors,[]); assert.deepEqual(await page.evaluate(()=>unhandledRejections),[]); console.log(`PASS ${name} ${width}: read, inline exceptions, drawers, one-click sync${width===1440?' with conflict stop':''}, work log, overflow`); await page.close()
    } } finally { await browser.close() }
  }
} finally { await new Promise(resolve=>server.close(resolve)) }
