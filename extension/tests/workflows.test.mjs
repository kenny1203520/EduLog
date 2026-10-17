import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM, VirtualConsole } from '../../app/node_modules/jsdom/lib/api.js'
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const wait = () => new Promise(resolve => setTimeout(resolve, 150))
const pendingJsdomErrors = []
test.afterEach(async () => {
  await wait()
  assert.deepEqual(pendingJsdomErrors.splice(0), [], 'unexpected asynchronous JSDOM error')
})

test('hours preserves native GET filters and distinguishes empty loaded month', () => {
  const dom = fixture('hours','/my/hour?year=2026&month=9'), doc = dom.window.document
  const form = doc.querySelector('form'), year = doc.querySelector('[name=year]')
  const first = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.equal(doc.querySelector('form'),form); assert.equal(doc.querySelector('[name=year]'),year)
  assert.match(doc.querySelector('.edulog-page-context').textContent,/2026年 9月/)
  assert.equal(doc.querySelector('.edulog-empty'),null)
  first.restore(); doc.querySelector('table').remove()
  const second = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.equal(doc.querySelector('.edulog-empty').textContent,'此月份沒有鐘點紀錄')
  second.restore(); dom.window.close()
})

test('profile grouping keeps nested skills and original edit link', () => {
  const dom = fixture('profile','/my'), doc = dom.window.document, link = doc.querySelector('a[href$=edit]')
  const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.equal(doc.querySelector('.edulog-profile-header a'),link)
  assert.match([...doc.querySelectorAll('.edulog-section')].find(x=>x.querySelector('h3').textContent==='其他資訊').textContent,/測試技能.*測試範圍/)
  enhanced.restore(); dom.window.close()
})

test('profile edit retains native form payload, file field and validation after toggling', () => {
  const dom = fixture('profile-edit','/my/101/edit'), doc = dom.window.document, form = doc.querySelector('form'), before = form.outerHTML
  const password = doc.querySelector('#employee_password'), skill = doc.querySelector('textarea'), file = doc.querySelector('[type=file]')
  skill.value='edited'; password.value='test-only'
  const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  const details = password.closest('details'); assert.equal(details.open,false)
  password.dispatchEvent(new dom.window.Event('invalid')); assert.equal(details.open,true)
  assert.equal(new dom.window.FormData(form).get('employee[skill]'),'edited')
  assert.equal(doc.querySelector('[type=file]'),file)
  enhanced.restore(); assert.equal(form.outerHTML,before); assert.equal(skill.value,'edited'); assert.equal(password.value,'test-only')
  dom.window.close()
})

test('multiple native modals get reversible close controls without fabricated save status', () => {
  const dom = fixture('class','/courses/dt/101'), doc = dom.window.document
  const remote = doc.querySelector('#remote_modal'); remote.insertAdjacentHTML('beforeend',read('fixtures/secondary-modals.html'))
  const before = remote.outerHTML, textarea = doc.querySelector('#admissions_teacher_comment'); textarea.value='unsent'
  const enhanced = dom.window.edulogSiteAdapter.enhanceDialogs(doc,{})
  assert.equal(enhanced.roots.length,2); assert.equal(enhanced.isCurrent(),true)
  assert.equal(doc.querySelector('[data-edulog-close]').getAttribute('aria-label'),'關閉視窗')
  assert.match(doc.querySelector('.edulog-dialog-context').textContent,/不代表已儲存/)
  enhanced.restore(); assert.equal(remote.outerHTML,before); assert.equal(textarea.value,'unsent')
  assert.equal(doc.querySelector('[data-edulog-close]'),null)
  const next = dom.window.edulogSiteAdapter.enhanceDialogs(doc,{})
  doc.querySelector('#teachers-comment-modal').remove(); assert.equal(next.isCurrent(),false)
  next.restore(); dom.window.close()
})

test('report details preserve native handlers and selected target date without inferring status', () => {
  const dom = fixture('reports','/courses/dt/101/lesson_reports'), doc=dom.window.document, view={}
  Object.defineProperty(dom.window,'innerWidth',{value:390,writable:true})
  const link=doc.querySelector('a[href$=edit]'); let clicks=0; link.addEventListener('click',e=>{clicks++;e.preventDefault()})
  const enhanced=dom.window.edulogSiteAdapter.enhancePage(doc,view)
  assert.equal(doc.querySelector('.edulog-report-details').open,false)
  link.click(); assert.equal(clicks,1); assert.match(view.reportTarget.label,/本週/)
  dom.window.innerWidth=1440; dom.window.dispatchEvent(new dom.window.Event('resize'))
  assert.equal(doc.querySelector('.edulog-report-details').open,true)
  enhanced.restore(); assert.equal(link.textContent,'記錄'); dom.window.close()
})

