// Synthetic UI verification in installed Chrome/Edge; no live site/API writes.
import { readFileSync, mkdirSync } from 'node:fs'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
const { chromium } = await import(pathToFileURL(process.argv[2] || 'C:/Users/kenny/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const root = new URL('../', import.meta.url), output = new URL('artifacts/workspace/', import.meta.url); mkdirSync(output, { recursive: true })
const server = createServer((req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname.slice(1)
  if (!/^[a-z0-9.-]+$/.test(name)) { res.writeHead(404).end(); return }
  try { const content = readFileSync(new URL(name, root)); res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(content) } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
const mock = () => {
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, store = new Map()
  const catalog = { classrooms:[{id:id(1),name:'測試教室'}],courses:[{id:id(2),display_name:'測試課程'}],class_sessions:[{id:id(3),name:'測試班級',classroom_id:id(1),course_ids:[id(2)],start_time:'09:00:00',end_time:'10:00:00',start_date:'2026-01-01',day_of_week:5}],students:[],enrollments:[],occurrences:[],report_targets:[],source_links:[],lessons:[],permissions:{course_create:true,classroom_scopes:[{id:id(1),class_create:true}],session_scopes:[{id:id(3),student_create:true,enrollment_create:true,occurrence_create:true,report_create:true}]} }
  const native = {formId:'native-form',action:'/dt_admissions/301/reports/401',admissionId:'301',reportId:'401',title:'測試學生 A 課堂紀錄',date:'2026-10-02',fingerprint:'a'.repeat(64),sourceReportUrl:'https://corp.orangeapple.co/dt_admissions/301/reports/401',fields:[{key:'attendance_status',label:'出席',type:'select',value:'',options:[{value:'attended',label:'出席'},{value:'absent',label:'不出席'}]},{key:'content',label:'學習表現',type:'text',value:'原站草稿',options:[]},{key:'class_notes',label:'內部紀錄',internal:true,type:'text',value:'',options:[]}]}
  const report = {id:id(5),version:1,student_name:'測試學生 A',course_name:'測試課程',occurrence_date:'2026-10-02',updated_at:'2026-10-02T00:00:00Z',content:'EduLog 評語',attendance_status:'present',is_completed:true,class_notes:'內部文字',completeness:{isMissing:true}}
  window.testCalls=[]; window.chrome={runtime:{sendMessage:async m=>{
    window.testCalls.push(m)
    if(m.type==='workspace-init')return{data:{binding:{instance:'http://localhost:3000',userId:id(8)},status:{status:'connected',capabilities:{teaching_data_import:true,report_prefill:true,catalog_v1:true,mapping_memory:true,multi_course_import:true}},tabs:new URL(location.href).searchParams.has('empty')?[]:[{id:10,title:'測試班級',path:'/courses/dt/11',url:'https://corp.orangeapple.co/courses/dt/11'}]}}
    if(m.type==='workspace-store'){ if(m.action==='list')return{data:[...store.values()]};if(m.action==='get')return{data:store.get(m.id)};let w=structuredClone(m.work);if(['complete','cancelled'].includes(w.status)){delete w.snapshot;delete w.batches}w.updatedAt=Date.now();store.set(w.id,w);return{data:w} }
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
      if(m.operation==='preview')return{data:{rows:m.body.rows.map(r=>({kind:r.record.kind,source_id:r.source_id,status:'added',before:{},after:r.record.data})),counts:{added:m.body.rows.length}}}
      if(m.operation==='apply')return{data:{applied:m.body.rows.length}}
      if(m.operation==='reports')return{data:{reports:[report],next_cursor:null}}
      if(m.operation==='work')return{data:{imports:[],pushes:[]}}
      return{data:{status:'pending_confirmation'}}
    }
    return{data:true}
  },onMessage:{addListener(){}}},action:{openPopup:async()=>{}}}
}
try {
  for (const [name, executablePath] of [['chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]) {
    const browser = await chromium.launch({ executablePath, headless: true })
    try {
      const emptyPage = await browser.newPage(); await emptyPage.addInitScript(mock); await emptyPage.goto(`http://127.0.0.1:${port}/workspace.html?empty=1`); await emptyPage.locator('#workspace').waitFor({state:'visible'})
      assert.equal(await emptyPage.locator('#collect').isDisabled(),true); assert.equal(await emptyPage.locator('#read-form').isDisabled(),true)
      assert.equal(await emptyPage.evaluate(()=>testCalls.some(m=>m.type==='workspace-api'&&['context','catalog','reports'].includes(m.operation))),false)
      console.log(`PASS ${name}: no source tabs means no catalog reads and no active import/prefill action`); await emptyPage.close()
      const storagePage = await browser.newPage(), storageErrors = []
      storagePage.on('pageerror', error => storageErrors.push(error.message))
      await storagePage.goto(`http://127.0.0.1:${port}/workspace.css`)
      const checks = await storagePage.evaluate(async () => {
        const { workStore } = await import('/work-store.js'), owner = { instance: 'https://test.invalid', userId: 'user-a' }, other = { ...owner, userId: 'user-b' }
        const results = [], check = (name, value) => results.push({ name, passed: !!value })
        const row = { id: 'storage-test', revision: 2, status: 'paused', snapshot: { records: ['private'] }, batches: [1], form: { value: 'draft' }, prefill: { value: 'draft' }, report: { id: 'test' }, uiState: [1] }
        const saved = await workStore.put(row, owner)
        check('seven-day expiry', saved.expiresAt <= Date.now() + 7 * 86400000)
        check('wrong user isolated', await workStore.get(row.id, other) === null && (await workStore.list(other)).length === 0)
        check('wrong instance isolated', await workStore.get(row.id, { ...owner, instance: 'https://other.invalid' }) === null)
        let blocked = false; try { await workStore.put(row, other) } catch { blocked = true }; check('owner replacement rejected', blocked)
        check('late revision ignored', (await workStore.put({ ...saved, revision: 1, status: 'complete' }, owner)).status === 'paused')
        const done = await workStore.put({ ...saved, revision: 3, status: 'complete', expiresAt: saved.expiresAt + 86400000 }, owner)
        check('expiry cannot extend', done.expiresAt === saved.expiresAt)
        check('completed payload cleared', ['snapshot','batches','form','prefill','report','uiState'].every(key => !(key in done)))
        const cancelled = await workStore.put({ ...row, id: 'cancelled', status: 'cancelled' }, owner)
        check('cancelled payload cleared', !cancelled.snapshot && !cancelled.form)
        const pending = await workStore.put({ ...row, id: 'pending', status: 'pending_confirmation', push: { id: 'metadata' } }, owner)
        check('pending native form cleared', !pending.form && !pending.prefill && pending.push.id === 'metadata')
        await workStore.put({ id: 'expired', status: 'paused', expiresAt: Date.now() - 1 }, owner)
        check('expired invisible', await workStore.get('expired', owner) === null)
        await workStore.purge()
        check('purge preserves active works', (await workStore.list(owner)).length === 3)
        return results
      })
      assert.deepEqual(checks.filter(c => !c.passed), []); assert.deepEqual(storageErrors, [])
      console.log(`PASS ${name}: ${checks.length} IndexedDB ownership, retention, checkpoint and cleanup checks`); await storagePage.close()
      for (const width of [360,390,768,1024,1440]) {
      const page = await browser.newPage({viewport:{width,height:900}}), errors=[]; page.on('pageerror',e=>errors.push(e.message)); await page.addInitScript(mock)
      await page.goto(`http://127.0.0.1:${port}/workspace.html?source=10`); await page.locator('#workspace').waitFor({state:'visible'})
      await page.locator('#read-history').uncheck(); await page.locator('#collect').click(); await page.locator('#mapping').waitFor({state:'visible'})
      await page.locator('#classroom').selectOption('00000000-0000-4000-8000-000000000001'); await page.locator('#class-session').selectOption('00000000-0000-4000-8000-000000000003')
      await page.locator('[data-mapping-section=admissions]').click(); await page.locator('#mapping-items button:visible').first().click()
      await page.locator('#student-101').selectOption('new'); await page.locator('#enrollment-301').selectOption('new'); await page.locator('#enrollment-course-301').selectOption('00000000-0000-4000-8000-000000000002'); await page.locator('#start-301').fill('2026-01-01'); await page.locator('#status-301').selectOption('regular')
      if (width === 390) {
        await page.waitForFunction(() => testCalls.some(m => m.type === 'workspace-store' && m.work?.uiState?.find(s => s.id === 'status-301' && s.value === 'regular')))
        await page.locator('[data-flow=work]').click(); await page.getByRole('button', { name: '繼續確認對應', exact: true }).click()
        await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('已恢復來源資料'))
        for (const [id, value] of [['classroom','00000000-0000-4000-8000-000000000001'],['class-session','00000000-0000-4000-8000-000000000003'],['student-101','new'],['enrollment-301','new'],['enrollment-course-301','00000000-0000-4000-8000-000000000002'],['start-301','2026-01-01'],['status-301','regular']]) assert.equal(await page.locator(`#${id}`).inputValue(), value, `${name}: restores ${id}`)
      }
      await page.locator('#preview').click(); await page.locator('#preview-section').waitFor({state:'visible'})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} ${width}: preview overflow`)
      await page.screenshot({path:new URL(`${name}-${width}-import.png`,output).pathname.replace(/^\//,'')})
      await page.locator('#apply').click(); await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('全部可匯入'))
      assert.equal(await page.evaluate(()=>testCalls.filter(m=>m.operation==='apply').length),1)
      await page.locator('[data-flow=prefill]').click(); await page.locator('#read-form').click(); await page.locator('#target-summary').waitFor({state:'visible'})
      await page.locator('#target-confirm').check(); await page.locator('input[name=report]').check(); await page.locator('#compare').click(); await page.locator('#field-review').waitFor({state:'visible'})
      assert.equal(await page.locator('[data-key=content] [data-include]').isChecked(),false)
      assert.equal(await page.locator('[data-key=class_notes] [data-include]').isChecked(),false)
      assert.equal(await page.locator('#report-completeness').textContent().then(s=>s.includes('未齊備')&&s.includes('課程已完成')),true)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} ${width}: prefill overflow`)
      await page.screenshot({path:new URL(`${name}-${width}-prefill.png`,output).pathname.replace(/^\//,'')})
      await page.locator('#prefill').click(); await page.locator('#prefill-result').waitFor({state:'visible'})
      const fields = await page.evaluate(()=>testCalls.find(m=>m.type==='workspace-source'&&m.action==='apply').input.fields); assert.deepEqual(fields.map(f=>f.key),['attendance_status'])
      await page.locator('[data-flow=work]').click(); await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('工作紀錄已更新'))
      assert.deepEqual(errors,[]); console.log(`PASS ${name} ${width}: import, manual mapping, preview/apply, prefill preservation, pending record, history, overflow`); await page.close()
    } } finally { await browser.close() }
  }
} finally { await new Promise(resolve=>server.close(resolve)) }
