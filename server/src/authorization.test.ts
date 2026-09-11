import type { Request } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { authorizeCollection, authorizeResource } from './authorization.js'
import { resources } from './resources.js'

function requestWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { user: { id: '00000000-0000-4000-8000-000000000001' }, db: { rpc } } as unknown as Request
}

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

  it('does not require a fabricated teaching id for broad teaching collections', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await authorizeCollection(requestWithRpc(rpc), resources.courses, 'teaching.courses.list')
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

  it('allows an owner to create teacher credentials without a session assignment', async () => {
    const teacherId = '00000000-0000-4000-8000-000000000020'
    const userId = '00000000-0000-4000-8000-000000000001'
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const db = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'teachers') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: teacherId, user_id: userId }, error: null }) }) }) }
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      }),
    }
    const req = { user: { id: userId }, db } as unknown as Request
    await authorizeCollection(req, resources['teacher-credentials'], 'teaching.teachers.create', { teacher_id: teacherId })
    expect(rpc).not.toHaveBeenCalled()
  })
})