test('class reports default to one native session and load the same enrollment lesson summary on demand', async () => {
  const dom=fixture('class','/courses/dt/101'),w=dom.window,doc=w.document,view={}
  const header=doc.querySelector('#reports th:nth-child(5)');header.setAttribute('data-date','2026-10-04')
  const calls=[];w.edulogSourceIntegration={readPreviousTeaching:async(path,date)=>{calls.push([path,date]);return{status:'found',readAt:'2026-10-11T08:00:00.000Z',report:{date:'2026-09-27',lesson:'Lesson 3 · 樂趣 Lesson',completed:false,progress:'C-D',internalNotes:'繼續練習',content:'完成迴圈練習',participation:0,behavior:null,contactNotes:'',externalLink:'https://corp.orangeapple.co/dt_admissions/301/reports/399/edit'}}}}
  const enhanced=dom.window.edulogSiteAdapter.enhancePage(doc,view)
  assert.equal(doc.querySelector('#reports').getAttribute('data-edulog-week-mode'),'single')
  assert.equal(doc.querySelector('.edulog-week-tools [data-report-mode="single"]').getAttribute('aria-pressed'),'true')
  assert.equal(doc.querySelector('.edulog-week-tools [data-report-mode="compare"]').getAttribute('aria-pressed'),'false')
  assert.match(doc.querySelector('.edulog-session-status').textContent,/本堂排定進度.*已啟用教材.*出席狀態.*課堂紀錄/)
  assert.deepEqual(calls,[],'history remains unloaded until the teacher opens the summary')
  const button=doc.querySelector('.edulog-last-teaching-toggle');assert.equal(button.disabled,false)
  const reportRow=doc.querySelector('#reports tbody tr')
  assert.equal(button.closest('td'),reportRow.cells[0],'the previous-teaching action stays with the student identity, not a selected week')
  doc.querySelector('.edulog-week-tools [data-report-mode="compare"]').click()
  assert.equal(reportRow.querySelectorAll('[data-edulog-week-summary]').length,3,'each compared week has its own status summary')
  for(const weekCell of [...reportRow.cells].slice(-3)){
    assert.match(weekCell.querySelector('[data-edulog-week-summary]').textContent,/本堂排定進度.*已啟用教材.*出席狀態.*課堂紀錄/)
  }
  assert.equal(reportRow.querySelector('.edulog-teaching-actions')?.closest('td'),reportRow.cells[0],'changing view does not move the student summary action')
  doc.querySelector('.edulog-week-tools [data-report-mode="single"]').click()
  button.click();await wait()
  assert.equal(doc.querySelector('.edulog-last-teaching-panel').hidden,false,'the opened teaching summary panel is visible')
  assert.equal(doc.querySelector('.edulog-last-teaching-content').hidden,false,'the live content region is not hidden after expansion')
  assert.deepEqual(calls,[['/dt_admissions/301','2026-10-04']])
  assert.match(doc.querySelector('.edulog-last-teaching-content').textContent,/2026-09-27.*Lesson 3.*未完成.*繼續練習.*完成迴圈練習/)
  assert.match(doc.querySelector('.edulog-last-teaching-content').textContent,/0/,'zero ratings remain visible')
  const form=doc.createElement('form');form.action='https://corp.orangeapple.co/dt_admissions/301/reports/399/edit';doc.body.append(form)
  form.dispatchEvent(new w.CustomEvent('turbo:submit-end',{detail:{success:true},bubbles:true}))
  assert.match(doc.querySelector('.edulog-last-teaching-content').textContent,/待重新讀取/,'a confirmed native report save invalidates the cached lesson summary')
  doc.querySelector('.edulog-last-teaching-panel > button').click();await wait()
  assert.equal(calls.length,2,'refresh after a confirmed save performs a fresh enrollment-scoped read')
  doc.querySelector('.edulog-week-tools [data-report-mode="compare"]').click()
  assert.equal(doc.querySelector('#reports').getAttribute('data-edulog-week-mode'),'compare')
  doc.querySelector('.edulog-week-tools [data-report-mode="single"]').click()
  assert.equal(doc.querySelector('#reports').getAttribute('data-edulog-week-mode'),'single')
  enhanced.restore();assert.equal(doc.querySelector('.edulog-last-teaching-toggle'),null);dom.window.close()
})

