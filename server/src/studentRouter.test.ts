import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('student delete API contract', () => {
  it('uses canonical authorization, idempotency and explicit cascade order', () => {
    const source = readFileSync(new URL('./studentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("rpc('can_access_student'")
    expect(source).toContain("teaching.students.delete")
    expect(source).toContain("'occurrence_reports'")
    expect(source).toContain("'student_credentials'")
    expect(source).toContain('idempotency(req')
    expect(source).not.toContain("from('*')")
  })
})
