import assert from 'node:assert/strict'
import { request } from 'node:http'
const { SMOKE_DATE: date, SMOKE_HOLIDAY: holiday, ACTOR: actor, TOKEN: token } = process.env
const session = '15800000-0000-4000-8000-0000000000e1'
const occurrence = '15800000-0000-4000-8000-000000000011'
const enrollment = '15800000-0000-4000-8000-0000000000b1'
const second = '15800000-0000-4000-8000-0000000000b3'
const makeup = '15800000-0000-4000-8000-0000000000b4'
const course = '15800000-0000-4000-8000-0000000000d1'
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
const completion = `/class-sessions/${session}/report-completion?from=${date}&to=${date}`
if (actor === 'outsider') {
  await call(workspace, [403, 404])
  await call(completion, [403, 404])
} else {
  const page = (await call(workspace)).data
  assert.equal(page.session.id, session)
  assert.deepEqual(page.enrollments.map(item => item.id).sort(), [enrollment, second, makeup])
  assert.equal((await call(completion)).data[0].total, actor === 'owner' ? 1 : 3)
  assert.equal((await call(`/holidays/check?date=${holiday}&class_session_id=${session}`)).data.matched, true)
  assert.equal((await call(`/lessons?course_id=${course}&sort=sequence`)).data.length, 1)
  await call(`/occurrences/${occurrence}/report-progress-gaps?enrollment_ids=${[enrollment, second, makeup].join(',')}`)
  await call(`/reports/progress-summary?enrollment_ids=${[enrollment, second].join(',')}`)
  assert.equal((await call(`/reports?class_occurrence_id=${occurrence}`)).data.length, actor === 'owner' ? 1 : 3)
  if (actor === 'teacher' || actor === 'owner') {
    const path = `/occurrences/${occurrence}/reports`
    assert.equal((await call(path, [201], `class-smoke-${actor}-first`)).meta.provisioned, actor === 'owner' ? 2 : 0)
    assert.equal((await call(path, [201], `class-smoke-${actor}-repeat`)).meta.provisioned, 0)
  }
}
if (actor === 'owner') {
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
const attendancePath = `/occurrences/${occurrence}`
const firstTeacher = '15800000-0000-4000-8000-0000000000f2'
const secondTeacher = '15800000-0000-4000-8000-0000000000f5'
if (actor === 'teacher') {
  await call(attendancePath, [403], 'class-smoke-attendance-denied', { teacher_attendance: { [secondTeacher]: true } }, 'PATCH')
  await call(attendancePath, [200], 'class-smoke-attendance-self', { teacher_attendance: { [firstTeacher]: true } }, 'PATCH')
} else if (actor === 'assistant') {
  const checked = await call(attendancePath, [200], 'class-smoke-attendance-assistant', { teacher_attendance: { [secondTeacher]: false } }, 'PATCH')
  assert.equal(checked.data.teacher_attendance[firstTeacher], true)
  assert.equal(checked.data.teacher_attendance[secondTeacher], false)
} else if (actor === 'outsider') {
  await call(attendancePath, [403], 'class-smoke-attendance-outsider', { teacher_attendance: { [firstTeacher]: false } }, 'PATCH')
}
console.log(`Class workspace smoke passed: ${actor}`)
