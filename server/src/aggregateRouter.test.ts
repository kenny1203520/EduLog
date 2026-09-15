import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/aggregateRouter.ts'), 'utf8')

describe('aggregate API contract', () => {
  it('uses the authenticated Supabase client and explicit fields', () => {
    expect(source).toContain('req.db')
    expect(source).toContain("select('id,name,color,address,phone,external_link")
    expect(source).not.toContain("select('*')")
  })

  it('exposes page read models without restoring the removed aggregate aliases', () => {
    expect(source).toContain("router.get('/pages/me/preferences', wrap(preferences))")
    expect(source).toContain("router.get('/pages/enrollments/:enrollmentId/reports', wrap(studentReports))")
    expect(source).toContain("router.get('/pages/classrooms/overview', wrap(classroomManager))")
    expect(source).toContain("router.get('/pages/holidays/overview', wrap(holidays))")
    expect(source).toContain("router.get('/pages/reports/incomplete', wrap(incomplete))")
    expect(source).toContain("router.get('/pages/dashboard', wrap(dashboard))")
    expect(source).not.toContain('/aggregates/')
    expect(source).not.toContain("router.get('/dashboard'")
  })

  it('keeps nested class session selects balanced for PostgREST', () => {
    expect(source).toContain("class_sessions(id,name,classroom_id,classrooms(id,name)))').eq('attendance_status'")
  })
})
