import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resources } from './resources.js'
import { createEnrollmentRouter, enrollmentBodySchema, trialReportTargetAfterStartChange } from './enrollmentRouter.js'
import { errorHandler } from '../../http/errors.js'
import { expectPriorAttendedReportScope, routeSource } from '../../test/routeSource.js'

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


describe('enrollment report provisioning rules', () => {
  it('adds one placeholder for a trial enrollment whose reports are all recorded before the start date', () => {
    expect(trialReportTargetAfterStartChange({ target_count: 1, fixed_before_start_dates: ['2026-11-01'] })).toBe(2)
    expect(trialReportTargetAfterStartChange({ target_count: 0, fixed_before_start_dates: [] })).toBe(1)
  })

  it('adds nothing while a blank or later report remains', () => {
    expect(trialReportTargetAfterStartChange({ target_count: 2, fixed_before_start_dates: ['2026-11-01'] })).toBeNull()
    expect(trialReportTargetAfterStartChange({ target_count: 1, fixed_before_start_dates: [] })).toBeNull()
  })

  it('accepts a regular lesson count of at least one when a trial becomes regular', () => {
    expect(enrollmentBodySchema.safeParse({ status: 'regular', target_regular_reports: 11 }).success).toBe(true)
    expect(enrollmentBodySchema.safeParse({ status: 'regular', target_regular_reports: 0 }).success).toBe(false)
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain('targetCount: (recorded.fixed_count ?? 0) + input.target_regular_reports')
  })
})

describe('enrollment history access route', () => {
  const user = '00000000-0000-4000-8000-000000000001'
  const enrollment = '00000000-0000-4000-8000-000000000002'
  function historyApp(rpcResult: { data: unknown; error: unknown } = { data: { items: [], next_cursor: null }, error: null }) {
    const db = { rpc: vi.fn().mockResolvedValue(rpcResult) }
    const adminDb = { rpc: vi.fn().mockResolvedValue({ data: [{ is_replay: false }], error: null }) }
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { Object.assign(req, { db, adminDb, user: { id: user }, requestId: 'request', traceId: 'trace' }); next() })
    app.use('/api', createEnrollmentRouter())
    app.use(errorHandler)
    return { app, db }
  }

  it('invokes the guarded RPC with the named operation and the caller user client', async () => {
    const { app, db } = historyApp()
    const input = { enrollment_id: enrollment, cursor: '2026-10-01|x', limit: 50, unlinked_only: true }
    const response = await request(app).post('/api/enrollment-history/list').set('Idempotency-Key', 'history-list-1').send(input)
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ items: [], next_cursor: null })
    expect(db.rpc).toHaveBeenCalledWith('enrollment_history_access', { p_operation: 'list', p_input: input })
  })

  it('rejects unknown operations and undeclared input keys before reaching the database', async () => {
    const { app, db } = historyApp()
    expect((await request(app).post('/api/enrollment-history/route').set('Idempotency-Key', 'history-route-1').send({})).status).toBe(404)
    expect((await request(app).post('/api/enrollment-history/list').set('Idempotency-Key', 'history-list-2').send({ p_user_id: user })).status).toBe(422)
    expect(db.rpc).not.toHaveBeenCalled()
  })

  it('surfaces RPC authorization failures', async () => {
    const { app } = historyApp({ data: null, error: { code: '42501', message: 'PERMISSION_DENIED' } })
    const response = await request(app).post('/api/enrollment-history/candidates').set('Idempotency-Key', 'history-candidates-1').send({ history_id: enrollment, limit: 50 })
    expect(response.status).toBe(403)
  })
})

