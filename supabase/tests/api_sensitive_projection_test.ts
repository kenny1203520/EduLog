import { assert, assertFalse } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { resourceDefinitions } from '../volumes/functions/api-v1/resourceRegistry.ts'

Deno.test('student and teacher collection projections do not expose sensitive fields', () => {
  const sensitiveStudentFields = ['gov_id', 'email', 'phone', 'residence_address', 'mailing_address', 'birthday', 'notes']
  for (const field of sensitiveStudentFields) assertFalse(resourceDefinitions.students.select.split(',').includes(field), `students must not expose ${field}`)

  const sensitiveTeacherFields = ['gov_id', 'email', 'phone', 'address', 'birthday']
  for (const field of sensitiveTeacherFields) assertFalse(resourceDefinitions.teachers.select.split(',').includes(field), `teachers must not expose ${field}`)
  assert(resourceDefinitions.teachers.fields.includes('email'), 'owners may still provide their required email on create/update')
})
