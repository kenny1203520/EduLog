import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const tick = () => new Promise(resolve => setTimeout(resolve, 40))
function fixture(name = 'hours-nested') {
  const dom = new JSDOM(read(`fixtures/${name}.html`), { url: 'https://corp.orangeapple.co/my/hour', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, doc = w.document
  for (const file of ['adapters/orange-apple-workflows.js', 'adapters/orange-apple.js']) w.eval(read(`../${file}`))
  return { dom, w, doc, enhance: () => w.edulogSiteAdapter.enhancePage(doc) }
}
for (const name of ['hours', 'hours-nested']) test(`${name}: preserves native query, events and exact restore across repeat applications`, () => {
  const s = fixture(name), form = s.doc.querySelector('form'), year = form.querySelector('[name=year]'), month = form.querySelector('[name=month]')
  const before = s.doc.documentElement.outerHTML
  let changes = 0, submits = 0
  year.addEventListener('change', () => changes++)
  form.addEventListener('submit', event => { event.preventDefault(); submits++ })
  for (let i = 0; i < 2; i++) {
    const enhanced = s.enhance()
    assert.equal(year.form, form); assert.equal(month.form, form)
    assert.equal(s.doc.querySelectorAll('label label').length, 0)
    year.dispatchEvent(new s.w.Event('change', { bubbles: true }))
    form.requestSubmit()
    assert.deepEqual([...new s.w.FormData(form)], [[year.name, year.value], [month.name, month.value]])
    enhanced.restore(); assert.equal(s.doc.documentElement.outerHTML, before)
    enhanced.restore(); assert.equal(s.doc.documentElement.outerHTML, before)
  }
  assert.equal(changes, 2); assert.equal(submits, 2)
  // Calling an old restore cannot undo later native updates.
  const enhanced = s.enhance(); enhanced.restore(); year.setAttribute('aria-label', '原站新標籤'); enhanced.restore()
  assert.equal(year.getAttribute('aria-label'), '原站新標籤')
  s.dom.window.close()
})
test('existing wrapping and associated labels are not duplicated or nested', () => {
  const s = fixture(), year = s.doc.querySelector('[name=year]'), month = s.doc.querySelector('[name=month]')
  const label = s.doc.createElement('label'); label.textContent = '原站年份'; year.before(label); label.append(year)
  month.insertAdjacentHTML('beforebegin', '<label for="query-month">原站月份</label>')
  const before = s.doc.documentElement.outerHTML
  const enhanced = s.enhance()
  assert.equal(s.doc.querySelectorAll('label').length, 2)
  assert.equal(year.parentElement, label); assert.equal(month.labels.length, 1)
  enhanced.restore(); assert.equal(s.doc.documentElement.outerHTML, before); s.dom.window.close()
})
for (const malformed of ['missing-month', 'different-form']) test(`incomplete hours structure ${malformed} stays native`, () => {
  const s = fixture(), month = s.doc.querySelector('[name=month]')
  if (malformed === 'missing-month') month.remove()
  else { const other = s.doc.createElement('form'); other.id = 'other'; s.doc.body.append(other); month.setAttribute('form', 'other') }
  const before = s.doc.documentElement.outerHTML
  assert.equal(s.enhance(), null); assert.equal(s.doc.documentElement.outerHTML, before); s.dom.window.close()
})
test('partial enhancement rolls back additions, moves, attributes, text and listeners', () => {
  const s = fixture(), year = s.doc.querySelector('[name=year]'), heading = s.doc.querySelector('h1')
  const before = s.doc.documentElement.outerHTML
  let calls = 0
  s.w.edulogSiteWorkflows = { enhancePage({ scope, content }) {
    const wrapper = scope.add(scope.element('section')); content.append(wrapper)
    scope.move(year, wrapper); scope.mark(year, 'data-test', 'changed'); scope.text(heading, 'changed')
    scope.listen(year, 'change', () => calls++)
    throw new Error('synthetic failure')
  } }
  assert.throws(s.enhance, /synthetic failure/)
  assert.equal(s.doc.documentElement.outerHTML, before)
  year.dispatchEvent(new s.w.Event('change')); assert.equal(calls, 0); s.dom.window.close()
})
test('replacing native select invalidates enhancement without resurrecting removed control', () => {
  const s = fixture(), old = s.doc.querySelector('[name=year]'), first = s.enhance()
  const replacement = old.cloneNode(true); replacement.value = '2025'; old.replaceWith(replacement)
  assert.equal(first.isCurrent(), false); first.restore()
  assert.equal(s.doc.querySelector('[name=year]'), replacement); assert.equal(old.isConnected, false)
  const next = s.enhance(); assert.equal(new s.w.FormData(replacement.form).get('year'), '2025')
  next.restore(); s.dom.window.close()
})
test('dialog failure restores every scope created before the error', () => {
  const s = fixture(), before = s.doc.documentElement.outerHTML
  s.w.edulogSiteWorkflows = { enhanceDialogs(doc, view, createScope) {
    for (const tag of ['section', 'aside']) {
      const scope = createScope(doc); doc.body.append(scope.add(scope.element(tag)))
      scope.mark(doc.querySelector('form'), `data-${tag}`, 'changed')
    }
    throw new Error('synthetic dialog failure')
  } }
  assert.throws(() => s.w.edulogSiteAdapter.enhanceDialogs(s.doc), /synthetic dialog failure/)
  assert.equal(s.doc.documentElement.outerHTML, before); s.dom.window.close()
})
async function controller(failAt = 'apply') {
  const s = fixture(), native = s.w.edulogSiteWorkflows, sent = [], errors = []
  const draft = s.doc.createElement('textarea'); draft.value = '尚未送出的內容'
  s.doc.querySelector('form').append(draft); draft.focus(); draft.setSelectionRange(1, 3)
  let fault = failAt, attempts = 0
  s.w.addEventListener('error', e => errors.push(e.error))
  s.w.addEventListener('unhandledrejection', e => errors.push(e.reason))
  s.w.edulogSiteWorkflows = { ...native, enhancePage(context) {
    attempts++
    const result = native.enhancePage(context)
    if (fault === 'apply') throw new Error('synthetic apply failure')
    return { ...result, refresh() { result?.refresh?.(); if (fault === 'refresh') throw new Error('synthetic refresh failure') } }
  } }
  s.w.chrome = { runtime: { sendMessage: async data => { sent.push(data); return { enabled: data.enabled ?? true } }, onMessage: { addListener() {} } } }
  for (const file of ['runtime-bridge.js', 'bootstrap.js', 'connection-ui.js', 'integration-ui.js', 'content.js']) s.w.eval(read(`../${file}`))
  await tick()
  return { ...s, draft, sent, errors, attempts: () => attempts, clearFault: () => { fault = null }, close() {
    s.doc.dispatchEvent(new s.w.Event('turbo:before-cache'))
    s.w.edulogUiBoot.release(); s.dom.window.close()
  } }
}
function checkFallback(s) {
  assert.equal(s.doc.documentElement.hasAttribute('data-edulog-ui'), false)
  assert.equal(s.doc.documentElement.hasAttribute('data-edulog-pending'), false)
  assert.equal(s.doc.querySelector('[data-edulog-hours-filter]'), null)
  assert.equal(s.doc.querySelectorAll('#edulog-extension-root').length, 1)
  assert.equal(s.doc.querySelector('#edulog-extension-root').shadowRoot.querySelectorAll('.notice:not([hidden])').length, 1)
  assert.equal(s.w.edulogUiBoot.preferred, true)
  assert.deepEqual(s.errors, [])
  assert.equal(s.sent.some(data => data.type === 'set-ui-preferences' && data.enabled === false), false)
}
test('initial failure releases loading and blocks observer retries; manual retry preserves query', async () => {
  const s = await controller(), year = s.doc.querySelector('[name=year]')
  checkFallback(s); assert.equal(s.doc.querySelectorAll('label[data-edulog-owned]').length, 0)
  assert.equal(s.doc.activeElement, s.draft); assert.equal(s.draft.selectionStart, 1)
  assert.equal(s.draft.selectionEnd, 3); assert.equal(s.draft.value, '尚未送出的內容')
  const attempts = s.attempts(); year.value = '2025'
  s.doc.querySelector('h1').append('更新'); await tick(); checkFallback(s); assert.equal(s.attempts(), attempts)
  // Failed manual retry also leaves the preferred theme enabled.
  s.doc.querySelector('#edulog-extension-root').shadowRoot.querySelector('.toggle').click(); await tick(); checkFallback(s)
  s.clearFault(); s.doc.querySelector('#edulog-extension-root').shadowRoot.querySelector('.toggle').click(); await tick()
  assert.equal(s.doc.documentElement.dataset.edulogUi, 'on')
  assert.equal(s.doc.querySelector('[name=year]'), year); assert.equal(year.value, '2025')
  assert.equal(s.doc.querySelector('#edulog-extension-root').shadowRoot.querySelector('.notice').hidden, true)
  assert.deepEqual(s.errors, []); s.close()
})
test('refresh failure restores native form and focus; a new Turbo visit can reapply', async () => {
  const s = await controller('refresh'), month = s.doc.querySelector('[name=month]')
  month.value = '8'; month.focus()
  s.doc.querySelector('table td').textContent = '局部更新'; await tick()
  checkFallback(s); assert.equal(s.doc.activeElement, month); assert.equal(month.value, '8')
  s.clearFault(); s.doc.dispatchEvent(new s.w.Event('turbo:visit'))
  const event = new s.w.CustomEvent('turbo:before-render', { detail: { render() {} } })
  s.doc.dispatchEvent(event); await event.detail.render()
  assert.equal(s.doc.documentElement.dataset.edulogUi, 'on')
  assert.equal(s.doc.querySelector('[name=month]'), month); assert.equal(month.value, '8')
  assert.equal(s.doc.documentElement.hasAttribute('data-edulog-pending'), false)
  s.close()
})
test('Turbo rendering succeeds even when extension enhancement fails and returns native content', async () => {
  const s = await controller(), before = s.attempts()
  s.doc.dispatchEvent(new s.w.Event('turbo:visit'))
  const event = new s.w.CustomEvent('turbo:before-render', { detail: { render: () => 'native-render-result' } })
  s.doc.dispatchEvent(event); assert.equal(await event.detail.render(), 'native-render-result')
  checkFallback(s); assert.equal(s.attempts(), before + 1); s.close()
})
test('controller rebuild after native filter replacement keeps the new selection and form', async () => {
  const s = await controller(null), form = s.doc.querySelector('form'), old = s.doc.querySelector('[name=year]')
  const replacement = old.cloneNode(true); replacement.value = '2025'; old.replaceWith(replacement); await tick()
  assert.equal(s.doc.documentElement.dataset.edulogUi, 'on')
  assert.equal(s.doc.querySelector('[name=year]'), replacement)
  assert.equal(replacement.form, form); assert.equal(replacement.value, '2025')
  assert.equal(s.doc.querySelectorAll('[name=year]').length, 1)
  assert.equal(s.doc.querySelectorAll('#edulog-extension-root').length, 1)
  assert.equal(s.draft.value, '尚未送出的內容'); s.close()
})
