import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { readFileSync } from 'node:fs'
import { readCollaboration, remove, reportLessonEntryOptions } from './reportRouter.js'
import { assertClientManagedAttendanceReason, assertReportAttendanceUpdate, firstUncompletedSequence, legacySnapshotHasLessonState } from './reportRouter.js'

describe('report lifecycle progress', () => {
  it('selects the first lesson not represented by a report', () => {
    expect(firstUncompletedSequence([{ id: 'a', sequence: 1 }, { id: 'b', sequence: 2 }], new Set(['a']), 1)).toBe(2)
    expect(firstUncompletedSequence([{ id: 'a', sequence: 1 }], new Set(['a']), 1)).toBe(1)
  })

  it('rejects forged server-managed attendance reasons', () => {
    expect(() => assertClientManagedAttendanceReason('holiday')).toThrow('Holiday and suspension')
    expect(() => assertClientManagedAttendanceReason('suspension')).toThrow('Holiday and suspension')
    expect(() => assertClientManagedAttendanceReason('teacher_note')).not.toThrow()
  })

  it('allows editing other fields while retaining a system-managed attendance reason', () => {
    expect(() => assertReportAttendanceUpdate({ absence_reason: 'holiday', attendance_status: 'absent' }, { absence_reason: 'holiday' })).not.toThrow()
    expect(() => assertReportAttendanceUpdate({ absence_reason: 'holiday', attendance_status: 'absent' }, { attendance_status: 'present' })).toThrow('managed by the system')
    expect(() => assertReportAttendanceUpdate({ absence_reason: 'holiday', attendance_status: 'absent' }, { absence_reason: null })).toThrow('managed by the system')
  })

  it('completes DELETE through scope binding, lifecycle mutation, and idempotency completion', async () => {
    const dbRpc = vi.fn((name: string) => {
      if (name === 'get_occurrence_report_mutation_context') return { maybeSingle: vi.fn().mockResolvedValue({ data: { report_id: 'r1', version: 2, teaching_id: 't1', classroom_id: null, class_session_id: 's1', class_occurrence_id: 'o1' }, error: null }) }
      if (name === 'apply_occurrence_report_lifecycle') return Promise.resolve({ data: { id: 'r1', deleted: true }, error: null })
      throw new Error(`unexpected db RPC ${name}`)
    })
    const adminRpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ is_replay: false }], error: null })
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: null })
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const req = {
      method: 'DELETE', originalUrl: '/api/reports/r1', requestId: 'request-1', traceId: 'trace-1',
      params: { id: 'a1000000-0000-4000-8000-000000000001' },
      header: vi.fn((name: string) => name.toLowerCase() === 'idempotency-key' ? 'delete-key-1' : undefined),
      user: { id: 'u1' }, db: { rpc: dbRpc }, adminDb: { rpc: adminRpc }, auditContext: {},
    } as unknown as Request

    await remove(req, response)

    expect(dbRpc).toHaveBeenCalledWith('apply_occurrence_report_lifecycle', expect.objectContaining({ p_operation: 'delete', p_expected_version: 2 }))
    expect(adminRpc).toHaveBeenCalledWith('bind_api_idempotency_scope', expect.objectContaining({ p_resource_id: 'a1000000-0000-4000-8000-000000000001', p_permission_key: 'teaching.reports.delete' }))
    expect(adminRpc).toHaveBeenCalledWith('complete_api_idempotency', expect.objectContaining({ p_status: 200 }))
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ data: { id: 'r1', deleted: true }, request_id: 'request-1', trace_id: 'trace-1' }))
  })

  it('replays a deleted report only after the database scope helper returns no row', async () => {
    const dbRpc = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }))
    const adminRpc = vi.fn().mockResolvedValue({
      data: [{ is_replay: true, response_status: 200, response_body: { data: { deleted: true }, meta: {}, request_id: 'old', trace_id: 'old' } }],
      error: null,
    })
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const req = {
      method: 'DELETE', originalUrl: '/api/reports/r1', requestId: 'request-2', traceId: 'trace-2',
      params: { id: 'a1000000-0000-4000-8000-000000000001' },
      header: vi.fn((name: string) => name.toLowerCase() === 'idempotency-key' ? 'delete-key-1' : undefined),
      user: { id: 'u1' }, db: { rpc: dbRpc }, adminDb: { rpc: adminRpc }, auditContext: {},
    } as unknown as Request

    await remove(req, response)

    expect(response.status).toHaveBeenCalledWith(200)
    expect(response.json).toHaveBeenCalledWith({ data: { deleted: true }, meta: {}, request_id: 'request-2', trace_id: 'trace-2' })
    expect(dbRpc).toHaveBeenCalledTimes(1)
  })

  it('does not replay when the idempotency binding no longer passes current authorization', async () => {
    const dbRpc = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }))
    const adminRpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const req = {
      method: 'DELETE', originalUrl: '/api/reports/r1', requestId: 'request-3', traceId: 'trace-3',
      params: { id: 'a1000000-0000-4000-8000-000000000001' },
      header: vi.fn((name: string) => name.toLowerCase() === 'idempotency-key' ? 'delete-key-1' : undefined),
      user: { id: 'u1' }, db: { rpc: dbRpc }, adminDb: { rpc: adminRpc }, auditContext: {},
    } as unknown as Request

    await expect(remove(req, response)).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' })
    expect(response.json).not.toHaveBeenCalled()
  })

  it('binds a deleted-report replay to the current route and method', async () => {
    const dbRpc = vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }))
    const adminRpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const req = {
      method: 'DELETE', originalUrl: '/api/reports/other-report', requestId: 'request-5', traceId: 'trace-5',
      params: { id: 'a1000000-0000-4000-8000-000000000001' },
      header: vi.fn((name: string) => name.toLowerCase() === 'idempotency-key' ? 'delete-key-1' : undefined),
      user: { id: 'u1' }, db: { rpc: dbRpc }, adminDb: { rpc: adminRpc }, auditContext: {},
    } as unknown as Request

    await expect(remove(req, response)).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' })
    expect(adminRpc).toHaveBeenCalledWith('replay_deleted_report_idempotency', expect.objectContaining({
      p_route: '/api/reports/other-report', p_method: 'DELETE', p_resource_id: 'a1000000-0000-4000-8000-000000000001',
    }))
    expect(response.json).not.toHaveBeenCalled()
  })

  it('rejects malformed report ids before calling database or idempotency RPCs', async () => {
    const dbRpc = vi.fn()
    const adminRpc = vi.fn()
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response
    const req = {
      method: 'DELETE', originalUrl: '/api/reports/not-a-uuid', requestId: 'request-4', traceId: 'trace-4',
      params: { id: 'not-a-uuid' }, header: vi.fn(),
      user: { id: 'u1' }, db: { rpc: dbRpc }, adminDb: { rpc: adminRpc }, auditContext: {},
    } as unknown as Request

    await expect(remove(req, response)).rejects.toMatchObject({ status: 400, code: 'INVALID_ID' })
    expect(dbRpc).not.toHaveBeenCalled()
    expect(adminRpc).not.toHaveBeenCalled()
  })
})

