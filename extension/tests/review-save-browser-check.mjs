import { loadPlaywright, browserTargets, fileURLToPath } from './browser-runtime.mjs'
// Full original workspace ES module/DOM with synthetic runtime responses only.
// Test accessors are appended by this HTTP server, never shipped in the extension.
import {createServer} from 'node:http'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const { chromium } = await loadPlaywright(process.argv.slice(2).find(arg => !arg.startsWith('--')))
const root=new URL('../',import.meta.url),out=new URL('artifacts/review-save/',import.meta.url);mkdirSync(out,{recursive:true})
const accessors=`
globalThis.reviewTest={
 async setup(){
  generation++;context={courses:[],students:[],lessons:[],permissions:{session:{}},enrollments:[]};
  const record={kind:'report',enrollment_source_id:'synthetic-admission',source_id:'synthetic-report',date:'2026-10-04',sourceStudentName:'合成學生',sourceCourseLabel:'Python 教學核對',data:{content:'來源教學內容'},sourceFields:[],staleReviewFields:['content'],historyFieldDecisions:{content:'keep'}};
  const key=historyIdentity(record);work={id:crypto.randomUUID(),type:'import',status:'previewed',revision:0,dateFrom:'1900-01-01',dateTo:'9999-12-31',jobId:'synthetic-job',done:0,needs:[],snapshot:{records:[record]},historyUI:{},staleReviewRows:[{batchKey:'synthetic-batch',source_id:key}],staleReviewPending:[{kind:'history_report',source_id:key,field:'content'}],batches:[{key:'synthetic-batch',rows:[{source_id:key,target_id:'synthetic-history',overwrite:[],record:{kind:'history_report',data:{content:'original',enrollment_id:'synthetic-enrollment',report_date:'2026-10-04'}}}]}]};
  historyPlan=[{key,record,category:'needs',reason:'請重新確認學習報告',issues:[{target:'conflict:content',fieldKey:'content',message:'請核對學習報告'}],data:{content:'來源教學內容'},sourceData:{content:'來源教學內容'},comparisonReport:{content:'EduLog 教學內容'},conflicts:['content'],staleReviewFields:['content'],target:{id:'synthetic-enrollment',name:'合成學生',courseName:'Python 教學核對'}}];
  activeWorks.import=work;previewResults=[];saveFailureWorkId='';unsavedWorkId='';saveState='saved';busy=false;
  $('connect').hidden=true;$('workspace').hidden=false;flow('import');historyView.render(historyPlan);renderDifferences();return key;
 },
 state(){return {pending:work.staleReviewPending.length,saving:reviewSaveCoordinator.isSaving(work),key:historyPlan[0].key,issues:work.staleReviewIssues||[],records:work.snapshot.records}},
 saveDecision(){return confirmStaleHistoryReview(historyPlan[0],['content'])},
 edit(){work.snapshot.records[0].historyFieldDecisions.content='source';historyLocalSequence++},
 async stored(){return workStore.get(work.id,{instance:'http://synthetic.test',userId:'synthetic-user'})},
 blockers(){work.staleReviewPending=[];work.snapshot.records[0].staleReviewFields=[];work.staleReviewIssues=[{source_id:historyPlan[0].key,batchKey:'synthetic-batch',reason:'mapping',targets:[{field:'content'}]}];historyView.render(historyPlan);renderDifferences()},
 refreshBatch(){work.staleReviewPending=[];work.snapshot.records[0].staleReviewFields=[];refreshStaleReviewBatchRows()},
 async update(){return run(()=>preview(true),{label:'更新差異',readOnly:true})}
};`
const server=createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!/^(?:[a-z0-9-]+\/)*[a-z0-9.-]+$/.test(name)){res.writeHead(404).end();return}try{let content=readFileSync(new URL(name,root),'utf8');if(name==='workspace/workspace.js')content+=accessors;res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(content)}catch{res.writeHead(404).end()}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const results=[]
try{
 for (const [name, launchOptions] of browserTargets()) {
    const browser = await chromium.launch(launchOptions)
  try{for(const [width,height] of [[390,900],[1440,480]]){
   const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',error=>errors.push(error.message))
   await page.addInitScript(()=>{
    window.testRequests=[];window.testSaveHold=false;window.testSaveRelease=null;window.testFailures=[];
    addEventListener('unhandledrejection',event=>window.testFailures.push(String(event.reason)));
    window.chrome={runtime:{onMessage:{addListener(){}},sendMessage:async message=>{
     window.testRequests.push({type:message.type,operation:message.operation,action:message.action});
     if(message.type==='workspace-init')return {data:{binding:{instance:'http://synthetic.test'},status:{capabilities:{}},tabs:[]}};
     if(message.type==='workspace-store-authorize'){
      if(message.action==='put'&&window.testSaveHold){window.testSaveHold=false;await new Promise(resolve=>window.testSaveRelease=resolve)}
      return {data:{instance:'http://synthetic.test',userId:'synthetic-user'}}
     }
     return {data:{}}
    }},storage:{local:{get:async()=>({}),set:async()=>{}}}};
   })
   await page.goto(`http://127.0.0.1:${server.address().port}/workspace/workspace.html`);await page.waitForFunction(()=>window.reviewTest&&document.getElementById('workspace').getAttribute('aria-busy')!=='true')
   await page.evaluate(()=>edulogUi.setLocale('zh-TW'));await page.evaluate(()=>reviewTest.setup())
   await page.locator('[data-stale-review-open]').click()
   assert.equal(await page.locator('#mapping').isVisible(),true);assert.equal(await page.locator('#history-detail').isVisible(),true)
   assert.equal(await page.evaluate(()=>document.activeElement.dataset.issueTarget),'conflict:content')
   await page.evaluate(()=>{testSaveHold=true;window.savePromise=reviewTest.saveDecision()})
   await page.waitForFunction(()=>Boolean(testSaveRelease))
   assert.equal(await page.evaluate(()=>reviewTest.state().pending),1);assert.equal(await page.locator('#apply').isDisabled(),true);assert.equal(await page.locator('#repreview').isDisabled(),true)
   if(width<768)await page.locator('#history-back').click()
   assert.match(await page.locator('#history-items').innerText(),/正在保存核對決定/)
   await page.evaluate(()=>edulogUi.setLocale('en'));assert.match(await page.locator('#history-items').innerText(),/Saving review decisions/)
   assert.doesNotMatch(await page.locator('#history-items').innerText(),/work\./)
   await page.evaluate(()=>{reviewTest.edit();testSaveRelease()});assert.equal(await page.evaluate(()=>savePromise),false)
   assert.equal(await page.evaluate(()=>reviewTest.state().saving),false);assert.equal(await page.evaluate(()=>reviewTest.state().pending),1)
   assert.equal(await page.evaluate(async()=>{const stored=await reviewTest.stored();return stored.staleReviewPending.length}),1)
   assert.equal(await page.evaluate(()=>reviewTest.saveDecision()),true)
   assert.equal(await page.evaluate(()=>reviewTest.state().pending),0);assert.equal(await page.evaluate(()=>reviewTest.state().saving),false)
   assert.equal(await page.evaluate(async()=>{const stored=await reviewTest.stored();return stored.staleReviewPending.length}),0)
   await page.evaluate(()=>reviewTest.setup())
   await page.evaluate(()=>edulogUi.setLocale('zh-TW'));await page.evaluate(()=>reviewTest.blockers())
   assert.match(await page.locator('[data-review-blockers]').innerText(),/合成學生/);assert.match(await page.locator('[data-review-blockers]').innerText(),/2026-10-04/)
   await page.locator('[data-review-blocker-open]').click();assert.equal(await page.locator('#history-detail').isVisible(),true);assert.equal(await page.evaluate(()=>document.activeElement.dataset.issueTarget),'conflict:content')
   await page.evaluate(()=>reviewTest.update())
   assert.match(await page.locator('#operation-title').innerText(),/仍有報告需要核對/,await page.locator('#diagnostics').textContent())
   assert.equal(await page.locator('[data-review-blockers]').isVisible(),true);assert.equal(await page.locator('#apply').isDisabled(),true)
   assert.equal(await page.locator('#notice').innerText(),'');assert.doesNotMatch(await page.locator('#operation-detail').innerText(),/重試核對/)
   const writes=await page.evaluate(()=>testRequests.filter(request=>request.type==='workspace-api'&&['apply','history-bind-apply','job'].includes(request.operation)))
   assert.deepEqual(writes,[]);assert.deepEqual(await page.evaluate(()=>testFailures),[]);assert.deepEqual(errors,[])
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   await page.screenshot({path:fileURLToPath(new URL(`${name}-${width}-${height}.png`,out))})
   results.push({browser:name,width,height,passed:true,teachingWrites:0});console.log(`PASS ${name} ${width}x${height}: original workspace module, durable save race, localized saving, actionable blockers, exact navigation, zero teaching writes`);await page.close()
  }}finally{await browser.close()}
 }
 writeFileSync(new URL('results.json',out),JSON.stringify(results,null,2))
}finally{await new Promise(resolve=>server.close(resolve))}
