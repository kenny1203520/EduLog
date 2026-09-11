import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('suspension API contract', () => {
  it('keeps overlap, report synchronization and mutation idempotency server-side', () => {
    const source = readFileSync(new URL('./suspensionRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("'/student-suspensions'")
    expect(source).toContain('SUSPENSION_OVERLAP')
    expect(source).toContain('syncReports')
    expect(source).toContain('revertReports')
    expect(source).toContain('idempotency(req')
    expect(source).toContain('teaching.students.update')
  })
})