describe('multi-lesson report compatibility', () => {
  it('only offers same-teaching lesson entries for an authorized report', async () => {
    const teachingId = 'b1000000-0000-4000-8000-000000000001'
    const studentId = '98000000-0000-4000-8000-000000000001'
    const anchorEnrollmentId = '99000000-0000-4000-8000-000000000001'
    const courseRows = [
      { id: '94000000-0000-4000-8000-000000000001', teaching_id: teachingId, subject: 'A', stage: 'primary', display_name: null },
      { id: '94000000-0000-4000-8000-000000000002', teaching_id: teachingId, subject: 'B', stage: 'primary', display_name: null },
      { id: '94000000-0000-4000-8000-000000000003', teaching_id: 'b1000000-0000-4000-8000-000000000002', subject: 'Private', stage: 'primary', display_name: null },
    ]
    const enrollmentRows = [
      { id: anchorEnrollmentId, student_id: studentId, course_id: courseRows[0].id, status: 'regular' },
      { id: '99000000-0000-4000-8000-000000000004', student_id: studentId, course_id: courseRows[1].id, status: 'regular' },
      { id: '99000000-0000-4000-8000-000000000005', student_id: studentId, course_id: courseRows[2].id, status: 'regular' },
    ]
    const lessonRows = courseRows.map((course, index) => ({ id: `95000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, course_id: course.id, sequence: 1, title: `Lesson ${index + 1}` }))
    const calls: Array<{ table: string; method: string; args: unknown[] }> = []
    const tableCalls = new Map<string, number>()
    const dataByTable: Record<string, Array<Record<string, any>>> = { courses: courseRows, enrollments: enrollmentRows, lessons: lessonRows }
    const adminDb = {
      from(table: string) {
        const index = tableCalls.get(table) ?? 0
        tableCalls.set(table, index + 1)
        const filters: Array<{ method: string; args: unknown[] }> = []
        const query: any = {}
        for (const method of ['select', 'eq', 'is', 'in', 'neq', 'order']) {
          query[method] = (...args: unknown[]) => {
            calls.push({ table, method, args })
            if (['eq', 'is', 'in', 'neq'].includes(method)) filters.push({ method, args })
            return query
          }
        }
        const result = () => {
          const rows = table === 'enrollments' && index === 0
            ? enrollmentRows.filter((row) => row.id === anchorEnrollmentId)
            : (dataByTable[table] ?? []).filter((row) => filters.every(({ method, args }) => {
              const [field, value] = args as [string, unknown]
              if (method === 'eq' || method === 'is') return row[field] === value
              if (method === 'in') return (value as unknown[]).includes(row[field])
              if (method === 'neq') return row[field] !== value
              return true
            }))
          return { data: rows, error: null }
        }
        query.maybeSingle = async () => {
          const rows = result().data
          return { data: rows[0] ?? null, error: null }
        }
        query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
        return query
      },
    }
    const db = {
      rpc: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { enrollment_id: anchorEnrollmentId, teaching_id: teachingId }, error: null }) })),
    }
    const response = { json: vi.fn() } as unknown as Response
    const req = {
      params: { reportId: '9b000000-0000-4000-8000-000000000001' },
      requestId: 'request-options', traceId: 'trace-options',
      user: { id: 'teacher-1' }, db, adminDb, auditContext: {},
    } as unknown as Request

    await reportLessonEntryOptions(req, response)

    expect(calls).toContainEqual({ table: 'courses', method: 'eq', args: ['teaching_id', teachingId] })
    expect(calls).toContainEqual({ table: 'enrollments', method: 'in', args: ['course_id', [courseRows[0].id, courseRows[1].id]] })
    const body = (response.json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(body.data.enrollments.map((row: { course_id: string }) => row.course_id)).toEqual([courseRows[0].id, courseRows[1].id])
  })

  it('leaves lesson progress untouched when restoring a content-only historical version', () => {
    expect(legacySnapshotHasLessonState({ content: 'older report content' })).toBe(false)
    expect(legacySnapshotHasLessonState({ lesson_id: null, is_completed: false, progress_letter: null })).toBe(true)
  })

  it('reconstructs a one-entry lesson state when restoring pre-migration snapshots', () => {
    const source = readFileSync(new URL('./reportRouter.ts', import.meta.url), 'utf8')
    const handler = source.slice(source.indexOf('async function restoreVersion'), source.indexOf('async function resolveConflict'))
    expect(handler).toContain('snapshot.lesson_entries === undefined')
    expect(handler).toContain("from('enrollments').select('id,course_id')")
    expect(handler).toContain('randomUUID()')
    expect(handler).toContain("patch.primary_lesson_entry_id = entryId")
    expect(handler).toContain("patch.lesson_entries = lessonId ? [{")
  })

  it('uses legacy scalar lesson data only when a report has no lesson entries', () => {
    const report = readFileSync(new URL('./reportRouter.ts', import.meta.url), 'utf8')
    const enrollment = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    const occurrence = readFileSync(new URL('./occurrenceRouter.ts', import.meta.url), 'utf8')
    expect(report).toContain('entries.length === 0 && report.enrollment_id === enrollmentId && report.lesson_id')
    expect(enrollment).toContain('entries.length === 0 && report.enrollment_id === enrollmentId && report.lesson_id')
    expect(occurrence).toContain('entries.length === 0 && report.enrollment_id === enrollmentId')
  })
})

describe('report collaboration snapshot API', () => {
  const reportId = 'a1000000-0000-4000-8000-000000000001'

  function makeRequest(snapshot: unknown, error: unknown = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: snapshot, error })
    const eq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const req = {
      params: { id: reportId }, requestId: 'request-1', traceId: 'trace-1',
      user: { id: 'user-1' }, db: { rpc, from }, auditContext: {},
    } as unknown as Request
    const response = { json: vi.fn() } as unknown as Response
    return { req, response, rpc, from, select, eq, maybeSingle }
  }

  it('returns an empty snapshot when no row exists and aliases last_updated_at for API compatibility', async () => {
    const { req, response, rpc, from, select } = makeRequest(null)
    await readCollaboration(req, response)

    expect(rpc).toHaveBeenCalledWith('can_access_report', { p_report_id: reportId, p_permission_key: 'teaching.reports.read' })
    expect(from).toHaveBeenCalledWith('report_collab_docs')
    expect(select).toHaveBeenCalledWith('occurrence_report_id,snapshot_base64,base_report_version,updated_at:last_updated_at')
    expect(response.json).toHaveBeenCalledWith({
      data: { occurrence_report_id: reportId, snapshot_base64: null, base_report_version: null, updated_at: null },
      meta: {}, request_id: 'request-1', trace_id: 'trace-1',
    })
  })

  it('preserves snapshot timestamps and reports database errors instead of treating them as empty', async () => {
    const updatedAt = '2026-09-26T02:00:00.000Z'
    const row = { occurrence_report_id: reportId, snapshot_base64: 'snapshot', base_report_version: 4, updated_at: updatedAt }
    const success = makeRequest(row)
    await readCollaboration(success.req, success.response)
    expect(success.response.json).toHaveBeenCalledWith(expect.objectContaining({ data: row }))

    const failed = makeRequest(null, { code: '42703', message: 'column does not exist' })
    await expect(readCollaboration(failed.req, failed.response)).rejects.toMatchObject({ status: 500, code: 'DATABASE_ERROR' })
  })
})
