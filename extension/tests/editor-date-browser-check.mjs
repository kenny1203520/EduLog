import { loadPlaywright, browserTargets, fileURLToPath } from './browser-runtime.mjs'
// Actual native DOM + injected scripts, isolated mock broker; never contacts the source site.
import {readFileSync,mkdirSync} from 'node:fs'
import {createServer} from 'node:http'
import assert from 'node:assert/strict'
const { chromium } = await loadPlaywright(process.argv.slice(2).find(arg => !arg.startsWith('--')))
const root=new URL('../',import.meta.url),output=new URL('artifacts/editor-date/',import.meta.url);mkdirSync(output,{recursive:true})
const fixture=readFileSync(new URL('fixtures/report-modal.html',import.meta.url),'utf8')
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname
 if(path==='/fixture'){res.setHeader('content-type','text/html;charset=utf-8');res.end(`<!doctype html><html lang="zh-Hant" data-edulog-ui="on"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles/edulog-tokens.css"><link rel="stylesheet" href="/sites/orange-apple/orange-apple.css"><link rel="stylesheet" href="/content/dialog-layout.css"><link rel="stylesheet" href="/content/editor-prefill.css"><style>body{margin:0}.modal{position:fixed;inset:0;overflow:auto}.modal-dialog{margin:auto}.modal-content{background:white;border:1px solid #ccc}.modal-header{padding:16px;display:flex;justify-content:space-between}.modal-body{padding:16px}.modal-title{margin:0}.row{display:flex;flex-wrap:wrap;gap:12px}.form-group{margin:12px 0}textarea{width:100%;min-height:110px}form{min-width:0}select{max-width:100%}</style></head><body><table id="reports"><tr><th>學生</th><th>課程</th><th>本週(10/04)</th></tr><tr><td>學生甲</td><td>課程甲</td><td><a href="https://corp.orangeapple.co/dt_admissions/301/reports/401/edit">記錄</a></td></tr></table>${fixture}</body></html>`);return}
 if(!/^\/(?:[\w-]+\/)*[\w.-]+$/.test(path)){res.writeHead(404).end();return}
 try{res.setHeader('content-type',path.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync(new URL(path.slice(1),root)))}catch{res.writeHead(404).end()}
})
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/fixture`
try{
 for(const [channel, launchOptions] of browserTargets()){
  const browser=await chromium.launch(launchOptions)
  try{
   for(const width of [360,390,768,1024,1200,1440,1920]){
    const page=await browser.newPage({locale:'zh-TW',viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.goto(url);await page.addStyleTag({content:'.modal{z-index:1050}'});await page.addScriptTag({url:new URL('/shared/source-date.js',url).href});await page.addScriptTag({url:new URL('/shared/field-mappings.js',url).href});await page.addScriptTag({url:new URL('/shared/field-mapping-ui.js',url).href});await page.addScriptTag({url:new URL('/sites/orange-apple/orange-apple-integration.js',url).href})
    await page.evaluate(()=>{
     const a=document.querySelector('#reports a');a.addEventListener('click',e=>e.preventDefault());a.click()
     window.originalForm=document.querySelector('form');window.originalForm.sentinel='native';window.submitCount=0;window.editorCalls=[];window.editorDelayed=[];window.delayDetails=false
     const body=originalForm.parentElement,wrapper=document.createElement('div'),inner=document.createElement('div');wrapper.className='report-body';body.append(wrapper);wrapper.append(inner);inner.append(originalForm)
     originalForm.addEventListener('submit',e=>{e.preventDefault();submitCount++})
     const completion=document.querySelector('#dt_admission_lesson_report_completion_status');completion.append(new Option('未完成','not_done'),new Option('未填值',''));completion.value=''
     const student='00000000-0000-4000-8000-000000000001',enrollment='00000000-0000-4000-8000-000000000002',course='00000000-0000-4000-8000-000000000003'
     const make=(n,date)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,version:4,student_id:student,student_name:'學生甲',enrollment_id:enrollment,course_id:course,course_name:'同一課程',class_name:'週日班級',lesson_name:'測試課程 Lesson 1',occurrence_date:date,is_completed:false,attendance_status:'present',content:'<p>第一段</p><p>第二段</p>',class_notes:'內部內容',completeness:{isMissing:false},date_difference:date==='2026-10-03'?-1:1,external_link:'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit'})
     window.reports=[make(11,'2026-10-03'),make(12,'2026-10-05')]
     reports.forEach(r=>{r.course_name+=' · '+ 'LongCourseName'.repeat(8);r.class_name+=' · 長名稱測試班級'.repeat(4)})
     window.edulogRuntime={send:async m=>{
      editorCalls.push(m);if(m.type==='get-edulog-integration-status')return{status:'connected',capabilities:{report_prefill:true}};if(m.type==='open-integration-workspace')return{data:{opened:true}}
      const form=await edulogSourceIntegration.readForm(document)
      if(m.operation==='lookup')return{data:{connected:true,form,target:{studentId:student,enrollmentId:enrollment,courseId:course,studentName:'學生甲',courseName:'同一課程',className:'週日班級'},reports:[],settingsUrl:'https://web.example:8443/edulog/dashboard/settings?tab=integrations',capabilities:{nearest_report_candidates:true}}}
      if(m.operation==='supplement')return{data:{form:await edulogSourceIntegration.supplementForm(document,{...m.input,formId:m.formId,fingerprint:m.fingerprint})}}
      if(m.operation==='candidates')return{data:{reports:m.query.group==='other-course'?[]:reports,next_cursor:null}}
      if(m.operation==='detail'){if(delayDetails)await new Promise(r=>editorDelayed.push(r));return{data:reports.find(r=>r.id===m.reportId)}}
      if(m.operation==='apply'){const result=await edulogSourceIntegration.applyForm(document,{formId:form.formId,reportId:form.reportId,fingerprint:m.fingerprint,fields:m.input.fields});return{data:{...result,recordSaved:true}}}
      return{data:{reports:[],items:[],next_cursor:null}}
     }}
    })
    await page.addScriptTag({url:new URL('/shared/ui-core.js',url).href});await page.addScriptTag({url:new URL('/shared/ui-messages.js',url).href});await page.addScriptTag({url:new URL('/content/editor-prefill.js',url).href})
    const helper=page.locator('aside[data-edulog-owned]'),shadow=selector=>helper.locator(selector)
    if(width<1200){await page.locator('.edulog-editor-native').waitFor({state:'visible'});await page.locator('button[data-view=assistant]').click()}
    const openGroups=()=>helper.evaluate(n=>n.shadowRoot.querySelectorAll('.field-group').forEach(d=>d.open=true))
    await shadow('.question input[type=date]').waitFor({state:'visible'})
    await shadow('.choice').first().waitFor({state:'visible'})
    assert.equal(await shadow('.target').textContent().then(t=>t.includes('日期待確認')),true)
    await shadow('.choice').first().click();await shadow('[data-key=content]').waitFor({state:'attached'});await openGroups();await shadow('[data-key=content]').waitFor({state:'visible'})
    assert.equal(await shadow('.fields-result .primary').isDisabled(),true,'date answer gates apply but not preview')
    if(!await shadow('.question input[type=date]').isVisible())await shadow('.questions summary').first().click();await shadow('.question input[type=date]').fill('2026-10-04');await shadow('.question .primary').click()
    await page.waitForFunction(()=>document.querySelector('aside').shadowRoot.querySelector('.target').textContent.includes('2026-10-04'))
    await openGroups()
    await shadow('[data-key=content]').waitFor({state:'visible'})
    assert.equal(await shadow('[data-key=is_completed]').inputValue(),'not_done','false must not match completed option')
    assert.equal(await shadow('[data-key=content]').inputValue(),'第一段\n第二段')
    const reportLink=await shadow('a').filter({hasText:'查看 EduLog 報名'}).getAttribute('href');assert.ok(reportLink.startsWith('https://web.example:8443/edulog/dashboard/reports/'))
    const geom=await page.evaluate(()=>{const n=document.querySelector('.edulog-editor-native'),a=document.querySelector('aside'),d=document.querySelector('.modal-dialog'),r=x=>({x:x.getBoundingClientRect().x,y:x.getBoundingClientRect().y,width:x.getBoundingClientRect().width,right:x.getBoundingClientRect().right});return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,n:r(n),a:r(a),d:r(d),header:document.querySelector('.modal-header').getBoundingClientRect().bottom}})
    assert.equal(geom.overflow,false,`${channel} ${width}: page overflow`);assert.ok(geom.d.right<=width+1)
    if(width>=1200){assert.ok(geom.n.width>geom.a.width);assert.ok(geom.a.x>=geom.n.right-1)}else{assert.equal(await page.locator('.edulog-editor-native').isVisible(),false)}
    assert.equal(await helper.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,'long names must wrap inside the assistant')
    const bounds=await helper.evaluate(n=>{const r=n.getBoundingClientRect();return{bottom:r.bottom,height:r.height,viewport:innerHeight,scroll:n.scrollHeight,client:n.clientHeight}})
    assert.ok(bounds.bottom<=bounds.viewport&&bounds.height>300&&bounds.scroll>bounds.client,`nested source wrappers must preserve a bounded scrollable pane: ${JSON.stringify(bounds)}`)
    const close=page.locator('.modal-header button');await close.focus();await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(()=>{const b=document.querySelector('.modal-header button'),r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b}),true,'native close remains visible and unobstructed')
    // RWD switches retain actual native nodes and separate scroll positions.
    await shadow('[data-key=content]').fill('助手草稿\n保留段落');await shadow('[data-key=content]').evaluate(n=>n.focus())
    const beforeScroll=await helper.evaluate(n=>{n.scrollTop=120;return n.scrollTop})
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    await page.setViewportSize({width:width>=1200?390:1440,height:900})
    if(width>=1200)await page.locator('button[data-view=assistant]').click()
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    assert.equal(await page.evaluate(()=>originalForm===document.querySelector('form')&&originalForm.sentinel==='native'),true)
    assert.equal(await shadow('[data-key=content]').inputValue(),'助手草稿\n保留段落')
    assert.ok(Math.abs(await helper.evaluate(n=>n.scrollTop)-beforeScroll)<=1,JSON.stringify({beforeScroll,after:await helper.evaluate(n=>({scroll:n.scrollTop,height:n.offsetHeight,view:n.parentElement.dataset.view,focused:n.shadowRoot.activeElement?.dataset.key}))}))
    await page.setViewportSize({width,height:900})
    // Recheck retains selected report, draft text, focus/caret and both scroll regions.
    await shadow('[data-key=content]').evaluate(n=>{n.focus();n.setSelectionRange(2,4)})
    const recheck=await helper.evaluate(n=>{const active=n.shadowRoot.activeElement;return{scroll:n.scrollTop,start:active.selectionStart,end:active.selectionEnd}})
    await helper.evaluate(n=>n.shadowRoot.querySelector('.refresh').click())
    await page.waitForFunction(()=>document.querySelector('aside').shadowRoot.querySelector('[data-key=content]')?.value==='助手草稿\n保留段落'&&document.querySelector('aside').shadowRoot.activeElement?.dataset.key==='content')
    // Scroll is restored after the refreshed fields render; wait for it before comparing.
    await page.waitForFunction(top=>document.querySelector('aside[data-edulog-owned]')?.scrollTop===top,recheck.scroll,{timeout:3000}).catch(()=>{})
    const restored=await helper.evaluate(n=>({scroll:n.scrollTop,start:n.shadowRoot.activeElement.selectionStart,end:n.shadowRoot.activeElement.selectionEnd}))
    assert.deepEqual(restored,recheck)
    await page.evaluate(()=>edulogUi.setLocale('en'))
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    assert.equal(await shadow('.refresh').textContent(),'Recheck')
    assert.equal(await shadow('[data-key=content]').inputValue(),'助手草稿\n保留段落')
    await page.waitForFunction(top=>document.querySelector('aside[data-edulog-owned]')?.scrollTop===top,recheck.scroll,{timeout:3000}).catch(()=>{})
    assert.deepEqual(await helper.evaluate(n=>({scroll:n.scrollTop,start:n.shadowRoot.activeElement.selectionStart,end:n.shadowRoot.activeElement.selectionEnd})),recheck)
    await page.evaluate(()=>edulogUi.setLocale('zh-TW'))
    await openGroups()
    if(width===390){
      await page.evaluate(()=>{delayDetails=true;const root=document.querySelector('aside').shadowRoot,buttons=[...root.querySelectorAll('.result .choice')];buttons[1].click();buttons[0].click()})
      await page.waitForFunction(()=>editorDelayed.length===2);await page.evaluate(()=>editorDelayed[1]());await shadow('[data-key=content]').waitFor({state:'attached'});await openGroups();await page.evaluate(()=>{editorDelayed[0]();delayDetails=false})
      await page.waitForFunction(()=>document.querySelector('aside').shadowRoot.querySelector('.fields-result .report').textContent.includes('2026-10-03'))
      assert.equal(await shadow('[data-key=content]').inputValue(),'助手草稿\n保留段落','late response cannot replace selected report or draft')
    }
    const content=shadow('[data-key=content]').locator('..').locator('..')
    await content.locator('[data-include]').check();await content.locator('[data-overwrite]').check();await shadow('[data-mismatch]').check()
    // Default internal consent remains off, even after selecting a report.
    assert.equal(await shadow('[data-internal]').isChecked(),false)
    const apply=shadow('.fields-result .primary');await apply.click()
    await page.waitForFunction(()=>document.querySelector('aside').shadowRoot.querySelector('[role=status]').textContent.includes('已套用'))
    assert.equal(await page.locator('#lesson_report_feedback').inputValue(),'助手草稿\n保留段落');assert.equal(await page.locator('#nothing').isChecked(),false);assert.equal(await page.evaluate(()=>submitCount),0)
    assert.equal(await page.locator('#lesson_report_comment').inputValue(),'')
    await shadow('.fields-result details summary').last().click();await page.screenshot({path:fileURLToPath(new URL(`${channel}-${width}.png`,output))})
    await helper.evaluate(n=>[...n.shadowRoot.querySelectorAll('header button')].find(b=>b.textContent==='收合助手').click())
    assert.equal(await page.locator('.modal[data-edulog-prefill]').count(),0)
    assert.equal(await page.evaluate(()=>originalForm===document.querySelector('form')),true)
    await helper.evaluate(n=>[...n.shadowRoot.querySelectorAll('header button')].find(b=>b.textContent==='展開 EduLog 助手').click())
    assert.equal(await shadow('[data-key=content]').inputValue(),'助手草稿\n保留段落','collapse cannot rebuild drafts')
    // Theme changes must never own or remove the assistant's structural layout.
    for(const theme of ['off','on']){
      await page.evaluate(value=>document.documentElement.dataset.edulogUi=value,theme)
      await page.setViewportSize({width,height:480});await openGroups()
      await helper.evaluate(n=>n.scrollTop=n.scrollHeight)
      const bottom=await helper.evaluate(n=>{const r=n.getBoundingClientRect();return{bottom:r.bottom,height:r.height,scroll:n.scrollHeight,client:n.clientHeight}})
      assert.ok(bottom.bottom<=481&&bottom.client>150&&bottom.scroll>bottom.client,`${theme}: short viewport remains scrollable ${JSON.stringify(bottom)}`)
      const native=page.locator('.edulog-editor-native');if(width<1200)await page.locator('button[data-view=native]').click()
      await native.evaluate(n=>n.scrollTop=n.scrollHeight)
      const submit=page.locator('input[type=submit]');await submit.scrollIntoViewIfNeeded();assert.equal(await submit.isVisible(),true)
      assert.equal(await page.evaluate(()=>originalForm===document.querySelector('form')),true)
      if(width<1200)await page.locator('button[data-view=assistant]').click()
    }
    await page.setViewportSize({width,height:900})
    // Native focus/keyboard operation remains inside the existing modal.
    await page.evaluate(()=>{document.dispatchEvent(new Event('turbo:before-cache'))})
    assert.equal(await page.evaluate(()=>originalForm===document.querySelector('form')&&document.querySelectorAll('.edulog-editor-layout,[data-edulog-prefill-container]').length===0&&Boolean(originalForm.closest('.report-body'))),true)
    assert.deepEqual(errors,[]);console.log(`PASS ${channel} ${width}: date question, template preview, 56/44 geometry, drafts, native apply and restore`);await page.close()
   }
  }finally{await browser.close()}
 }
}finally{await new Promise(r=>server.close(r))}
