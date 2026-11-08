import { describe, expect, it } from 'vitest'
import { mapDatabaseError, sendError } from './errors.js'
import { ZodError, z } from 'zod'

describe('database error taxonomy', () => {
  it('maps malformed UUID/value errors to a safe 400 response', () => {
    expect(mapDatabaseError({ code: '22P02', message: 'invalid input syntax for type uuid' })).toMatchObject({
      status: 400,
      code: 'INVALID_VALUE',
    })
    expect(mapDatabaseError({ code: '22P02', message: 'secret SQL should not escape' }).message).not.toContain('secret')
  })

  it('maps known business RPC failures without leaking database messages', () => {
    expect(mapDatabaseError({ code: 'P0001', message: 'TARGET_SESSION_COURSE_MISMATCH' })).toMatchObject({
      status: 422,
      code: 'BUSINESS_VALIDATION_FAILED',
    })
    expect(mapDatabaseError({ code: 'P0001', message: 'RBAC_MANAGE_REQUIRED' })).toMatchObject({
        status: 403,
        code: 'PERMISSION_DENIED',
    })
    expect(mapDatabaseError({ code: 'P0001', message: 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP' })).toMatchObject({
      status: 409,
      code: 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP',
    })
    expect(mapDatabaseError({ code: 'P0001', message: 'CLASSROOM_ROLE_ASSIGNMENT_OVERLAP' })).toMatchObject({
      status: 409,
      code: 'CLASSROOM_ROLE_ASSIGNMENT_OVERLAP',
    })
    expect(mapDatabaseError({ code: 'P0001', message: 'TEACHER_HAS_ACTIVE_ASSIGNMENTS' })).toMatchObject({ status: 409, code: 'TEACHER_HAS_ACTIVE_ASSIGNMENTS' })
    expect(mapDatabaseError({ code: 'P0001', message: 'TEACHER_ARCHIVED' })).toMatchObject({ status: 409, code: 'TEACHER_ARCHIVED' })
    expect(mapDatabaseError({ code: 'P0001', message: 'ROLE_IN_USE' })).toMatchObject({ status: 409, code: 'RBAC_ROLE_IN_USE' })
    expect(mapDatabaseError({ code: 'P0001', message: 'PROTECTED_ROLE' })).toMatchObject({ status: 409, code: 'RBAC_PROTECTED_RESOURCE' })
    expect(mapDatabaseError({ code: 'P0001', message: 'internal SQL details' }).message).toBe('The request violates a business rule')
  })

  it('maps GET schema failures to the query error contract', () => {
    const status = { value: 0 }
    const response = { status: (value: number) => { status.value = value; return response }, json: (body: unknown) => body } as any
    const request = { method: 'GET', query: {}, requestId: 'request-1', traceId: 'trace-1' } as any
    sendError(request, response, new ZodError(z.object({ limit: z.coerce.number() }).safeParse({ limit: 'bad' }).error?.issues ?? []))
    expect(status.value).toBe(400)
  })
})
