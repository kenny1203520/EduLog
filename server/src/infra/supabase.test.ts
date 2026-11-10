import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
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

  describe('asymmetric (JWKS) tokens', () => {
    const supabaseUrl = 'http://api-gw.test:8000'
    const signEs256 = async (privateKey: CryptoKey, kid: string) => new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid })
      .setSubject('user-es256')
      .setAudience('authenticated')
      .setExpirationTime('1m')
      .sign(privateKey)

    afterEach(() => { vi.unstubAllGlobals() })

    it('verifies ES256 tokens against the Auth JWKS endpoint even when an HS256 secret is configured', async () => {
      const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
      const jwk = { ...(await exportJWK(publicKey)), kid: 'es-key-1', alg: 'ES256', use: 'sig' }
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } }))
      vi.stubGlobal('fetch', fetchMock)
      const token = await signEs256(privateKey, 'es-key-1')
      const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'user-es256' } }, error: null })

      const user = await validateAccessToken({ auth: { getUser } } as any, token, { SUPABASE_URL: supabaseUrl, SUPABASE_JWT_SECRET: 's'.repeat(32) })

      expect(user.id).toBe('user-es256')
      expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
      clearAccessTokenValidation(token)
    })

    it('rejects ES256 tokens signed by a key outside the published JWKS', async () => {
      const published = await generateKeyPair('ES256', { extractable: true })
      const attacker = await generateKeyPair('ES256')
      const jwk = { ...(await exportJWK(published.publicKey)), kid: 'es-key-2', alg: 'ES256', use: 'sig' }
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } })))
      const token = await signEs256(attacker.privateKey, 'es-key-2')
      const getUser = vi.fn()

      await expect(validateAccessToken({ auth: { getUser } } as any, token, { SUPABASE_URL: `${supabaseUrl}/other`, SUPABASE_JWT_SECRET: 's'.repeat(32) })).rejects.toThrow('AUTH_INVALID')
      expect(getUser).not.toHaveBeenCalled()
    })
  })
})
