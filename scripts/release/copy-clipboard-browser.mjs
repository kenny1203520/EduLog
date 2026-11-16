import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium, webkit } from 'playwright'
import { expect } from '@playwright/test'
import { build } from '../../app/node_modules/vite/dist/node/index.js'
import vue from '../../app/node_modules/@vitejs/plugin-vue/dist/index.mjs'

const fixture = `
import { createApp, h, ref } from 'vue'
import { createPinia } from 'pinia'
import i18n from '/src/i18n.ts'
import ClassHeldCard from '/src/components/classroom/ClassHeldCard.vue'
import ReportEditor from '/src/components/report/ReportEditor.vue'
import MakeupStudentModal from '/src/components/classroom/MakeupStudentModal.vue'
import CopyClipboardFeedback from '/src/components/ui/CopyClipboardFeedback.vue'
import { ClassOccurrence } from '/src/models/ClassOccurrence.ts'
import { useAttendanceCopyTemplate } from '/src/composables/session/useAttendanceCopyTemplate.ts'
import { useMakeupEnrollment } from '/src/composables/session/useMakeupEnrollment.ts'

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
    const rosterUpdated = ref(false)
    const legacyEditorOpen = ref(false)
    const makeup = useMakeupEnrollment({
      sessionId: 'class', todayOccurrence, selectedDateKey: ref('2026-11-01'),
      refreshRosterForDate: async () => { rosterUpdated.value = true },
      focusSubmitError: () => {},
    })
    return () => h('main', [
      h('button', { onClick: makeup.openAddStudentModal }, 'Add Make-up Student'),
      rosterUpdated.value ? h('p', 'Make-up roster refreshed') : null,
      makeup.showAddStudentModal.value ? h(MakeupStudentModal, {
        search: makeup.makeupSearch.value,
        studentId: makeup.selectedMakeupStudentId.value,
        enrollmentId: makeup.selectedMakeupEnrollmentId.value,
        joinDate: makeup.makeupJoinDate.value,
        'onUpdate:search': value => { makeup.makeupSearch.value = value },
        'onUpdate:studentId': value => { makeup.selectedMakeupStudentId.value = value },
        'onUpdate:enrollmentId': value => { makeup.selectedMakeupEnrollmentId.value = value },
        'onUpdate:joinDate': value => { makeup.makeupJoinDate.value = value },
        onStudentChange: makeup.handleMakeupStudentChange,
        onSubmit: makeup.submitAddStudentToClass,
        onClose: makeup.closeAddStudentModal,
        studentOptions: makeup.makeupStudentOptions.value,
        enrollmentOptions: makeup.makeupEnrollmentOptions.value,
        selectedEnrollment: makeup.selectedMakeupEnrollment.value,
        busy: makeup.isAddingStudent.value,
        submitError: makeup.makeupSubmitError.value,
      }) : null,
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
        reportId: 'report', enrollmentId: 'host', classOccurrenceId: 'first', courseName: 'Math',
        availableLessons: [{ id: 'l1', sequence: 1, title: 'Numbers' }],
        initialPrimaryLessonEntryId: 'primary', initialLessonEntries: [progress],
      }),
      h('button', { onClick: () => { legacyEditorOpen.value = true } }, 'Open legacy report'),
      legacyEditorOpen.value ? h('section', { 'aria-label': 'Legacy report' }, [
        h(ReportEditor, {
          reportId: 'legacy', enrollmentId: 'host', classOccurrenceId: 'first', courseName: 'Math',
          collaborationEnabled: false, autoSaveEnabled: true, debounceMs: 500,
          availableLessons: [{ id: 'l1', sequence: 1, title: 'Numbers' }],
          initialLessonId: 'l1', initialVersion: 4,
        }),
      ]) : null,
      h('textarea', { 'aria-label': 'Paste target' }),
      h('div', { contenteditable: 'true', 'aria-label': 'Rich paste target' }),
    ])
  },
}).use(createPinia()).use(i18n).mount('#app')
`