describe('enrollment report-progress context contract', () => {
  it('exposes a report-progress context limited to the authorized enrollment and earlier attended summaries', () => {
    const source = routeSource('enrollmentRouter.ts')
    expect(source).toContain("router.get('/enrollments/:id/report-progress-context'")
    expectPriorAttendedReportScope(source)
    expect(source).toContain(".neq('id', query.report_id)")
    expect(source).toContain('const pageSize = 500')
    expect(source).toContain('range(offset, offset + pageSize - 1)')
    expect(source).toContain("orderByRelation(builder, 'class_occurrences', 'occurrence_date', true).order('id', { ascending: true })")
    expect(source).toContain("req.adminDb.from('occurrence_reports').select(linkedReportFields)")
    expect(source).toContain(".contains('lesson_entries', JSON.stringify([{ enrollment_id: enrollmentId, course_id: targetEnrollment.course_id }]))")
    expect(source).toContain(".eq('enrollments.student_id', targetEnrollment.student_id)")
    expect(source).toContain(".eq('class_occurrences.class_sessions.teaching_id', teachingId)")
    expect(source).toContain('latest_prior_report: latestPriorReport')
    expect(source).not.toContain("select('id,lesson_id,is_completed,progress_letter,attendance_status,class_occurrences!inner(occurrence_date),content")
  })

  it('returns only the target enrollment progress from another class after checking the B-session permission', async () => {
    const teacherId = '00000000-0000-4000-8000-000000000021'
    const enrollmentA = '00000000-0000-4000-8000-000000000011'
    const enrollmentB = '00000000-0000-4000-8000-000000000012'
    const occurrenceB = '00000000-0000-4000-8000-000000000013'
    const reportA = '00000000-0000-4000-8000-000000000014'
    const reportB = '00000000-0000-4000-8000-000000000015'
    const studentId = '00000000-0000-4000-8000-000000000016'
    const courseB = '00000000-0000-4000-8000-000000000017'
    const lessonB = '00000000-0000-4000-8000-000000000018'
    const sessionB = '00000000-0000-4000-8000-000000000019'
    const teachingB = '00000000-0000-4000-8000-000000000020'
    const entryB = '00000000-0000-4000-8000-000000000022'
    const userReportQueries: Array<Record<string, unknown>> = []
    const adminReportQueries: Array<{ filters: Record<string, unknown>; columns: string }> = []
    const linkedReport = {
      id: reportA,
      enrollment_id: enrollmentA,
      lesson_entries: [{ id: entryB, enrollment_id: enrollmentB, course_id: courseB, lesson_id: lessonB, is_completed: false, progress_letter: 'B' }],
      attendance_status: 'present',
      content: 'Shared class comment',
      content_document: null,
      class_occurrences: { occurrence_date: '2026-11-01', class_sessions: { teaching_id: teachingB } },
    }
    const userClient = {
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) => {
        const filters: Record<string, unknown> = {}
        let columns = ''
        const query: Record<string, any> = {}
        query.select = (value: string) => { columns = value; return query }
        for (const method of ['eq', 'neq', 'contains', 'lt', 'order', 'range']) {
          query[method] = (key: string, value: unknown) => { filters[key] = value; return query }
        }
        query.maybeSingle = async () => {
          if (table === 'enrollments') return { data: { id: enrollmentB, student_id: studentId, course_id: courseB }, error: null }
          if (table === 'class_occurrences') return { data: { id: occurrenceB, class_session_id: sessionB, occurrence_date: '2026-11-12' }, error: null }
          if (table === 'occurrence_reports' && filters.id === reportB) return { data: { id: reportB, enrollment_id: enrollmentB, class_occurrence_id: occurrenceB }, error: null }
          return { data: null, error: null }
        }
        query.then = (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
          if (table === 'occurrence_reports') userReportQueries.push({ ...filters, columns })
          const data = table === 'lessons' ? [{ id: lessonB, sequence: 2, title: 'B lesson 2' }] : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        }
        return query
      }),
    }
    const adminClient = {
      from: vi.fn((table: string) => {
        const filters: Record<string, unknown> = {}
        let columns = ''
        const query: Record<string, any> = {}
        query.select = (value: string) => { columns = value; return query }
        for (const method of ['eq', 'neq', 'contains', 'lt', 'order', 'range']) {
          query[method] = (key: string, value: unknown) => { filters[key] = value; return query }
        }
        query.maybeSingle = async () => ({ data: { teaching_id: teachingB }, error: null })
        query.then = (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
          if (table === 'occurrence_reports') adminReportQueries.push({ filters: { ...filters }, columns })
          const data = table === 'occurrence_reports' ? [linkedReport] : []
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        }
        return query
      }),
    }
    const app = express()
    app.use((req, _res, next) => { Object.assign(req, { db: userClient, adminDb: adminClient, user: { id: teacherId }, requestId: 'request', traceId: 'trace' }); next() })
    app.use('/api', createEnrollmentRouter())
    app.use(errorHandler)

    const response = await request(app).get(`/api/enrollments/${enrollmentB}/report-progress-context?occurrence_id=${occurrenceB}&report_id=${reportB}`)

    expect(response.status).toBe(200)
    expect(response.body.data.reports).toMatchObject([{
      id: reportA, enrollment_id: enrollmentB, lesson_id: lessonB, progress_letter: 'B',
      shared_content: 'Shared class comment', can_open_report: false,
    }])
    expect(userClient.rpc).toHaveBeenCalledWith('has_api_permission', {
      p_user_id: teacherId, p_permission_key: 'teaching.reports.list', p_classroom_id: null, p_class_session_id: sessionB,
    })
    expect(userReportQueries.some((query) => query.enrollment_id === enrollmentB)).toBe(true)
    expect(userReportQueries.filter((query) => 'enrollment_id' in query).every((query) => query.enrollment_id === enrollmentB)).toBe(true)
    expect(adminReportQueries).toHaveLength(1)
    expect(adminReportQueries[0]?.filters).toMatchObject({
      'enrollments.student_id': studentId,
      'class_occurrences.class_sessions.teaching_id': teachingB,
      enrollment_id: enrollmentB,
    })
    expect(adminReportQueries[0]?.filters.lesson_entries).toBe(JSON.stringify([{ enrollment_id: enrollmentB, course_id: courseB }]))
    expect(adminReportQueries[0]?.columns).not.toMatch(/contact_notes|class_notes/)
  })
})

