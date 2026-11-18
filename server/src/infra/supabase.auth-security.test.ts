import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import type { SupabaseClient } from '@supabase/supabase-js'

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { createAuthenticatedUserClient, validateAccessToken, verifyCurrentPassword } from './supabase.js'

const config = { SUPABASE_URL: 'https://supabase.example.test', SUPABASE_ANON_KEY: 'anon-key' } as any

describe('self-service authentication helpers', () => {
  beforeEach(() => createClientMock.mockReset())

  it('rejects an incorrect current password without retaining a session', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { user: null, session: null }, error: new Error('invalid credentials') })
    createClientMock.mockReturnValue({ auth: { signInWithPassword } })

    await expect(verifyCurrentPassword(config, 'person@example.test', 'wrong-password')).resolves.toBeNull()
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'person@example.test', password: 'wrong-password' })
    expect(createClientMock).toHaveBeenCalledWith(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  })

  it('returns only a verified, short-lived reauthentication session', async () => {
    const session = { access_token: 'verified-access', refresh_token: 'verified-refresh', expires_in: 3600, user: { id: 'user-1' } }
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { user: session.user, session }, error: null })
    createClientMock.mockReturnValue({ auth: { signInWithPassword } })

    await expect(verifyCurrentPassword(config, 'person@example.test', 'correct-password')).resolves.toBe(session)
  })

  it('binds Auth updates to the supplied user session without persistent storage', async () => {
    const setSession = vi.fn().mockResolvedValue({ data: { session: null, user: null }, error: null })
    const client = { auth: { setSession } }
    createClientMock.mockReturnValue(client)

    await expect(createAuthenticatedUserClient(config, 'access-token', 'refresh-token')).resolves.toBe(client)
    expect(setSession).toHaveBeenCalledWith({ access_token: 'access-token', refresh_token: 'refresh-token' })
    expect(createClientMock).toHaveBeenCalledWith(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  })
})

describe('third-party OAuth access token isolation', () => {
  it('rejects signed OAuth access tokens before contacting GoTrue, even without local token validation configured', async () => {
    const secret = new TextEncoder().encode('local-test-oauth-access-token-signing-key')
    const getUser = vi.fn()
    const client = { auth: { getUser } } as unknown as SupabaseClient
    const token = await new SignJWT({ client_id: 'eb69dca1-a777-4c58-8798-ab357d68f1c3', role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' }).setAudience('authenticated').setSubject('user-1').setExpirationTime('1h').sign(secret)
    await expect(validateAccessToken(client, token)).rejects.toThrow('AUTH_INVALID')
    expect(getUser).not.toHaveBeenCalled()
  })
})
