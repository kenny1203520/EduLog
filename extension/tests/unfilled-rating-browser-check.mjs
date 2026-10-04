import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createServer} from 'node:http'
import {fileURLToPath,pathToFileURL} from 'node:url'

const {chromium}=await import(process.argv[2]?pathToFileURL(process.argv[2]).href:'playwright')
const extensionRoot=new URL('../',import.meta.url)
const fixture=readFileSync(new URL('fixtures/unfilled-current.html',import.meta.url),'utf8')
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
  for(const channel of ['chrome','msedge']){
    const browser=await chromium.launch({channel,headless:true})
    try{
      for(const width of [360,390,768,1024,1200,1440,1920]){
        const page=await browser.newPage({viewport:{width,height:560},deviceScaleFactor:2}),errors=[]
        page.on('pageerror',error=>errors.push(error.message))
        await page.goto(`${origin}/admissions/unfilled_report`)
        await page.addStyleTag({path:fileURLToPath(new URL('adapters/orange-apple.css',extensionRoot))})
        await page.addStyleTag({content:`
          body{margin:0}.content{padding:16px}.rating{float:left}.rating input{position:absolute;left:-9999px}
          .rating label{float:right;position:static;width:24px;height:28px;color:#ddd}
          .rating label:before{content:'★'}.rating label.half:before{content:'★';position:absolute;top:100%;left:0}
          .form-section{padding:12px}.col-md-6{width:50%}
        `})
        await page.addScriptTag({path:fileURLToPath(new URL('adapters/orange-apple-workflows.js',extensionRoot))})
        await page.addScriptTag({path:fileURLToPath(new URL('adapters/orange-apple.js',extensionRoot))})
        await page.evaluate(()=>{
          document.documentElement.dataset.edulogUi='on'
          const modal=document.createElement('div');modal.id='lesson-report-modal';modal.innerHTML='<div class="modal-dialog"><div class="modal-content"><div class="modal-header"><h4 class="modal-title">測試報告</h4></div><div class="modal-body"><form><div class="row"><div class="col-md-6"><fieldset class="rating"></fieldset></div><div class="col-md-6"><fieldset class="rating"></fieldset></div></div><textarea id="lesson_report_feedback"></textarea><input type="submit" value="更新"></form></div></div></div>';document.body.append(modal)
          for(const [group,name] of [...modal.querySelectorAll('.rating')].entries())for(let score=1;score<=10;score++){const radio=document.createElement('input');radio.type='radio';radio.name=`admission_lesson_report[${group?'order_rating':'participation_rating'}]`;radio.value=String(score);const label=document.createElement('label');if(score%2)label.className='half';label.setAttribute('for',`rating-${group}-${score}`);radio.id=`rating-${group}-${score}`;group.append(radio,label)}
          window.pageEnhancement=edulogSiteAdapter.enhancePage(document)
          window.dialogEnhancement=edulogSiteAdapter.enhanceDialog(document,{})
        })
        const viewport=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('[data-edulog-unfilled-card]')].map(row=>getComputedStyle(row).display),actions:[...document.querySelectorAll('[data-edulog-unfilled-action]')].map(n=>n.getBoundingClientRect().height)}))
        assert.ok(viewport.scroll<=viewport.width+1,`${channel} ${width}: no page-level horizontal overflow (${viewport.scroll}/${viewport.width})`)
        assert.equal(await page.locator('[data-edulog-unfilled-card]').count(),2)
        assert.ok((await page.locator('[data-edulog-unfilled-action]').first().evaluate(el=>el.isConnected)),'original record link remains connected')
        if(width<=767){assert.ok(viewport.cards.every(display=>display==='grid'));assert.ok(viewport.actions.every(height=>height>=44))}
        else assert.ok(viewport.cards.every(display=>display==='table-row'))
        for(const rating of await page.locator('[data-edulog-rating-stars]').all()){
          const box=await rating.boundingBox(),halves=await rating.locator('[data-edulog-rating-half]').all()
          assert.ok(box&&box.height>=30,`${channel} ${width}: rating has a containing block`)
          for(const half of halves){const hb=await half.boundingBox();assert.ok(hb.y>=box.y-1&&hb.bottom<=box.y+box.height+1,`${channel} ${width}: half star stays inside rating`)}
        }
        const select=page.locator('.edulog-rating-control select').first(),selectBox=await select.boundingBox(),ratingBox=await page.locator('[data-edulog-rating-stars]').first().boundingBox()
        assert.ok(selectBox.y>=ratingBox.y+ratingBox.height-1,`${channel} ${width}: numeric score does not overlap stars`)
        await page.locator('.edulog-table-tools input[type=search]').fill('學生乙')
        assert.equal(await page.locator('[data-edulog-unfilled-card]:visible').count(),1)
        await page.locator('.edulog-table-tools input[type=search]').fill('')
        const field=page.locator('#lesson_report_feedback');await field.focus();await page.keyboard.press('Tab')
        assert.deepEqual(errors,[])
        console.log(`PASS ${channel} ${width} @2x: unfilled list, native actions, contained half stars, responsive layout`)
        await page.close()
      }
    }finally{await browser.close()}
  }
}finally{await new Promise(resolve=>server.close(resolve))}
