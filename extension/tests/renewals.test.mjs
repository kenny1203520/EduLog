import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from '../../app/node_modules/jsdom/lib/api.js'

// tests/fixtures/renewals.html is de-identified but keeps the real 「剩餘課堂」 structure: stacked
// contact cell, class link plus course, badge-coloured order and renewal status, and the provider's
// renewal menu (whose own click handler never binds).
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const SCRIPTS = [...['lexicon', 'model', 'renewals', 'workflows'].map(name => `sites/orange-apple/orange-apple-${name}.js`), 'sites/orange-apple/orange-apple.js']
function page({ locale = 'zh-TW', fetch, confirm = () => true } = {}) {
  let html = read('fixtures/renewals.html')
  if (locale !== 'zh-TW') html = html.replace('btn btn-sm btn-primary me-1 mb-1" href="/locale?locale=zh-TW"', 'btn btn-sm btn-outline-secondary me-1 mb-1" href="/locale?locale=zh-TW"').replace(`btn-outline-secondary me-1 mb-1" href="/locale?locale=${locale}"`, `btn-primary me-1 mb-1" href="/locale?locale=${locale}"`).replace(`btn-outline-secondary mb-1" href="/locale?locale=${locale}"`, `btn-primary mb-1" href="/locale?locale=${locale}"`)
  const dom = new JSDOM(html, { url: 'https://corp.orangeapple.co/dt_admissions', runScripts: 'outside-only', pretendToBeVisual: true })
  const w = dom.window, calls = []
  w.confirm = message => { calls.push(['confirm', message]); return confirm(message) }
  w.fetch = async (url, init) => { calls.push(['fetch', url, init]); return fetch ? fetch(url, init) : { ok: true, status: 200 } }
  for (const file of SCRIPTS) w.eval(read(`../${file}`))
  const view = {}
  const result = w.edulogSiteAdapter.enhancePage(w.document, view)
  return { w, doc: w.document, view, result, calls }
}
const groups = doc => [...doc.querySelectorAll('.edulog-renewal-list .edulog-unfilled-group')].map(group => ({
  label: group.querySelector('.edulog-unfilled-head > span:not(.edulog-status-dot):not(.edulog-unfilled-count)')?.textContent,
  open: group.querySelector('.edulog-unfilled-head').getAttribute('aria-expanded') === 'true',
  names: [...group.querySelectorAll('.edulog-renewal-row strong')].map(node => node.textContent),
}))
const row = (doc, name) => [...doc.querySelectorAll('.edulog-renewal-row')].find(item => item.querySelector('strong')?.textContent === name)
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('the renewal table is read by its headers and badge colours', () => {
  const { w, doc } = page()
  const items = w.edulogSiteRenewals.read(doc.querySelector('#dt-admissions table'))
  assert.equal(items.length, 5)
  const first = JSON.parse(JSON.stringify({ ...items[0], row: undefined, codes: [...items[0].codes] }))
  assert.deepEqual(first, { id: '9101', name: '學生甲', contact: { parent: '學生甲家長', phone: '0900000001', email: 'parent1@example.com' }, className: '測試分校_201教室 - 週六 第 1 時段 (10:00 ~ 12:00)', classPath: '/courses/dt/101', course: '菁英_Python 程式進階班', order: { label: '已付款', tone: 'ok', date: '26-06-22' }, next: { label: '已付款', tone: 'ok', date: '26-06-22' }, remaining: 2, makeup: 2, renew: 'renewed', owner: '業務甲', codes: ['renewed', 'pending', 'not-renew'] })
  assert.equal(items[1].remaining, -7)
  assert.deepEqual([...items].map(item => item.renew), ['renewed', 'renewed', 'pending', 'pending', 'not-renew'])
})

test('rows are grouped 未續班 → 已續班 → 不續班, fewest lessons left first, with 不續班 folded', () => {
  const { doc, result } = page()
  assert.ok(result)
  assert.equal(doc.querySelector('#dt-admissions').getAttribute('data-edulog-cards'), 'on')
  assert.ok(doc.querySelector('form[data-edulog-renew-filter]'))
  assert.deepEqual(groups(doc), [
    { label: '未續班', open: true, names: ['學生丁', '學生丙'] },
    { label: '已續班', open: true, names: ['學生乙', '學生甲'] },
    { label: '不續班', open: false, names: ['學生戊'] },
  ])
  assert.equal(row(doc, '學生乙').dataset.bar, 'danger')
  assert.equal(row(doc, '學生丁').dataset.bar, 'warn')
  assert.match(doc.querySelector('.edulog-renewal-list .edulog-unfilled-summary').textContent, /未續班 2 · 已續班 2 · 不續班 1 · 剩餘 2 堂以下 3 位/)
})

