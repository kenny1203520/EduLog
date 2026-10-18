import { loadPlaywright, browserTargets, fileURLToPath } from './browser-runtime.mjs'
// Original workspace ES module and DOM; all source/API data is synthetic.
// Accessors are served only by this test server and never enter the side-load.
import {createServer} from 'node:http'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const { chromium } = await loadPlaywright(process.argv.slice(2).find(arg => !arg.startsWith('--')))
const root=new URL('../',import.meta.url),out=new URL('artifacts/stale-recovery/',import.meta.url)
mkdirSync(out,{recursive:true})
const accessors=`
globalThis.recoveryTest={
 async seed(trusted=false){
  const draft={id:crypto.randomUUID(),type:'import',status:'previewed',revision:0,title:'合成恢復工作',sourceTab:10,sourcePath:'/courses/dt/11',sourceClassId:'11',dateFrom:'1900-01-01',dateTo:'9999-12-31',ids:{},needs:[],done:0,jobId:'original-job',batchCount:1,
   snapshot:{sourceOrigin:'https://corp.orangeapple.co',sourcePath:'/courses/dt/11',classId:'11',title:'合成班級',records:[],sourceEvidence:'保留本機證據'},
   staleDiagnosticSource:trusted?'version_check':undefined,staleDiagnostics:{'rows.course.synthetic.target_version':['TARGET_VERSION_CHANGED']},previewDirty:true,previewError:{code:'PREVIEW_FAILED',message:'previous error'},
   uiState:[],batches:[{key:'original-key',rows:[{source_id:'synthetic',target_id:'synthetic-course',overwrite:[],record:{kind:'course',data:{subject:'合成課程',stage:'合成階段'}}}]}]};
  await workStore.put(draft,{instance:'http://synthetic.test',userId:'synthetic-user'});return draft.id;
 },
 async open(id){return run(()=>openWorkRecord({local:{id,__summary:true,type:'import'}}),{label:'正在恢復所選工作'})},
 state(){return {id:work.id,status:work.status,jobId:work.jobId,batches:work.batches,dirty:work.previewDirty,error:work.previewError,sourceEvidence:work.snapshot.sourceEvidence}},
 injectRenderFailure(){const original=globalThis.edulogUi;let fail=true;globalThis.edulogUi={...original,t(key,...args){if(fail&&key==='work.staleCauseUnknown'){fail=false;throw new ReferenceError('syntheticMissing is not defined')}return original.t(key,...args)}}}
};`
const server=createServer((req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname.slice(1)
 if(!/^[a-z0-9.-]+$/.test(name)){res.writeHead(404).end();return}
 try{let content=readFileSync(new URL(name,root),'utf8');if(name==='workspace.js')content+=accessors;res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(content)}catch{res.writeHead(404).end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const results=[]
try{
 for (const [name, launchOptions] of browserTargets()) {
    const browser = await chromium.launch(launchOptions)
  try{for(const [width,height] of [[390,900],[1440,480]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[]
   page.on('pageerror',error=>errors.push(error.message))
   await page.addInitScript(()=>{
    window.testRequests=[];window.testFailures=[]
    addEventListener('unhandledrejection',event=>testFailures.push(String(event.reason)))
    const context={classrooms:[],courses:[],class_sessions:[],students:[],enrollments:[],occurrences:[],report_targets:[],source_links:[],lessons:[],permissions:{}}
    window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async m=>{
     testRequests.push({type:m.type,operation:m.operation,key:m.body?.key})
     if(m.type==='workspace-init')return{data:{binding:{instance:'http://synthetic.test',userId:'synthetic-user'},status:{status:'connected',capabilities:{catalog_v1:true,teaching_data_import:true,report_prefill:true,mapping_memory:true,multi_course_import:true,enrollment_history_reports:true}},tabs:[{id:10,path:'/courses/dt/11',title:'合成班級'}]}}
     if(m.type==='workspace-store-authorize')return{data:{instance:'http://synthetic.test',userId:'synthetic-user'}}
     if(m.type==='workspace-source')return{data:{sourceOrigin:'https://corp.orangeapple.co',classId:'11',title:'合成班級'}}
     if(m.type==='workspace-api'){
      if(m.operation==='context')return{data:context}
      if(m.operation==='catalog')return{data:{items:[],next_cursor:null}}
      if(m.operation==='resolve')return{data:{source_links:[],targets:[],memories:[]}}
      if(m.operation==='import-info')return{data:{job:{status:'paused'},batches:[{key:'original-key',status:'previewed'}]}}
      if(m.operation==='preview')return{data:{rows:m.body.rows.map(r=>({kind:r.record.kind,source_id:r.source_id,status:'unchanged',before:r.record.data,after:r.record.data})),counts:{unchanged:m.body.rows.length}}}
     }
     return{data:{}}
    }},storage:{local:{get:async()=>({}),set:async()=>{}}}}
   })
   await page.goto(`http://127.0.0.1:${server.address().port}/workspace.html?source=10`)
   await page.waitForFunction(()=>window.recoveryTest&&document.getElementById('workspace').getAttribute('aria-busy')!=='true')
   assert.equal(await page.locator('#workspace').isVisible(),true,await page.locator('#diagnostic').textContent())
   for(const trusted of [false,true]){
    const id=await page.evaluate(trusted=>recoveryTest.seed(trusted),trusted)
    await page.evaluate(id=>recoveryTest.open(id),id)
    assert.equal(await page.locator('#preview-section').isVisible(),true,await page.locator('#operation-detail').textContent()+' '+await page.locator('#diagnostic').textContent())
    assert.equal(await page.locator('#operation-status').isVisible(),false)
    assert.equal(await page.locator('#apply').isEnabled(),true)
    const state=await page.evaluate(()=>recoveryTest.state())
    assert.equal(state.jobId,'original-job');assert.equal(state.batches[0].key,'original-key');assert.equal(state.sourceEvidence,'保留本機證據');assert.equal(state.error,undefined)
    assert.match(await page.locator('#diff-list').innerText(),trusted?/目標資料版本改變/:/原因尚未確認/)
   }
   const id=await page.evaluate(()=>recoveryTest.seed(false))
   await page.evaluate(()=>recoveryTest.injectRenderFailure())
   await page.evaluate(id=>recoveryTest.open(id),id)
   assert.match(await page.locator('#operation-title').innerText(),/工作台介面發生錯誤/)
   assert.match(await page.locator('#diagnostic').textContent(),/WORKSPACE_UI_ERROR/,JSON.stringify(await page.evaluate(()=>({state:recoveryTest.state(),failures:testFailures,status:document.getElementById('operation-status').outerHTML,diagnostics:document.getElementById('diagnostics').outerHTML}))))
   assert.match(await page.locator('#diagnostic').textContent(),/syntheticMissing is not defined/)
   assert.equal(await page.locator('#apply').isDisabled(),true)
   assert.equal(await page.locator('#cancel-read').isVisible(),false)
   assert.equal(await page.locator('#workspace').getAttribute('aria-busy'),null)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   const hit=await page.locator('#retry-work-recovery').boundingBox();assert.ok(hit.width>=44&&hit.height>=44)
   await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-${height}-error.png`,out))})
   await page.evaluate(()=>edulogUi.setLocale('en'))
   assert.match(await page.locator('#operation-title').innerText(),/Workspace interface error/)
   assert.match(await page.locator('#retry-work-recovery').innerText(),/Reopen and review work/)
   await page.locator('#retry-work-recovery').focus();await page.keyboard.press('Enter')
   await page.waitForFunction(()=>document.getElementById('workspace').getAttribute('aria-busy')!=='true')
   assert.equal(await page.locator('#preview-section').isVisible(),true)
   assert.equal(await page.locator('#operation-status').isVisible(),false)
   assert.equal(await page.locator('#diagnostics').isVisible(),false)
   assert.equal(await page.locator('#apply').isEnabled(),true)
   const requests=await page.evaluate(()=>testRequests.filter(m=>m.type==='workspace-api'))
   assert.equal(requests.filter(m=>['apply','history-bind-apply','job'].includes(m.operation)).length,0)
   assert.ok(requests.some(m=>m.operation==='import-info'));assert.ok(requests.filter(m=>m.operation==='preview').every(m=>m.key==='original-key'))
   assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>testFailures),[])
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-${height}.png`,out))})
   results.push({browser:name,width,height,passed:true,teachingWrites:0})
   console.log(`PASS ${name} ${width}x${height}: original ES module, stale draft recovery, trusted/legacy diagnostics, error retry and zero teaching writes`)
   await page.close()
  }}finally{await browser.close()}
 }
 writeFileSync(new URL('results.json',out),JSON.stringify(results,null,2))
}finally{await new Promise(resolve=>server.close(resolve))}