describe('linked lesson report history contract', () => {
  it('checks access on the target enrollment and returns only its linked progress plus shared comments', () => {
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    const handler = source.slice(source.indexOf('async function linkedLessonReportHistory'), source.indexOf('/** Course lessons in order'))
    expect(source).toContain("router.get('/enrollments/:id/linked-lesson-report-history'")
    expect(handler).toContain("permission(req, 'teaching.reports.list', targetEnrollment.class_session_id)")
    expect(handler).toContain(".contains('lesson_entries', JSON.stringify([{ enrollment_id: enrollmentId }]))")
    expect(handler).toContain(".neq('enrollment_id', enrollmentId)")
    expect(handler).toContain(".eq('enrollments.student_id', targetEnrollment.student_id)")
    expect(handler).toContain("entry.course_id !== targetEnrollment.course_id")
    expect(handler).toContain('content_document: report.content_document ?? null')
    expect(handler).not.toContain('contact_notes')
    expect(handler).not.toContain('class_notes')
  })

  it('blocks changing or deleting enrollments that own or are referenced by shared lesson progress', () => {
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain('async function hasCrossEnrollmentReportReferences')
    expect(source).toContain("'ENROLLMENT_HAS_LINKED_REPORT_PROGRESS'")
    expect(source).toContain("contains('lesson_entries', JSON.stringify([{ enrollment_id: enrollmentId }]))")
    expect(source).toContain(".eq('enrollment_id', enrollmentId).range(0, 9999)")
  })
})

describe('class transfer contract', () => {
  it('generates the target lessons before the transfer and forwards the note', () => {
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    const handler = source.slice(source.indexOf('async function transferClass'), source.indexOf('async function enrollmentClassTimeline'))
    expect(handler).toContain('note: z.string().trim().max(200)')
    expect(handler).not.toContain('original_last_date')
    expect(handler.indexOf('await ensurePlannedLessons(')).toBeGreaterThan(0)
    expect(handler.indexOf('await ensurePlannedLessons(')).toBeLessThan(handler.indexOf("rpc('transfer_enrollment_class'"))
    expect(handler).toContain('p_note: input.note || null')
    expect(handler).toContain('missing_count: summary.missing_count ?? 0')
  })

  it('exposes the class timeline and roster flags read models behind read permissions', () => {
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("router.get('/enrollments/:id/class-timeline', wrap(enrollmentClassTimeline))")
    expect(source).toContain("router.get('/class-sessions/:id/roster-flags', wrap(classSessionRosterFlags))")
    expect(source).toContain("permission(req, 'teaching.enrollments.read', enrollment.data.class_session_id)")
    expect(source).toContain("permission(req, 'teaching.class_sessions.read', sessionId)")
    expect(source).toContain("rpc('get_enrollment_class_timeline'")
    expect(source).toContain("rpc('get_class_session_roster_flags'")
  })
})

describe('class transfer contract', () => {
  it('moves the enrollment through the date-effective RPC instead of a direct update', () => {
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    const handler = source.slice(source.indexOf('async function transferClass'), source.indexOf('async function enrollmentClassTimeline'))
    expect(handler).toContain("rpc('transfer_enrollment_class'")
    expect(handler).toContain('p_effective_date: input.transfer_date')
    expect(handler).toContain('retained_reports')
    expect(handler).not.toContain(".from('enrollments').update(")
  })
})