test('load all session summaries reads only reliably linked students with concurrency capped at three', async()=>{
 const dom=fixture('reports','/courses/dt/101/lesson_reports'),w=dom.window,doc=w.document,view={},calls=[];let active=0,maximum=0
 const header=doc.querySelector('#reports th:nth-child(5)');header.setAttribute('data-date','2026-10-04')
 const body=doc.querySelector('#reports tbody'),template=[...body.rows].find(row=>row.cells.length===6)
 for(let id=302;id<=304;id++){const clone=template.cloneNode(true);const link=clone.cells[4].querySelector('a[href*="/reports/"]');link.setAttribute('href',`/dt_admissions/${id}/reports/${500+id}/edit`);body.append(clone)}
 w.edulogSourceIntegration={readPreviousTeaching:async(path,date)=>{active++;maximum=Math.max(maximum,active);calls.push([path,date]);await new Promise(resolve=>setTimeout(resolve,12));active--;return{status:'none',readAt:'2026-10-11T08:00:00.000Z'}}}
 dom.window.edulogSiteAdapter.enhancePage(doc,view)
 assert.equal(view.classHistoryEligibleCount,4,'the non-session row without a report link is excluded')
 const result=await view.loadClassHistory()
 assert.equal(result.done,4);assert.equal(result.failed,0);assert.equal(result.total,4);assert.equal(result.cancelled,false)
 assert.equal(maximum,3,'at most three source history reads run at once')
 assert.deepEqual(new Set(calls.map(call=>call[0])),new Set(['/dt_admissions/301','/dt_admissions/302','/dt_admissions/303','/dt_admissions/304']))
 const rendered=[...doc.querySelectorAll('.edulog-last-teaching-content')].map(panel=>panel.textContent)
 assert.equal(rendered.filter(value=>value.includes('未找到')).length,4,rendered.join(' | '))
 dom.window.close()
})

test('class lesson summary resolves a complete date from the selected native report before reading history', async () => {
  const dom=fixture('class','/courses/dt/101'),w=dom.window,doc=w.document,calls=[]
  doc.querySelector('#reports th:nth-child(5)').removeAttribute('data-date')
  w.edulogSourceIntegration={resolveSessionDate:async(path,url)=>{calls.push(['date',path,new URL(url).pathname]);return{date:'2026-10-04'}},readPreviousTeaching:async(path,date)=>{calls.push(['history',path,date]);return{status:'none',readAt:'2026-10-11T08:00:00.000Z'}}}
  dom.window.edulogSiteAdapter.enhancePage(doc,{})
  doc.querySelector('.edulog-last-teaching-toggle').click();await wait()
  assert.deepEqual(calls,[['date','/dt_admissions/301','/dt_admissions/301/reports/401/edit'],['history','/dt_admissions/301','2026-10-04']])
  assert.match(doc.querySelector('.edulog-last-teaching-content').textContent,/2026-10-11|未找到|沒有符合/)
  dom.window.close()
})

test('class lesson summary never guesses a year from a week label', async () => {
  const dom=fixture('class','/courses/dt/101'),w=dom.window,doc=w.document;let calls=0
  w.edulogSourceIntegration={readPreviousTeaching:async()=>{calls++;return{status:'none'}}}
  doc.querySelector('#reports a[href*="/reports/"]').remove()
  dom.window.edulogSiteAdapter.enhancePage(doc,{})
  assert.equal(doc.querySelector('.edulog-last-teaching-toggle').disabled,false,'a unique student and course may resolve the enrollment from the native roster link')
  doc.querySelector('.edulog-last-teaching-toggle').click();await wait()
  assert.equal(calls,0)
  const message=doc.querySelector('.edulog-last-teaching-content').textContent
  assert.ok(message.length>0,'the panel explains why an exact previous lesson cannot be selected')
  assert.equal(doc.querySelector('.edulog-last-teaching-panel > button').hidden,false,'the teacher can retry after the source date becomes available')
  dom.window.close()
})

