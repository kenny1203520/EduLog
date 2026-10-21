import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// tests/fixtures/sign-in.html keeps the real Devise sign-in structure with placeholder tokens.
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const SCRIPTS = [...['lexicon', 'model', 'navigation', 'renewals', 'workflows'].map(name => `sites/orange-apple/orange-apple-${name}.js`), 'sites/orange-apple/orange-apple.js']
function page(locale = 'zh-TW') {
  let html = read('fixtures/sign-in.html')
  if (locale !== 'zh-TW') html = html.replace('btn-primary me-1 mb-1" data-turbo="false" href="/locale?locale=zh-TW"', 'btn-outline-secondary me-1 mb-1" data-turbo="false" href="/locale?locale=zh-TW"').replace(new RegExp(`btn-outline-secondary( me-1)? mb-1" data-turbo="false" href="/locale\\?locale=${locale}"`), `btn-primary$1 mb-1" data-turbo="false" href="/locale?locale=${locale}"`)
  const dom = new JSDOM(html, { url: 'https://corp.orangeapple.co/employees/sign_in', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, doc = w.document
  // Count every read of what the teacher types: EduLog must never read it.
  let reads = 0
  for (const input of doc.querySelectorAll('#employee_email, #employee_password')) {
    const descriptor = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value')
    Object.defineProperty(input, 'value', { configurable: true, get() { reads++; return descriptor.get.call(this) }, set(value) { descriptor.set.call(this, value) } })
  }
  for (const file of SCRIPTS) w.eval(read(`../${file}`))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(doc, view)
  return { w, doc, view, result, reads: () => reads }
}

test('the sign-in page becomes one card around the native form', () => {
  const { doc, view, result, reads } = page()
  assert.ok(result)
  assert.equal(doc.documentElement.dataset.edulogPage, 'sign-in')
  const card = doc.querySelector('.edulog-signin')
  assert.ok(card.contains(doc.querySelector('form#new_employee')))
  assert.ok(card.querySelector('[data-edulog-signin-alert]').textContent.includes('您需要先登入'))
  assert.ok(card.querySelector('footer .locale-selector'))
  assert.equal(card.querySelector('footer a[href="/employees/password/new"]').textContent, '忘記密碼？')
  assert.ok([...doc.querySelectorAll('#page-body > .content h2')].find(heading => !card.contains(heading)).hasAttribute('data-edulog-replaced'))
  assert.deepEqual([...doc.querySelectorAll('.edulog-signin label')].map(label => label.textContent), ['電子郵件', '密碼', '記住我'])
  // Nothing about the native form changes: fields, autocomplete, target and method.
  const form = doc.querySelector('form#new_employee')
  assert.equal(form.getAttribute('action'), '/employees/sign_in'); assert.equal(form.getAttribute('method'), 'post')
  assert.deepEqual([...form.querySelectorAll('input')].map(input => [input.name, input.type, input.getAttribute('autocomplete')]), [
    ['authenticity_token', 'hidden', 'off'], ['employee[email]', 'email', 'email'], ['employee[password]', 'password', 'current-password'],
    ['employee[remember_me]', 'hidden', 'off'], ['employee[remember_me]', 'checkbox', null], ['commit', 'submit', null],
  ])
  assert.equal(reads(), 0, 'EduLog read what was typed')
  assert.equal(view.navigation, null); assert.equal(doc.querySelector('.edulog-nav'), null)
})

test('restoring puts the native sign-in page back', () => {
  const { doc, result } = page()
  result.restore?.()
  assert.equal(doc.querySelector('.edulog-signin'), null)
  assert.equal(doc.querySelector('label[for=employee_email]').textContent, 'Email')
  assert.ok(doc.querySelector('#page-body > .sidebar .locale-selector'))
  assert.equal(doc.querySelector('form#new_employee').parentElement.classList.contains('content'), false)
})

test('the sign-in card is the same with the site in zh-CN or English', () => {
  const shape = doc => [...doc.querySelectorAll('.edulog-signin > *')].map(node => node.tagName + (node.id ? `#${node.id}` : ''))
  const reference = shape(page().doc)
  for (const locale of ['zh-CN', 'en']) assert.deepEqual(shape(page(locale).doc), reference, locale)
})
