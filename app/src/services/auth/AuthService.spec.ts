import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }))
vi.mock('@/services/api/ApiV1Client', () => ({ apiV1Client: { get: getMock, post: postMock } }))

import { AuthService } from './AuthService'

describe('AuthService BFF contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockResolvedValue({ data: { id: 'user-1' }, meta: {}, request_id: 'r', trace_id: 't' })
    postMock.mockResolvedValue({ data: { id: 'user-1' }, meta: {}, request_id: 'r', trace_id: 't' })
  })

  it('uses the shared API client for login, including the BFF mutation contract', async () => {
    const result = await AuthService.getInstance().login('user@example.test', 'password')
    expect(postMock).toHaveBeenCalledWith('/auth/login', { email: 'user@example.test', password: 'password' })
    expect(result.session?.user.id).toBe('user-1')
  })

  it('uses the shared API client for refresh and logout', async () => {
    await AuthService.getInstance().refresh()
    await AuthService.getInstance().logout()
    expect(postMock).toHaveBeenNthCalledWith(1, '/auth/refresh', {})
    expect(postMock).toHaveBeenNthCalledWith(2, '/auth/logout', {})
  })

  it('reads the authenticated session through the BFF', async () => {
    const result = await AuthService.getInstance().getSession()
    expect(getMock).toHaveBeenCalledWith('/auth/me')
    expect(result.session?.user.id).toBe('user-1')
  })
})
