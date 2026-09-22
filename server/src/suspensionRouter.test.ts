import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('suspension API contract', () => {
  it('delegates attendance synchronization and overlap handling to the atomic RPC', () => {
    const source = readFileSync(new URL('./suspensionRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("'/student-suspensions'")
    expect(source).toContain("'apply_student_suspension'")
    expect(source).toContain('p_operation: \'create\'')
    expect(source).toContain('p_operation: \'update\'')
    expect(source).toContain('p_operation: \'delete\'')
    expect(source).toContain('idempotency(req')
    expect(source).toContain('teaching.students.update')
  })
})
