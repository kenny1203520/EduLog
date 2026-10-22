import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiV1Client, ApiV1Error, registerApiAuthRecovery } from './ApiV1Client'

describe('ApiV1Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    registerApiAuthRecovery(async () => null)
    })

  it('uses same-origin cookies and correlation headers without a browser token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [], meta: {}, request_id: 'r', trace_id: 't' }), { status: 200 }))
    await new ApiV1Client('/api').get('/teachings?limit=10')
    const request = fetchMock.mock.calls[0][1] as RequestInit
    const headers = new Headers(request.headers)
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('x-request-id')).toMatch(/^edulog-/)
    expect(headers.get('traceparent')).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })

  it('adds and preserves idempotency keys for mutations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { id: '1' }, request_id: 'r', trace_id: 't' }), { status: 201 }))
    await new ApiV1Client('/api').post('/teachings', { name: 'Test' }, { idempotencyKey: 'repeatable-key' })
    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers)
    expect(headers.get('idempotency-key')).toBe('repeatable-key')
  })

  it('in the extension side panel, reads the CSRF token from /auth/csrf and reads it again once after rotation', async () => {
    // A frame of an extension page sends its cookies but cannot read them from script.
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window)
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ data: { csrf_token: 'old' }, request_id: 'r', trace_id: 't' }))
      .mockResolvedValueOnce(json({ data: { id: '1' }, request_id: 'r', trace_id: 't' }, 201))
      .mockResolvedValueOnce(json({ data: { id: '2' }, request_id: 'r', trace_id: 't' }, 201))
      .mockResolvedValueOnce(json({ error: { code: 'CSRF_INVALID', message: 'x', request_id: 'r', trace_id: 't' } }, 403))
      .mockResolvedValueOnce(json({ data: { csrf_token: 'new' }, request_id: 'r', trace_id: 't' }))
      .mockResolvedValueOnce(json({ data: { id: '3' }, request_id: 'r', trace_id: 't' }, 201))
    const client = new ApiV1Client('/api')
    await client.post('/teachings', { name: 'A' })
    await client.post('/teachings', { name: 'B' })
    await client.post('/teachings', { name: 'C' })
    const calls = fetchMock.mock.calls.map(([url, init]) => [String(url), new Headers((init as RequestInit).headers).get('x-csrf-token')])
    expect(calls).toEqual([
      ['/api/auth/csrf', null], ['/api/teachings', 'old'], ['/api/teachings', 'old'],
      ['/api/teachings', 'old'], ['/api/auth/csrf', null], ['/api/teachings', 'new'],
    ])
  })

  it('announces pending API activity and ends it after the response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [], request_id: 'r', trace_id: 't' }), { status: 200 }))
    const started = vi.fn()
    const ended = vi.fn()
    window.addEventListener('edulog:api-request-start', started)
    window.addEventListener('edulog:api-request-end', ended)

    await new ApiV1Client('/api').get('/students')

    expect(started).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledTimes(1)
    window.removeEventListener('edulog:api-request-start', started)
    window.removeEventListener('edulog:api-request-end', ended)
  })

  it('blocks mutation requests when the browser is offline', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    await expect(new ApiV1Client('/api').post('/students', { name: 'Learner' })).rejects.toThrow('Network offline')

    expect(fetchMock).not.toHaveBeenCalled()
    online.mockRestore()
  })

  it('maps the standard error envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'PERMISSION_DENIED', message: 'Denied', request_id: 'r', trace_id: 't', fields: { role: ['required'] } } }), { status: 403 }))
    await expect(new ApiV1Client('/api').get('/roles')).rejects.toMatchObject<ApiV1Error>({ status: 403, code: 'PERMISSION_DENIED', requestId: 'r', traceId: 't', fields: { role: ['required'] } })
  })

  it('refreshes once and retries an unauthenticated request with the same mutation idempotency key', async () => {
    const recovery = vi.fn().mockResolvedValue({ id: 'user-1' })
    registerApiAuthRecovery(recovery)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'AUTH_INVALID', message: 'Expired', request_id: 'r1', trace_id: 't1' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 'created' }, request_id: 'r2', trace_id: 't2' }), { status: 201 }))

    const result = await new ApiV1Client('/api').post('/students', { name: 'Learner' })

    expect(result.data).toEqual({ id: 'created' })
    expect(recovery).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstHeaders = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers)
    const retryHeaders = new Headers((fetchMock.mock.calls[1][1] as RequestInit).headers)
    expect(retryHeaders.get('idempotency-key')).toBe(firstHeaders.get('idempotency-key'))
  })

  it('does not try to recover permission denials and dispatches disabled-account state', async () => {
    const recovery = vi.fn().mockResolvedValue({ id: 'user-1' })
    registerApiAuthRecovery(recovery)
    const disabled = vi.fn()
    window.addEventListener('edulog:account-disabled', disabled)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'ACCOUNT_DISABLED', message: 'Disabled', request_id: 'r', trace_id: 't' } }), { status: 403 }))

    await expect(new ApiV1Client('/api').get('/students')).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED' })

    expect(recovery).not.toHaveBeenCalled()
    expect(disabled).toHaveBeenCalledTimes(1)
    window.removeEventListener('edulog:account-disabled', disabled)
  })

  it('dispatches session expiration after refresh fails, but never refreshes the login endpoint', async () => {
    const recovery = vi.fn().mockResolvedValue(null)
    registerApiAuthRecovery(recovery)
    const expired = vi.fn()
    window.addEventListener('edulog:auth-session-expired', expired)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: 'Required', request_id: 'r', trace_id: 't' } }), { status: 401 }))

    await expect(new ApiV1Client('/api').get('/students')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(new ApiV1Client('/api').post('/auth/login', { email: 'x@example.test', password: 'bad' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })

    expect(recovery).toHaveBeenCalledTimes(1)
    expect(expired).toHaveBeenCalledTimes(1)
    window.removeEventListener('edulog:auth-session-expired', expired)
  })
})
