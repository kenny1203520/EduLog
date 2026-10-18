import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {JSDOM} from '../../app/node_modules/jsdom/lib/api.js'
import {renderReviewBlockers} from '../workspace/history-review-issues.js'

test('blockers identify reports, localize actions, and open only the exact report without changing decisions',async()=>{
  const dom=new JSDOM('<body><section id="host"></section></body>',{runScripts:'outside-only'}),w=dom.window
  w.eval(readFileSync(new URL('../shared/ui-core.js',import.meta.url),'utf8'));await new Promise(resolve=>setTimeout(resolve,0));w.edulogUi.setLocale('zh-TW')
  const original=globalThis.edulogUi;globalThis.edulogUi=w.edulogUi
  try{
    const issues=[{source_id:'a',batchKey:'batch',reason:'mapping',targets:[{field:'lesson_id'}]},{source_id:'missing',batchKey:'batch',reason:'report-missing'}],items=[{key:'a',category:'needs',record:{sourceStudentName:'合成學生',sourceCourseLabel:'Python',date:'2026-10-04',enrollment_source_id:'admission'},reason:'請核對教材'}],before=structuredClone({issues,items}),calls=[]
    const host=w.document.getElementById('host');renderReviewBlockers(host,issues,items,{open:(...args)=>calls.push(args),recheck:(...args)=>calls.push(['read',...args])})
    assert.match(host.textContent,/合成學生/);assert.match(host.textContent,/Python · 2026-10-04/);assert.match(host.textContent,/請核對教材/)
    const buttons=host.querySelectorAll('[data-review-blocker-open]');buttons[0].click();assert.deepEqual(calls,[['a','lesson_id']]);assert.equal(buttons[1].disabled,true)
    assert.match(host.textContent,/學生資訊不足/);assert.equal(host.querySelector('a').href,'https://corp.orangeapple.co/dt_admissions/admission')
    w.edulogUi.setLocale('en');assert.equal(buttons[0].textContent,'Open report review');assert.match(host.textContent,/reports block the preview update/)
    assert.doesNotMatch(host.textContent,/work\.(?:review|stale)/);assert.deepEqual({issues,items},before)
  }finally{globalThis.edulogUi=original;dom.window.close()}
})