test('secondary modal updates preserve focused draft and do not duplicate controls', async () => {
  const dom=fixture('class','/courses/dt/101'),w=dom.window,doc=w.document
  w.chrome={runtime:{sendMessage:async()=>({enabled:true}),onMessage:{addListener(){}}}}
  for(const file of ['runtime-bridge.js','connection-ui.js', 'integration-ui.js','bootstrap.js','content.js']) w.eval(read(`../${file}`))
  await wait(); doc.querySelector('#remote_modal').insertAdjacentHTML('beforeend',read('fixtures/secondary-modals.html')); await wait()
  const field=doc.querySelector('#admissions_teacher_comment'); field.value='draft';field.focus();field.setSelectionRange(1,3)
  const note=doc.querySelector('.edulog-dialog-context')
  doc.querySelector('#students-table tbody tr td:nth-child(2)').textContent='updated';await wait()
  assert.equal(doc.querySelector('.edulog-dialog-context'),note);assert.equal(doc.activeElement,field);assert.equal(field.selectionStart,1)
  doc.querySelector('#edulog-extension-root').shadowRoot.querySelector('.toggle').click(); await wait()
  assert.equal(field.value,'draft');assert.equal(doc.querySelector('[data-edulog-close]'),null)
  dom.window.close()
})

test('report cell replacement restores disclosures without rebuilding page controls', async () => {
  const dom=fixture('reports','/courses/dt/101/lesson_reports'),w=dom.window,doc=w.document
  Object.defineProperty(w,'innerWidth',{value:390,writable:true})
  w.chrome={runtime:{sendMessage:async()=>({enabled:true}),onMessage:{addListener(){}}}}
  for(const file of ['runtime-bridge.js','connection-ui.js', 'integration-ui.js','bootstrap.js','content.js']) w.eval(read(`../${file}`))
  await wait(); const search=doc.querySelector('[data-edulog-search=reports]')
  const cell=doc.querySelector('#reports tbody tr').cells[2]; cell.textContent='更新課程';await wait()
  assert.equal(doc.querySelector('[data-edulog-search=reports]'),search)
  assert.match(cell.querySelector('.edulog-report-details').textContent,/更新課程/)
  assert.equal(cell.querySelectorAll('.edulog-report-details').length,1)
  dom.window.close()
})

test('password disclosure and focused native draft survive UI switching', async () => {
  const dom=fixture('profile-edit','/my/101/edit'),w=dom.window,doc=w.document
  w.chrome={runtime:{sendMessage:async()=>({enabled:true}),onMessage:{addListener(){}}}}
  for(const file of ['runtime-bridge.js','connection-ui.js', 'integration-ui.js','bootstrap.js','content.js']) w.eval(read(`../${file}`))
  await wait();const field=doc.querySelector('#employee_password');field.closest('details').open=true;await wait()
  field.value='synthetic-only';field.focus()
  doc.querySelector('#edulog-extension-root').shadowRoot.querySelector('.toggle').click();await wait()
  doc.querySelector('#edulog-extension-root').shadowRoot.querySelector('.toggle').click();await wait()
  assert.equal(field.closest('details').open,true);assert.equal(doc.activeElement,field);assert.equal(field.value,'synthetic-only')
  dom.window.close()
})

