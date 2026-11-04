// The real extension end to end, with synthetic data only: a click on 在 EduLog 編輯 opens the side
// panel, which frames a stand-in EduLog web app that keeps its own sign-in (cookies + storage) and can
// save with its CSRF token; 回填 from it reaches the report form, which shows the changed fields.
// The teaching site is routed to a local fixture and never contacted.
import { loadPlaywright, browserTargets, fileURLToPath } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const { chromium } = await loadPlaywright(args[0])
const output = args[1] ? fileURLToPath(new URL(`file:///${args[1].replace(/\\/g, '/')}/`)) : fileURLToPath(new URL('../artifacts/side-panel/', import.meta.url)); mkdirSync(output, { recursive: true })
const fixture = readFileSync(new URL('../fixtures/report-modal.html', import.meta.url), 'utf8')
const ENROLLMENT = '00000000-0000-4000-8000-000000000101', STUDENT = '00000000-0000-4000-8000-000000000102', COURSE = '00000000-0000-4000-8000-000000000103'
const REPORT = { id: '00000000-0000-4000-8000-000000000201', version: 3, enrollment_id: ENROLLMENT, student_id: STUDENT, occurrence_date: '2026-10-04', student_name: '測試學生 A', course_name: '測試課程', attendance_status: 'present', content: 'EduLog 寫好的學習表現' }

