import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// Fixtures are de-identified copies of the real #accounts-modal structure, including the
// provider's broken email pattern and duplicated AnyDesk form id.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
function modalPage(name) {
  const dom = new JSDOM(read(`fixtures/${name}.html`), { url: 'https://corp.orangeapple.co/courses/dt/101', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, original = w.document.body.outerHTML, copied = []
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { copied.push(text) } }, configurable: true })
  for (const file of ['lexicon', 'model', 'accounts', 'workflows']) w.eval(read(`../sites/orange-apple/orange-apple-${file}.js`))
  w.eval(read('../sites/orange-apple/orange-apple.js'))
  const enhancement = w.edulogSiteAdapter.enhanceDialogs(w.document, {})
  return { dom, w, doc: w.document, original, copied, enhancement }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const accounts = doc => [...doc.querySelectorAll('.edulog-account')]
const section = (doc, id) => doc.getElementById(id).getAttribute('data-edulog-account-section')

test('configured platforms become a list with masked passwords; native sections are closed', () => {
  const s = modalPage('accounts-exam')
  assert.equal(s.doc.querySelector('#accounts-modal').dataset.edulogDialog, 'accounts')
  assert.equal(accounts(s.doc).map(item => item.querySelector('strong').textContent).join('|'), '橘子蘋果學苑|測驗平台')
  const ks = accounts(s.doc)[0]
  assert.equal(ks.querySelector('code').textContent, 'student_b')
  assert.equal(ks.querySelector('.edulog-account-secret').textContent, '••••••••')
  assert.equal(s.doc.body.textContent.includes('pw-sample-2'), false, 'the password is not shown as text anywhere')
  const exam = accounts(s.doc)[1]
  assert.equal(exam.querySelector('dt').textContent, '網址')
  assert.equal(exam.querySelector('a').getAttribute('rel'), 'noopener noreferrer')
  assert.equal(exam.querySelector('.edulog-account-secret'), null)
  for (const id of ['ks_account_form', 'app_account', 'roblox_account', 'exam_account', 'mc_account', 'anydesk_account']) assert.equal(section(s.doc, id), 'closed', id)
  assert.equal(s.doc.querySelector('#ks_password').type, 'password')
  assert.equal(s.doc.querySelector('#ks_password').value, 'pw-sample-2')
  s.dom.window.close()
})

test('show, copy and edit work without changing the native values', async () => {
  const s = modalPage('accounts-exam')
  const ks = accounts(s.doc)[0]
  const show = [...ks.querySelectorAll('button')].find(button => button.textContent === '顯示')
  show.click()
  assert.equal(ks.querySelector('.edulog-account-secret').textContent, 'pw-sample-2')
  assert.equal(show.getAttribute('aria-pressed'), 'true')
  show.click()
  assert.equal(ks.querySelector('.edulog-account-secret').textContent, '••••••••')
  const copies = [...ks.querySelectorAll('button')].filter(button => button.textContent === '複製')
  copies[0].click(); await tick()
  copies[1].click(); await tick()
  assert.equal(JSON.stringify(s.copied), JSON.stringify(['student_b', 'pw-sample-2']))
  assert.equal(copies[1].textContent, '已複製')
  const edit = ks.querySelector('.edulog-account-head button')
  edit.click()
  assert.equal(section(s.doc, 'ks_account_form'), 'open')
  assert.equal(edit.getAttribute('aria-expanded'), 'true')
  assert.equal(s.doc.activeElement, s.doc.querySelector('#ks_account'))
  const reveal = s.doc.querySelector('#ks_password').nextElementSibling
  reveal.click()
  assert.equal(s.doc.querySelector('#ks_password').type, 'text')
  edit.click()
  assert.equal(section(s.doc, 'ks_account_form'), 'closed')
  s.dom.window.close()
})

test('the add menu lists unconfigured platforms and opens the native form through its own button', () => {
  const s = modalPage('accounts-basic')
  assert.equal(accounts(s.doc).length, 1)
  const select = s.doc.querySelector('.edulog-account-add select')
  assert.equal([...select.options].map(option => option.textContent).join('|'), 'APP|Roblox|測驗平台|麥塊|AnyDesk')
  assert.equal(s.doc.querySelector('button[onclick*="remove_hidden"]').parentElement.hasAttribute('data-edulog-replaced'), true)
  let nativeReveal = 0
  s.doc.querySelector('button[onclick*="#roblox_account"]').addEventListener('click', () => nativeReveal++)
  select.value = 'roblox'
  s.doc.querySelector('.edulog-account-add .edulog-account-primary').click()
  assert.equal(nativeReveal, 1)
  assert.equal(section(s.doc, 'roblox_account'), 'open')
  assert.equal(s.doc.activeElement, s.doc.querySelector('input[id="roblox_account"]'))
  s.dom.window.close()
})

test('broken provider email patterns are fixed reversibly and AnyDesk no longer requires an email', () => {
  const s = modalPage('accounts-basic')
  const roblox = s.doc.querySelector('input[id="roblox_account"]'), mc = s.doc.querySelector('input[id="mc_account"]'), anydesk = s.doc.querySelector('input[id="anydesk_account"]')
  for (const input of [roblox, mc]) {
    input.value = 'teacher@example.com'
    assert.equal(input.validity.patternMismatch, false, input.id)
    input.value = 'not-an-email'
    assert.equal(input.validity.patternMismatch, true, input.id)
  }
  assert.equal(anydesk.getAttribute('pattern'), '.*')
  anydesk.value = '123456789'
  assert.equal(anydesk.validity.valid, true)
  assert.equal(s.doc.querySelector('#ks_account').getAttribute('pattern'), '^[a-zA-Z0-9_.]*$', 'correct provider patterns stay untouched')
  s.dom.window.close()
})

test('restore returns the exact original modal', () => {
  for (const name of ['accounts-basic', 'accounts-exam']) {
    const s = modalPage(name)
    assert.equal(s.enhancement.isCurrent(), true)
    s.enhancement.restore()
    assert.equal(s.doc.body.outerHTML, s.original, name)
    s.dom.window.close()
  }
})