test('report date context is shown only when it matches the native form action', () => {
  const dom=fixture('class','/courses/dt/101'),doc=dom.window.document
  doc.querySelector('#remote_modal').insertAdjacentHTML('beforeend',read('fixtures/report-modal.html'))
  const view={reportTarget:{path:'/dt_admissions/301/reports/401/edit',label:'本週 (10/04)'}}
  const matching=dom.window.edulogSiteAdapter.enhanceDialog(doc,view)
  assert.match(doc.querySelector('.edulog-dialog-context').textContent,/10\/04/); matching.restore()
  view.reportTarget.path='/dt_admissions/301/reports/402/edit'
  const other=dom.window.edulogSiteAdapter.enhanceDialog(doc,view)
  assert.equal(doc.querySelector('.edulog-dialog-context'),null);other.restore();dom.window.close()
})
function fixture(name, path) {
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => pendingJsdomErrors.push(error))
  const dom = new JSDOM(read(`fixtures/${name}.html`), { url: `https://corp.orangeapple.co${path}`, runScripts: 'outside-only', virtualConsole })
  for (const file of ['adapters/orange-apple-lexicon.js', 'adapters/orange-apple-model.js', 'adapters/orange-apple-workflows.js', 'adapters/orange-apple.js']) dom.window.eval(read(`../${file}`))
  return dom
}
for (const [name, path] of [['hours','/my/hour'],['profile','/my'],['profile-edit','/my/101/edit'],['reports','/courses/dt/101/lesson_reports'],['classes','/courses/dt'],['history','/dt_admissions/301'],['calendar','/calendar'],['unfilled','/admissions/month_unfilled_report'],['unfilled-current','/admissions/unfilled_report'],['report-editor','/dt_admissions/274452/reports/6558413/edit']]) {
  test(`${name}: enhancements restore exactly the original DOM`, () => {
    const dom = fixture(name, path), doc = dom.window.document
    const before = doc.documentElement.outerHTML
    const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc, {})
    assert.ok(enhanced)
    enhanced.restore()
    assert.equal(doc.documentElement.outerHTML, before)
    dom.window.close()
  })
}
test('standalone report editor is supported for prefill but excluded from teaching import', () => {
  const dom = fixture('report-editor','/dt_admissions/274452/reports/6558413/edit')
  const adapter = dom.window.edulogSiteAdapter
  assert.equal(adapter.matchesIntegrationPage(dom.window.location.pathname), true)
  assert.equal(adapter.matchesTeachingPage(dom.window.location.pathname), false)
  assert.equal(adapter.matchPage(dom.window.location.pathname).kind, 'report-editor')
  const enhanced = adapter.enhancePage(dom.window.document)
  assert.equal(enhanced.page.kind, 'report-editor')
  enhanced.restore(); dom.window.close()
})
test('class matrix spans map to the correct weekday and source time slot', () => {
  const dom = fixture('classes', '/courses/dt'), doc = dom.window.document
  const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  const cards = [...doc.querySelectorAll('.edulog-class-list article')]
  assert.equal(cards.length, 2)
  assert.match(cards[0].textContent, /Sun\./)
  assert.match(cards[1].textContent, /Sat\./)
  assert.match(cards[1].textContent, /測試教室/)
  assert.match(cards[0].textContent, /付費（含長期停課）9/)
  assert.ok(doc.querySelector('table').hasAttribute('data-edulog-matrix-hidden'))
  doc.querySelectorAll('.edulog-table-tools button')[1].click()
  assert.equal(doc.querySelector('table').hasAttribute('data-edulog-matrix-hidden'), false)
  enhanced.restore(); dom.window.close()
})
test('history date/text filters and assessment disclosure retain source content', () => {
  const dom = fixture('history', '/dt_admissions/301'), doc = dom.window.document
  const assessment = doc.querySelector('table td:nth-child(6)')
  const native = assessment.firstElementChild
  const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.equal(native.parentElement.tagName, 'DETAILS')
  const search = doc.querySelector('input[type=search]'), date = doc.querySelector('input[type=date]')
  search.value = '測試評語乙'; search.dispatchEvent(new dom.window.Event('input'))
  assert.equal(doc.querySelectorAll('tr[data-edulog-filtered]').length, 2)
  date.value = '2026-09-20'; date.dispatchEvent(new dom.window.Event('input'))
  assert.equal(doc.querySelectorAll('tr[data-edulog-filtered]').length, 3)
  assert.equal(doc.querySelector('.edulog-empty').hidden, false)
  enhanced.restore(); assert.equal(assessment.firstElementChild, native); dom.window.close()
})
test('empty monthly list does not imply reports were submitted', () => {
  const dom = fixture('unfilled','/admissions/month_unfilled_report')
  dom.window.edulogSiteAdapter.enhancePage(dom.window.document)
  assert.match(dom.window.document.querySelector('.edulog-empty').textContent, /沒有紀錄/)
  assert.equal(dom.window.document.querySelector('[aria-current=page]').textContent, '上月份')
  dom.window.close()
})
test('current unfilled list is searchable without losing original action links', () => {
  const dom = fixture('unfilled-current','/admissions/unfilled_report'), doc = dom.window.document
  const originalLink = doc.querySelector('tbody a[href*="student_id=301"]')
  const enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.equal(doc.querySelector('[data-edulog-page="unfilled-current"]') !== null, true)
  assert.equal(doc.querySelectorAll('tbody tr[data-edulog-unfilled-card]').length, 2)
  assert.equal(doc.querySelector('tbody tr td[data-edulog-label="目前節次"]')?.textContent.trim(), '週日第 1 時段 (10:00 ~ 12:00)')
  assert.equal(doc.querySelector('tbody a[href*="student_id=301"]'), originalLink)
  const search = doc.querySelector('[data-edulog-search="unfilledQuery"]')
  search.value = '學生乙'; search.dispatchEvent(new dom.window.Event('input', { bubbles:true }))
  assert.equal(doc.querySelectorAll('tbody tr:not([data-edulog-filtered])').length, 1)
  assert.match(doc.querySelector('[role=status]').textContent, /顯示 1 \/ 2 筆/)
  enhanced.restore(); dom.window.close()
})
test('report grouping preserves form identity, values, handlers and native rating payload', () => {
  const dom = fixture('class','/courses/dt/101'), doc = dom.window.document
  doc.querySelector('#remote_modal').insertAdjacentHTML('beforeend', read('fixtures/report-modal.html'))
  const form = doc.querySelector('#lesson-report-modal form'), before = form.outerHTML
  const feedback = form.querySelector('textarea'); feedback.value = 'edited draft'
  const attendance = form.querySelector('#lesson_report_attendance_status'), reason = form.querySelector('#lesson_report_reason')
  attendance.addEventListener('change', () => { reason.disabled = attendance.value !== 'absent' })
  const dialog = dom.window.edulogSiteAdapter.enhanceDialog(doc, {})
  assert.equal(dialog.form, form)
  assert.equal(form.querySelectorAll('.edulog-form-section').length, 6)
  assert.equal(feedback.getAttribute('aria-label'), '學習表現')
  const score = form.querySelector('.edulog-rating-control select')
  score.value = '9'; score.dispatchEvent(new dom.window.Event('change'))
  assert.equal(new dom.window.FormData(form).get('admission_lesson_report[participation_rating]'), '9')
  assert.equal(new dom.window.FormData(form).has('edulog-rating'), false)
  attendance.value = 'absent'; attendance.dispatchEvent(new dom.window.Event('change'))
  assert.equal(reason.disabled, false)
  form.querySelector('#nothing').checked = true
  dialog.restore()
  // Values/properties stay edited; source structure is exactly restored.
  assert.equal(form.outerHTML.replace(' disabled=""', ''), before.replace(' disabled=""', ''))
  assert.equal(reason.disabled, false)
  assert.equal(feedback.value, 'edited draft')
  assert.equal(form.querySelector('#nothing').checked, true)
  assert.equal(form.querySelector('input[value="9"]').checked, true)
  dom.window.close()
})
test('dynamic report modal does not recreate page filters; switching keeps draft focus', async () => {
  const dom = fixture('class','/courses/dt/101'), w = dom.window, doc = w.document
  w.chrome = { runtime: { sendMessage: async data => ({ enabled: data.enabled ?? true }), onMessage: { addListener() {} } } }
  for (const file of ['runtime-bridge.js','connection-ui.js', 'integration-ui.js','bootstrap.js','content.js']) w.eval(read(`../${file}`))
  await wait()
  const search = doc.querySelector('[data-edulog-search=students]')
  const remote = doc.querySelector('#remote_modal'); remote.insertAdjacentHTML('beforeend', read('fixtures/report-modal.html'))
  await wait()
  assert.equal(doc.querySelector('[data-edulog-search=students]'), search)
  const field = doc.querySelector('#lesson_report_feedback'); field.value = 'unsaved'; field.focus()
  doc.querySelector('#edulog-extension-root').shadowRoot.querySelector('.toggle').click(); await wait()
  assert.equal(field.value, 'unsaved')
  assert.equal(doc.querySelector('.edulog-form-section'), null)
  assert.equal(doc.activeElement, field)
  doc.querySelector('#edulog-extension-root').shadowRoot.querySelector('.toggle').click(); await wait()
  assert.equal(field.value, 'unsaved')
  assert.equal(doc.querySelectorAll('.edulog-form-section').length, 6)
  doc.querySelector('#lesson-report-modal').remove(); await wait()
  assert.equal(doc.querySelectorAll('.edulog-table-tools').length, 2)
  dom.window.close()
})
test('recognized URL with an access-denied response is not enhanced', () => {
  const dom = fixture('history','/dt_admissions/301')
  dom.window.document.querySelector('.content').innerHTML = '<h1>沒有存取權限</h1>'
  assert.equal(dom.window.edulogSiteAdapter.enhancePage(dom.window.document), null)
  assert.equal(dom.window.document.documentElement.hasAttribute('data-edulog-ui'), false)
  dom.window.close()
})

