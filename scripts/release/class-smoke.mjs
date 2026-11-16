import assert from 'node:assert/strict'
import { request } from 'node:http'
const { SMOKE_DATE: date, SMOKE_HOLIDAY: holiday, ACTOR: actor, TOKEN: token } = process.env
const session = '15800000-0000-4000-8000-0000000000e1'
const occurrence = '15800000-0000-4000-8000-000000000011'
const enrollment = '15800000-0000-4000-8000-0000000000b1'
const second = '15800000-0000-4000-8000-0000000000b3'
const makeup = '15800000-0000-4000-8000-0000000000b4'
const course = '15800000-0000-4000-8000-0000000000d1'
const firstLesson = '15800000-0000-4000-8000-0000000000a9'
const referenceLesson = '15800000-0000-4000-8000-0000000000aa'
const sourceReport = '15800000-0000-4000-8000-000000000021'
const legacyReport = '15800000-0000-4000-8000-000000000025'
const linkedReport = '15800000-0000-4000-8000-000000000026'
const otherEnrollment = '15800000-0000-4000-8000-0000000000b2'
const makeupOccurrence = '15800000-0000-4000-8000-000000000019'
const references = `/reports/reference?lesson_id=${referenceLesson}`
async function call(path, expected = [200], postKey, payload, method = postKey ? "POST" : "GET") {
  const bodyText = payload === undefined ? undefined : JSON.stringify(payload)
  const response = await new Promise((resolve, reject) => {
    const client = request({
      hostname: 'frontend', port: 4173, path: '/api' + path,
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(postKey ? { 'Idempotency-Key': postKey } : {}),
        ...(bodyText ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyText) } : {}),
      },
    }, async (incoming) => {
      try {
        const chunks = []
        for await (const chunk of incoming) chunks.push(chunk)
        resolve({ status: incoming.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) })
      } catch (error) { reject(error) }
    })
    client.on('error', reject)
    client.end(bodyText)
  })
  const { body } = response
  assert.ok(expected.includes(response.status), `${actor} ${path}: ${response.status} ${body.error?.code ?? ''}`)
  return body
}
const workspace = `/pages/class-sessions/${session}/workspace?occurrence_date=${date}`
const progressContext = (enrollmentId, reportId) =>
  `/enrollments/${enrollmentId}/report-progress-context?occurrence_id=${occurrence}&report_id=${reportId}`
