// Synthetic startup/renderer recording: scripts run while the HTML is parsing.
// Does not read a user's profile or contact the real website.
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.argv[2]).href)
const output = process.argv[3]
mkdirSync(output, { recursive: true })
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const early = ['runtime-bridge.js', 'adapters/orange-apple.js', 'bootstrap.js'].map(file => read(`../${file}`)).join('\n;\n')
const main = ['connection-ui.js', 'adapters/orange-apple-workflows.js', 'content.js'].map(file => read(`../${file}`)).join('\n;\n')
const css = read('../adapters/orange-apple.css')
const fixture = name => read(`fixtures/${name}.html`)
const cases = [
  { name: 'enabled', delay: 0, enabled: true },
  { name: 'delayed', delay: 140, enabled: true },
  { name: 'disabled', delay: 0, enabled: false },
  { name: 'timeout-late', delay: 450, enabled: true },
  { name: 'rejection', delay: 60, reject: true },
  { name: 'unknown', delay: 0, enabled: true, path: '/unknown' },
  { name: 'denied', delay: 0, enabled: true, denied: true },
]
const results = []
for (const [browserName, executablePath] of [
  ['chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
  ['edge', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
]) {
  if (!existsSync(executablePath)) throw new Error(`${browserName} executable missing`)
  const browser = await chromium.launch({ headless: true, executablePath })
  try {
    for (const width of [390, 1440]) for (const scenario of cases) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, recordVideo: { dir: output, size: { width, height: 900 } } })
      await context.route('**/*', route => {
        if (route.request().resourceType() !== 'document') return route.abort()
        let html = fixture('class')
        if (scenario.denied) html = '<html><head></head><body><div id="page-body"><div class="content"><h1>沒有存取權限</h1></div></div></body></html>'
        html = html.replace('</head>', `<style>${css}</style></head>`)
        // Early scripts are parser-blocking; body is not constructed yet.
        const mock = `window.__beforeBody = !document.querySelector('#page-body'); window.chrome={runtime:{sendMessage:()=>new Promise((resolve,reject)=>setTimeout(()=>${scenario.reject ? "reject(new Error('offline'))" : `resolve({enabled:${scenario.enabled}})`},${scenario.delay})),onMessage:{addListener(){}}}};`
        const sample = `window.__frames=[];function sample(){const h=document.documentElement,p=document.querySelector('#page-body');window.__frames.push({t:performance.now(),pending:h.hasAttribute('data-edulog-pending'),mode:h.dataset.edulogUi||null,visible:!!p&&getComputedStyle(p).visibility!=='hidden',enhanced:!!document.querySelector('[data-edulog-search]'),toolbar:document.querySelectorAll('#edulog-extension-root').length});requestAnimationFrame(sample)}requestAnimationFrame(sample);`
        html = html.replace('<head>', `<head><script>${mock}${early};${sample}</script>`).replace('</body>', `<script>${main}</script></body>`)
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html })
      })
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(error.message))
      const url = `https://corp.orangeapple.co${scenario.path || '/courses/dt/101'}`
      await page.goto(url); await page.waitForTimeout(600)
      const capture = async () => page.evaluate(() => ({ beforeBody: window.__beforeBody, frames: window.__frames, pending: document.documentElement.hasAttribute('data-edulog-pending'), mode: document.documentElement.dataset.edulogUi || null }))
      let check = await capture()
      assert.ok(check.beforeBody, `${browserName}/${width}/${scenario.name}: ${errors.join('; ')}`)
      assert.ok(check.frames.length > 10)
      assert.equal(check.pending, false)
      const enhanced = ['enabled', 'delayed'].includes(scenario.name)
      assert.equal(check.mode, enhanced ? 'on' : null)
      for (const f of check.frames) {
        if (enhanced && f.visible) { assert.equal(f.mode, 'on', `${browserName}/${width}/${scenario.name}: visible native frame`); assert.ok(f.enhanced) }
        if (!enhanced && f.visible) assert.equal(f.mode, null)
        assert.ok(f.toolbar <= 1)
      }
      const pendingFrames = check.frames.filter(f => f.pending)
      if (pendingFrames.length) assert.ok(pendingFrames.at(-1).t - pendingFrames[0].t < 350, 'loading gate exceeded deadline')
      const startupFrames = check.frames
      if (scenario.name === 'unknown') {
        await page.evaluate(() => {
          window.__frames = []
          history.pushState({}, '', '/courses/dt/101')
          for (const name of ['turbo:visit', 'turbo:render', 'turbo:load']) document.dispatchEvent(new Event(name))
        })
        await page.waitForTimeout(80)
        const frames = (await capture()).frames
        assert.ok(frames.some(f => f.visible && f.enhanced))
        assert.ok(frames.filter(f => f.visible).every(f => f.mode === 'on' && f.enhanced))
      }
      if (enhanced) {
        const height = await page.evaluate(() => {
          const root = document.querySelector('#edulog-extension-root').shadowRoot
          return root.querySelector('.bar').getBoundingClientRect().height
        })
        assert.equal(height, width <= 480 ? 113 : 64, 'early toolbar reservation must match the bar')
        // Refresh recording exercises a new bootstrap before parsing again.
        await page.reload(); await page.waitForTimeout(350)
        check = await capture()
        assert.ok(check.frames.filter(f => f.visible).every(f => f.mode === 'on' && f.enhanced))
        await page.evaluate(async () => {
          const event = name => document.dispatchEvent(new Event(name))
          // A native clean snapshot, cache preview, fresh response and restore.
          window.__frames = []
          for (let i = 0; i < 3; i++) {
            event('turbo:visit'); event('turbo:before-cache')
            await new Promise(resolve => setTimeout(resolve, 0))
            const body = document.body.cloneNode(true)
            if (body.querySelector('[data-edulog-owned]')) throw new Error('dirty Turbo snapshot')
            const e = new CustomEvent('turbo:before-render', { detail: { newBody: body, render: async () => { await new Promise(resolve => setTimeout(resolve, 20)); document.body.replaceWith(body) } } })
            document.dispatchEvent(e); await e.detail.render(document.body, body)
            event('turbo:render'); event('turbo:load')
            await new Promise(resolve => setTimeout(resolve, 40))
          }
          const draft = document.querySelector('textarea'); draft.value = 'not submitted'; draft.focus(); draft.setSelectionRange(2, 5)
          const filter = document.querySelector('[data-edulog-search]'), toolbar = document.querySelector('#edulog-extension-root')
          const f = new CustomEvent('turbo:before-frame-render', { detail: { render: () => document.querySelector('#remote_modal').append(document.createElement('p')) } })
          document.dispatchEvent(f); await f.detail.render()
          if (document.querySelector('[data-edulog-search]') !== filter || document.querySelector('#edulog-extension-root') !== toolbar || draft.value !== 'not submitted' || draft.selectionStart !== 2) throw new Error('frame lost editing state')
        })
        await page.waitForTimeout(80)
        const navigationFrames = (await capture()).frames
        assert.ok(navigationFrames.filter(f => f.visible).every(f => f.mode === 'on' && f.enhanced))
        assert.ok(navigationFrames.every(f => f.toolbar <= 1))
        await page.screenshot({ path: join(output, `${browserName}-${width}-${scenario.name}.png`) })
      }
      assert.deepEqual(errors, [])
      results.push({ browser: browserName, width, scenario: scenario.name, startupFrames: startupFrames.length, passed: true })
      await context.close()
      await page.video().saveAs(join(output, `${browserName}-${width}-${scenario.name}.webm`))
    }
  } finally { await browser.close() }
}
writeFileSync(join(output, 'startup-results.json'), JSON.stringify(results, null, 2))
console.log(`${results.length} startup/refresh/render recordings passed in Chrome and Edge`)
