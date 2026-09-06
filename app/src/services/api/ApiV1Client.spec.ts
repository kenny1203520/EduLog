import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiV1Client, ApiV1Error } from './ApiV1Client'
import { supabase } from '@/lib/supabase'

describe('ApiV1Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'jwt-test' } as never },
      error: null,
    })
  })

  it('sends the Supabase JWT and correlation headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [], meta: {}, request_id: 'r', trace_id: 't' }), { status: 200 }))
    await new ApiV1Client('https://example.test/api-v1').get('/teachings?limit=10')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const headers = new Headers(request.headers)
    expect(headers.get('authorization')).toBe('Bearer jwt-test')
    expect(headers.get('x-request-id')).toMatch(/^edulog-/)
    expect(headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('adds and preserves idempotency keys for mutations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { id: '1' }, request_id: 'r', trace_id: 't' }), { status: 201 }))
    await new ApiV1Client('https://example.test/api-v1').post('/teachings', { name: 'Test' }, { idempotencyKey: 'repeatable-key' })
    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers)
    expect(headers.get('idempotency-key')).toBe('repeatable-key')
  })

  it('maps the standard error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'PERMISSION_DENIED', message: 'Denied', request_id: 'r', trace_id: 't', fields: { role: ['required'] } } }), { status: 403 }))
    await expect(new ApiV1Client('https://example.test/api-v1').get('/roles')).rejects.toMatchObject<ApiV1Error>({ status: 403, code: 'PERMISSION_DENIED', requestId: 'r', traceId: 't', fields: { role: ['required'] } })
  })
})
