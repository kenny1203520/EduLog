import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('transfer API contract', () => {
  it('keeps transfer operations behind user-JWT RPCs, scoped permission checks and idempotency', () => {
    const source = readFileSync(new URL('./transferRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("'/enrollment-transfers/single-lesson'")
    expect(source).toContain("'/enrollment-transfers/conflicts/resolve'")
    expect(source).toContain("'cancel_single_lesson_transfer'")
    expect(source).toContain("rpc('can_access_single_lesson_transfer'")
    expect(source).toContain("'get_effective_occurrence_enrollment_ids'")
    expect(source).toContain("'get_occurrence_lesson_transfers'")
    expect(source).toContain('teaching.enrollments.')
    expect(source).toContain('teaching.occurrences.')
    expect(source).toContain('idempotency(req')
    expect(source).toContain('transferRpcError')
  })

  it('does not expose the transfer table through a direct select or wildcard projection', () => {
    const source = readFileSync(new URL('./transferRouter.ts', import.meta.url), 'utf8')
    expect(source).not.toContain("from('single_lesson_transfers')")
    expect(source).not.toContain("select('*')")
  })
})

describe('transfer RPC error mapping', () => {
  it('returns the blocking business rule as details.reason', async () => {
    const { transferRpcError } = await import('./transferRouter.js')
    expect(transferRpcError({ code: 'P0001', message: 'SOURCE_OCCURRENCE_NOT_EFFECTIVE' })).toMatchObject({
      status: 422,
      code: 'TRANSFER_INVALID',
      details: { reason: 'SOURCE_OCCURRENCE_NOT_EFFECTIVE' },
    })
    expect(transferRpcError({ code: 'P0001', message: 'TARGET_OCCURRENCE_ALREADY_EFFECTIVE' })).toMatchObject({
      status: 409,
      code: 'TRANSFER_CONFLICT',
      details: { reason: 'TARGET_OCCURRENCE_ALREADY_EFFECTIVE' },
    })
    expect(transferRpcError({ code: 'P0001', message: 'TARGET_REPORT_ALREADY_EXISTS' }).details).toEqual({ reason: 'TARGET_REPORT_ALREADY_EXISTS' })
    expect(transferRpcError({ code: 'P0001', message: 'SINGLE_LESSON_TRANSFER_FORBIDDEN' })).toMatchObject({ status: 403, details: { reason: 'SINGLE_LESSON_TRANSFER_FORBIDDEN' } })
  })

  it('does not expose unknown database messages as a reason', async () => {
    const { transferRpcError } = await import('./transferRouter.js')
    const error = transferRpcError({ code: 'P0001', message: 'internal SQL details' })
    expect(error.details).toBeUndefined()
    expect(error.message).not.toContain('internal')
  })
})
