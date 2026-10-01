// Optional visual/keyboard check. No real site requests or personal fixtures.
// node tests/browser-check.mjs <playwright/index.mjs> [screenshots-dir] [native-css-dir]
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = process.argv[2] ? await import(pathToFileURL(process.argv[2]).href) : await import('playwright')
const output = process.argv[3] || mkdtempSync(join(tmpdir(), 'edulog-ui-'))
mkdirSync(output, { recursive: true })
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const css = read('../adapters/orange-apple.css')
let nativeCss = ''
if (process.argv[4]) {
  const dir = process.argv[4]
  const application = readdirSync(dir).find(n => n.startsWith('application-'))
  nativeCss = [application, 'flatpickr.min.css', 'style.min.css', 'all.css', 'jquery.dataTables.min.css', 'bootstrap-table.min.css', 'selectize.bootstrap5.min.css']
    .filter(n => n && existsSync(join(dir, n))).map(n => readFileSync(join(dir, n), 'utf8')).join('\n')
}
const executables = process.platform === 'win32' ? [
  ['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
  ['edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
] : [['chromium', undefined]]
for (const [browserName, executablePath] of executables) {
  if (executablePath && !existsSync(executablePath)) continue
  const browser = await chromium.launch({ headless: true, executablePath })
  try {
    for (const state of ['not-connected', 'pending', 'connected', 'unavailable']) {
      const page = await browser.newPage({ viewport: { width: 360, height: 600 } })
      await page.setContent(read('../popup.html').replace('</head>', `<style>${read('../popup.css')}</style></head>`))
      await page.evaluate(state => {
        window.chrome = {
          storage: { local: { get: async () => ({ edulogExtension: { origin: 'http://localhost:5173', pending: state === 'pending' ? { expiresAt: new Date(Date.now() + 60000).toISOString() } : null } }) } },
          runtime: { sendMessage: async data => data.type === 'get-ui-preferences' ? { enabled: true } : { status: state, origin: 'http://localhost:5173', settingsUrl: 'http://localhost:5173/dashboard/settings?tab=integrations', lastVerifiedAt: new Date().toISOString() } },
        }
      }, state)
      for (const file of ['runtime-bridge.js', 'connection-ui.js', 'popup.js']) await page.addScriptTag({ content: read(`../${file}`) })
      await page.locator(`[data-state="${state}"]`).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${browserName} popup overflow`)
      await page.screenshot({ path: join(output, `${browserName}-popup-${state}.png`), fullPage: true })
      console.log(`${browserName} popup ${state}: passed`)
      await page.close()
    }
    for (const width of [390, 1440]) for (const [name, path] of [['overview', '/'], ['class', '/courses/dt/101'], ['reports', '/courses/dt/101/lesson_reports']]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } })
      const fixture = read(`fixtures/${name}.html`).replace('</head>', `<style>${nativeCss}</style><style>${css}</style></head>`)
      await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort())
      await page.goto(`https://corp.orangeapple.co${path}`)
      await page.evaluate(() => {
        window.chrome = { runtime: { sendMessage: async data => ({ enabled: data.enabled ?? true }), onMessage: { addListener() {} } } }
      })
      await page.addScriptTag({ content: read('../adapters/orange-apple.js') })
      await page.addScriptTag({ content: read('../runtime-bridge.js') })
      await page.addScriptTag({ content: read('../connection-ui.js') })
      await page.addScriptTag({ content: read('../content.js') })
      await page.locator('html[data-edulog-ui=on]').waitFor()
      assert.equal(await page.locator('#edulog-extension-root').count(), 1)
      await page.waitForTimeout(80)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${browserName} ${name} ${width}: page overflow`)
      assert.ok(await page.evaluate(() => document.querySelector('.content h2').getBoundingClientRect().top >= document.querySelector('#edulog-extension-root').shadowRoot.querySelector('.bar').getBoundingClientRect().bottom), `${browserName} ${name} ${width}: toolbar obscures heading`)
      if (name === 'reports' && width === 390) {
        assert.equal(await page.locator('#reports th[data-edulog-week-cell]:visible').count(), 1)
        await page.getByRole('button', { name: /上週/ }).click()
        assert.match(await page.locator('#reports th[data-edulog-week-selected]').textContent(), /上週/)
      }
      if (name === 'class' && width === 390) {
        const row = page.locator('#students-table tbody tr').first()
        assert.equal(await row.locator('[data-edulog-extra]:visible').count(), 0)
        await row.getByRole('button', { name: '更多資料' }).click()
        assert.ok(await row.locator('[data-edulog-extra]:visible').count() > 0)
      }
      await page.screenshot({ path: join(output, `${browserName}-${name}-${width}.png`), fullPage: true })
      // Verify keyboard focus and unchanged native form state on toggle.
      if (name === 'class') await page.locator('textarea').fill('未送出的內容')
      const toggle = page.getByRole('button', { name: '切回原站' })
      await toggle.focus(); await page.keyboard.press('Enter')
      assert.equal(await page.locator('html[data-edulog-ui]').count(), 0)
      if (name === 'class') assert.equal(await page.locator('textarea').inputValue(), '未送出的內容')
      await page.getByRole('button', { name: '啟用 UI 改善' }).press('Enter')
      await page.locator('html[data-edulog-ui=on]').waitFor()
      if (name === 'class') {
        await page.evaluate(() => { chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.') } })
        await page.getByRole('button', { name: 'EduLog 功能' }).click()
        await page.getByText('擴充套件已更新，請先儲存正在編輯的內容，再重新整理分頁。', { exact: true }).waitFor()
        assert.equal(await page.locator('textarea').inputValue(), '未送出的內容')
      }
      console.log(`${browserName} ${name} ${width}: passed`)
      await page.close()
    }
  } finally { await browser.close() }
}
console.log(`Screenshots: ${output}`)
