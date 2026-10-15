import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('class session teacher assignment API contract', () => {
  it('exposes scoped CRUD routes with canonical permission and idempotency guards', () => {
    const source = readFileSync(new URL('./teacherAssignmentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("rpc('has_api_permission'")
    expect(source).toContain('teaching.class_sessions.')
    expect(source).toContain("router.get('/class-sessions/:sessionId/teachers'")
    expect(source).toContain("router.post('/class-sessions/:sessionId/teachers'")
    expect(source).toContain("router.put('/class-sessions/:sessionId/teachers'")
    expect(source).toContain("rpc('replace_class_session_teacher_assignments'")
    expect(source).toContain("p_permission_key: 'teaching.roles.manage'")
    expect((source.match(/await authorize\(req, id, 'update'\)/g) ?? []).length).toBe(4)
    expect(source).toContain('idempotency(req')
    expect(source).toContain("from('class_session_teachers')")
  })
})
