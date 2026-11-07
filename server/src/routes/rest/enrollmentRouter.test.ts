import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resources } from './resources.js'
import { createEnrollmentRouter } from './enrollmentRouter.js'
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
    expect(source).toContain('latest_prior_report: latestPriorReport')
    expect(source).not.toContain("select('id,lesson_id,is_completed,progress_letter,attendance_status,class_occurrences!inner(occurrence_date),content")
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
