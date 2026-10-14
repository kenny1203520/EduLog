// Isolated synthetic site only. No account access or real salary data.
// node tests/hours-browser-check.mjs <playwright/index.mjs> <output> <native-css-dir>
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const output = process.argv[3]
mkdirSync(output, { recursive: true })
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const dir = process.argv[4]
const nativeCss = dir ? readdirSync(dir).filter(name => name.startsWith('application-') && name.endsWith('.css')).map(name => readFileSync(join(dir, name), 'utf8')).join('\n') : ''
const body = read('fixtures/hours-nested.html').replace('</head>', `<style>${nativeCss}</style><style>${read('../edulog-tokens.css')}</style><style>${read('../adapters/orange-apple.css')}</style></head>`)
const early = ['runtime-bridge.js', 'adapters/orange-apple-lexicon.js', 'adapters/orange-apple-model.js', 'adapters/orange-apple.js', 'bootstrap.js'].map(file => read(`../${file}`))
const late = ['adapters/orange-apple-workflows.js', 'connection-ui.js', 'integration-ui.js'].map(file => read(`../${file}`))
const results = []
for (const [name, executablePath] of [['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'], ['edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]) {
  assert.ok(existsSync(executablePath), `${name} executable required`)
  const browser = await chromium.launch({ executablePath, headless: true })
  try {
    for (const width of [360, 390, 768, 1440]) for (const failed of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body }) : route.abort())
      await page.addInitScript(({ early, late, content, failed }) => {
        window.sent = []
        window.chrome = { runtime: { sendMessage: async data => { sent.push(data); return { enabled: data.enabled ?? true } }, onMessage: { addListener() {} } } }
        for (const code of early) (0, eval)(code)
        document.addEventListener('DOMContentLoaded', () => {
          for (const code of late) (0, eval)(code)
          window.syntheticFault = failed
          const native = window.edulogSiteWorkflows
          window.edulogSiteWorkflows = { ...native, enhancePage(context) {
            const enhanced = native.enhancePage(context)
            if (window.syntheticFault) throw new Error('synthetic enhancement failure')
            return enhanced
          } }
          window.yearNode = document.querySelector('[name=year]')
          window.monthNode = document.querySelector('[name=month]')
          window.nativeForm = document.querySelector('form')
          window.nativeMarkup = nativeForm.outerHTML
          window.nativeChanges = 0
          yearNode.addEventListener('change', () => nativeChanges++)
          ;(0, eval)(content)
        })
      }, { early, late, content: read('../content.js'), failed })
      await page.goto('https://corp.orangeapple.co/my/hour')
      await page.locator('#edulog-extension-root').waitFor()
      const toggle = page.getByRole('button', { name: '套用清晰主題', exact: true })
      if (failed) {
        assert.equal(await page.locator('html[data-edulog-ui]').count(), 0)
        assert.equal(await page.locator('[data-edulog-pending]').count(), 0)
        assert.equal(await page.evaluate(() => nativeForm.outerHTML === nativeMarkup), true)
        assert.equal(await page.locator('#edulog-extension-root').locator('.notice').count(), 1)
        assert.ok(await page.evaluate(() => edulogUiBoot.preferred))
        assert.ok(await page.evaluate(() => {
          const r = document.querySelector('#edulog-extension-root').getBoundingClientRect()
          return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight
        }), 'fallback notice fits viewport')
        await page.screenshot({ path: join(output, `${name}-${width}-fallback.png`), fullPage: true })
        await page.evaluate(() => { window.syntheticFault = false })
        await toggle.click()
      }
      await page.locator('html[data-edulog-ui=on]').waitFor()
      await page.locator('[name=year]').selectOption('2025')
      await page.locator('[name=month]').selectOption('8')
      await page.locator('[name=year]').focus()
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement === monthNode), true)
      await page.keyboard.press('Tab')
      assert.equal(await page.evaluate(() => document.activeElement === nativeForm.querySelector('button')), true)
      assert.equal(await page.evaluate(() => nativeChanges), 1)
      assert.equal(await page.evaluate(() => yearNode === document.querySelector('[name=year]') && monthNode === document.querySelector('[name=month]') && yearNode.form === nativeForm), true)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} ${width}: page overflow`)
      for (const selector of ['[name=year]', '[name=month]', 'form button']) assert.ok(await page.locator(selector).evaluate(el => {
        const r = el.getBoundingClientRect()
        return r.left >= 0 && r.right <= innerWidth && r.width > 0 && r.height >= 44
      }), `${name} ${width}: ${selector} usable`)
      await page.screenshot({ path: join(output, `${name}-${width}-${failed ? 'recovered' : 'hours'}.png`), fullPage: true })
      await page.getByRole('button', { name: '使用原站主題', exact: true }).click()
      assert.equal(await page.evaluate(() => nativeForm.outerHTML === nativeMarkup), true)
      assert.equal(await page.locator('[name=year]').inputValue(), '2025')
      await toggle.click()
      await page.evaluate(async () => {
        document.dispatchEvent(new Event('turbo:before-cache'))
        const event = new CustomEvent('turbo:before-render', { detail: { render() {} } })
        document.dispatchEvent(event); await event.detail.render()
      })
      await page.locator('html[data-edulog-ui=on]').waitFor()
      assert.equal(await page.locator('#edulog-extension-root').count(), 1)
      assert.equal(await page.locator('[name=month]').inputValue(), '8')
      assert.equal(await page.locator('[data-edulog-pending]').count(), 0)
      if (!failed) {
        await Promise.all([page.waitForURL('**/my/hour?year=2025&month=8'), page.getByRole('button', { name: '查詢該月鐘點' }).click()])
        await page.locator('html[data-edulog-ui=on]').waitFor()
        assert.equal(new URL(page.url()).search, '?year=2025&month=8')
      }
      assert.deepEqual(errors, [])
      results.push({ browser: name, width, failureRecovery: failed, passed: true })
      console.log(`${name} ${width} ${failed ? 'failure recovery' : 'nested GET query'}: passed`)
      await page.close()
    }
  } finally { await browser.close() }
}
writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2))
