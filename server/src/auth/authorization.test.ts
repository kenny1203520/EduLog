import type { Request } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { authorizeCollection, authorizeResource, requireAuthorizationDecision, requireAuthorizationRpcDecision } from './authorization.js'
import { resources } from '../resources.js'

function requestWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { user: { id: '00000000-0000-4000-8000-000000000001' }, db: { rpc }, log: { warn: vi.fn(), error: vi.fn() }, auditContext: {} } as unknown as Request
}

describe('authorization decision diagnostics', () => {
  it('records a permission denial with the failed stage and scope', () => {
    const req = requestWithRpc(vi.fn())
    expect(() => requireAuthorizationDecision(req, { data: false, error: null }, {
      permission: 'teaching.enrollments.create',
      stage: 'enrollment_student_and_teaching_scope',
      scopeId: '00000000-0000-4000-8000-000000000010',
      scopeType: 'class_session',
    })).toThrowError(expect.objectContaining({ status: 403, code: 'PERMISSION_DENIED' }))
    expect(req.auditContext).toMatchObject({
      permission: 'teaching.enrollments.create',
      authorizationStage: 'enrollment_student_and_teaching_scope',
      authorizationResult: 'denied',
      errorCode: 'PERMISSION_DENIED',
    })
    expect((req.log as any).warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'authorization_denied',
      permission: 'teaching.enrollments.create',
      authorization_stage: 'enrollment_student_and_teaching_scope',
    }), 'authorization_denied')
  })

  it('records authorization RPC failures separately as unavailable checks', () => {
    const req = requestWithRpc(vi.fn())
    expect(() => requireAuthorizationDecision(req, { data: null, error: { code: '08006', message: 'private database detail' } }, {
      permission: 'teaching.enrollments.create',
      stage: 'enrollment_teaching_permission',
    })).toThrowError(expect.objectContaining({ status: 503, code: 'AUTHORIZATION_CHECK_UNAVAILABLE' }))
    expect(req.auditContext).toMatchObject({
      authorizationStage: 'enrollment_teaching_permission',
      authorizationResult: 'rpc_error',
      errorCode: 'AUTHORIZATION_RPC_ERROR',
    })
    const logged = JSON.stringify((req.log as any).error.mock.calls)
    expect(logged).toContain('08006')
    expect(logged).not.toContain('private database detail')
  })

  it('does not report an authorization RPC privilege/configuration error as a user denial', () => {
    const req = requestWithRpc(vi.fn())
    expect(() => requireAuthorizationDecision(req, { data: null, error: { code: '42501', message: 'function execute grant missing' } }, {
      permission: 'teaching.enrollments.create',
      stage: 'enrollment_teaching_permission',
    })).toThrowError(expect.objectContaining({ status: 503, code: 'AUTHORIZATION_CHECK_UNAVAILABLE' }))
    expect(req.auditContext).toMatchObject({ authorizationResult: 'rpc_error', errorCode: 'AUTHORIZATION_RPC_ERROR' })
  })

  it('records rejected authorization RPC promises as unavailable rather than permission denials', async () => {
    const req = requestWithRpc(vi.fn())
    await expect(requireAuthorizationRpcDecision(req, Promise.reject({ code: '08006' }), {
      permission: 'teaching.enrollments.create', stage: 'enrollment_student_read_permission',
      teachingId: '00000000-0000-4000-8000-000000000009', scopeId: '00000000-0000-4000-8000-000000000010', scopeType: 'class_session',
    })).rejects.toMatchObject({ status: 503, code: 'AUTHORIZATION_CHECK_UNAVAILABLE' })
    expect(req.auditContext).toMatchObject({ authorizationResult: 'rpc_error', errorCode: 'AUTHORIZATION_RPC_ERROR', authorizationStage: 'enrollment_student_read_permission' })
    expect(JSON.stringify((req.log as any).error.mock.calls)).toContain('08006')
  })

  it('records successful authorization decisions explicitly', () => {
    const req = requestWithRpc(vi.fn())
    requireAuthorizationDecision(req, { data: true, error: null }, { permission: 'teaching.students.read', stage: 'enrollment_student_read_permission' })
    expect(req.auditContext).toMatchObject({ authorizationResult: 'allowed', permission: 'teaching.students.read' })
  })
})

