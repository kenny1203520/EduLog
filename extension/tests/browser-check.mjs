import { loadPlaywright, browserTargets } from './browser-runtime.mjs'
// Optional visual/keyboard check. No real site requests or personal fixtures.
// node tests/browser-check.mjs <playwright/index.mjs> [screenshots-dir] [native-css-dir]
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { chromium } = await loadPlaywright(process.argv.slice(2).find(arg => !arg.startsWith('--')))
const output = process.argv[3] || mkdtempSync(join(tmpdir(), 'edulog-ui-'))
mkdirSync(output, { recursive: true })
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8')
const css = read('../styles/edulog-tokens.css') + read('../sites/orange-apple/orange-apple.css') + read('../content/dialog-layout.css')
let nativeCss = read('fixtures/native-bootstrap-dialog.css')
if (process.argv[4]) {
  const dir = process.argv[4]
  const application = readdirSync(dir).find(n => n.startsWith('application-'))
  nativeCss = [application, 'flatpickr.min.css', 'style.min.css', 'all.css', 'jquery.dataTables.min.css', 'bootstrap-table.min.css', 'selectize.bootstrap5.min.css']
    .filter(n => n && existsSync(join(dir, n))).map(n => readFileSync(join(dir, n), 'utf8')).join('\n')
}
const executables = browserTargets()
for (const [browserName, launchOptions] of executables) {
  const browser = await chromium.launch(launchOptions)
  try {
    // Popup: connection chip, one primary action per tab context, settings behind the gear.
    const popupCases = [
      ['not-connected', 'not-connected', null], ['pending', 'pending', null], ['unavailable', 'unavailable', null],
      ['class', 'connected', 'https://corp.orangeapple.co/courses/dt/1024'], ['report', 'connected', 'https://corp.orangeapple.co/dt_admissions/301/reports/401/edit'],
      ['other', 'connected', 'https://corp.orangeapple.co/admissions'], ['settings', 'connected', 'https://corp.orangeapple.co/courses/dt/1024'],
    ]
    for (const [name, state, tabUrl] of popupCases) {
      const page = await browser.newPage({ locale:'zh-TW', viewport: { width: 360, height: 600 } })
      await page.setContent(read('../popup/popup.html').replace('</head>', `<style>${read('../styles/edulog-tokens.css')}</style><style>${read('../popup/popup.css')}</style></head>`).replace(/<script[^>]*src=[^>]*><\/script>/g, ''))
      await page.evaluate(({ state, tabUrl }) => {
        window.chrome = {
          storage: { local: { get: async () => ({ edulogExtension: { origin: 'http://localhost:5173', pending: state === 'pending' ? { expiresAt: new Date(Date.now() + 60000).toISOString() } : null } }) } },
          tabs: { query: async () => tabUrl ? [{ url: tabUrl, title: tabUrl.includes('/courses/') ? '初階程式 A 班 | 橘子蘋果' : '學生甲 第 8 堂 | 橘子蘋果' }] : [] },
          runtime: { sendMessage: async data => data.type === 'get-edulog-installation' ? { installation_id: '11111111-1111-4111-8111-111111111111', device_name: '教室筆電', browser_name: 'Chrome', platform_name: 'Windows', extension_version: '0.1.0' } : data.type === 'get-ui-preferences' ? { enabled: true } : data.type === 'get-integration-work-summary' ? { count: 3 } : { status: state, capabilities: { teaching_data_import: true, report_prefill: true }, deviceName: '教室筆電 · Chrome', origin: 'http://localhost:5173', settingsUrl: 'http://localhost:5173/dashboard/settings?tab=integrations', lastVerifiedAt: new Date().toISOString() } },
        }
      }, { state, tabUrl })
      for (const file of ['shared/runtime-bridge.js', 'shared/ui-core.js', 'shared/ui-messages.js', 'sites/orange-apple/orange-apple-lexicon.js', 'shared/connection-ui.js', 'popup/popup.js']) await page.addScriptTag({ content: read(`../${file}`) })
      await page.locator(`[data-state="${state}"]`).waitFor()
      if (name === 'settings') { await page.locator('#open-settings-panel').focus(); await page.keyboard.press('Enter'); await page.locator('#settings-view').waitFor() }
      await page.waitForTimeout(50)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${browserName} popup ${name} overflow`)
      assert.equal(await page.locator('html').evaluate(el => Math.round(el.getBoundingClientRect().width)), 360, `${browserName} popup target width`)
      assert.ok(await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].filter(button => button.offsetParent).length <= 1), `${browserName} popup ${name}: one primary action`)
      assert.equal(await page.evaluate(() => /[\u{1F300}-\u{1FAFF}✅⚠⚙]/u.test(document.body.innerText)), false, `${browserName} popup ${name}: no emoji icons`)
      if (['class', 'report', 'other'].includes(name)) assert.equal(await page.locator('#primary-label').textContent(), { class: '同步本班', report: '預填本報告', other: '開啟工作台' }[name])
      if (state === 'connected' && name !== 'settings') assert.equal(await page.locator('#work-count').textContent(), '3')
      for (const button of await page.locator('.btn-block:visible').all()) assert.ok((await button.boundingBox()).height >= 44, `${browserName} popup ${name}: primary touch target`)
      await page.screenshot({ path: join(output, `${browserName}-popup-${name}.png`), fullPage: true })
      console.log(`${browserName} popup ${name}: passed`)
      await page.close()
    }
    // 720 CSS px at DPR 2 is a layout surrogate; native browser 200% zoom remains pending.
    for (const width of [360, 390, 768, 1024, 1200, 1440, 1920, 720]) for (const [name, path] of [['hours','/my/hour'],['profile','/my'],['profile-edit','/my/101/edit'],['overview', '/'], ['class', '/courses/dt/101'], ['real-class', '/courses/dt/101'], ['real-sidebar', '/courses/dt/101'], ['reports', '/courses/dt/101/lesson_reports'], ['classes','/courses/dt'], ['history','/dt_admissions/301'], ['calendar','/calendar'], ['unfilled','/admissions/month_unfilled_report'], ['unfilled-current','/admissions/unfilled_report'], ['report-editor','/dt_admissions/301/reports/401/edit']]) {
      const page = await browser.newPage({ locale:'zh-TW', viewport: { width, height: width === 720 ? 500 : 1000 }, deviceScaleFactor: width === 720 ? 2 : 1 })
      let fixture = read(`fixtures/${name}.html`)
      if (name === 'calendar') fixture = fixture.replace('<form method="get">','<div class="row"><div class="col-sm-2"><a class="btn" href="/calendar?date=2026-09-21">前一週</a></div><div class="col-sm-8"><form method="get"><div class="row"><div class="col-sm-7">').replace('<input type="submit"','</div><div class="col-sm-3"><input type="submit"').replace('</form>','</div></div></form></div><div class="col-sm-2"><a class="btn" href="/calendar?date=2026-10-05">下一週</a></div></div>')
      fixture = fixture.replace('</head>', `<style>${nativeCss}</style><style>${css}</style></head>`)
      // The overview to-do view reads provider pages; answer them with local samples.
      const sourcePages = { '/admissions/unfilled_report': 'unfilled-current', '/admissions/month_unfilled_report': 'unfilled', '/calendar': 'calendar', '/my/hour': 'hours', '/courses/dt/101/lesson_reports': 'reports', '/courses/dt/102/lesson_reports': 'reports' }
      await page.route('**/*', route => {
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: fixture })
        const source = sourcePages[new URL(route.request().url()).pathname]
        return source ? route.fulfill({ contentType: 'text/html; charset=utf-8', body: read(`fixtures/${source}.html`) }) : route.abort()
      })
      await page.goto(`https://corp.orangeapple.co${path}`)
      await page.evaluate(() => {
        window.chrome = { runtime: { sendMessage: async data => ({ enabled: data.enabled ?? true }), onMessage: { addListener(fn) { window.edulogTestListener = fn } } } }
      })
      for (const file of ['lexicon', 'model']) await page.addScriptTag({ content: read(`../sites/orange-apple/orange-apple-${file}.js`) })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-todo.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-session-cards.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-attendance-export.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-quick-attendance.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-accounts.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-navigation.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-report-editor.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-roster.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple-workflows.js') })
      await page.addScriptTag({ content: read('../sites/orange-apple/orange-apple.js') })
      await page.addScriptTag({ content: read('../shared/runtime-bridge.js') });await page.addScriptTag({ content: read('../shared/ui-core.js') });await page.addScriptTag({ content: read('../shared/ui-messages.js') })
      await page.addScriptTag({ content: read('../content/bootstrap.js') })
      await page.addScriptTag({ content: read('../shared/connection-ui.js') })
      await page.addScriptTag({ content: read('../shared/integration-ui.js') })
      await page.addScriptTag({ content: read('../content/content.js') })
      await page.locator('html[data-edulog-ui=on]').waitFor()
      assert.equal(await page.locator('#edulog-extension-root').count(), 1)
      await page.waitForTimeout(80)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${browserName} ${name} ${width}: page overflow`)
      const toolbarRoot = await page.locator('#edulog-extension-root').evaluateHandle(el => el.shadowRoot)
      const toolbar = await page.locator('#edulog-extension-root').evaluateHandle(el => el.shadowRoot.querySelector('.integration'))
      await toolbar.asElement().click()
      const panel = await page.locator('#edulog-extension-root').evaluateHandle(el => el.shadowRoot.querySelector('.panel'))
      const panelBounds = await panel.evaluate(el => { const r = el.getBoundingClientRect(); return { width:r.width, right:r.right, bottom:r.bottom } })
      assert.ok(panelBounds.width <= Math.min(400, width - 16) + 1, `${browserName} ${name} ${width}: integration panel width`)
      assert.ok(panelBounds.right <= width + 1 && panelBounds.bottom <= 1000 + 1, `${browserName} ${name} ${width}: integration panel bounds`)
      await panel.evaluate(el => el.querySelector('.panel-close').click())
      assert.equal(await panel.evaluate(el => el.hidden), true, `${browserName} ${name} ${width}: close control`)
      await toolbarRoot.dispose(); await toolbar.dispose(); await panel.dispose()
      assert.ok(await page.evaluate(() => document.querySelector('.content h1,.content h2').getBoundingClientRect().top >= document.querySelector('#edulog-extension-root').shadowRoot.querySelector('.bar').getBoundingClientRect().bottom), `${browserName} ${name} ${width}: toolbar obscures heading`)
      if (name === 'reports') {
        assert.equal(await page.locator('#reports').getAttribute('data-edulog-week-mode'),'single')
        await page.getByRole('button',{name:'三週比較'}).click()
        assert.equal(await page.locator('#reports').getAttribute('data-edulog-week-mode'),'compare')
        const compareLayout=await page.locator('#reports').evaluate(table=>{const region=table.closest('[data-edulog-report-region]')||table.parentElement;return{tableWidth:table.getBoundingClientRect().width,regionWidth:region.clientWidth,regionScrollWidth:region.scrollWidth,headerPosition:getComputedStyle(table.tHead.rows[0].cells[0]).position,namePosition:getComputedStyle(table.tBodies[0].rows[0].cells[0]).position,weekCount:table.querySelectorAll('tbody [data-edulog-week-summary]').length,reportRows:table.querySelectorAll('tbody tr[data-edulog-report-row]').length}})
        assert.equal(compareLayout.weekCount,compareLayout.reportRows*3,`${browserName} ${name} ${width}: each report row has three independent week summaries`)
        assert.equal(compareLayout.headerPosition,'sticky',`${browserName} ${name} ${width}: compare header stays visible`)
        assert.equal(compareLayout.namePosition,'sticky',`${browserName} ${name} ${width}: student identity stays visible`)
        if(width<=1199)assert.ok(compareLayout.regionScrollWidth>compareLayout.regionWidth,'narrow comparison stays inside its labelled horizontal scroll region')
        else assert.ok(compareLayout.tableWidth>=compareLayout.regionWidth-1,'wide comparison fills the available region')
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'three-week comparison must not overflow the whole page')
        await page.getByRole('button',{name:'單堂清單'}).click()
        assert.equal(await page.locator('#reports').getAttribute('data-edulog-week-mode'),'single')
      }
      if (name === 'reports' || name === 'real-class') {
        // Single-session mode: extension rows replace the native table.
        assert.equal(await page.locator('[data-edulog-report-region]').isVisible(), false, `${browserName} ${name} ${width}: native table hidden behind rows`)
        const cardsFit = await page.locator('.edulog-session-cards').evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 })
        assert.ok(cardsFit, `${browserName} ${name} ${width}: rows fit the viewport`)
        // Desktop is dense (32–36px controls); touch widths need 44px.
        const minTarget = width < 768 ? 44 : 30
        const smallTargets = await page.locator('.edulog-session-cards button:visible, .edulog-session-cards summary:visible, .edulog-filter-chips button:visible, .edulog-filter-chips summary:visible').evaluateAll((els, min) => els.filter(el => el.getBoundingClientRect().height < min).length, minTarget)
        assert.equal(smallTargets, 0, `${browserName} ${name} ${width}: row and chip targets are at least ${minTarget}px`)
        if (name === 'real-class') {
          for (const [week, label] of [['3', 'past'], ['5', 'future'], ['4', 'today']]) {
            await page.locator(`.edulog-week-tools [data-week="${week}"]`).click()
            const shown = await page.locator('.edulog-session-card:visible').evaluateAll(rows => rows.map(row => ({ statuses: row.querySelectorAll('.edulog-card-status li').length, filled: getComputedStyle(row).backgroundColor, other: row.querySelector('.edulog-badge')?.textContent === '非本堂' })))
            assert.ok(shown.length > 0, `${browserName} ${name} ${width} ${label}: rows listed`)
            assert.ok(shown.every(row => row.other || row.statuses === 4), `${browserName} ${name} ${width} ${label}: four statuses on every row`)
            assert.ok(shown.every(row => !/rgb\(254, 243, 199\)|rgb\(254, 242, 242\)/.test(row.filled)), `${browserName} ${name} ${width} ${label}: no amber or red row fills`)
            if (label === 'future') {
              assert.equal(await page.locator('[data-chip="all"]').getAttribute('aria-pressed'), 'true', 'next week opens on 全部')
              assert.equal(await page.locator('.edulog-card-status li[data-tone="warn"]:visible').count(), 0, 'next week has no amber statuses')
            }
            if ([390, 1440].includes(width)) await page.locator('.edulog-session-cards').screenshot({ path: join(output, `${browserName}-class-${label}-${width}.png`) })
          }
        }
        if (width === 390) {
          await page.getByRole('button', { name: /上週/ }).click()
          assert.match(await page.locator('#reports th[data-edulog-week-selected]').textContent(), /上週/)
        }
      }
      if (name === 'real-class') {
        // 班級名單 tab: roster cards replace the native table and fit every width.
        await page.evaluate(() => { for (const pane of document.querySelectorAll('.tab-pane')) pane.classList.toggle('active', pane.id === 'overview'), pane.classList.toggle('show', pane.id === 'overview') })
        assert.equal(await page.locator('#students-table').isVisible(), false, `${browserName} ${name} ${width}: native roster hidden behind cards`)
        assert.equal(await page.locator('.color-labels').isVisible(), false, `${browserName} ${name} ${width}: colour legend replaced by text badges`)
        const rosterFit = await page.locator('.edulog-roster-cards').evaluate(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1 && [...el.querySelectorAll('.edulog-roster-card')].every(card => card.getBoundingClientRect().right <= innerWidth + 1) })
        assert.ok(rosterFit, `${browserName} ${name} ${width}: roster cards fit the viewport`)
        const smallRoster = await page.locator('.edulog-roster-cards button:visible, .edulog-roster-cards summary:visible, .edulog-roster-select:visible, .edulog-roster-select-all:visible').evaluateAll(els => els.filter(el => el.getBoundingClientRect().height < 44).length)
        assert.equal(smallRoster, 0, `${browserName} ${name} ${width}: roster targets are at least 44px`)
        await page.locator('.edulog-roster-cards').screenshot({ path: join(output, `${browserName}-roster-${width}.png`) })
        if (width >= 1024) {
          // 精簡列: one line per enrolment, still inside the viewport.
          await page.locator('.edulog-table-tools .edulog-density-toggle').first().click()
          assert.equal(await page.locator('.edulog-roster-cards').getAttribute('data-edulog-density'), 'compact')
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${browserName} ${name} ${width}: compact roster must not overflow`)
          await page.locator('.edulog-roster-cards').screenshot({ path: join(output, `${browserName}-roster-compact-${width}.png`) })
          await page.locator('.edulog-table-tools .edulog-density-toggle').first().click()
        }
        await page.getByRole('button', { name: /剩餘少/ }).click()
        assert.equal(await page.locator('.edulog-roster-card:visible').count(), 2)
        await page.getByRole('button', { name: /^全部/ }).first().click()
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${browserName} ${name} ${width}: roster must not overflow the page`)
        await page.evaluate(() => { for (const pane of document.querySelectorAll('.tab-pane')) pane.classList.toggle('active', pane.id === 'lesson-reports'), pane.classList.toggle('show', pane.id === 'lesson-reports') })
      }
      if (name === 'reports' && width <= 991) {
        await page.getByRole('button',{name:'三週比較'}).click()
        assert.equal(await page.locator('.edulog-report-details').first().getAttribute('open'),null)
        await page.locator('.edulog-report-details').first().locator('summary').click()
        assert.notEqual(await page.locator('.edulog-report-details').first().getAttribute('open'),null)
        await page.getByRole('button',{name:'單堂清單'}).click()
      }
      if (name === 'profile-edit') {
        await page.locator('#employee_skill').fill('保留的個人資料草稿')
        assert.equal(await page.locator('[data-edulog-profile-form] details').getAttribute('open'),null)
        await page.locator('[data-edulog-profile-form] details summary').click()
        assert.equal(await page.locator('#employee_password').isVisible(),true)
      }
      if (name === 'class' && width === 390) {
        // The roster table is replaced by cards; the native rows stay in the DOM, hidden.
        assert.equal(await page.locator('#students-table').isVisible(), false)
        assert.ok(await page.locator('.edulog-roster-card:visible').count() > 0)
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
        const closeHit=await close.evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return{ok:el===hit||el.contains(hit),hit:hit?.outerHTML.slice(0,200),x:r.x,y:r.y,modal:getComputedStyle(el.closest('.modal')).zIndex}})
        assert.ok(closeHit.ok,'modal close is not covered by toolbar or backdrop '+JSON.stringify(closeHit))
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
      if (name === 'class') await page.locator('textarea[name="content"]').fill('未送出的內容')
      await page.getByRole('button',{name:'EduLog 功能',exact:true}).click()
      await page.locator('.preferences summary').click()
      const toggle = page.getByRole('button', { name: '使用原站主題' })
      await toggle.focus(); await page.keyboard.press('Enter')
      assert.equal(await page.locator('html[data-edulog-ui]').count(), 0)
      if (name === 'class') assert.equal(await page.locator('textarea[name="content"]').inputValue(), '未送出的內容')
      if (name === 'profile-edit') assert.equal(await page.locator('#employee_skill').inputValue(),'保留的個人資料草稿')
      await page.getByRole('button',{name:'EduLog 功能',exact:true}).click()
      await page.locator('.preferences summary').click()
      await page.getByRole('button', { name: '套用清晰主題' }).press('Enter')
      await page.locator('html[data-edulog-ui=on]').waitFor()
      if (name === 'class') {
        await page.evaluate(() => { chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.') } })
        await page.getByRole('button', { name: 'EduLog 功能' }).click()
        await page.getByText('擴充套件已更新，請先儲存正在編輯的內容，再重新整理分頁。', { exact: true }).waitFor()
        assert.equal(await page.locator('textarea[name="content"]').inputValue(), '未送出的內容')
      }
      console.log(`${browserName} ${name} ${width}: passed`)
      await page.close()
    }
  } finally { await browser.close() }
}
console.log(`Screenshots: ${output}`)