test('student expansion survives rebuilding and native UI restoration', () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document, view = {}
  const first = dom.window.edulogSiteAdapter.enhancePage(doc, view)
  doc.querySelector('[data-edulog-expand]').click()
  const row = doc.querySelector('[data-edulog-expanded]')
  first.restore()
  assert.equal(row.hasAttribute('data-edulog-expanded'), false)
  const second = dom.window.edulogSiteAdapter.enhancePage(doc, view)
  assert.equal(row.hasAttribute('data-edulog-expanded'), true)
  assert.equal(row.querySelector('button').getAttribute('aria-expanded'), 'true')
  second.restore(); dom.window.close()
})

test('history refresh preserves focused date filter without selection-range errors', async () => {
  const dom = fixture('history', '/dt_admissions/301'), w = dom.window, doc = w.document, errors = []
  w.addEventListener('error', event => errors.push(event.error))
  w.chrome = { runtime: { sendMessage: async () => ({ enabled: true }), onMessage: { addListener() {} } } }
  for (const file of ['runtime-bridge.js', 'connection-ui.js', 'integration-ui.js', 'bootstrap.js', 'content.js']) w.eval(read(`../${file}`))
  await wait()
  const date = doc.querySelector('input[type=date]'); date.value = '2026-09-20'; date.dispatchEvent(new w.Event('input')); date.focus()
  doc.querySelector('tbody').append(doc.querySelector('tbody tr').cloneNode(true))
  await wait()
  assert.equal(doc.activeElement.type, 'date')
  assert.equal(doc.activeElement.value, '2026-09-20')
  assert.deepEqual(errors, [])
  dom.window.close()
})

