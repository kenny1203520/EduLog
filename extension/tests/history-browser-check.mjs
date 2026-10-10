// Installed-browser checks against the actual workbench DOM/CSS. Synthetic data only.
import {createServer} from 'node:http'
import {readFileSync,mkdirSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const playwrightPath=process.argv[2]||'C:/Users/kenny/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
const {chromium}=await import(pathToFileURL(playwrightPath).href)
const root=new URL('../',import.meta.url),output=new URL('artifacts/history/',import.meta.url);mkdirSync(output,{recursive:true})
const server=createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(1);if(!/^[a-z0-9.-]+$/.test(name)){res.writeHead(404).end();return}try{let content=readFileSync(new URL(name,root),'utf8');if(name==='workspace.html')content=content.replace(/<script[\s\S]*?<\/script>/g,'');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(content)}catch{res.writeHead(404).end()}})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
try{
 for(const [name,path] of [['chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]) {
  const browser=await chromium.launch({executablePath:path,headless:true})
  try{
   for(const [width,height] of [[360,900],[390,900],[768,900],[1024,900],[1200,900],[1440,900],[1920,900],[1440,480]]) {
    const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/workspace.html`)
    await page.evaluate(async()=>{
     const {createHistoryWorkbench}=await import('/history-workbench.js')
     document.getElementById('workspace').hidden=false;document.getElementById('import-view').hidden=false;document.getElementById('mapping').hidden=false;document.getElementById('import-scope').hidden=true;document.getElementById('identity-review').open=false
     const work={id:'synthetic'},items=Array.from({length:70},(_,i)=>({key:String(301+i),category:'needs',reason:'需要確認來源課程；報名關係不變。',target:{id:'enrollment',name:`測試學生 ${i+1}`,courseName:'長課程名稱 · 程式設計與教學紀錄核對'},record:{enrollment_source_id:String(301+i),date:'2026-10-04',...(i===1?{skipDecision:{status:'review'}}:{}),sourceEvidence:[{sourcePath:'/dt_admissions/301',table:'歷史紀錄',row:1,fields:[{label:'評語',text:'允許的來源教學原文。'.repeat(30)}]}]}}))
     let view
     view=createHistoryWorkbench({work:()=>work,labels:{},changed:()=>{},recheck:()=>{items[0].category='history';view.render(items);view.refreshEditor()},fields:(host,item)=>{const label=document.createElement('label');label.textContent='人工核對草稿';const input=document.createElement('textarea');input.name='review-draft';input.value=item.record.draft||'';input.style.minHeight='110px';input.oninput=()=>{item.record.draft=input.value};label.append(input);host.append(label)}})
     window.historyTest={view,items,work};view.render(items)
    })
    const layout=await page.evaluate(()=>({searchVisible:document.querySelector('label[for="history-search"]').getBoundingClientRect().width>0,regular:(()=>{const entry=document.querySelector('.history-report-entry[data-selectable="false"]'),button=entry?.querySelector('.mapping-list-item');return entry&&button?{entry:entry.getBoundingClientRect().width,button:button.getBoundingClientRect().width}:null})(),selectable:(()=>{const entry=document.querySelector('.history-report-entry[data-selectable="true"]'),button=entry?.querySelector('.mapping-list-item'),target=entry?.querySelector('.history-skip-toggle');return entry&&button&&target?{entry:entry.getBoundingClientRect().width,button:button.getBoundingClientRect().width,target:target.getBoundingClientRect().width,height:target.getBoundingClientRect().height}:null})()}))
    assert.equal(layout.searchVisible,true,`${name} ${width}: history search remains visible`)
    assert.ok(layout.regular&&layout.regular.button>=layout.regular.entry*.8,`${name} ${width}: regular report uses full row`)
    assert.ok(layout.selectable&&layout.selectable.button>=layout.selectable.entry*.7,`${name} ${width}: selectable report button keeps a readable column`)
    assert.ok(layout.selectable.target>=44&&layout.selectable.height>=44,`${name} ${width}: batch checkbox has a 44px target`)
    if(width>=768){
     const aside=page.locator('#history-workbench aside')
     await aside.evaluate(el=>el.focus({preventScroll:true}))
     const beforeKeys=await page.evaluate(()=>({page:scrollY,editor:document.getElementById('history-editor').scrollTop,list:document.querySelector('#history-workbench aside').scrollTop}))
     await page.keyboard.press('PageDown')
     const afterKeys=await page.evaluate(()=>({page:scrollY,editor:document.getElementById('history-editor').scrollTop,list:document.querySelector('#history-workbench aside').scrollTop,max:document.querySelector('#history-workbench aside').scrollHeight-document.querySelector('#history-workbench aside').clientHeight,overflow:getComputedStyle(document.querySelector('#history-workbench aside')).overflowY}))
     assert.equal(afterKeys.overflow,'auto',`${name} ${width}: left report pane is the desktop scroll region`)
     assert.ok(afterKeys.list>beforeKeys.list,`${name} ${width}: PageDown scrolls the left report pane ${JSON.stringify({beforeKeys,afterKeys})}`)
     assert.equal(afterKeys.page,beforeKeys.page,`${name} ${width}: page position stays fixed while scrolling the list`)
     assert.equal(afterKeys.editor,beforeKeys.editor,`${name} ${width}: editor position stays fixed while scrolling the list`)
     await page.keyboard.press('End')
     const atEnd=await aside.evaluate(el=>({scrollTop:el.scrollTop,max:el.scrollHeight-el.clientHeight,last:el.querySelector('#history-items button:last-of-type')?.getBoundingClientRect().bottom,edge:el.getBoundingClientRect().bottom}))
     assert.ok(atEnd.scrollTop>0&&atEnd.scrollTop>=atEnd.max-2,`${name} ${width}: End reaches the end of the student list`)
     assert.ok(atEnd.last<=atEnd.edge,`${name} ${width}: last student can be brought into view`)
     await aside.evaluate(el=>el.scrollIntoView({block:'center'}));await aside.evaluate(el=>el.scrollTop=el.scrollHeight)
     const beforeWheel=await page.evaluate(()=>({page:scrollY,editor:document.getElementById('history-editor').scrollTop,list:document.querySelector('#history-workbench aside').scrollTop}))
     const box=await aside.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-500)
     const afterWheel=await page.evaluate(()=>({page:scrollY,editor:document.getElementById('history-editor').scrollTop,list:document.querySelector('#history-workbench aside').scrollTop}))
     assert.ok(afterWheel.list<beforeWheel.list,`${name} ${width}: mouse wheel scrolls the left report pane ${JSON.stringify({beforeWheel,afterWheel,box})}`)
     assert.equal(afterWheel.page,beforeWheel.page);assert.equal(afterWheel.editor,beforeWheel.editor)
     await aside.evaluate(el=>el.scrollTop=0)
    }else{
     const aside=page.locator('#history-workbench aside');await aside.evaluate(el=>el.scrollIntoView({block:'start'}));await aside.evaluate(el=>{el.focus({preventScroll:true});el.addEventListener('keydown',event=>{window.mobileKeyWasPrevented=event.defaultPrevented})})
     await page.keyboard.press('PageDown');assert.equal(await page.evaluate(()=>window.mobileKeyWasPrevented),false,`${name} ${width}: mobile PageDown remains available to page scrolling`)
     const pageBefore=await page.evaluate(()=>scrollY),box=await aside.boundingBox(),height=page.viewportSize().height;await page.mouse.move(box.x+box.width/2,box.y+Math.min(box.height/2,height-8));await page.mouse.wheel(0,400);const pageAfter=await page.evaluate(()=>scrollY)
     assert.ok(pageAfter>pageBefore,`${name} ${width}: mouse wheel scrolls the mobile page`)
     await page.evaluate(()=>scrollTo(0,0))
    }
    await page.locator('#history-items button').first().click()
    await page.locator('#history-detail textarea').fill('保留核對草稿\n第二行')
    await page.locator('#history-detail summary').click()
    const last=page.getByRole('button',{name:'略過此份紀錄',exact:true});await last.focus();await last.scrollIntoViewIfNeeded()
    assert.equal(await last.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true,`${name} ${width}x${height}: last control reachable`)
    assert.equal(await last.evaluate(el=>el.getBoundingClientRect().height>=44),true)
    await page.locator('#history-detail').getByRole('button',{name:'重新核對此份紀錄',exact:true}).focus()
    if(width>=768)await page.locator('#history-workbench aside').evaluate(el=>el.scrollTop=180)
    const before=await page.evaluate(()=>({page:scrollY,pane:document.getElementById('history-editor').scrollTop,list:document.querySelector('#history-workbench aside').scrollTop}))
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('#history-detail textarea').inputValue(),'保留核對草稿\n第二行')
    assert.equal(await page.locator('#history-items button').first().isVisible(),width>=768)
    const after=await page.evaluate(()=>({page:scrollY,pane:document.getElementById('history-editor').scrollTop,list:document.querySelector('#history-workbench aside').scrollTop,focus:document.activeElement.textContent}))
    assert.equal(after.page,before.page);assert.equal(after.pane,before.pane);assert.equal(after.list,before.list);assert.equal(after.focus,'重新核對此份紀錄')
    if(width<768){await page.locator('#history-back').click();assert.equal(await page.locator('#history-items button').first().isVisible(),true)}
    await page.locator('#history-search').fill('不存在的學生');assert.equal(await page.locator('#history-empty').isVisible(),true)
    await page.locator('#history-search').fill('');await page.locator('#history-filter').selectOption('all')
    assert.equal(await page.locator('#history-items button').count(),70)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} ${width}: horizontal overflow`)
    assert.deepEqual(errors,[])
    if(width===390||width===1440&&height===480)await page.screenshot({path:new URL(`${name}-${width}-${height}.png`,output).pathname.replace(/^\//,'')})
    console.log(`PASS ${name} ${width}x${height}: left-list wheel/keyboard scroll, scroll restore, history search, draft/focus and no overflow`)
    await page.close()
   }
  }finally{await browser.close()}
 }
}finally{await new Promise(resolve=>server.close(resolve))}
