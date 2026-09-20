import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/aggregateRouter.ts'), 'utf8')

describe('aggregate API contract', () => {
  it('uses the authenticated Supabase client and explicit fields', () => {
    expect(source).toContain('req.db')
    expect(source).toContain("select('id,name,color,external_link")
    expect(source).not.toContain("select('*')")
  })

  it('exposes page read models without restoring the removed aggregate aliases', () => {
    expect(source).toContain("router.get('/pages/me/preferences', wrap(preferences))")
    expect(source).toContain("router.get('/pages/enrollments/:enrollmentId/reports', wrap(studentReports))")
    expect(source).toContain("router.get('/pages/classrooms/overview', wrap(classroomManager))")
    expect(source).toContain("router.get('/pages/holidays/overview', wrap(holidays))")
    expect(source).toContain("router.get('/pages/reports/incomplete', wrap(incomplete))")
    expect(source).toContain("router.get('/pages/dashboard', wrap(dashboard))")
    expect(source).toContain("router.get('/pages/courses/overview', wrap(coursesOverview))")
    expect(source).toContain("router.get('/pages/students/overview', wrap(studentsOverview))")
    expect(source).toContain("router.get('/pages/students/:studentId/profile', wrap(studentProfile))")
    expect(source).toContain("router.get('/pages/students/:studentId/reports', wrap(studentReportsPage))")
    expect(source).toContain("router.get('/pages/teachers/overview', wrap(teachersOverview))")
    expect(source).toContain("router.get('/pages/class-sessions/:sessionId/workspace', wrap(classSessionWorkspace))")
    expect(source).not.toContain('/aggregates/')
    expect(source).not.toContain("router.get('/dashboard'")
  })

  it('keeps nested class session selects balanced for PostgREST', () => {
    expect(source).toContain("class_sessions(id,name,classroom_id,classrooms(id,name)))').eq('attendance_status'")
  })

  it('uses exact head counts for dashboard stats without loading student rows', () => {
    expect(source).toContain("db.from('students').select('id', { count: 'exact', head: true })")
    expect(source).not.toContain("dashboard.students_count")
    expect(source).not.toContain('dashboardQuery')
    expect(source).not.toContain('edulog-dashboard-diagnostics')
  })

  it('uses scoped permission checks and explicit safe projections for new page read models', () => {
    expect(source).toContain("authorizeCollection(req, resources.courses, 'teaching.courses.list', query)")
    expect(source).toContain("authorizeCollection(req, resources.students, 'teaching.students.list', query)")
    expect(source).toContain("authorizeResource(req, resources.students, 'teaching.students.read', studentId)")
    expect(source).toContain("rpc('can_access_sensitive_student', { p_student_id: studentId, p_permission_key: 'teaching.students.read_sensitive' })")
    expect(source).toContain("authorizeResource(req, resources['class-sessions'], 'teaching.class_sessions.read', sessionId)")
    expect(source).toContain("select('id,subject,stage,display_name,description,description_document,created_at,updated_at,lessons(")
    expect(source).toContain("select('id,name,notes,notes_document,external_link,created_at,updated_at'")
    expect(source).toContain("select('id,user_id,name,bio,bio_document,created_at,updated_at'")
    expect(source).not.toContain('classrooms(id,name,address)')
    expect(source).not.toContain('id,name,color,address,phone')
    expect(source).toContain("router.get('/pages/students/:studentId/private-details'")
    expect(source).toContain("router.get('/pages/teachers/:teacherId/private-details'")
    expect(source).not.toContain('student_credentials(')
    expect(source).not.toContain("select('*')")
    expect(source).not.toContain('password,student_id,platform')
  })

  it('uses database pagination for classrooms and aliases nested schedule rules for page DTOs', () => {
    expect(source).toContain("classroomQuery.order('name').range(query.offset, query.offset + query.limit - 1)")
    expect(source).toContain('schedule_rules:class_session_schedule_rules(')
  })
})
