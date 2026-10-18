import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// The provider's "本週快速點名" form: one checkbox per this-week report (value = report id,
// matching turbo-frame#report_status_{id} in the report table), names in the header row,
// and two submit buttons sharing name="type" (0 出席, 1 不出席).
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const ROSTER = [['學生甲', 7002], ['學生乙', 7005], ['學生丙', 7008], ['學生丁', 7011], ['學生庚', 7015], ['學生辛', 7017]]
function quickForm(roster = ROSTER) {
  const heads = roster.map(([name]) => `<th>${name}&nbsp;L2&nbsp;<a class="admission-comment" href="#"><div class="admission-comment-box"> </div></a><br>菁英_Python程式開發班(9)</th>`).join('')
  const boxes = roster.map(([, id]) => `<td><label><input name="report_ids[]" type="checkbox" value="${id}">&nbsp;</label></td>`).join('')
  return `<form action="/courses/dt/101/update_attendance" method="post"><input type="hidden" name="_method" value="put">本週快速點名 (應出人數：${roster.length}&nbsp;&nbsp;出席人數：0&nbsp;&nbsp; 不出席人數：0)<table class="table table-bordered"><tbody><tr>${heads}</tr><tr>${boxes}</tr><tr><th><button class="btn btn-xs btn-default" name="type" value="0">設定為出席</button>&nbsp;<button class="btn btn-xs btn-default" id="set-leave-btn" name="type" value="1">設定為不出席</button></th></tr></tbody></table></form>`
}
function classPage({ roster, mutate } = {}) {
  const dom = new JSDOM(read('fixtures/real-class.html'), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window
  w.document.querySelector('.alert').insertAdjacentHTML('afterend', quickForm(roster))
  mutate?.(w.document)
  for (const file of ['lexicon', 'model', 'session-cards', 'quick-attendance', 'workflows']) w.eval(read(`../sites/orange-apple/orange-apple-${file}.js`))
  w.eval(read('../sites/orange-apple/orange-apple.js'))
  const submitted = []
  for (const button of w.document.querySelectorAll('form button[name=type]')) button.addEventListener('click', event => {
    event.preventDefault()
    submitted.push({ type: button.value, ids: [...button.form.querySelectorAll('input[name="report_ids[]"]:checked')].map(box => box.value) })
  })
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { dom, w, doc: w.document, view, result, submitted }
}
const section = doc => doc.querySelector('.edulog-quick-attendance')
const tiles = doc => [...section(doc).querySelectorAll('.edulog-qa-tile')]
const tile = (doc, name) => tiles(doc).find(item => item.querySelector('strong').textContent === name)
const native = (doc, id) => doc.querySelector(`form input[name="report_ids[]"][value="${id}"]`)
const button = (doc, text) => [...section(doc).querySelectorAll('button')].find(item => item.textContent.trim() === text)

test('tiles replace the native form in the session-card order and show each attendance state', () => {
  const s = classPage()
  const form = s.doc.querySelector('form[action$="/update_attendance"]')
  assert.equal(form.hasAttribute('data-edulog-replaced'), true)
  assert.equal(tiles(s.doc).map(item => item.querySelector('strong').textContent).join('|'), '學生丙|學生庚|學生甲|學生乙|學生辛|學生丁')
  const status = name => tile(s.doc, name).querySelector('.edulog-badge').textContent
  assert.equal(status('學生甲'), '未點名'); assert.equal(status('學生乙'), '出席'); assert.equal(status('學生丙'), '缺席')
  assert.match(tile(s.doc, '學生甲').textContent, /本堂 L3/)
  assert.match(tile(s.doc, '學生甲').textContent, /菁英_Python程式開發班/)
  assert.match(section(s.doc).querySelector('.edulog-qa-counts').textContent, /應出 6.*出席 4.*缺席 1.*未點名 1/)
  s.result.restore()
  assert.equal(form.hasAttribute('data-edulog-replaced'), false)
  assert.equal(section(s.doc), null)
  s.dom.window.close()
})

test('a tile toggles the native checkbox; select all, invert and clear work on the native form', () => {
  const s = classPage()
  const box = tile(s.doc, '學生甲').querySelector('input[type=checkbox]')
  box.click()
  assert.equal(native(s.doc, 7002).checked, true)
  assert.equal(tile(s.doc, '學生甲').dataset.selected, 'true')
  assert.match(section(s.doc).querySelector('.edulog-qa-selected').textContent, /已選 1 位/)
  button(s.doc, '全選').click()
  assert.equal(ROSTER.every(([, id]) => native(s.doc, id).checked), true)
  button(s.doc, '反選').click()
  assert.equal(ROSTER.some(([, id]) => native(s.doc, id).checked), false)
  native(s.doc, 7005).checked = true; button(s.doc, '反選').click()
  assert.equal(native(s.doc, 7005).checked, false); assert.equal(native(s.doc, 7002).checked, true)
  button(s.doc, '清除').click()
  assert.equal(ROSTER.some(([, id]) => native(s.doc, id).checked), false)
  assert.equal(button(s.doc, '設定為出席').disabled, true)
  s.dom.window.close()
})

test('出席 clicks the native submit; 不出席 asks first, naming the students', () => {
  const s = classPage()
  tile(s.doc, '學生甲').querySelector('input').click()
  tile(s.doc, '學生乙').querySelector('input').click()
  const asked = []
  s.w.confirm = message => { asked.push(message); return false }
  button(s.doc, '設定為不出席').click()
  assert.equal(s.submitted.length, 0)
  assert.match(asked[0], /2 位.*不出席/); assert.match(asked[0], /學生乙/); assert.match(asked[0], /學生甲/)
  s.w.confirm = () => true
  button(s.doc, '設定為不出席').click()
  assert.deepEqual(s.submitted, [{ type: '1', ids: ['7002', '7005'] }])
  assert.equal(button(s.doc, '送出中…').disabled, true)
  s.dom.window.close()
})

test('出席 submits without a confirmation', () => {
  const s = classPage()
  s.w.confirm = () => { throw new Error('should not ask') }
  tile(s.doc, '學生甲').querySelector('input').click()
  button(s.doc, '設定為出席').click()
  assert.deepEqual(s.submitted, [{ type: '0', ids: ['7002'] }])
  s.dom.window.close()
})

test('once everyone is marked the block folds into a summary that can be reopened', () => {
  const s = classPage({ roster: ROSTER.filter(([name]) => name !== '學生甲') })
  const details = section(s.doc).querySelector('details.edulog-qa-done')
  assert.ok(details)
  assert.equal(details.open, false)
  assert.match(details.querySelector('summary').textContent, /已點名 5\/5：出席 4、缺席 1/)
  details.open = true; details.dispatchEvent(new s.w.Event('toggle'))
  assert.equal(s.view.quickAttendanceOpen, true)
  s.dom.window.close()
})

test('a checkbox whose report is not in the table still gets a tile from the header text', () => {
  const s = classPage({ roster: [...ROSTER, ['學生壬', 7999]] })
  const lost = tile(s.doc, '學生壬')
  assert.ok(lost)
  assert.equal(lost.querySelector('.edulog-badge').textContent, '—')
  lost.querySelector('input').click()
  assert.equal(native(s.doc, 7999).checked, true)
  s.dom.window.close()
})

test('the 尚未點名 badge on a student card jumps to that student\'s tile', () => {
  const s = classPage()
  const card = [...s.doc.querySelectorAll('.edulog-session-card')].find(item => item.querySelector('.edulog-row-name').textContent === '學生甲')
  const jump = card.querySelector('[data-status="attendance"] button.edulog-status-jump')
  assert.ok(jump)
  assert.equal(jump.getAttribute('aria-label'), '學生甲 尚未點名，前往快速點名')
  let scrolled = null
  const target = tile(s.doc, '學生甲'); target.scrollIntoView = options => { scrolled = options }
  jump.click()
  assert.ok(scrolled)
  assert.equal(target.hasAttribute('data-edulog-flash'), true)
  assert.equal(native(s.doc, 7002).checked, false)
  s.dom.window.close()
})

test('pages without the quick-attendance form are untouched', () => {
  const s = classPage({ mutate: doc => doc.querySelector('form[action$="/update_attendance"]').remove() })
  assert.equal(section(s.doc), null)
  s.dom.window.close()
})
