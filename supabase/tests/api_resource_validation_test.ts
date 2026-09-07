import { assertEquals, assertThrows } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { ApiError } from '../volumes/functions/_shared/api.ts'
import { resourceDefinitions } from '../volumes/functions/api-v1/resourceRegistry.ts'
import { validateResourceBody } from '../volumes/functions/api-v1/resourceService.ts'

Deno.test('resource validation rejects missing required create fields', () => {
  const error = assertThrows(() => validateResourceBody(resourceDefinitions.courses, { subject: 'Math' }, true), ApiError)
  assertEquals(error.status, 422)
  assertEquals(error.code, 'VALIDATION_ERROR')
  assertEquals(error.fields?.stage, ['required'])
  assertEquals(error.fields?.teaching_id, ['required'])
})

Deno.test('resource validation rejects unknown and invalid typed fields', () => {
  const unknown = assertThrows(() => validateResourceBody(resourceDefinitions.students, { name: 'A', password: 'secret' }, true), ApiError)
  assertEquals(unknown.status, 422)

  const invalid = assertThrows(() => validateResourceBody(resourceDefinitions.enrollments, {
    student_id: 'not-a-uuid',
    course_id: 'also-not-a-uuid',
  }, true), ApiError)
  assertEquals(invalid.fields?.student_id, ['must be a valid uuid'])
  assertEquals(invalid.fields?.course_id, ['must be a valid uuid'])
})

Deno.test('resource validation accepts typed create and partial update payloads', () => {
  validateResourceBody(resourceDefinitions.occurrences, {
    class_session_id: '11111111-1111-4111-8111-111111111111',
    occurrence_date: '2026-09-07',
    is_conducted: true,
    teacher_ids: [],
  }, true)
  validateResourceBody(resourceDefinitions.courses, { description: null }, false)
})
