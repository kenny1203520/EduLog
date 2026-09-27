import express, { type Request } from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createDomainRouter } from './domainRouter.js'

const enrollmentId = '00000000-0000-4000-8000-000000000001'
const occurrenceId = '00000000-0000-4000-8000-000000000002'
const reportId = '00000000-0000-4000-8000-000000000003'
const sessionId = '00000000-0000-4000-8000-000000000004'

function createTestApp(options: {
  roster?: string[]
  rosterError?: { code: string; message: string }
  permission?: boolean
  currentReport?: { enrollment_id: string; class_occurrence_id: string } | null
} = {}) {
  const fromCalls: string[] = []
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'has_api_permission') return { data: options.permission ?? true, error: null }
    if (name === 'get_effective_occurrence_enrollment_ids' && args.p_occurrence_id === occurrenceId) {
      return {
        data: (options.roster ?? [enrollmentId]).map((id) => ({ enrollment_id: id })),
        error: options.rosterError ?? null,
      }
    }
    return { data: null, error: null }
  })
  const from = vi.fn((table: string) => {
    fromCalls.push(table)
    const query: Record<string, any> = {
      select: () => query,
      eq: () => query,
      neq: () => query,
      not: () => query,
      lt: () => query,
      order: () => query,
      range: async () => ({ data: [{ id: 'prior-report', lesson_id: 'lesson-1', is_completed: false, progress_letter: null, attendance_status: 'present', class_occurrences: { occurrence_date: '2026-09-20' } }], error: null }),
      maybeSingle: async () => {
        if (table === 'enrollments') return { data: { id: enrollmentId, course_id: 'course-1' }, error: null }
        if (table === 'class_occurrences') return { data: { id: occurrenceId, class_session_id: sessionId, occurrence_date: '2026-09-27' }, error: null }
        if (table === 'occurrence_reports') return { data: options.currentReport === undefined ? { id: reportId, enrollment_id: enrollmentId, class_occurrence_id: occurrenceId } : options.currentReport, error: null }
        return { data: null, error: null }
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: 'lesson-1', sequence: 1, title: 'Lesson 1' }], error: null }).then(resolve, reject),
    }
    return query
  })
  const app = express()
  app.use((req, _res, next) => {
    const extended = req as Request
    extended.user = { id: 'user-1' }
    extended.db = { rpc, from } as unknown as NonNullable<Request['db']>
    extended.requestId = 'test-request'
    extended.traceId = 'test-trace'
    next()
  })
  app.use(createDomainRouter())
  app.use((error: { status?: number; code?: string; message?: string }, _req: Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: { code: error.code, message: error.message } })
  })
  return { app, fromCalls, rpc }
}

async function getContext(app: express.Express) {
  return request(app).get(`/enrollments/${enrollmentId}/report-progress-context?occurrence_id=${occurrenceId}&report_id=${reportId}`)
}

describe('report progress context effective roster authorization', () => {
  it('allows a member returned by the effective roster RPC, including transfer-ins', async () => {
    const { app, fromCalls, rpc } = createTestApp({ roster: [enrollmentId] })

    const response = await getContext(app)

    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.data.latest_prior_report.id).toBe('prior-report')
    expect(JSON.stringify(response.body)).not.toContain('content')
    expect(fromCalls).toContain('lessons')
    expect(rpc).toHaveBeenNthCalledWith(1, 'has_api_permission', expect.objectContaining({
      p_permission_key: 'teaching.reports.list',
      p_class_session_id: sessionId,
    }))
    expect(rpc).toHaveBeenNthCalledWith(2, 'get_effective_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })
  })

  it('hides a transferred-out enrollment and stops before reading any report', async () => {
    const { app, fromCalls } = createTestApp({ roster: [] })

    const response = await getContext(app)

    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe('NOT_FOUND')
    expect(fromCalls).not.toContain('occurrence_reports')
    expect(fromCalls).not.toContain('lessons')
  })

  it('stops when roster authorization lookup fails', async () => {
    const { app, fromCalls } = createTestApp({ rosterError: { code: '42501', message: 'denied' } })

    const response = await getContext(app)

    expect(response.status).toBe(403)
    expect(fromCalls).not.toContain('occurrence_reports')
  })

  it('requires occurrence report read permission before looking up the effective roster', async () => {
    const { app, rpc, fromCalls } = createTestApp({ permission: false })

    const response = await getContext(app)

    expect(response.status).toBe(403)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(fromCalls).not.toContain('occurrence_reports')
  })

  it('rejects a report that does not belong to the requested enrollment and occurrence', async () => {
    const { app, fromCalls } = createTestApp({ currentReport: { enrollment_id: '00000000-0000-4000-8000-000000000005', class_occurrence_id: occurrenceId } })

    const response = await getContext(app)

    expect(response.status).toBe(404)
    expect(fromCalls.filter((table) => table === 'occurrence_reports')).toHaveLength(1)
    expect(fromCalls).not.toContain('lessons')
  })
})
