import { describe, expect, it, vi } from 'vitest'
import { ApiResourceClient } from './ApiResourceClient'
import { ApiV1Error } from './ApiV1Client'
import { ApiModeClient } from './ApiModeClient'

describe('ApiResourceClient', () => {
  it('builds bounded pagination and filter query parameters', async () => {
    const request = vi.fn().mockResolvedValue({ data: [], meta: { limit: 25, offset: 25 }, request_id: 'r', trace_id: 't' })
    const client = new ApiResourceClient(new ApiModeClient({ request }, { request }))
    await client.list('classrooms', { page: 2, perPage: 25, search: 'math room', sort: 'name:asc', mode: 'v1' })
    expect(request).toHaveBeenCalledWith('/classrooms?limit=25&offset=25&search=math+room&sort=name%3Aasc', expect.anything())
  })

  it('maps API authorization errors to the frontend error taxonomy', async () => {
    const request = vi.fn().mockRejectedValue(new ApiV1Error(403, { error: { code: 'FORBIDDEN', message: 'Denied', request_id: 'r', trace_id: 't' } }))
    const client = new ApiResourceClient(new ApiModeClient({ request }, { request }))
    await expect(client.list('classrooms', { mode: 'v1' })).rejects.toMatchObject({ kind: 'authorization' })
  })
})