test('contact details stay hidden until asked for', () => {
  const { doc } = page()
  assert.equal(doc.querySelector('.edulog-renewal-list a[href^="tel:"]'), null)
  assert.ok(!doc.querySelector('.edulog-renewal-list').textContent.includes('0900000004'))
  row(doc, '學生丁').querySelector('button.edulog-phone').click()
  assert.equal(row(doc, '學生丁').querySelector('a[href^="tel:"]').getAttribute('href'), 'tel:0900000004')
  assert.equal(row(doc, '學生丁').querySelector('a[href^="mailto:"]').getAttribute('href'), 'mailto:parent4@example.com')
  assert.equal(row(doc, '學生丙').querySelector('a[href^="tel:"]'), null)
})

test('a renewal change asks first, sends one PUT with the CSRF token, and updates the provider badge', async () => {
  const { doc, calls } = page()
  row(doc, '學生丁').querySelector('[data-renew="renewed"]').click()
  await settle()
  const sent = calls.filter(([kind]) => kind === 'fetch')
  assert.equal(calls[0][0], 'confirm')
  assert.equal(sent.length, 1)
  const [, url, init] = sent[0]
  assert.equal(url, 'https://corp.orangeapple.co/dt_admissions/9104.json')
  assert.equal(init.method, 'PUT'); assert.equal(init.credentials, 'same-origin')
  assert.equal(init.headers['X-CSRF-Token'], 'test-csrf-token')
  assert.deepEqual(JSON.parse(init.body), { dt_admission: { renew_status: 'renewed' } })
  const badge = [...doc.querySelectorAll('#dt-admissions tr')].find(tr => tr.cells[0]?.textContent === '學生丁').querySelector('span.renew-status')
  assert.equal(badge.textContent, '已續班'); assert.ok(badge.classList.contains('text-bg-success') && !badge.classList.contains('text-bg-warning'))
  assert.deepEqual(groups(doc).map(group => group.names), [['學生丙'], ['學生乙', '學生丁', '學生甲'], ['學生戊']])
  assert.equal(row(doc, '學生丁').querySelector('[data-renew="renewed"]').getAttribute('aria-pressed'), 'true')
  assert.match(doc.querySelector('.edulog-renewal-notice').textContent, /已將 學生丁 設為「已續班」/)
})

test('cancelling sends nothing; a refused change leaves the provider badge as it was', async () => {
  const cancelled = page({ confirm: () => false })
  row(cancelled.doc, '學生丙').querySelector('[data-renew="not-renew"]').click()
  await settle()
  assert.equal(cancelled.calls.filter(([kind]) => kind === 'fetch').length, 0)

  const refused = page({ fetch: () => ({ ok: false, status: 422 }) })
  row(refused.doc, '學生丙').querySelector('[data-renew="not-renew"]').click()
  await settle()
  const badge = [...refused.doc.querySelectorAll('#dt-admissions tr')].find(tr => tr.cells[0]?.textContent === '學生丙').querySelector('span.renew-status')
  assert.equal(badge.textContent, '未續班'); assert.ok(badge.classList.contains('text-bg-warning'))
  assert.equal(refused.doc.querySelector('.edulog-renewal-notice').dataset.tone, 'danger')
  assert.match(refused.doc.querySelector('.edulog-renewal-notice').textContent, /422/)
  assert.deepEqual(groups(refused.doc)[0].names, ['學生丁', '學生丙'])
})

test('unknown statuses, ids or a missing token are refused before any request', async () => {
  const { w, doc, calls } = page()
  const api = w.edulogSiteRenewals, item = api.read(doc.querySelector('#dt-admissions table'))[2]
  await assert.rejects(api.change({ doc, item, status: 'archived' }))
  await assert.rejects(api.change({ doc, item: { ...item, id: '91x' }, status: 'renewed' }))
  doc.querySelector('meta[name="csrf-token"]').remove()
  await assert.rejects(api.change({ doc, item, status: 'renewed' }))
  assert.equal(calls.filter(([kind]) => kind === 'fetch').length, 0)
})

test('the renewal list reads the same with the site in zh-CN or English', () => {
  const reference = groups(page().doc)
  for (const locale of ['zh-CN', 'en']) assert.deepEqual(groups(page({ locale }).doc), reference, locale)
})
