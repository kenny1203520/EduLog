import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('transfer API contract', () => {
  it('keeps transfer operations behind user-JWT RPCs, scoped permission checks and idempotency', () => {
    const source = readFileSync(new URL('./transferRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("'/enrollment-transfers/single-lesson'")
    expect(source).toContain("'/enrollment-transfers/conflicts/resolve'")
    expect(source).toContain("'cancel_single_lesson_transfer'")
    expect(source).toContain("'get_effective_occurrence_enrollment_ids'")
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
