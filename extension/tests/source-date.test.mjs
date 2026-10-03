import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import {JSDOM} from '../../app/node_modules/jsdom/lib/api.js'
const script=readFileSync(new URL('../source-date.js',import.meta.url),'utf8'),ctx=vm.createContext({Intl,Date});vm.runInContext(script,ctx)
const dates=ctx.edulogSourceDate
test('strict full dates, one digit values, Chinese dates and invalid calendar days',()=>{
  for(const raw of ['2024-2-29','2024/02/29','2024.2.29','2024年2月29日','課次 2024 / 2 / 29'])assert.equal(dates.parse(raw).date,'2024-02-29',raw)
  for(const raw of ['2023/2/29','2024-2-30','2026/13/2','2026/0/1','2026/4/31','2026/1/0','2026/01/012'])assert.equal(dates.parse(raw).date,null,raw)
  for(const raw of ['10-04','10/4','1.2','本週(02/29)','2月9日']){const parsed=dates.parse(raw);assert.equal(parsed.date,null);assert.equal(parsed.valid,true,raw)}
})
test('yearless dates require unique reliable evidence and never default to the current year',()=>{
  assert.equal(dates.resolve(['10/04']).date,null)
  assert.equal(dates.resolve(['10/04'],[['2026-08-08','2026-11-29']]).date,'2026-10-04')
  assert.equal(dates.resolve(['1/2'],[['2026-12-01','2027-02-01']]).date,'2027-01-02')
  assert.equal(dates.resolve(['10/04'],[['2025-01-01','2027-12-31']]).date,null)
  assert.equal(dates.resolve(['10/04','2022/10/04']).date,'2022-10-04')
  assert.equal(dates.resolve(['10/04','2022/10/05']).conflict,true)
  assert.equal(dates.resolve(['2022/10/04','2023/10/04']).conflict,true)
  assert.equal(dates.resolve(['2026/2/30','2026/2/28']).date,null)
})
function page(){
  const dom=new JSDOM(`<table id="reports"><tr><th>學生</th><th>課程</th><th>本週(10/04)</th></tr><tr><td>學生甲</td><td>課程甲 (2026-08-08 ~ 2026-11-29)</td><td><a href="/dt_admissions/301/reports/401/edit">記錄</a></td></tr></table>${readFileSync(new URL('fixtures/report-modal.html',import.meta.url),'utf8')}`,{url:'https://corp.orangeapple.co/courses/dt/11',runScripts:'outside-only'})
  Object.defineProperty(dom.window,'crypto',{value:webcrypto});dom.window.TextEncoder=TextEncoder;dom.window.eval(script);dom.window.eval(readFileSync(new URL('../adapters/orange-apple-integration.js',import.meta.url),'utf8'))
  const click=()=>dom.window.document.querySelector('a').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true}))
  dom.window.document.querySelector('a').addEventListener('click',e=>e.preventDefault())
  return {dom,api:dom.window.edulogSourceIntegration,doc:dom.window.document,click}
}
test('original click date works without theme; temporary answers preserve native DOM and invalidate on new evidence',async()=>{
  const {dom,api,doc,click}=page();click();const before=await api.readForm(doc)
  assert.equal(before.date,'2026-10-04');assert.equal(before.dateInfo.basis,'course_range')
  const native=doc.querySelector('form'),old=doc.querySelector('#lesson_report_feedback').value
  const supplemented=await api.supplementForm(doc,{formId:before.formId,fingerprint:before.fingerprint,date:'2026-10-04'})
  assert.equal(supplemented.supplement.label,'使用者確認');assert.equal(supplemented.dateInfo.basis,'user_confirmed');assert.equal(doc.querySelector('form'),native);assert.equal(doc.querySelector('#lesson_report_feedback').value,old)
  await assert.rejects(api.supplementForm(doc,{formId:before.formId,fingerprint:before.fingerprint,date:'2026-10-05'}),/已改變/)
  doc.querySelectorAll('th')[2].textContent='下週(10/11)';click();const changed=await api.readForm(doc);assert.equal(changed.supplement,null);assert.equal(changed.date,'2026-10-11')
  dom.window.close()
})
test('historical same report ID resolves year; conflicting history needs explicit acknowledgement',async()=>{
  const {dom,api,doc,click}=page();doc.querySelector('tr:nth-child(2) td:nth-child(2)').textContent='課程甲';click()
  dom.window.AbortSignal.timeout=()=>undefined
  dom.window.fetch=async()=>({ok:true,headers:{get:()=> 'text/html'},text:async()=>'<div id="page-body"><div class="content"><table><tbody><tr><td>1</td><td>2022年10月4日</td><td><a href="/dt_admissions/301/reports/401/edit">記錄</a></td></tr></tbody></table></div></div>'})
  assert.equal((await api.resolveFormDate(doc)).date,'2022-10-04')
  doc.querySelectorAll('th')[2].textContent='本週(10/05)';click();const conflict=await api.resolveFormDate(doc)
  assert.equal(conflict.date,null);assert.equal(conflict.dateInfo.conflict,true)
  await assert.rejects(api.supplementForm(doc,{formId:conflict.formId,fingerprint:conflict.fingerprint,date:'2022-10-04'}),/矛盾/)
  const confirmed=await api.supplementForm(doc,{formId:conflict.formId,fingerprint:conflict.fingerprint,date:'2022-10-04',conflictAcknowledged:true});assert.equal(confirmed.date,'2022-10-04')
  dom.window.close()
})
