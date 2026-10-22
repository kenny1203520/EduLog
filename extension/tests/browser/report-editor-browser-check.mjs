import { loadPlaywright, launchBrowser } from './browser-runtime.mjs'
import { siteFiles } from '../site-files.mjs'
// Optional visual check for the lesson report editor. Local de-identified fixture only;
// no real site requests.
// node tests/report-editor-browser-check.mjs <playwright/index.mjs> [screenshots-dir]
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = await loadPlaywright(process.argv.slice(2).find(arg => !arg.startsWith('--')))
const output = process.argv[3] || mkdtempSync(join(tmpdir(), 'edulog-editor-'))
mkdirSync(output, { recursive: true })
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const css = read('../../styles/edulog-tokens.css') + read('../../sites/orange-apple/site.css') + read('../../content/dialog-layout.css') + read('../fixtures/native-bootstrap-dialog.css')
const scripts = ['../../sites/orange-apple/core/lexicon.js', '../../sites/orange-apple/core/model.js', '../../sites/orange-apple/features/report-editor.js', ...siteFiles('workflows').map(file => '../../' + file), '../../sites/orange-apple/core/adapter.js']
const browser = await launchBrowser(chromium)
try {
  for (const width of [360, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    const html = read('../fixtures/real-report-editor.html').replace('</head>', `<style>${css}</style></head>`)
    await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort())
    await page.goto('https://corp.orangeapple.co/courses/dt/101')
    await page.evaluate(() => document.documentElement.setAttribute('data-edulog-ui', 'on'))
    for (const file of scripts) await page.addScriptTag({ content: read(file) })
    await page.evaluate(() => { window.enhanced = window.edulogSiteAdapter.enhanceDialogs(document, {}) })
    const label = `editor ${width}`
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: page overflow`)
    const fits = await page.locator('#lesson-report-modal .modal-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1)
    assert.ok(fits, `${label}: modal content fits`)
    const small = await page.locator('#lesson-report-modal :is(.edulog-phrase,.edulog-phrase-tabs button,.edulog-rating-clear,.edulog-submit-check button):visible').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 44).map(el => el.textContent))
    assert.deepEqual(small, [], `${label}: targets at least 44px`)
    await page.locator('#lesson_report_attendance_status').selectOption('attended')
    await page.locator('.edulog-phrase').nth(1).click()
    assert.match(await page.locator('#lesson_report_feedback').inputValue(), /今天的進度第11課/, `${label}: phrase inserted with lesson`)
    await page.screenshot({ path: join(output, `editor-${width}.png`), fullPage: true })
    await page.locator('#lesson_report_attendance_status').selectOption('absent')
    assert.equal(await page.locator('.admission_lesson_report_feedback').isVisible(), false, `${label}: absent hides feedback`)
    assert.equal(await page.locator('.dt_admission_lesson_report_contact').isVisible(), true, `${label}: absent keeps contact`)
    await page.evaluate(() => window.enhanced.restore())
    assert.equal(await page.locator('.edulog-phrases').count(), 0, `${label}: restore removes additions`)
    console.log(`${label}: passed`)
    await page.close()
  }
} finally { await browser.close() }
console.log(`Screenshots: ${output}`)