describe('resource-aware authorization', () => {
  it('uses the report scope helper instead of treating a report id as a classroom id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await authorizeResource(requestWithRpc(rpc), resources.reports, 'teaching.reports.read', '00000000-0000-4000-8000-000000000010', {})
    expect(rpc).toHaveBeenCalledWith('can_access_report', {
      p_report_id: '00000000-0000-4000-8000-000000000010',
      p_permission_key: 'teaching.reports.read',
    })
  })

  it('uses the actual session id for session child resources', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await authorizeResource(
      requestWithRpc(rpc),
      resources['class-session-schedule-rules'],
      'teaching.class_sessions.read',
      '00000000-0000-4000-8000-000000000011',
      { class_session_id: '00000000-0000-4000-8000-000000000012' },
    )
    expect(rpc).toHaveBeenCalledWith('has_api_permission', {
      p_user_id: '00000000-0000-4000-8000-000000000001',
      p_permission_key: 'teaching.class_sessions.read',
      p_classroom_id: null,
      p_class_session_id: '00000000-0000-4000-8000-000000000012',
    })
  })

  it('resolves broad teaching collections through the platform root', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const req = requestWithRpc(rpc)
    await authorizeCollection(req, resources.courses, 'teaching.courses.list')
    expect(rpc).toHaveBeenCalledWith('has_api_permission', {
      p_user_id: '00000000-0000-4000-8000-000000000001',
      p_permission_key: 'teaching.courses.list',
      p_classroom_id: null,
      p_class_session_id: null,
    })
  })

  it('keeps self-owned resources independent from system permissions', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    await expect(authorizeResource(
      requestWithRpc(rpc),
      resources['user-preferences'],
      'system.users.read',
      '00000000-0000-4000-8000-000000000001',
      { user_id: '00000000-0000-4000-8000-000000000002' },
    )).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('checks every classroom and session referenced by a holiday', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await authorizeResource(
      requestWithRpc(rpc),
      resources.holidays,
      'teaching.holidays.read',
      '00000000-0000-4000-8000-000000000010',
      {
        classroom_ids: ['00000000-0000-4000-8000-000000000011'],
        class_session_ids: ['00000000-0000-4000-8000-000000000012'],
      },
    )
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenNthCalledWith(1, 'has_api_permission', expect.objectContaining({
      p_classroom_id: '00000000-0000-4000-8000-000000000011',
      p_class_session_id: null,
    }))
    expect(rpc).toHaveBeenNthCalledWith(2, 'has_api_permission', expect.objectContaining({
      p_classroom_id: null,
      p_class_session_id: '00000000-0000-4000-8000-000000000012',
    }))
  })

  it('allows a teacher to manage their own profile-linked credential without a session assignment', async () => {
    const teacherId = '00000000-0000-4000-8000-000000000020'
    const userId = '00000000-0000-4000-8000-000000000001'
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const db = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'teacher_records') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: teacherId, profile_id: '00000000-0000-4000-8000-000000000021' }, error: null }) }) }) }
        if (table === 'profiles') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: '00000000-0000-4000-8000-000000000021' }, error: null }) }) }) }) }
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      }),
    }
    const req = { user: { id: userId }, db, adminDb: db } as unknown as Request
    await authorizeCollection(req, resources['teacher-credentials'], 'teaching.teachers.create', { teacher_id: teacherId })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('uses the sensitive student scope helper instead of the ordinary owner shortcut', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await authorizeResource(
      requestWithRpc(rpc),
      resources['student-credentials'],
      'teaching.students.read_sensitive',
      '00000000-0000-4000-8000-000000000030',
      { student_id: '00000000-0000-4000-8000-000000000031' },
    )
    expect(rpc).toHaveBeenCalledWith('can_access_sensitive_student', {
      p_student_id: '00000000-0000-4000-8000-000000000031',
      p_permission_key: 'teaching.students.read_sensitive',
    })
  })
})