test('full native rating range displays half stars without changing payload', () => {
  const dom = fixture('class', '/courses/dt/101'), doc = dom.window.document
  doc.querySelector('#remote_modal').insertAdjacentHTML('beforeend', read('fixtures/report-modal.html'))
  const rating = doc.querySelector('.rating')
  for (let value = 1; value <= 8; value++) {
    const radio = doc.createElement('input'); radio.type = 'radio'; radio.name = 'admission_lesson_report[participation_rating]'; radio.value = String(value); rating.append(radio)
  }
  const half = doc.createElement('label'); half.className = 'half'; half.textContent = '½'; rating.append(half)
  const dialog = dom.window.edulogSiteAdapter.enhanceDialog(doc, {})
  assert.equal(rating.hasAttribute('data-edulog-rating-stars'), true)
  assert.equal(half.hasAttribute('data-edulog-rating-half'), true)
  const select = doc.querySelector('.edulog-rating-control select')
  assert.equal(select.querySelector('option[value="9"]').textContent, '4.5 / 5 星')
  select.value = '9'; select.dispatchEvent(new dom.window.Event('change'))
  assert.equal(new dom.window.FormData(dialog.form).get('admission_lesson_report[participation_rating]'), '9')
  dialog.restore(); assert.equal(rating.hasAttribute('data-edulog-rating-stars'), false); assert.equal(half.hasAttribute('data-edulog-rating-half'), false); dom.window.close()
})

test('source captions follow fields and rating control escapes inline container', () => {
  const dom = fixture('class','/courses/dt/101'), doc = dom.window.document
  doc.querySelector('#remote_modal').insertAdjacentHTML('beforeend', read('fixtures/report-source-captions.html'))
  const form = doc.querySelector('#lesson-report-modal form'), before = form.outerHTML
  const dialog = dom.window.edulogSiteAdapter.enhanceDialog(doc, {})
  const input = form.querySelector('#dt_admission_lesson_report_completion_status')
  assert.match(input.parentElement.textContent, /完成狀況/)
  assert.equal(input.closest('section').querySelector('h3').textContent, '課程與專案進度')
  assert.equal(form.querySelector('.edulog-rating-control').parentElement.className, 'col-md-6')
  assert.equal(form.querySelector('.edulog-form-section h3').textContent, '出席狀況')
  dialog.restore(); assert.equal(form.outerHTML, before); dom.window.close()
})

