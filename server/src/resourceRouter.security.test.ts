import type { Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'

const authorizationMocks = vi.hoisted(() => ({
  authorizeResource: vi.fn(),
  authorizeCollection: vi.fn(),
  permissionForResource: vi.fn(() => 'teaching.lessons.update'),
}))

vi.mock('./auth/authorization.js', () => authorizationMocks)

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
