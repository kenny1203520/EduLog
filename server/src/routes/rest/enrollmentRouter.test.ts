import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resources } from './resources.js'

describe('enrollment API contract', () => {
  it('keeps enrollment fields explicit and excludes mutation-only options', () => {
    const definition = resources.enrollments
    expect(definition.fields).toContain('time_zone')
    expect(definition.fields).toContain('koding_admission_id')
    expect(definition.fields).not.toContain('target_report_count')
    expect(definition.writable).not.toContain('user_id')
  })

  it('uses the canonical permission RPC and preserves session/course alignment', () => {
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("rpc('can_access_enrollment'")
    expect(source).toContain("rpc('has_teaching_permission'")
    expect(source).toContain("rpc('can_access_enrollment_scope'")
    expect(source).toContain("p_permission_key: 'teaching.students.read'")
    expect(source).toContain("stage: 'enrollment_student_read_permission'")
    expect(source).toContain('requireAuthorizationRpcDecision')
    expect(source).toContain('SESSION_COURSE_MISMATCH')
    expect(source).toContain("classroom_id: result.data.classroom_id ?? null")
    expect(source).toContain('idempotency(req')
  })

  it('returns a created enrollment without requiring the separate read/list policy', () => {
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    const authorization = source.indexOf("await authorizeScope(req, 'create', aligned)")
    const privilegedInsert = source.indexOf("req.adminDb.from('enrollments').insert(payload).select(fields).single()")
    expect(authorization).toBeGreaterThanOrEqual(0)
    expect(privilegedInsert).toBeGreaterThan(authorization)
    expect(source).toContain("authorizationStage: 'enrollment_create_write'")
    expect(source).toContain("event: 'enrollment_create_write_failed'")
    expect(source).not.toContain("req.db.from('enrollments').insert(payload).select(fields).single()")
  })
})

