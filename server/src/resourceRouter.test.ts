import type { Request } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { collection, idempotency } from './resourceRouter.js'
import { resources } from './resources.js'

describe('idempotency replay contract', () => {
  it('replays the stored response body with the current request and trace ids', async () => {
    const req = {
      method: 'POST',
      requestId: 'request-new',
      traceId: 'trace-new',
      originalUrl: '/api/roles?limit=25',
      user: { id: '00000000-0000-4000-8000-000000000001' },
      header: vi.fn().mockReturnValue('stable-key'),
      adminDb: {
        rpc: vi.fn().mockResolvedValue({
          data: [{
            is_replay: true,
            response_status: 201,
            response_body: { data: { id: 'resource-1' }, meta: {}, request_id: 'request-old', trace_id: 'trace-old' },
          }],
          error: null,
        }),
      },
    } as unknown as Request

    await expect(idempotency(req, 201, null)).resolves.toEqual({
      status: 201,
      body: { data: { id: 'resource-1' }, meta: {}, request_id: 'request-new', trace_id: 'trace-new' },
    })
  })
})

describe('resource mutation validation boundary', () => {
  function request(body: unknown) {
    const from = vi.fn()
    const rpc = vi.fn()
    const adminRpc = vi.fn()
    const req = {
      method: 'POST',
      body,
      query: {},
      requestId: 'request-invalid',
      traceId: 'trace-invalid',
      originalUrl: '/api/teachings',
      user: { id: '00000000-0000-4000-8000-000000000001' },
      db: { from, rpc },
      adminDb: { rpc: adminRpc },
      header: vi.fn(),
    } as unknown as Request
    return { req, from, rpc, adminRpc }
  }

  it('rejects invalid typed payloads before authorization or idempotency', async () => {
    const { req, from, rpc, adminRpc } = request({ name: 123 })
    await expect(collection(req, {} as never, resources.teachings)).rejects.toBeInstanceOf(ZodError)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(adminRpc).not.toHaveBeenCalled()
  })

  it('rejects invalid UUID child payloads before any database call', async () => {
    const { req, from, rpc, adminRpc } = request({ course_id: 'not-a-uuid', title: 'Lesson', sequence: 1 })
    await expect(collection(req, {} as never, resources.lessons)).rejects.toBeInstanceOf(ZodError)
    expect(from).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    expect(adminRpc).not.toHaveBeenCalled()
  })
})
