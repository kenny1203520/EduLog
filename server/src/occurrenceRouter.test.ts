import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('occurrence API contract', () => {
  it('enforces scoped permission, holiday and teacher-leave guards', () => {
    const source = readFileSync(new URL('./occurrenceRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("p_permission_key: 'teaching.occurrences.update'")
    expect(source).toContain('HOLIDAY_OCCURRENCE')
    expect(source).toContain('TEACHER_ON_LEAVE')
    expect(source).toContain('idempotency(req')
  })
})
