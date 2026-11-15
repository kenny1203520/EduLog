import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { expect } from '@playwright/test'
import { createServer } from '../../app/node_modules/vite/dist/node/index.js'

const fixture = `
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n from '/src/i18n.ts'
import ClassHeldCard from '/src/components/classroom/ClassHeldCard.vue'
import ReportEditor from '/src/components/report/ReportEditor.vue'
import CopyClipboardFeedback from '/src/components/ui/CopyClipboardFeedback.vue'
import { ClassOccurrence } from '/src/models/ClassOccurrence.ts'
import { useAttendanceCopyTemplate } from '/src/composables/session/useAttendanceCopyTemplate.ts'

localStorage.setItem('locale', 'en')
i18n.global.locale.value = 'en'
createApp({
  setup() {
    const occurrence = (id, day, time) => new ClassOccurrence({
      id, class_session_id: 'class', occurrence_date: day, status: 'rescheduled', original_start_time: '09:00:00',
      original_end_time: '11:00:00', actual_start_time: time, actual_end_time: '15:45:00',
    })
    const todayOccurrence = ref(occurrence('first', '2026-11-01', '13:15:00'))
    const rosterEnrollments = ref([{ id: 'original', studentName: 'Jamie' }, { id: 'makeup', studentName: 'Casey' }])
    const reportMap = ref(new Map([['original', { attendanceStatus: 'present' }], ['makeup', { attendanceStatus: 'present' }]]))
    const ready = ref(true)
    const attendance = useAttendanceCopyTemplate({
      sessionId: 'class', session: ref({ name: 'Saturday School' }),
      todayOccurrence, rosterEnrollments, reportMap, ready,
    })
    const progress = {
      id: 'primary', enrollment_id: 'makeup', course_id: 'science', lesson_id: 'l7',
      course_name: 'Science', lesson_sequence: 7, lesson_title: 'Orbits', is_completed: false,
    }
    return () => h('main', [
      h(ClassHeldCard, {
        isConducted: true, isHoliday: false,
        copyDisabled: !ready.value || attendance.clipboard.loading.value,
        onCopyAttendance: attendance.copyAttendanceInfo,
      }),
      h(CopyClipboardFeedback, {
        loading: attendance.clipboard.loading.value, loadFailed: attendance.clipboard.loadFailed.value,
        manualText: attendance.clipboard.manualText.value,
      }),
      h('button', { onClick: () => {
        ready.value = false
        todayOccurrence.value = occurrence('second', '2026-11-08', '14:30:00')
      } }, 'Switch day'),
      h('button', { onClick: () => {
        rosterEnrollments.value = []
        reportMap.value = new Map()
        ready.value = true
      } }, 'Finish loading'),
      h(ReportEditor, {
        disabled: true, autoSaveEnabled: false, collaborationEnabled: false,
        reportId: 'report', enrollmentId: 'host', courseName: 'Math',
        availableLessons: [{ id: 'l1', sequence: 1, title: 'Numbers' }],
        initialPrimaryLessonEntryId: 'primary', initialLessonEntries: [progress],
      }),
      h('textarea', { 'aria-label': 'Paste target' }),
      h('div', { contenteditable: 'true', 'aria-label': 'Rich paste target' }),
    ])
  },
}).use(createPinia()).use(i18n).mount('#app')
`

const root = fileURLToPath(new URL('../../app/', import.meta.url))
const fixtureId = fileURLToPath(new URL('../../app/clipboard-fixture.js', import.meta.url)).replaceAll('\\', '/')
const server = await createServer({
  root,
  server: { host: '127.0.0.1', port: 0, hmr: false, ws: false },
  plugins: [{
    name: 'clipboard-browser-fixture',
    enforce: 'pre',
    resolveId: id => id === '/clipboard-fixture.js' ? fixtureId : undefined,
    load: id => id === fixtureId ? fixture : undefined,
  }],
})
await server.listen()

async function check(browserType) {
  const browser = await browserType.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => console.error(error))
    page.on('response', response => {
      if (response.status() >= 400) console.error(response.status(), new URL(response.url()).pathname)
    })
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const url = new URL(route.request().url())
      const type = url.searchParams.get('template_type')
      const isAttendance = type === 'attendance_copy'
      const template = isAttendance ? '{{start_time}} {{present_list|slash}}' : '{{course_name}} {{lesson_title}}'
      const data = type ? [{
        template_text: template,
        ...(isAttendance ? {} : {
          template_document: { schemaVersion: 1, doc: { type: 'doc', content: [{
            type: 'paragraph', content: [{ type: 'text', text: template, marks: [{ type: 'bold' }] }],
          }] } },
        }),
      }] : []
      await route.fulfill({ json: { data, meta: {} } })
    })
    const address = server.resolvedUrls.local[0]
    if (browserType === chromium) {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(address).origin })
    }
    await page.route(new URL('/clipboard-test', address).href, route => route.fulfill({
      contentType: 'text/html', body: '<div id="app"></div><script type="module" src="/clipboard-fixture.js"></script>',
    }))
    await page.goto(new URL('/clipboard-test', address).href)
    const attendance = page.getByRole('button', { name: 'Copy Attendance' })
    const course = page.getByRole('button', { name: 'Copy Course Info' })
    const target = page.getByRole('textbox', { name: 'Paste target', exact: true })
    const shortcut = process.platform === 'darwin' ? 'Meta+V' : 'Control+V'
    async function paste(expected) {
      await expect.poll(async () => {
        await target.fill('')
        await target.press(shortcut)
        return (await target.inputValue()) === expected
      }, { message: `Expected fixture clipboard text: ${expected}` }).toBe(true)
    }
    await attendance.click()
    await paste('13:15 Jamie / Casey')
    await page.getByRole('button', { name: 'Switch day' }).click()
    assert.ok(await attendance.isDisabled())
    await page.getByRole('button', { name: 'Finish loading' }).click()
    await attendance.click()
    await paste('14:30 None')
    await course.click()
    await page.getByText('Copied', { exact: true }).waitFor()
    await paste('Science Orbits')
    const richTarget = page.getByLabel('Rich paste target')
    await richTarget.evaluate(element => {
      element.addEventListener('paste', event => {
        element.dataset.pastedHtml = event.clipboardData?.getData('text/html')
      })
    })
    await richTarget.press(shortcut)
    assert.match(await richTarget.getAttribute('data-pasted-html') ?? '', /<(?:strong|b)[\s>]/i)
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { write: async () => { throw new Error('denied') }, writeText: async () => { throw new Error('denied') } },
      })
      document.execCommand = () => false
    })
    await course.click()
    const manual = page.getByRole('textbox', { name: 'Could not write to the clipboard. Copy this text manually.' })
    await manual.waitFor()
    assert.equal(await manual.inputValue(), 'Science Orbits')
    console.log(`${browserType.name()}: real attendance and course clipboard, rich paste, and manual fallback passed`)
  } finally {
    await browser.close()
  }
}

try {
  const requested = process.argv.slice(2)
  for (const browserType of [chromium, webkit]) {
    if (!requested.length || requested.includes(browserType.name())) await check(browserType)
  }
} finally {
  await server.close()
}
