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

describe('student credentials API contract', () => {
  it('isolates password projection behind canonical student authorization and user-JWT RLS', () => {
    const source = readFileSync(new URL('./studentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("router.get('/students/:id/credentials', wrap(credentials))")
    expect(source).toContain("rpc('can_access_sensitive_student'")
    expect(source).toContain("p_permission_key: 'teaching.students.read_sensitive'")
    expect(source).toContain("from('student_credentials').select('id,student_id,platform,username,password,url,created_at,updated_at')")
    expect(source).toContain("resource: 'student-credentials'")
    expect(source).not.toContain("adminDb.from('student_credentials')")
  })
})