// One local origin plays the EduLog deployment: API under /api, the web app elsewhere (as behind nginx).
let ancestors = "'none'"
const probes = [], editorRequests = []
const json = (res, body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const cookies = req => Object.fromEntries((req.headers.cookie || '').split('; ').filter(Boolean).map(part => part.split('=')))
const server = createServer((req, res) => {
  const url = new URL(req.url, 'https://local.invalid')
  const api = url.pathname.replace(/^\/api\/extension\/v1/, '')
  if (url.pathname.startsWith('/api/extension/v1/')) {
    if (req.headers.authorization !== `Bearer ${'a'.repeat(64)}`) return json(res, { error: { code: 'EXTENSION_AUTH_INVALID', message: 'x' } }, 401)
    if (api === '/me') return json(res, { data: { user_id: 'user-A', settings_url: `http://127.0.0.1:${server.address().port}/dashboard/settings`, connection: { installation_id: 'synthetic', device_name: 'test' }, capabilities: { report_prefill: true } } })
    if (api === '/catalog/resolve') return json(res, { data: { memories: [{ valid: true, target_id: ENROLLMENT, student_id: STUDENT, course_id: COURSE }] } })
    if (api === `/enrollments/${ENROLLMENT}`) return json(res, { data: { student_id: STUDENT, course_id: COURSE, student_name: '測試學生 A', course_name: '測試課程', class_name: '週六班' } })
    if (api === '/reports') return json(res, { data: { reports: url.searchParams.get('id') === REPORT.id || url.searchParams.get('enrollment_id') === ENROLLMENT ? [REPORT] : [], next_cursor: null } })
    return json(res, { data: {} })
  }
  if (url.pathname === '/login') {
    res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['edulog_access=signed-in; Path=/; HttpOnly; SameSite=Lax', 'edulog_csrf=t0k3n; Path=/; SameSite=Lax'] })
    return res.end('<script>localStorage.setItem("edulog-session","signed-in");document.title="signed-in"</script>')
  }
  if (url.pathname === '/api/auth/csrf') return json(res, { data: { csrf_token: cookies(req).edulog_csrf || '' } })
  if (url.pathname === '/api/save') { const c = cookies(req); return json(res, { saved: c.edulog_access === 'signed-in' && req.headers['x-csrf-token'] === c.edulog_csrf }, c.edulog_access === 'signed-in' && req.headers['x-csrf-token'] === c.edulog_csrf ? 200 : 403) }
  if (url.pathname === '/probe') { let body = ''; req.on('data', d => { body += d }); req.on('end', () => { probes.push(JSON.parse(body)); res.end() }); return }
  if (url.pathname.startsWith('/dashboard/reports/')) {
    editorRequests.push({ path: url.pathname, date: url.searchParams.get('date'), channel: url.searchParams.get('source_fill'), cookie: Boolean(cookies(req).edulog_access) })
    // Stand-in for the web editor: same panel protocol as the app's useSourceFill.
    res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': `frame-ancestors ${ancestors}` })
    return res.end(`<!doctype html><h1>EduLog</h1><script>(async()=>{
      const report=m=>fetch('/probe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)})
      const token=(await fetch('/api/auth/csrf').then(r=>r.json())).data.csrf_token
      const save=await fetch('/api/save',{method:'POST',headers:{'X-CSRF-Token':token}}).then(r=>r.status)
      const panel=location.ancestorOrigins[0],channel=new URLSearchParams(location.search).get('source_fill')
      addEventListener('message',e=>{if(e.source!==parent||e.origin!==panel)return
        if(e.data.type==='edulog:bridge-ready')parent.postMessage({type:'edulog:source-fill',channel,reportId:${JSON.stringify(REPORT.id)}},panel)
        if(e.data.type==='edulog:source-fill-result')report({signedIn:localStorage.getItem('edulog-session'),cookieReadable:document.cookie.includes('edulog_csrf'),save,panel,fill:e.data})})
      parent.postMessage({type:'edulog:bridge-ping'},panel)})()</script>`)
  }
  res.writeHead(404).end()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const web = `http://127.0.0.1:${server.address().port}`

// The teacher granted the EduLog origin when pairing; a test copy declares it so no prompt is needed.
const temporary = mkdtempSync(join(tmpdir(), 'edulog-side-panel-')), extension = join(temporary, 'extension')
cpSync(fileURLToPath(new URL('../../', import.meta.url)), extension, { recursive: true, filter: source => !/[\\/](tests|dist|node_modules)([\\/]|$)/.test(source.slice(fileURLToPath(new URL('../../', import.meta.url)).length)) })
const manifest = JSON.parse(readFileSync(join(extension, 'manifest.json'), 'utf8'))
manifest.host_permissions.push('http://127.0.0.1/*')
writeFileSync(join(extension, 'manifest.json'), JSON.stringify(manifest))

try {
  for (const [name, options] of browserTargets()) {
    // Branded Chrome no longer loads unpacked extensions from the command line; use Playwright's Chromium.
    const channel = options.channel === 'chrome' ? 'chromium' : options.channel
    const context = await chromium.launchPersistentContext(join(temporary, `profile-${name}`), { channel, headless: true, locale: 'zh-TW', viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    const errors = []
    try {
      const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker')
      const id = new URL(worker.url()).hostname
      ancestors = `chrome-extension://${id}`
      await worker.evaluate(origin => chrome.storage.local.set({ edulogExtension: { origin, token: 'a'.repeat(64), tokenExpiresAt: new Date(Date.now() + 864e5).toISOString(), userId: 'user-A', settingsUrl: `${origin}/dashboard/settings` } }), web)
      await context.route('https://corp.orangeapple.co/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: new URL(route.request().url()).pathname.endsWith('/edit') ? `<!doctype html><html lang="zh-Hant"><body>${fixture}</body></html>` : '<!doctype html><title>other</title>' }))
      // 1. The teacher is signed in to EduLog in this browser.
      const site = await context.newPage(); await site.goto(web + '/login'); await site.waitForFunction(() => document.title === 'signed-in'); await site.close()
      // 2. The report form on the teaching site shows the assistant card; the date is confirmed there.
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message))
      await page.goto('https://corp.orangeapple.co/dt_admissions/301/reports/401/edit')
      const card = page.locator('aside[data-edulog-owned]')
      await card.locator('.date-step input[type=date]').fill('2026-10-04', { timeout: 15000 })
      await card.locator('.date-step .primary').click()
      const open = card.locator('[data-open-editor]'); await open.waitFor({ state: 'visible', timeout: 15000 })
      // 3. A real click opens the side panel, which frames the editor for this student and date.
      await open.click()
      await page.waitForFunction(() => document.querySelector('aside[data-edulog-owned]').shadowRoot.querySelector('section').dataset.state === 'waiting', undefined, { timeout: 15000 })
      const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://corp.orangeapple.co/*' }))[0].id)
      const panelState = await worker.evaluate(async key => (await chrome.storage.session.get(key))[key], `edulogPanel:${tabId}`)
      assert.equal(panelState.state, 'ready', `${name}: panel state ${JSON.stringify(panelState)}`)
      for (let i = 0; i < 50 && !probes.length; i++) await new Promise(resolve => setTimeout(resolve, 200))
      assert.equal(editorRequests.length, 1, `${name}: the panel framed the editor once`)
      assert.deepEqual([editorRequests[0].path, editorRequests[0].date, editorRequests[0].cookie], [`/dashboard/reports/${ENROLLMENT}`, '2026-10-04', true])
      assert.match(editorRequests[0].channel, /^[a-f0-9]{32}$/)
      // 4. Inside the panel the web app is signed in and can save; 回填 reached the report form.
      const probe = probes.shift()
      assert.ok(probe, `${name}: the framed editor reported back`)
      assert.deepEqual({ signedIn: probe.signedIn, save: probe.save, panel: probe.panel, fill: probe.fill.ok }, { signedIn: 'signed-in', save: 200, panel: `chrome-extension://${id}`, fill: true }, JSON.stringify(probe))
      assert.ok(probe.fill.applied >= 1 && probe.fill.review === false, JSON.stringify(probe.fill))
      assert.equal(probe.cookieReadable, false, 'page scripts in the panel cannot read cookies; the token came from /api/auth/csrf')
      // 回填 replaced the site's unsent text with the EduLog report; the form itself is not submitted.
      await page.waitForFunction(() => document.querySelector('aside[data-edulog-owned]').shadowRoot.querySelector('section').dataset.state === 'applied', undefined, { timeout: 10000 })
      assert.equal(await page.locator('#lesson_report_feedback').inputValue(), 'EduLog 寫好的學習表現')
      assert.match(await card.locator('.outcome').textContent(), /尚未送出的樣本內容 → EduLog 寫好的學習表現/)
      assert.equal(new URL(page.url()).pathname.endsWith('/edit'), true, 'the site form was not submitted')
      await page.screenshot({ path: join(output, `${name}-filled.png`) })
      // The panel page at side-panel width: without access to the EduLog origin it asks for it instead
      // of framing a signed-out app; disconnected, it shows no editor at all.
      const panelPage = await context.newPage(); await panelPage.setViewportSize({ width: 400, height: 760 })
      await worker.evaluate(origin => chrome.storage.session.set({ 'edulogPanel:999': { state: 'no-access', url: `${origin}/dashboard/reports/x`, origin, channel: 'f'.repeat(32), label: '測試學生 A · 週六班 · 2026-10-04' } }), web)
      await panelPage.goto(`chrome-extension://${id}/sidepanel/panel.html?tab=999`)
      await panelPage.locator('#allow').waitFor({ state: 'visible' })
      assert.equal(await panelPage.locator('#editor').isVisible(), false)
      assert.match(await panelPage.locator('#message-text').textContent(), new RegExp(web.replace(/[.:/]/g, '\\$&')))
      await panelPage.screenshot({ path: join(output, `${name}-panel-no-access.png`) })
      await worker.evaluate(() => chrome.storage.local.remove('edulogExtension'))
      await panelPage.waitForFunction(() => document.querySelector('#message').dataset.tone === 'error')
      assert.equal(await panelPage.locator('#editor').isVisible(), false)
      await panelPage.close()
      // 5. Closing the report tab clears its panel and channel.
      await page.close()
      await new Promise(resolve => setTimeout(resolve, 300))
      assert.equal(await worker.evaluate(async key => (await chrome.storage.session.get(key))[key] ?? null, `edulogPanel:${tabId}`), null)
      assert.deepEqual(errors, [])
      console.log(`PASS ${name}: click opens the side panel; framed EduLog keeps its sign-in, saves with its CSRF token, and 回填 reaches the form for review`)
    } finally { await context.close(); editorRequests.length = 0; probes.length = 0 }
  }
} finally { server.close(); rmSync(temporary, { recursive: true, force: true }) }
