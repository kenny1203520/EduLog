import assert from 'node:assert/strict'
const { SMOKE_DATE: date, SMOKE_HOLIDAY: holiday, ACTOR: actor, TOKEN: token } = process.env
const base = 'http://frontend:4173/api'
const session = '15800000-0000-4000-8000-0000000000e1'
const occurrence = '15800000-0000-4000-8000-000000000011'
const enrollment = '15800000-0000-4000-8000-0000000000b1'
const second = '15800000-0000-4000-8000-0000000000b3'
const makeup = '15800000-0000-4000-8000-0000000000b4'
const course = '15800000-0000-4000-8000-0000000000d1'
async function call(path, expected = [200], postKey) {
  const response = await fetch(base + path, {
    method: postKey ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(postKey ? { 'Idempotency-Key': postKey } : {}) },
  })
  const body = await response.json()
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
console.log(`Class workspace smoke passed: ${actor}`)
