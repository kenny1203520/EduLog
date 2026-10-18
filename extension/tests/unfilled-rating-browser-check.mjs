import { loadPlaywright, browserTargets } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {fileURLToPath,pathToFileURL} from 'node:url'

const { chromium } = await loadPlaywright(process.argv.slice(2).find(arg => !arg.startsWith('--')))
const extensionRoot=new URL('../',import.meta.url)
// One overdue row with a phone number, as the provider shows it, next to the two plain rows.
const fixture=readFileSync(new URL('fixtures/unfilled-current.html',import.meta.url),'utf8').replace('<tbody>','<tbody><tr><td><a href="/dt_admissions/303">學生丙</a><small>課程丙</small> 0912-345-678</td><td>週日第 1 時段 (10:00 ~ 12:00)</td><td>週日第 1 時段 (10:00 ~ 12:00)</td><td><a class="btn btn-danger" href="/courses/dt/101/lesson_reports?student_id=303">請儘速填寫</a></td></tr>')
const output=process.argv.slice(3).find(arg=>!arg.startsWith('--'))
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname
  if(path==='/admissions/unfilled_report'){res.setHeader('content-type','text/html;charset=utf-8');res.end(fixture);return}
  const file=path.slice(1)
  if(!/^[\w./-]+$/.test(file)){res.writeHead(404).end();return}
  try{res.setHeader('content-type',file.endsWith('.css')?'text/css':'text/javascript');res.end(readFileSync(new URL(file,extensionRoot)))}catch{res.writeHead(404).end()}
})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin=`http://127.0.0.1:${server.address().port}`
try{
  for(const [channel, launchOptions] of browserTargets()){
    const browser=await chromium.launch(launchOptions)
    try{
      for(const width of [360,390,768,1024,1200,1440,1920]){
        const page=await browser.newPage({viewport:{width,height:560},deviceScaleFactor:2}),errors=[]
        page.on('pageerror',error=>errors.push(error.message))
        await page.goto(`${origin}/admissions/unfilled_report`)
        await page.addStyleTag({path:fileURLToPath(new URL('styles/edulog-tokens.css',extensionRoot))})
        await page.addStyleTag({path:fileURLToPath(new URL('sites/orange-apple/orange-apple.css',extensionRoot))})
        await page.addStyleTag({content:`
          body{margin:0}.content{padding:16px}.rating{float:left}.rating input{position:absolute;left:-9999px}
          .rating label{float:right;position:static;width:24px;height:28px;color:#ddd}
          .rating label:before{content:'★'}.rating label.half:before{content:'★';position:absolute;top:100%;left:0}
          .form-section{padding:12px}.col-md-6{width:50%}
        `})
        for(const file of ['lexicon','model'])await page.addScriptTag({path:fileURLToPath(new URL(`sites/orange-apple/orange-apple-${file}.js`,extensionRoot))})
        await page.addScriptTag({path:fileURLToPath(new URL('sites/orange-apple/orange-apple-workflows.js',extensionRoot))})
        await page.addScriptTag({path:fileURLToPath(new URL('sites/orange-apple/orange-apple.js',extensionRoot))})
        await page.evaluate(()=>{
          document.documentElement.dataset.edulogUi='on'
          const modal=document.createElement('div');modal.id='lesson-report-modal';modal.innerHTML='<div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h4 class="modal-title">測試報告</h4></div><div class="modal-body"><form><div class="row"><div class="col-md-6"><fieldset class="rating"></fieldset></div><div class="col-md-6"><fieldset class="rating"></fieldset></div></div><textarea id="lesson_report_feedback"></textarea><input type="submit" value="更新"></form></div></div></div>';document.body.append(modal)
          for(const [index,group] of [...modal.querySelectorAll('.rating')].entries())for(let score=1;score<=10;score++){const radio=document.createElement('input');radio.type='radio';radio.name=`admission_lesson_report[${index?'order_rating':'participation_rating'}]`;radio.value=String(score);const label=document.createElement('label');if(score%2)label.className='half';label.setAttribute('for',`rating-${index}-${score}`);radio.id=`rating-${group}-${score}`;group.append(radio,label)}
          window.pageEnhancement=edulogSiteAdapter.enhancePage(document)
          window.dialogEnhancement=edulogSiteAdapter.enhanceDialog(document,{})
        })
        const viewport=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,fills:[...document.querySelectorAll('[data-edulog-unfilled-fill]')].map(n=>n.getBoundingClientRect().height),heads:[...document.querySelectorAll('.edulog-unfilled-head')].map(n=>n.textContent)}))
        assert.ok(viewport.scroll<=viewport.width+1,`${channel} ${width}: no page-level horizontal overflow (${viewport.scroll}/${viewport.width})`)
        assert.equal(await page.locator('[data-edulog-unfilled-card]').count(),3)
        assert.equal(await page.locator('table[data-edulog-unfilled-current]').isVisible(),false,'native table hidden behind the grouped list')
        assert.equal(await page.locator('.edulog-unfilled-row').count(),3)
        assert.match(viewport.heads[0],/逾期未填/,'overdue group first')
        assert.equal(await page.locator('.edulog-unfilled-row').first().evaluate(row=>getComputedStyle(row,'::before').backgroundColor),'rgb(185, 28, 28)','overdue rows carry the red bar')
        assert.ok((await page.locator('[data-edulog-unfilled-action]').first().evaluate(el=>el.isConnected)),'original record link remains connected')
        assert.equal(await page.locator('.edulog-unfilled-list').evaluate(el=>el.textContent.includes('0912-345-678')),false,'phone hidden until clicked')
        if(width<=767)assert.ok(viewport.fills.every(height=>height>=44))
        else assert.ok(viewport.fills.every(height=>height>=36))
        if(output&&[390,1440].includes(width))await page.locator('.edulog-unfilled-list').screenshot({path:`${output}/${channel}-unfilled-${width}.png`})
        await page.locator('button.edulog-phone').first().click()
        assert.equal(await page.locator('a.edulog-phone').first().getAttribute('href'),'tel:0912345678')
        for(const rating of await page.locator('[data-edulog-rating-stars]').all()){
          const box=await rating.boundingBox(),halves=await rating.locator('[data-edulog-rating-half]').all()
          assert.ok(box&&box.height>=30,`${channel} ${width}: rating has a containing block`)
          for(const half of halves){const hb=await half.boundingBox();assert.ok(hb.y>=box.y-1&&hb.y+hb.height<=box.y+box.height+1,`${channel} ${width}: half star stays inside rating`)}
        }
        const select=page.locator('.edulog-rating-control select').first(),selectBox=await select.boundingBox(),ratingBox=await page.locator('[data-edulog-rating-stars]').first().boundingBox()
        assert.ok(selectBox.y>=ratingBox.y+ratingBox.height-1,`${channel} ${width}: numeric score does not overlap stars`)
        await page.locator('.edulog-table-tools input[type=search]').fill('學生乙')
        assert.equal(await page.locator('.edulog-unfilled-row').count(),1)
        await page.locator('.edulog-table-tools input[type=search]').fill('')
        const field=page.locator('#lesson_report_feedback');await field.focus();await page.keyboard.press('Tab')
        assert.deepEqual(errors,[])
        console.log(`PASS ${channel} ${width} @2x: grouped unfilled list, native actions, contained half stars, responsive layout`)
        await page.close()
      }
    }finally{await browser.close()}
  }
}finally{await new Promise(resolve=>server.close(resolve))}
