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
    // 720 CSS px at DPR 2 covers the layout of a 1440 px desktop at 200% zoom.
    for (const width of [360, 390, 768, 1024, 1440, 720]) for (const [name, path] of [['hours','/my/hour'],['profile','/my'],['profile-edit','/my/101/edit'],['overview', '/'], ['class', '/courses/dt/101'], ['reports', '/courses/dt/101/lesson_reports'], ['classes','/courses/dt'], ['history','/dt_admissions/301'], ['calendar','/calendar'], ['unfilled','/admissions/month_unfilled_report']]) {
      const page = await browser.newPage({ viewport: { width, height: width === 720 ? 500 : 1000 }, deviceScaleFactor: width === 720 ? 2 : 1 })
      let fixture = read(`fixtures/${name}.html`)
      if (name === 'calendar') fixture = fixture.replace('<form method="get">','<div class="row"><div class="col-sm-2"><a class="btn" href="/calendar?date=2026-09-21">前一週</a></div><div class="col-sm-8"><form method="get"><div class="row"><div class="col-sm-7">').replace('<input type="submit"','</div><div class="col-sm-3"><input type="submit"').replace('</form>','</div></div></form></div><div class="col-sm-2"><a class="btn" href="/calendar?date=2026-10-05">下一週</a></div></div>')
      fixture = fixture.replace('</head>', `<style>${nativeCss}</style><style>${css}</style></head>`)
      await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: fixture }) : route.abort())
      await page.goto(`https://corp.orangeapple.co${path}`)
      await page.evaluate(() => {
        window.chrome = { runtime: { sendMessage: async data => ({ enabled: data.enabled ?? true }), onMessage: { addListener(fn) { window.edulogTestListener = fn } } } }
      })
      await page.addScriptTag({ content: read('../adapters/orange-apple-workflows.js') })
      await page.addScriptTag({ content: read('../adapters/orange-apple.js') })
      await page.addScriptTag({ content: read('../runtime-bridge.js') })
      await page.addScriptTag({ content: read('../bootstrap.js') })
      await page.addScriptTag({ content: read('../connection-ui.js') })
      await page.addScriptTag({ content: read('../content.js') })
      await page.locator('html[data-edulog-ui=on]').waitFor()
      assert.equal(await page.locator('#edulog-extension-root').count(), 1)
      await page.waitForTimeout(80)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${browserName} ${name} ${width}: page overflow`)
      assert.ok(await page.evaluate(() => document.querySelector('.content h1,.content h2').getBoundingClientRect().top >= document.querySelector('#edulog-extension-root').shadowRoot.querySelector('.bar').getBoundingClientRect().bottom), `${browserName} ${name} ${width}: toolbar obscures heading`)
      if (name === 'reports' && width === 390) {
        assert.equal(await page.locator('#reports th[data-edulog-week-cell]:visible').count(), 1)
        await page.getByRole('button', { name: /上週/ }).click()
        assert.match(await page.locator('#reports th[data-edulog-week-selected]').textContent(), /上週/)
      }
      if (name === 'reports' && width <= 991) {
        assert.ok(await page.locator('#reports td[data-edulog-week-selected]').first().evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth}), 'selected report week is visible beside student')
        assert.equal(await page.locator('.edulog-report-details').first().getAttribute('open'),null)
        await page.locator('.edulog-report-details').first().locator('summary').click()
        assert.notEqual(await page.locator('.edulog-report-details').first().getAttribute('open'),null)
      }
      if (name === 'profile-edit') {
        await page.locator('#employee_skill').fill('保留的個人資料草稿')
        assert.equal(await page.locator('[data-edulog-profile-form] details').getAttribute('open'),null)
        await page.locator('[data-edulog-profile-form] details summary').click()
        assert.equal(await page.locator('#employee_password').isVisible(),true)
      }
      if (name === 'class' && width === 390) {
        const row = page.locator('#students-table tbody tr').first()
        assert.equal(await row.locator('[data-edulog-extra]:visible').count(), 0)
        await row.getByRole('button', { name: '更多資料' }).click()
        assert.ok(await row.locator('[data-edulog-extra]:visible').count() > 0)
      }
      if (name === 'class') {
        const avatar = await page.locator('.card.teacher img').boundingBox()
        assert.equal(avatar.width,48); assert.equal(avatar.height,48)
        const search = page.locator('[data-edulog-search=students]')
        await search.fill('測試學生 A')
        const modal = read('fixtures/report-modal.html').replace('<form class=', '<div class="report-body d-inline-block"><form class=').replace('</form>','</form></div>').replace('<label>完成狀況</label>','').replace('<label>章節進度</label>','').replace('<h4>專案進度</h4>', '<h4>專案進度</h4><div class="row"><div class="col-md-6">完成狀況</div><div class="col-md-6">章節進度</div></div>')
        await page.locator('#remote_modal').evaluate((el, html) => el.insertAdjacentHTML('beforeend', html), modal)
        await page.locator('[data-edulog-dialog]').waitFor()
        await page.locator('#lesson_report_feedback').fill('保留的報告草稿')
        assert.ok(await page.locator('#lesson_report_feedback').evaluate(el => el.getBoundingClientRect().height >= 110), 'report textarea retains usable height')
        assert.equal(await page.locator('#lesson_report_comment').isVisible(), true, 'native internal comment remains accessible')
        assert.equal(await page.locator('[data-edulog-submit-region]').evaluate(el=>getComputedStyle(el).position), 'static')
        assert.equal(await page.locator('.edulog-rating-control').evaluate(el => el.parentElement.classList.contains('col-md-6')), true)
        assert.equal(await page.locator('#dt_admission_lesson_report_completion_status').evaluate(el => el.parentElement.querySelector('[data-edulog-field-caption]')?.textContent), '完成狀況')
        assert.ok(await page.locator('#lesson-report-modal form').evaluate(el => el.getBoundingClientRect().width >= el.closest('.modal-body').clientWidth - 50), 'source inline report body must not shrink form to half width')
        const score = page.getByRole('combobox', { name: '課程參與評分', exact: true })
        await score.focus(); await score.press('Home'); await score.press('ArrowDown'); await score.press('Enter')
        assert.equal(await page.locator('#participation_start_9').isChecked(), true)
        assert.ok(await page.evaluate(() => document.querySelector('.modal-dialog').getBoundingClientRect().width <= innerWidth), `${browserName} modal overflow`)
        await page.screenshot({ path: join(output, `${browserName}-report-modal-${width}.png`), fullPage: true })
        await page.evaluate(() => window.edulogTestListener({ type: 'ui-preferences-changed', enabled: false }))
        assert.equal(await page.locator('#lesson_report_feedback').inputValue(), '保留的報告草稿')
        await page.evaluate(() => window.edulogTestListener({ type: 'ui-preferences-changed', enabled: true }))
        assert.equal(await page.locator('#lesson_report_feedback').inputValue(), '保留的報告草稿')
        await page.locator('#lesson-report-modal').evaluate(el => el.remove())
        await search.fill('')
        await page.locator('#remote_modal').evaluate((el,html)=>el.insertAdjacentHTML('beforeend',html),read('fixtures/secondary-modals.html'))
        await page.locator('#edit-teacher-comment-modal[data-edulog-dialog]').waitFor()
        await page.evaluate(()=>{const mask=document.createElement('div');mask.className='modal-backdrop fade show';document.body.append(mask)})
        const close=page.locator('#edit-teacher-comment-modal [data-edulog-close]')
        assert.equal(await close.isVisible(),true,'native hidden close button becomes visible')
        assert.ok(await close.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return el===hit||el.contains(hit)}),'modal close is not covered by toolbar or backdrop')
        assert.ok(await page.locator('.modal-backdrop').evaluate(el=>{const r=el.getBoundingClientRect();return r.x===0&&r.y===0&&r.width>=innerWidth&&r.height>=innerHeight}),'backdrop covers viewport')
        await page.locator('#admissions_teacher_comment').fill('備註草稿')
        await close.focus()
        await page.screenshot({path:join(output,`${browserName}-secondary-modal-${width}.png`),fullPage:false})
        await page.evaluate(()=>window.edulogTestListener({type:'ui-preferences-changed',enabled:false}))
        assert.equal(await page.locator('#admissions_teacher_comment').inputValue(),'備註草稿')
        await page.evaluate(()=>window.edulogTestListener({type:'ui-preferences-changed',enabled:true}))
        await page.locator('#remote_modal .modal,.modal-backdrop').evaluateAll(nodes=>nodes.forEach(n=>n.remove()))
      }
      if (name === 'unfilled') assert.equal(await page.locator('table').isVisible(), false)
      if (name === 'reports') assert.equal(await page.locator('[data-edulog-report-region] .edulog-table-tools').count(),0)
      if (name === 'calendar') {
        const positions = await page.locator('.edulog-calendar-nav').evaluate(el => ({prev:el.firstElementChild.getBoundingClientRect().top,next:el.lastElementChild.getBoundingClientRect().top,date:el.querySelector('input[type=text]').getBoundingClientRect().top,submit:el.querySelector('input[type=submit]').getBoundingClientRect().top}))
        assert.ok(Math.abs(positions.prev-positions.next) < 2, 'previous and next week align')
        assert.ok(Math.abs(positions.date-positions.submit) < 10, 'date and submit remain grouped')
      }
      await page.screenshot({ path: join(output, `${browserName}-${name}-${width}.png`), fullPage: true })
      // Verify keyboard focus and unchanged native form state on toggle.
      if (name === 'class') await page.locator('textarea').fill('未送出的內容')
      const toggle = page.getByRole('button', { name: '切回原站' })
      await toggle.focus(); await page.keyboard.press('Enter')
      assert.equal(await page.locator('html[data-edulog-ui]').count(), 0)
      if (name === 'class') assert.equal(await page.locator('textarea').inputValue(), '未送出的內容')
      if (name === 'profile-edit') assert.equal(await page.locator('#employee_skill').inputValue(),'保留的個人資料草稿')
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
