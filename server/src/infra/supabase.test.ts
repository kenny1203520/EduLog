import { describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import { clearAccessTokenValidation, validateAccessToken } from './supabase.js'

const futureToken = () => {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')
  return `header.${payload}.signature`
}

describe('access-token validation cache', () => {
  it('coalesces concurrent validations and never uses an expired cached token', async () => {
    const token = futureToken()
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-1', email: 'user@example.test' } }, error: null })
    const client = { auth: { getUser } } as any

    const [first, second] = await Promise.all([
      validateAccessToken(client, token),
      validateAccessToken(client, token),
    ])

    expect(first.id).toBe('user-1')
    expect(second.id).toBe('user-1')
    expect(getUser).toHaveBeenCalledTimes(1)
    clearAccessTokenValidation(token)
  })

  it('does not accept an already expired token from the cache', async () => {
    const token = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url')}.signature`
    const client = { auth: { getUser: vi.fn() } } as any
    await expect(validateAccessToken(client, token)).rejects.toThrow('AUTH_INVALID')
    expect(client.auth.getUser).not.toHaveBeenCalled()
  })

  it('verifies self-hosted HS256 tokens locally before the account lookup', async () => {
    const secret = 's'.repeat(32)
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('user-local')
      .setAudience('authenticated')
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode(secret))
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-local' } }, error: null })
    const client = { auth: { getUser } } as any

    await validateAccessToken(client, token, { SUPABASE_JWT_SECRET: secret })
    expect(getUser).toHaveBeenCalledTimes(1)
    clearAccessTokenValidation(token)
  })
})