test('hash menu links are not marked current and empty tables are hidden reversibly', () => {
  const dom = fixture('unfilled','/admissions/month_unfilled_report'), doc = dom.window.document
  doc.querySelector('.sidebar').insertAdjacentHTML('beforeend','<a href="#">模組</a>')
  const table = doc.querySelector('table'), enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.equal(doc.querySelector('a[href="#"]').hasAttribute('aria-current'), false)
  assert.equal(table.hasAttribute('data-edulog-empty-table'), true)
  assert.equal(doc.querySelector('.edulog-empty').parentElement.closest('[data-edulog-empty-table]'), null)
  enhanced.restore(); assert.equal(table.hasAttribute('data-edulog-empty-table'), false); dom.window.close()
})

test('calendar status is scoped to selected region, suppressing stale prompt', () => {
  const dom = fixture('calendar','/calendar'), doc = dom.window.document
  doc.querySelector('.content').insertAdjacentHTML('beforeend','<div class="alert">請選擇區域</div><a class="region-title" href="#region-91">第二區域</a><div id="region-91"><a class="active" id="region-91-weekday-0-tab" href="#region-91-weekday-0">另一日期</a><div class="active" id="region-91-weekday-0"><a href="/courses/dt/999">其他班級</a></div></div>')
  const before = doc.documentElement.outerHTML, enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.match(doc.querySelector('.edulog-page-context').textContent, /已載入 1 個班級/)
  assert.equal(doc.querySelector('.alert').hasAttribute('data-edulog-stale-alert'), true)
  doc.querySelector('.region-title.active').classList.remove('active')
  doc.querySelector('.region-title[href="#region-91"]').classList.add('active')
  enhanced.refresh()
  assert.match(doc.querySelector('.edulog-page-context').textContent, /第二區域.*另一日期/)
  doc.querySelector('.region-title[href="#region-91"]').classList.remove('active')
  doc.querySelector('.region-title').classList.add('active')
  enhanced.restore(); assert.equal(doc.documentElement.outerHTML, before); dom.window.close()
})

test('native cell update preserves search identity and modal draft/caret', async () => {
  const dom = fixture('class','/courses/dt/101'), w = dom.window, doc = w.document
  w.chrome = { runtime: { sendMessage: async () => ({enabled:true}), onMessage: {addListener(){}} } }
  for (const file of ['runtime-bridge.js','connection-ui.js', 'integration-ui.js','bootstrap.js','content.js']) w.eval(read(`../${file}`))
  await wait()
  doc.querySelector('#remote_modal').insertAdjacentHTML('beforeend', read('fixtures/report-modal.html')); await wait()
  const search = doc.querySelector('[data-edulog-search=students]'), section = doc.querySelector('.edulog-form-section'), field = doc.querySelector('#lesson_report_feedback')
  field.value = 'unsent draft'; field.focus(); field.setSelectionRange(3,5)
  doc.querySelector('#students-table tbody tr td:nth-child(2)').textContent = '更新年級'; await wait()
  assert.equal(doc.querySelector('[data-edulog-search=students]'), search)
  assert.equal(doc.querySelector('.edulog-form-section'), section)
  assert.equal(doc.activeElement, field); assert.equal(field.selectionStart,3); assert.equal(field.selectionEnd,5)
  dom.window.close()
})

test('calendar native form moves with week navigation and restores unchanged', () => {
  const dom = fixture('calendar','/calendar'), doc = dom.window.document, form = doc.querySelector('form')
  form.insertAdjacentHTML('beforebegin','<a href="/calendar?date=2026-09-21">前一週</a>')
  form.insertAdjacentHTML('afterend','<a href="/calendar?date=2026-10-05">下一週</a>')
  const before = doc.documentElement.outerHTML, enhanced = dom.window.edulogSiteAdapter.enhancePage(doc)
  assert.equal(form.parentElement.className,'edulog-calendar-nav')
  assert.equal(form.parentElement.children.length,3)
  enhanced.restore(); assert.equal(doc.documentElement.outerHTML,before); dom.window.close()
})
