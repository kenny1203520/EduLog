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
     const work={id:'synthetic'},items=Array.from({length:70},(_,i)=>({key:String(301+i),category:'needs',reason:'需要確認來源課程；報名關係不變。',target:{id:'enrollment',name:`測試學生 ${i+1}`,courseName:'長課程名稱 · 程式設計與教學紀錄核對'},record:{enrollment_source_id:String(301+i),date:'2026-10-04',sourceEvidence:[{sourcePath:'/dt_admissions/301',table:'歷史紀錄',row:1,fields:[{label:'評語',text:'允許的來源教學原文。'.repeat(30)}]}]}}))
     let view
     view=createHistoryWorkbench({work:()=>work,labels:{},changed:()=>{},recheck:()=>{items[0].category='history';view.render(items);view.refreshEditor()},fields:(host,item)=>{const label=document.createElement('label');label.textContent='人工核對草稿';const input=document.createElement('textarea');input.name='review-draft';input.value=item.record.draft||'';input.style.minHeight='110px';input.oninput=()=>{item.record.draft=input.value};label.append(input);host.append(label)}})
     window.historyTest={view,items,work};view.render(items)
    })
    await page.locator('#history-items button').first().click()
    await page.locator('#history-detail textarea').fill('保留核對草稿\n第二行')
    await page.locator('#history-detail summary').click()
    const last=page.getByRole('button',{name:'略過此份紀錄',exact:true});await last.focus();await last.scrollIntoViewIfNeeded()
    assert.equal(await last.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}),true,`${name} ${width}x${height}: last control reachable`)
    assert.equal(await last.evaluate(el=>el.getBoundingClientRect().height>=44),true)
    await page.locator('#history-detail').getByRole('button',{name:'重新核對此份紀錄',exact:true}).focus()
    const before=await page.evaluate(()=>({page:scrollY,pane:document.getElementById('history-editor').scrollTop}))
    await page.keyboard.press('Enter')
    assert.equal(await page.locator('#history-detail textarea').inputValue(),'保留核對草稿\n第二行')
    assert.equal(await page.locator('#history-items button').first().isVisible(),width>=768)
    const after=await page.evaluate(()=>({page:scrollY,pane:document.getElementById('history-editor').scrollTop,focus:document.activeElement.textContent}))
    assert.equal(after.page,before.page);assert.equal(after.pane,before.pane);assert.equal(after.focus,'重新核對此份紀錄')
    if(width<768){await page.locator('#history-back').click();assert.equal(await page.locator('#history-items button').first().isVisible(),true)}
    await page.locator('#history-search').fill('不存在的學生');assert.equal(await page.locator('#history-empty').isVisible(),true)
    await page.locator('#history-search').fill('');await page.locator('#history-filter').selectOption('all')
    assert.equal(await page.locator('#history-items button').count(),70)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} ${width}: horizontal overflow`)
    assert.deepEqual(errors,[])
    if(width===390||width===1440&&height===480)await page.screenshot({path:new URL(`${name}-${width}-${height}.png`,output).pathname.replace(/^\//,'')})
    console.log(`PASS ${name} ${width}x${height}: history search, pinned completion, draft/focus/scroll, raw evidence, last control and no overflow`)
    await page.close()
   }
  }finally{await browser.close()}
 }
}finally{await new Promise(resolve=>server.close(resolve))}
