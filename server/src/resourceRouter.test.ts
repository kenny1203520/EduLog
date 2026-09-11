import type { Request } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { idempotency } from './resourceRouter.js'

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
