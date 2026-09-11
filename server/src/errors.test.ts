import { describe, expect, it } from 'vitest'
import { mapDatabaseError } from './errors.js'

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
    expect(mapDatabaseError({ code: 'P0001', message: 'internal SQL details' }).message).toBe('The request violates a business rule')
  })
})
