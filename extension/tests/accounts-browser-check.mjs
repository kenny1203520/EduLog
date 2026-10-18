import { loadPlaywright, launchBrowser } from './browser-runtime.mjs'
// Optional visual check for the student learning-account modal. Local de-identified
// fixtures only; no real site requests.
// node tests/accounts-browser-check.mjs <playwright/index.mjs> [screenshots-dir]
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = await loadPlaywright(process.argv.slice(2).find(arg => !arg.startsWith('--')))
const output = process.argv[3] || mkdtempSync(join(tmpdir(), 'edulog-accounts-'))
mkdirSync(output, { recursive: true })
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const css = read('../edulog-tokens.css') + read('../adapters/orange-apple.css') + read('../dialog-layout.css') + read('fixtures/native-bootstrap-dialog.css')
const scripts = ['../adapters/orange-apple-lexicon.js', '../adapters/orange-apple-model.js', '../adapters/orange-apple-accounts.js', '../adapters/orange-apple-workflows.js', '../adapters/orange-apple.js']
const browser = await launchBrowser(chromium)
try {
  for (const fixture of ['accounts-basic', 'accounts-exam']) for (const width of [360, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const html = read(`fixtures/${fixture}.html`).replace('</head>', `<style>${css}</style></head>`)
    await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort())
    await page.goto('https://corp.orangeapple.co/courses/dt/101')
    await page.evaluate(() => { document.documentElement.setAttribute('data-edulog-ui', 'on'); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied = text } }, configurable: true }) })
    for (const file of scripts) await page.addScriptTag({ content: read(file) })
    await page.evaluate(() => { window.enhanced = window.edulogSiteAdapter.enhanceDialogs(document, {}) })
    const label = `${fixture} ${width}`
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page overflow`)
    const modalFits = await page.locator('#accounts-modal .modal-content').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1 })
    assert.ok(modalFits, `${label}: modal content fits`)
    const small = await page.locator('.edulog-accounts button:visible, .edulog-accounts select:visible, .edulog-accounts a:visible').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 44).map(el => el.textContent))
    assert.deepEqual(small, [], `${label}: targets at least 44px`)
    assert.equal(await page.locator('.edulog-account-secret').first().textContent(), '••••••••', `${label}: password masked`)
    await page.locator('.edulog-account-head button').first().click()
    assert.equal(await page.locator('#ks_account_form').isVisible(), true, `${label}: edit opens the native form`)
    assert.equal(await page.locator('#ks_password').getAttribute('type'), 'password', `${label}: native password masked`)
    await page.screenshot({ path: join(output, `accounts-${fixture}-${width}.png`), fullPage: true })
    await page.evaluate(() => window.enhanced.restore())
    assert.equal(await page.locator('.edulog-accounts').count(), 0, `${label}: restore removes the list`)
    console.log(`${label}: passed`)
    await page.close()
  }
} finally { await browser.close() }
console.log(`Screenshots: ${output}`)
