import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/aggregateRouter.ts'), 'utf8')

describe('aggregate API contract', () => {
  it('uses the authenticated Supabase client and explicit fields', () => {
    expect(source).toContain('req.db')
    expect(source).toContain("db.rpc('get_classrooms_overview'")
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
    expect(source).toContain('class_sessions(id,name,classroom_id,classrooms(id,name)))')
  })

  it('segments Dashboard reads into independently scoped RLS queries', () => {
    expect(source).toContain("db.rpc('get_dashboard_counts'")
    expect(source).toContain("loadIncompleteReports(req, pendingQuery, teacher, 'dashboard.pending_reports')")
    expect(source).toContain("loadDashboardOccurrences(req, query.start, query.end, teacher)")
    expect(source).not.toContain("db.rpc('get_dashboard_page'")
    expect(source).not.toContain('edulog-dashboard-diagnostics')
    expect(source).toContain("'dashboard', null, 'dashboard.permission'")
    expect(source).toContain("'dashboard.counts'")
    expect(source).toContain("'dashboard.pending_reports'")
    expect(source).toContain("'dashboard.occurrences'")
    expect(source).toContain('database_error_code')
  })

  it('validates dashboard date ranges before calling the database', () => {
    expect(source).toContain('start and end must be provided together')
    expect(source).toContain('end must not be earlier than start')
    expect(source).toContain('date range must not exceed 31 days')
  })

  it('uses scoped permission checks and explicit safe projections for new page read models', () => {
    expect(source).toContain("authorizeCollection(req, resources.courses, 'teaching.courses.list', query)")
    expect(source).toContain("authorizeCollection(req, resources.students, 'teaching.students.list', query)")
    expect(source).toContain("db.rpc('get_students_overview'")
    expect(source).toContain("'students_overview.read'")
    expect(source).toContain("authorizeResource(req, resources.students, 'teaching.students.read', studentId)")
    expect(source).toContain("db.rpc('get_student_profile_page', { p_student_id: studentId })")
    expect(source).toContain("'student_profile.read'")
    expect(source).toContain("authorizeResource(req, resources['class-sessions'], 'teaching.class_sessions.read', sessionId)")
    expect(source).toContain("db.rpc('get_courses_overview'")
    expect(source).toContain("db.rpc('get_teachers_overview'")
    expect(source).toContain("db.rpc('get_incomplete_reports_page'")
    expect(source).toContain("db.rpc('get_holidays_overview'")
    expect(source).toContain("db.rpc('get_class_session_workspace'")
    expect(source).toContain("'courses_overview.read'")
    expect(source).toContain("'teachers_overview.read'")
    expect(source).not.toContain('classrooms(id,name,address)')
    expect(source).not.toContain('id,name,color,address,phone')
    expect(source).toContain("router.get('/pages/students/:studentId/private-details'")
    expect(source).toContain("router.get('/pages/teachers/:teacherId/private-details'")
    expect(source).not.toContain('student_credentials(')
    expect(source).not.toContain("select('*')")
    expect(source).not.toContain('password,student_id,platform')
  })

  it('uses database pagination for classrooms and aliases nested schedule rules for page DTOs', () => {
    expect(source).toContain("db.rpc('get_classrooms_overview'")
    expect(source).toContain("'classrooms_overview.read'")
    expect(source).toContain('classroomTotal')
    expect(source).toContain('visibleClassroomCount')
    expect(source).toContain('hiddenClassroomCount')
    expect(source).toContain('sessionTotal')
    expect(source).toContain('visibleSessionCount')
    expect(source).toContain('hiddenSessionCount')
  })
})
