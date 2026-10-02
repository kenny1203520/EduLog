import test from 'node:test'
import assert from 'node:assert/strict'
import {frontendUrl, sourceUrl, statusLabel, enrollmentLabel, displayDate, sourceName, mergeEvidence} from '../mapping-presentation.js'
import {JSDOM} from '../../app/node_modules/jsdom/lib/api.js'
import {evidenceDetails} from '../mapping-view.js'
test('mapping links use only a validated frontend settings URL and retain prefix and custom port',()=>{
  const id='00000000-0000-4000-8000-000000000004'
  assert.equal(frontendUrl('http://localhost:5173/edulog/dashboard/settings?tab=integrations',`/dashboard/student/${id}`),`http://localhost:5173/edulog/dashboard/student/${id}`)
  assert.equal(frontendUrl('https://web.example:8443/school/dashboard/settings',`/dashboard/reports/${id}`),`https://web.example:8443/school/dashboard/reports/${id}`)
  for(const value of [null,'http://localhost:3000','https://api.example/api','javascript:alert(1)','https://user:secret@web.example/dashboard/settings','http://web.example/dashboard/settings'])assert.equal(frontendUrl(value,`/dashboard/student/${id}`),null)
  assert.equal(frontendUrl('https://web.example/dashboard/settings','/dashboard/student/../../settings'),null)
  assert.equal(sourceUrl('https://corp.orangeapple.co','/dt_admissions/301?secret=x#info'),'https://corp.orangeapple.co/dt_admissions/301')
  assert.equal(sourceUrl('https://corp.orangeapple.co','https://evil.example/dt_admissions/301'),null)
})
test('statuses and dates are readable without masking unknown original codes',()=>{
  assert.deepEqual(['regular','trial','completed','dropped','other'].map(statusLabel),['正式','試聽','已完成','已退選','未辨識狀態'])
  assert.match(enrollmentLabel({id:'abcd1234-9999',status:'regular',start_date:'2026-02-02'}),/^正式 · 2026\/2\/2 · #abcd1234$/)
  for(const date of ['2026-02-30','invalid',null])assert.equal(displayDate(date),'日期未提供')
})
test('evidence merges provenance and fields; unknown admissions retain an identifiable source summary',()=>{
  const entry={sourcePath:'/courses/dt/11',table:'reports',row:1,fields:[{key:'student_name',text:'來源文字'}]}
  const merged=mergeEvidence([entry],[{...entry,fields:[{key:'course_name',text:'課程文字'}]}])
  assert.equal(merged.length,1);assert.equal(merged[0].fields.length,2)
  assert.equal(sourceName({source_id:'301',sourceEvidence:merged}),'來源文字')
  assert.equal(sourceName({source_id:'302'}),'來源報名 #302')
})
test('source evidence is collapsed plain text, merges duplicate origins and supports older snapshots',()=>{
  const dom=new JSDOM('');const before=globalThis.document;globalThis.document=dom.window.document
  try{
    const entry={sourcePath:'/courses/dt/11',table:'reports',row:1,capturedAt:'invalid',fields:[{key:'student_name',label:'學生',text:'<img src=x onerror=alert(1)>'}]}
    const detail=evidenceDetails([{sourceEvidence:[entry]},{sourceEvidence:[{...entry,fields:[{key:'course_name',label:'課程',text:'原文'}]}]}])
    assert.equal(detail.open,false);assert.equal(detail.querySelectorAll('section').length,1);assert.equal(detail.querySelectorAll('dd').length,2);assert.equal(detail.querySelector('img'),null);assert.match(detail.textContent,/<img/)
    assert.match(evidenceDetails([{}]).textContent,/此工作尚未保留擷取原文/)
  }finally{globalThis.document=before;dom.window.close()}
})
