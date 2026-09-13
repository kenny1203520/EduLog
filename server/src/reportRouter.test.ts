import { describe, expect, it, vi } from 'vitest'
import type { Request, Response } from 'express'
import { remove } from './reportRouter.js'
import { assertClientManagedAttendanceReason, assertReportAttendanceUpdate, firstUncompletedSequence } from './reportRouter.js'

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