const root = fileURLToPath(new URL('../../app/', import.meta.url))
const fixtureId = fileURLToPath(new URL('../../app/clipboard-fixture.js', import.meta.url)).replaceAll('\\', '/')
const bundle = await build({
  root,
  configFile: false,
  logLevel: 'error',
  resolve: { alias: { '@': fileURLToPath(new URL('../../app/src', import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify('clipboard-fixture') },
  build: { write: false, rollupOptions: { input: fixtureId } },
  plugins: [vue(), {
    name: 'clipboard-browser-fixture',
    enforce: 'pre',
    resolveId: id => id === fixtureId ? fixtureId : undefined,
    load: id => id === fixtureId ? fixture : undefined,
  }],
})
const assets = new Map(bundle.output.map(asset => [`/${asset.fileName}`, asset]))
const entry = bundle.output.find(asset => asset.type === 'chunk' && asset.isEntry)
assert.ok(entry)
let serveLegacyWorker = false
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  if (path === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' })
    res.end(`
      self.addEventListener('install', event => event.waitUntil(self.skipWaiting()))
      self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
      ${serveLegacyWorker ? `
        self.addEventListener('install', event => event.waitUntil(caches.open('previous-edulog').then(cache =>
          cache.put('/', new Response('<p>Previous frontend</p>', { headers: {'content-type': 'text/html'} })))))
        self.addEventListener('fetch', event => {
          if (event.request.mode === 'navigate') event.respondWith(caches.match('/'))
        })
      ` : ''}
    `)
    return
  }
  if (path === '/install-legacy-worker') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><title>Install previous worker</title>')
    return
  }
  if (path === '/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(`<!doctype html><div id="app"></div><script type="module" src="/${entry.fileName}"></script>`)
    return
  }
  const asset = assets.get(path)
  if (!asset) {
    res.writeHead(404).end()
    return
  }
  res.writeHead(200, { 'content-type': asset.type === 'chunk' ? 'text/javascript' : 'text/css' })
  res.end(asset.type === 'chunk' ? asset.code : asset.source)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = `http://127.0.0.1:${server.address().port}/`

async function check(browserType) {
  const browser = await browserType.launch()
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(15000)
    page.on('pageerror', error => console.error(error))
    page.on('response', response => {
      const { pathname } = new URL(response.url())
      if (response.status() >= 400 && !pathname.endsWith('/report-progress-context')) console.error(response.status(), pathname)
    })
    let progressRequests = 0
    let releaseLegacyOptions
    const legacyOptionsReady = new Promise(resolve => { releaseLegacyOptions = resolve })
    const candidate = { id: 'outside-enrollment', student_id: 'outside-student', students: { name: 'Make-up learner' },
      courses: { display_name: 'Outside course' }, class_session_id: 'source-class', status: 'regular', start_date: '2026-01-01' }
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const req = route.request()
      const url = new URL(req.url())
      const path = url.pathname
      if (path === '/api/reports/legacy/lesson-entry-options') {
        await legacyOptionsReady
        await route.fulfill({ json: { data: { enrollments: [{
          id: 'host', course_id: 'math', course_name: 'Math',
          lessons: [{ id: 'l1', sequence: 1, title: 'Numbers' }],
        }] }, meta: {} } })
        return
      }
      if (path === '/api/reports/legacy' && req.method() === 'PATCH') {
        await route.fulfill({ json: { data: { id: 'legacy', enrollment_id: 'host', class_occurrence_id: 'first',
          lesson_id: 'l1', attendance_status: 'pending', ...req.postDataJSON(), version: 5 }, meta: {} } })
        return
      }
      if (path.endsWith('/report-progress-context')) {
        if (++progressRequests === 1) {
          await route.fulfill({ status: 500, json: { error: { code: 'DATABASE_ERROR', message: 'Error fixture' } } })
          return
        }
        const previous = { id: 'prior', lesson_id: 'l1', can_open_report: false, progress_letter: '-D',
          shared_content: 'Prior cross-course report' }
        await route.fulfill({ json: { data: { reports: [previous], latest_prior_report: previous }, meta: {} } })
        return
      }
      if (path === '/api/enrollments' || path === '/api/enrollments/outside-enrollment') {
        await route.fulfill({ json: { data: path === '/api/enrollments' ? [candidate] : candidate, meta: {} } })
        return
      }
      if (path === '/api/class-sessions/class') {
        await route.fulfill({ json: { data: { id: 'class', name: 'Saturday School', session_type: 'regular', schedule_mode: 'weekly',
          start_date: '2026-01-01', schedule_rules: [{ schedule_kind: 'weekly', day_of_week: 0,
            start_time: '09:00', end_time: '11:00' }] }, meta: {} } })
        return
      }
      if (path === '/api/occurrences') {
        await route.fulfill({ json: { data: [{ id: 'first', class_session_id: 'class',
          occurrence_date: '2026-11-01', status: 'completed' }], meta: {} } })
        return
      }
      if (path === '/api/reports' && req.method() === 'POST') {
        await route.fulfill({ status: 201, json: { data: { id: 'makeup-report' }, meta: {} } })
        return
      }
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
    if (browserType === chromium) {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(address).origin })
    }
    if (browserType === chromium) {
      // Seed the tab with a previous worker and a cached HTML response.
      serveLegacyWorker = true
      await page.goto(new URL('/install-legacy-worker', address).href)
      await page.evaluate(async () => {
        await navigator.serviceWorker.register('/sw.js')
        await navigator.serviceWorker.ready
      })
      await page.waitForFunction(() => navigator.serviceWorker.controller)
      await page.goto(address)
      await expect(page.getByText('Previous frontend')).toBeVisible()
      serveLegacyWorker = false
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready
        const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
        await registration.update()
        await changed
      })
    }
    await page.goto(address)
    const progress = page.getByTestId('progress-context')
    await expect(progress.getByText('Unable to check course progress.')).toBeVisible()
    await progress.getByRole('button', { name: 'Retry' }).click()
    await expect(progress.getByText('Prior cross-course report')).toBeVisible()
    await page.getByRole('button', { name: 'Add Make-up Student' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add Student for Make-up Class' })
    await dialog.getByLabel('Select Student', { exact: true }).click()
    await page.getByText('Make-up learner', { exact: true }).first().click()
    await dialog.getByLabel('Select Course', { exact: true }).click()
    await page.getByText(/Outside course/).first().click()
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/reports' &&
      response.request().method() === 'POST')
    await dialog.getByRole('button', { name: 'Create Single Report' }).click()
    const result = await submitted
    assert.equal(result.status(), 201)
    assert.deepEqual(result.request().postDataJSON(), { makeup: true, enrollment_id: 'outside-enrollment', class_occurrence_id: 'first' })
    await expect(page.getByText('Make-up roster refreshed')).toBeVisible()
    await expect(dialog).toBeHidden()
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

    await page.getByRole('button', { name: 'Open legacy report' }).click()
    const legacy = page.getByRole('region', { name: 'Legacy report' })
    const [legacyCourse, legacyLesson, start, end] = await legacy.locator('fieldset select').all()
    await expect(legacyCourse).toHaveValue('host')
    await expect(legacyLesson).toHaveValue('l1')
    await end.selectOption('D')
    await expect(legacy.getByText('Save failed', { exact: true })).toBeVisible()
    const legacySaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/reports/legacy' &&
      response.request().method() === 'PATCH')
    releaseLegacyOptions()
    const saved = await legacySaved
    assert.equal(saved.status(), 200)
    assert.equal(saved.request().postDataJSON().expected_version, 4)
    const [entry] = saved.request().postDataJSON().lesson_entries
    assert.deepEqual([entry.enrollment_id, entry.course_id, entry.lesson_id, entry.progress_letter], ['host', 'math', 'l1', '-D'])
    await expect(legacyLesson).toHaveAttribute('aria-invalid', 'false')
    await expect(start).toHaveValue('')
    await expect(end).toHaveValue('D')
    await expect(legacy.getByText('Save failed', { exact: true })).toBeHidden()
    console.log(`${browserType.name()}: legacy autosave, progress retry, make-up submission, and attendance/course clipboard passed`)
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
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