if (actor === 'makeup-teacher') {
  const payload = { makeup: true, enrollment_id: otherEnrollment, class_occurrence_id: occurrence }
  const created = await call('/reports', [201], 'class-smoke-scoped-makeup', payload)
  assert.equal(created.data.enrollment_id, otherEnrollment)
  const page = (await call(workspace)).data
  assert.ok(page.enrollments.some(item => item.id === otherEnrollment), 'manual makeup must appear on the target roster')
  console.log('Class workspace smoke passed: teacher with source and target scope')
  process.exit(0)
}
const completion = `/class-sessions/${session}/report-completion?from=${date}&to=${date}`
const classTemplate = `/copy-templates/attendance_copy/class_session/${session}`
if (actor === 'outsider') {
  await call(workspace, [403, 404])
  await call(completion, [403, 404])
  const denied = await call(references, [200, 403, 404])
  if (denied.data) assert.deepEqual(denied.data, [])
  await call(classTemplate, [403, 404], undefined, { template_text: 'Outside this class' }, 'PUT')
  await call(progressContext(enrollment, sourceReport), [403, 404])
} else {
  const page = (await call(workspace)).data
  assert.equal(page.session.id, session)
  assert.deepEqual(page.enrollments.map(item => item.id).sort(), [enrollment, second, makeup])
  assert.equal((await call(completion)).data[0].total, actor === 'owner' ? 1 : 3)
  assert.equal((await call(`/holidays/check?date=${holiday}&class_session_id=${session}`)).data.matched, true)
  assert.equal((await call(`/lessons?course_id=${course}&sort=sequence`)).data.length, 2)
  await call(`/occurrences/${occurrence}/report-progress-gaps?enrollment_ids=${[enrollment, second, makeup].join(',')}`)
  await call(`/reports/progress-summary?enrollment_ids=${[enrollment, second].join(',')}`)
  assert.equal((await call(`/reports?class_occurrence_id=${occurrence}`)).data.length, actor === 'owner' ? 1 : 3)
  const text = `Copy template for ${actor}`
  const personalTemplate = await call('/copy-templates/course_copy/user_default/user_default', [200], undefined, {
    template_text: text,
  }, 'PUT')
  assert.equal(personalTemplate.data.template_text, text)
  const savedTemplates = await call('/copy-templates?template_type=course_copy&scope_type=user_default&scope_entity_id=user_default')
  assert.deepEqual(savedTemplates.data.map(item => item.template_text), [text])
  const attendanceTemplate = await call(classTemplate, [200], undefined, { template_text: text }, 'PUT')
  assert.equal(attendanceTemplate.data.scope_entity_id, session)
  if (actor === 'teacher' || actor === 'owner') {
    const path = `/occurrences/${occurrence}/reports`
    assert.equal((await call(path, [201], `class-smoke-${actor}-first`)).meta.provisioned, actor === 'owner' ? 2 : 0)
    assert.equal((await call(path, [201], `class-smoke-${actor}-repeat`)).meta.provisioned, 0)
  }
}
if (actor === 'owner') {
  const current = (await call(`/reports/${sourceReport}`)).data
  const entries = [
    { id: '15800000-0000-4000-8000-0000000000a7', enrollment_id: enrollment, course_id: course, lesson_id: firstLesson, is_completed: false, progress_letter: '-C' },
    { id: '15800000-0000-4000-8000-0000000000a8', enrollment_id: enrollment, course_id: course, lesson_id: referenceLesson, is_completed: false, progress_letter: '-D' },
  ]
  await call(`/reports/${sourceReport}`, [200], 'class-smoke-save-reference', {
    expected_version: current.version, content: 'Reference content', lesson_entries: entries, primary_lesson_entry_id: entries[0].id,
  }, 'PATCH')
  const saved = (await call(`/reports/${sourceReport}`)).data
  assert.equal(saved.progress_letter, '-C')
  assert.equal(saved.lesson_entries[1].progress_letter, '-D')
  const room = (await call('/classrooms', [201], 'class-smoke-create-room', { name: 'Smoke classroom' })).data
  const availability = (await call('/classroom-schedules', [201], 'class-smoke-create-availability', {
    classroom_id: room.id, day_of_week: 1, start_time: '09:00', end_time: '17:00',
  })).data
  assert.equal(availability.classroom_id, room.id)
  const created = (await call('/class-sessions', [201], 'class-smoke-create-session', {
    name: 'Smoke session', classroom_id: room.id, course_ids: [course], start_date: date,
    schedule_rules: [{ schedule_kind: 'weekly', day_of_week: 1, start_time: '13:00', end_time: '14:00' }],
  })).data
  assert.equal(created.class_session_schedule_rules.length, 1)
  await call(`/class-sessions/${created.id}/occurrences/sync`, [200], 'class-smoke-sync-session', { scope: 'all' })
}
if (actor === 'owner' || actor === 'teacher') {
  const context = (await call(progressContext(enrollment, sourceReport))).data
  assert.deepEqual(context.reports.map(report => [report.id, report.lesson_id, report.progress_letter]), [
    [legacyReport, referenceLesson, 'B'],
    [linkedReport, firstLesson, '-D'],
  ])
  assert.equal(context.latest_prior_report.shared_content, 'Cross-course progress')
  assert.equal(context.latest_prior_report.can_open_report, false)
  const currentReports = (await call(`/reports?class_occurrence_id=${occurrence}&enrollment_id=${second}`)).data
  assert.equal(currentReports.length, 1)
  const empty = (await call(progressContext(second, currentReports[0].id))).data
  assert.deepEqual(empty.reports, [])
  assert.equal(empty.latest_prior_report, null)
  const page = await call(`${references}&class_session_id=${session}&search=Reference&limit=1`)
  assert.equal(page.meta.total, 2)
  assert.equal(page.data[0].id, sourceReport)
  assert.equal(page.data[0].lesson_id, firstLesson)
  assert.deepEqual(page.data[0].lesson_entries.map(item => [item.lesson_id, item.progress_letter]), [[referenceLesson, '-D']])
  const nextPage = await call(`${references}&limit=1&offset=1`)
  assert.equal(nextPage.meta.total, 2)
  assert.equal(nextPage.data[0].id, legacyReport)
  assert.equal(nextPage.data[0].progress_letter, 'B')
  assert.deepEqual(nextPage.data[0].lesson_entries, [])
  assert.equal((await call(`${references}&exclude_report_id=${sourceReport}`)).meta.total, 1)
}
const attendancePath = `/occurrences/${occurrence}`
const firstTeacher = '15800000-0000-4000-8000-0000000000f2'
const secondTeacher = '15800000-0000-4000-8000-0000000000f5'
if (actor === 'teacher') {
  await call(attendancePath, [403], 'class-smoke-attendance-denied', { teacher_attendance: { [secondTeacher]: true } }, 'PATCH')
  const present = { teacher_attendance: { [firstTeacher]: true } }
  await call(attendancePath, [400], undefined, present, 'PATCH')
  const original = await call(attendancePath, [200], 'class-smoke-attendance-self', present, 'PATCH')
  await call(attendancePath, [200], 'class-smoke-attendance-absent', { teacher_attendance: { [firstTeacher]: false } }, 'PATCH')
  const replay = await call(attendancePath, [200], 'class-smoke-attendance-self', present, 'PATCH')
  assert.deepEqual(replay.data, original.data)
  const current = await call(attendancePath)
  assert.equal(current.data.teacher_attendance[firstTeacher], false)
  await call(attendancePath, [200], 'class-smoke-attendance-present', present, 'PATCH')
} else if (actor === 'assistant') {
  const checked = await call(attendancePath, [200], 'class-smoke-attendance-assistant', { teacher_attendance: { [secondTeacher]: false } }, 'PATCH')
  assert.equal(checked.data.teacher_attendance[firstTeacher], true)
  assert.equal(checked.data.teacher_attendance[secondTeacher], false)
} else if (actor === 'outsider') {
  await call(attendancePath, [403], 'class-smoke-attendance-outsider', { teacher_attendance: { [firstTeacher]: false } }, 'PATCH')
}
const makeupRequest = { enrollment_id: otherEnrollment, class_occurrence_id: makeupOccurrence }
if (actor === 'owner') {
  await call('/reports', [403], 'class-smoke-ordinary-cross-class', makeupRequest)
  const request = { ...makeupRequest, makeup: true }
  const created = await call('/reports', [201], 'class-smoke-add-makeup', request)
  assert.equal(created.data.enrollment_id, otherEnrollment)
  assert.equal(created.data.class_occurrence_id, makeupOccurrence)
  assert.equal(created.data.attendance_status, 'pending')
  const replay = await call('/reports', [201], 'class-smoke-add-makeup', request)
  assert.equal(replay.data.id, created.data.id)
  await call('/reports', [409], 'class-smoke-duplicate-makeup', request)
  await call('/reports', [422], 'class-smoke-forged-makeup', { ...request, attendance_status: 'present' })
  assert.equal((await call(`/enrollments/${otherEnrollment}`)).data.class_session_id, '15800000-0000-4000-8000-0000000000e2')
} else {
  await call('/reports', [403], `class-smoke-makeup-denied-${actor}`, { ...makeupRequest, makeup: true })
}
console.log(`Class workspace smoke passed: ${actor}`)
