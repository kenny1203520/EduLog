// Run against a temporary Vite server. All API traffic uses synthetic records.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { resolveScreenshotDirectory } from '../../scripts/extension/paths.mjs'
const { chromium } = await import('@playwright/test')
const output = resolveScreenshotDirectory(process.argv[3], 'connections')
mkdirSync(output,{recursive:true})
const record = { id:'11111111-1111-4111-8111-111111111111',installation_id:'22222222-2222-4222-8222-222222222222',device_name:'教室筆電 · Chrome',browser_name:'Chrome',platform_name:'Windows',extension_origin:'chrome-extension://'+'a'.repeat(32),created_at:'2026-10-01T00:00:00Z',last_used_at:'2026-10-01T01:00:00Z',expires_at:'2099-01-01T00:00:00Z',revoked_at:null}
for(const [name,executablePath] of [['chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]){
 const browser=await chromium.launch({headless:true,executablePath})
 try{
  for(const width of [360,768,1440]){
   // Vite PWA injects an inline development script; this isolated layout test
   // bypasses CSP without changing application headers.
   const page=await browser.newPage({viewport:{width,height:850},bypassCSP:true})
   const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error') errors.push(message.text())})
   await page.route('**/api/**',route=>new URL(route.request().url()).pathname.startsWith('/api/') ? route.fulfill({json:{data:[record,{...record,id:'33333333-3333-4333-8333-333333333333',device_name:null,installation_id:null,browser_name:null,platform_name:null}],meta:{}}}) : route.continue())
   await page.goto('http://localhost:5199/tests/fixtures/extension-connections.html')
   await page.getByText('有效連線（2）').waitFor({timeout:10000}).catch(async error=>{console.log(errors);console.log(await page.locator('body').innerText());throw error})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Connection list horizontal overflow')
   await page.getByRole('button',{name:'撤銷 教室筆電',exact:false}).click()
   const dialog=page.getByRole('dialog')
   assert.ok(await dialog.isVisible())
   const bounds=await dialog.boundingBox()
   assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'Dialog outside viewport')
   assert.ok(Math.abs(bounds.x+bounds.width/2-width/2)<2 && Math.abs(bounds.y+bounds.height/2-850/2)<2,'Dialog not centered')
   await page.keyboard.press('Tab')
   assert.ok(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),'Focus escaped dialog')
   await page.screenshot({path:join(output,`${name}-connections-${width}-revoke.png`),fullPage:true})
   await page.keyboard.press('Escape')
   assert.equal(await dialog.isVisible(),false)
   await page.screenshot({path:join(output,`${name}-connections-${width}.png`),fullPage:true})
   assert.deepEqual(errors,[])
   console.log(`${name} connections ${width}: overflow, dialog bounds and keyboard passed`)
   await page.close()
  }
 }finally{await browser.close()}
}
