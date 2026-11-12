import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'

const authorizationMocks = vi.hoisted(() => ({
  authorizeResource: vi.fn(),
  authorizeCollection: vi.fn(),
  permissionForResource: vi.fn(() => 'teaching.lessons.update'),
}))

vi.mock('../../auth/authorization.js', () => authorizationMocks)

import { item } from './resourceRouter.js'
import { resources } from './resources.js'

function builder(result: unknown) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    update: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: result, error: null })),
  }
  return query
}

describe('resource item scope authorization', () => {
  it('re-checks a PATCH using the merged row and validated mutation', async () => {
    const oldCourseId = '00000000-0000-4000-8000-000000000010'
    const newCourseId = '00000000-0000-4000-8000-000000000011'
    const existing = { id: '00000000-0000-4000-8000-000000000012', course_id: oldCourseId, title: 'Lesson', sequence: 1 }
    const db = { from: vi.fn(() => builder(existing)) }
    const req = {
      method: 'PATCH',
      params: { id: existing.id },
      body: { course_id: newCourseId },
      query: {},
      requestId: 'request-1',
      traceId: 'trace-1',
      originalUrl: `/api/lessons/${existing.id}`,
      user: { id: '00000000-0000-4000-8000-000000000001' },
      db,
      adminDb: { rpc: vi.fn(async () => ({ data: [{ is_replay: false }], error: null })) },
      header: vi.fn((name: string) => name.toLowerCase() === 'idempotency-key' ? 'patch-key-1' : undefined),
    } as unknown as Request
    const response = { json: vi.fn((body: unknown) => body), status: vi.fn() } as unknown as Response

    authorizationMocks.authorizeResource.mockResolvedValue(undefined)
    await item(req, response, resources.lessons)

    expect(authorizationMocks.authorizeResource).toHaveBeenCalledTimes(2)
    expect(authorizationMocks.authorizeResource.mock.calls[0][4]).toMatchObject({ course_id: oldCourseId })
    expect(authorizationMocks.authorizeResource.mock.calls[1][4]).toMatchObject({ course_id: newCourseId, title: 'Lesson' })
  })
})

describe('resource creation with sensitive fields', () => {
  function createRequest(body: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const insert = { insert: vi.fn(() => insert), select: vi.fn(() => insert), single: vi.fn(async () => ({ data: { id: '00000000-0000-4000-8000-000000000021' }, error: null })) }
    const adminRpc = vi.fn(async (name: string) => name === 'create_teacher_with_profile'
      ? { data: { id: '00000000-0000-4000-8000-000000000022' }, error: null }
      : { data: [{ is_replay: false }], error: null })
    const profile = { select: vi.fn(() => profile), eq: vi.fn(() => profile), maybeSingle: vi.fn(async () => ({ data: null, error: null })) }
    const req = {
      method: 'POST', body, query: {}, originalUrl: '/api/x', requestId: 'r', traceId: 't',
      header: (name: string) => name.toLowerCase() === 'idempotency-key' ? 'create-test-key' : undefined,
      user: { id: 'caller' }, db: { from: vi.fn(() => insert) }, adminDb: { rpc: adminRpc, from: vi.fn(() => profile) },
      auditContext: {}, ...extra,
    } as unknown as Request
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) } as unknown as Response
    return { req, res, insert, adminRpc }
  }
  const permissions = () => authorizationMocks.authorizeCollection.mock.calls.map((call) => call[2])

  it('needs the personal-data permission to create a student with personal data', async () => {
    authorizationMocks.authorizeCollection.mockReset().mockResolvedValue(undefined)
    authorizationMocks.permissionForResource.mockReturnValue('teaching.students.create')
    const { collection } = await import('./resourceRouter.js')

    const plain = createRequest({ name: 'New Student' })
    await collection(plain.req, plain.res, resources.students)
    expect(permissions()).toEqual(['teaching.students.create'])

    authorizationMocks.authorizeCollection.mockClear()
    const personal = createRequest({ name: 'New Student', gov_id: 'A123456789' })
    await collection(personal.req, personal.res, resources.students)
    expect(permissions()).toEqual(['teaching.students.create', 'teaching.student_personal.update'])

    authorizationMocks.authorizeCollection.mockReset().mockImplementation(async (_req, _def, permission) => {
      if (permission === 'teaching.student_personal.update') throw new Error('denied')
    })
    const refused = createRequest({ name: 'New Student', phone: '0912345678' })
    await expect(collection(refused.req, refused.res, resources.students)).rejects.toThrow('denied')
    expect(refused.insert.insert).not.toHaveBeenCalled()
  })

  it('needs the account-link permissions to create a teacher already linked to an account', async () => {
    authorizationMocks.authorizeCollection.mockReset().mockResolvedValue(undefined)
    authorizationMocks.permissionForResource.mockReturnValue('teaching.teachers.create')
    const { collection } = await import('./resourceRouter.js')

    const unlinked = createRequest({ name: 'New Teacher' })
    await collection(unlinked.req, unlinked.res, resources.teachers)
    expect(permissions()).toEqual(['teaching.teachers.create'])

    authorizationMocks.authorizeCollection.mockClear()
    const linked = createRequest({ name: 'New Teacher', user_id: '00000000-0000-4000-8000-000000000023' })
    await collection(linked.req, linked.res, resources.teachers)
    expect(permissions()).toEqual(['teaching.teachers.create', 'teaching.teachers.update_sensitive', 'system.users.read'])

    authorizationMocks.authorizeCollection.mockReset().mockImplementation(async (_req, _def, permission) => {
      if (permission === 'system.users.read') throw new Error('denied')
    })
    const refused = createRequest({ name: 'New Teacher', user_id: '00000000-0000-4000-8000-000000000023' })
    await expect(collection(refused.req, refused.res, resources.teachers)).rejects.toThrow('denied')
    expect(refused.adminRpc).not.toHaveBeenCalledWith('create_teacher_with_profile', expect.anything())
  })
})
