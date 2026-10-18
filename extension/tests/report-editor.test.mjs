import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// tests/fixtures/real-report-editor.html is de-identified but keeps the real editor structure:
// field ids, half-star ratings, the #report-options phrase library and the staff-only field.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function editor() {
  const dom = new JSDOM(read('fixtures/real-report-editor.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, original = w.document.body.outerHTML
  for (const file of ['lexicon', 'model', 'report-editor', 'workflows']) w.eval(read(`../sites/orange-apple/orange-apple-${file}.js`))
  w.eval(read('../sites/orange-apple/orange-apple.js'))
  const enhancement = w.edulogSiteAdapter.enhanceDialogs(w.document, {})
  const doc = w.document
  const set = (selector, value) => { const node = doc.querySelector(selector); node.value = value; node.dispatchEvent(new w.Event('change', { bubbles: true })) }
  return { dom, w, doc, original, enhancement, set }
}
const statusRow = doc => [...doc.querySelectorAll('.edulog-editor-status li')].map(item => `${item.dataset.tone}:${item.querySelector('.edulog-card-status-value').textContent}`).join(' ')
const missing = doc => [...doc.querySelectorAll('.edulog-submit-check button')].map(button => button.textContent).join('|')

test('the four-status row and checklist follow the form as it is filled', () => {
  const s = editor()
  assert.equal(statusRow(s.doc), 'warn:未點名 warn:未填 warn:未選 warn:未填')
  assert.equal(missing(s.doc), '出席狀況')
  s.set('#lesson_report_attendance_status', 'attended')
  assert.equal(missing(s.doc), '完成狀況|學習表現|內部紀錄')
  s.set('#dt_admission_lesson_report_completion_status', 'all_done')
  assert.match(statusRow(s.doc), /warn:章節未填/)
  s.set('#dt_admission_lesson_report_start_from', '0'); s.set('#dt_admission_lesson_report_end_to', '3')
  s.set('#admission_lesson_report_learning_status', 'distracted')
  assert.equal(statusRow(s.doc), 'ok:出席 ok:完整完成 danger:跟不上 warn:未填')
  s.set('#lesson_report_feedback', '專心完成專案。')
  assert.equal(missing(s.doc), '確認學生姓名與上課資訊')
  const confirm = s.doc.querySelector('#nothing'); confirm.checked = true; confirm.dispatchEvent(new s.w.Event('change', { bubbles: true }))
  assert.match(s.doc.querySelector('.edulog-submit-check').textContent, /必要項目都已填寫/)
  s.dom.window.close()
})

test('absent mode keeps only the reason and contact field', () => {
  const s = editor()
  s.set('#lesson_report_attendance_status', 'absent')
  assert.equal(statusRow(s.doc), 'danger:不出席 neutral:不適用 neutral:不適用 neutral:不適用')
  const sections = [...s.doc.querySelectorAll('.edulog-form-section')].filter(section => section.hasAttribute('data-edulog-not-applicable')).map(section => section.querySelector('h3').textContent)
  assert.equal(sections.join('|'), '課程與專案進度|課堂評量|內部紀錄')
  assert.equal(s.doc.querySelector('.admission_lesson_report_feedback').hasAttribute('data-edulog-not-applicable'), true)
  assert.equal(s.doc.querySelector('.dt_admission_lesson_report_contact').hasAttribute('data-edulog-not-applicable'), false)
  assert.equal(s.doc.querySelector('.edulog-editor-note').hidden, false)
  assert.equal(missing(s.doc), '不出席原因')
  s.set('#lesson_report_attendance_status', 'attended')
  assert.equal(s.doc.querySelectorAll('[data-edulog-not-applicable]').length, 0)
  s.dom.window.close()
})

test('phrase library inserts at the cursor, fills today\'s lesson and fires native events', () => {
  const s = editor()
  const feedback = s.doc.querySelector('#lesson_report_feedback'), events = []
  for (const type of ['input', 'change']) feedback.addEventListener(type, () => events.push(type))
  assert.equal(s.doc.querySelector('#report-options').hasAttribute('data-edulog-replaced'), true)
  assert.equal(s.doc.querySelector('#show-options').hasAttribute('data-edulog-replaced'), true)
  const tabs = [...s.doc.querySelectorAll('.edulog-phrase-tabs [role=tab]')]
  assert.equal(tabs.map(tab => tab.textContent).join('|'), '學習表現前言|課程理解|挑戰題')
  const phrases = () => [...s.doc.querySelectorAll('.edulog-phrase')]
  phrases()[0].click()
  phrases()[1].click()
  assert.equal(feedback.value, '學生 學生甲，本週表現：這次有先完成上次的第＿課，並且驗收通過，接著進到今天的進度第11課。')
  assert.equal(JSON.stringify(events), JSON.stringify(['input', 'change', 'input', 'change']))
  feedback.setSelectionRange(0, 0)
  tabs[1].click()
  assert.equal([...s.doc.querySelectorAll('.edulog-phrase-level-title')].map(node => node.textContent).join('|'), '優良|普通|不佳')
  phrases()[0].click()
  assert.ok(feedback.value.startsWith('完全理解課程內容。學生 學生甲'))
  tabs[1].dispatchEvent(new s.w.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  assert.equal(s.doc.querySelector('.edulog-phrase-tabs [aria-selected=true]').textContent, '挑戰題')
  assert.equal(s.w.edulogSiteReportEditor.fillLesson('今天的進度第＿課', ''), '今天的進度第＿課')
  s.dom.window.close()
})

test('ratings can be cleared and the staff-only field sits in a closed block', () => {
  const s = editor()
  const radio = s.doc.querySelector('#participation_start_7'); radio.checked = true; radio.dispatchEvent(new s.w.Event('change', { bubbles: true }))
  const clear = radio.closest('[data-edulog-rating-column]').querySelector('.edulog-rating-clear')
  clear.click()
  assert.equal([...s.doc.querySelectorAll('input[name="admission_lesson_report[participation_rating]"]')].some(input => input.checked), false)
  const staff = s.doc.querySelector('.edulog-staff-only')
  assert.equal(staff.open, false)
  assert.equal(staff.querySelector('summary').textContent, '教學部使用')
  assert.ok(staff.querySelector('#dt_admission_lesson_report_typing_error'))
  s.dom.window.close()
})

test('restore returns the exact original editor', () => {
  const s = editor()
  s.enhancement.restore()
  assert.equal(s.doc.body.outerHTML, s.original)
  s.dom.window.close()
})
