import crypto from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'
import pino from 'pino'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthRouter, csrfProtection, setupLinkToken, validSetupLink } from './auth.js'
import { resetProviderCache } from './gotrue.js'
import { requestContext } from '../http/context.js'
import { errorHandler } from '../http/errors.js'
import type { Mailer } from '../mail/mailer.js'
import { testConfig } from '../test/testConfig.js'

const config = testConfig({ SUPABASE_PUBLIC_URL: 'https://db.example.test' })

/** A fake service-role client: account statuses per user id and recorded RPC calls. */
function fakeClients(statuses: Record<string, string>) {
  const rpc = vi.fn(async (name: string) => {
    if (name === 'mark_pending_account_notified') return { data: true, error: null }
    if (name === 'list_pending_accounts') return { data: Object.keys(statuses).map((id) => ({ id, email: `${id}@example.test`, provider: 'github' })), error: null }
    if (name === 'list_account_approver_emails') return { data: [{ email: 'admin@example.test' }], error: null }
    return { data: null, error: null }
  })
  const updateUserById = vi.fn(async () => ({ data: {}, error: null }))
  const adminClient = {
    rpc,
    from: (table: string) => ({
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => table === 'profiles'
            ? (statuses[id] ? { data: { account_status: statuses[id], full_name: null, nickname: null }, error: null } : { data: null, error: null })
            : { data: null, error: null },
        }),
      }),
    }),
    auth: {
      getUser: async (token: string) => ({ data: { user: { id: token.replace('token-', ''), email: 'user@example.test', app_metadata: {}, user_metadata: {} } }, error: null }),
      admin: { updateUserById, signOut: async () => ({}) },
    },
  }
  return { clients: { adminClient, publicClient: adminClient } as never, rpc, updateUserById }
}

function app(statuses: Record<string, string>, mailer: Mailer = { enabled: true, send: vi.fn(async () => {}) }) {
  const fake = fakeClients(statuses)
  const instance = express()
  instance.use(cookieParser())
  instance.use(express.json())
  instance.use(requestContext(pino({ level: 'silent' })))
  instance.use('/api/auth', csrfProtection, createAuthRouter(fake.clients, config, mailer))
  instance.use(errorHandler)
  return { instance, ...fake, mailer }
}

/** Answer GoTrue calls by path. */
function stubGoTrue(handlers: Record<string, (init?: RequestInit) => Response>) {
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname + new URL(String(url)).search
    const match = Object.keys(handlers).find((key) => path.startsWith(key))
    return match ? handlers[match](init) : new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const session = (userId: string) => ({ access_token: `token-${userId}`, refresh_token: 'refresh', expires_in: 3600, user: { id: userId } })

beforeEach(() => { resetProviderCache() })
afterEach(() => { vi.unstubAllGlobals() })

describe('OAuth sign-in', () => {
  it('lists only enabled social providers from GoTrue settings', async () => {
    stubGoTrue({ '/auth/v1/settings': () => json({ external: { email: true, phone: false, github: true, google: true, azure: false, anonymous_users: true, 'bad name': true } }) })
    const response = await request(app({}).instance).get('/api/auth/providers')
    expect(response.body.data.providers).toEqual(['github', 'google'])
  })

  it('offers no provider when GoTrue settings cannot be read', async () => {
    stubGoTrue({ '/auth/v1/settings': () => json({}, 500) })
    const response = await request(app({}).instance).get('/api/auth/providers')
    expect(response.body.data.providers).toEqual([])
  })

  it('redirects to GoTrue authorize with a PKCE challenge kept in an httpOnly cookie', async () => {
    stubGoTrue({ '/auth/v1/settings': () => json({ external: { github: true } }) })
    const response = await request(app({}).instance).get('/api/auth/oauth/github')
    expect(response.status).toBe(303)
    const target = new URL(response.headers.location)
    expect(target.origin + target.pathname).toBe('https://db.example.test/auth/v1/authorize')
    expect(target.searchParams.get('provider')).toBe('github')
    expect(target.searchParams.get('redirect_to')).toBe('http://localhost:4173/api/auth/oauth/callback')
    const cookie = String(response.headers['set-cookie']).match(/edulog_oauth=([^;]+)/)![1]
    expect(String(response.headers['set-cookie'])).toMatch(/HttpOnly/)
    expect(target.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update(decodeURIComponent(cookie)).digest('base64url'))
  })

  it('refuses a provider GoTrue has not enabled', async () => {
    stubGoTrue({ '/auth/v1/settings': () => json({ external: { github: true } }) })
    const response = await request(app({}).instance).get('/api/auth/oauth/google')
    expect(response.headers.location).toBe('/login?error=oauth')
  })

  it('signs a new OAuth account in as pending and tells administrators once', async () => {
    stubGoTrue({ '/auth/v1/token': () => json(session('new-user')) })
    const harness = app({ 'new-user': 'pending' })
    const response = await request(harness.instance).get('/api/auth/oauth/callback?code=abc').set('Cookie', 'edulog_oauth=verifier')
    expect(response.headers.location).toBe('/account-pending')
    expect(String(response.headers['set-cookie'])).toContain('edulog_access=token-new-user')
    await vi.waitFor(() => expect(harness.mailer.send).toHaveBeenCalledTimes(1))
    expect(vi.mocked(harness.mailer.send).mock.calls[0][0].to).toEqual(['admin@example.test'])
  })

  it('sends an active account to the dashboard and a disabled one to its notice without a session', async () => {
    stubGoTrue({ '/auth/v1/token': (init) => json(session(JSON.parse(String(init?.body)).auth_code)) })
    const harness = app({ 'active-user': 'active', 'banned-user': 'disabled' })
    const active = await request(harness.instance).get('/api/auth/oauth/callback?code=active-user').set('Cookie', 'edulog_oauth=v')
    expect(active.headers.location).toBe('/dashboard')
    const disabled = await request(harness.instance).get('/api/auth/oauth/callback?code=banned-user').set('Cookie', 'edulog_oauth=v')
    expect(disabled.headers.location).toBe('/account-disabled')
    expect(String(disabled.headers['set-cookie'])).not.toContain('edulog_access=token')
  })

  it('rejects a callback without the PKCE cookie', async () => {
    const response = await request(app({}).instance).get('/api/auth/oauth/callback?code=abc')
    expect(response.headers.location).toBe('/login?error=oauth')
  })
})

describe('email links and passwords', () => {
  it('opens a session from a reset link and allows setting a password once', async () => {
    stubGoTrue({ '/auth/v1/verify': () => json(session('reset-user')) })
    const harness = app({ 'reset-user': 'active' })
    const confirm = await request(harness.instance).get('/api/auth/confirm?token_hash=hash-12345&type=recovery')
    expect(confirm.headers.location).toBe('/auth/set-password')
    const cookies = (confirm.headers['set-cookie'] as unknown as string[]).map((cookie) => cookie.split(';')[0])
    expect(cookies.some((cookie) => cookie.startsWith('edulog_setup_link='))).toBe(true)

    const csrf = cookies.find((cookie) => cookie.startsWith('edulog_csrf='))!.split('=')[1]
    const set = await request(harness.instance).post('/api/auth/set-password').set('Cookie', cookies.join('; ')).set('x-csrf-token', csrf)
      .send({ new_password: 'a-new-password', confirm_password: 'a-new-password' })
    expect(set.status).toBe(200)
    expect(harness.updateUserById).toHaveBeenCalledWith('reset-user', { password: 'a-new-password' })
  })

  it('refuses to set a password without the setup cookie', async () => {
    const harness = app({ 'plain-user': 'active' })
    const response = await request(harness.instance).post('/api/auth/set-password').set('Authorization', 'Bearer token-plain-user')
      .send({ new_password: 'a-new-password', confirm_password: 'a-new-password' })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('PASSWORD_SETUP_EXPIRED')
    expect(harness.updateUserById).not.toHaveBeenCalled()
  })

  it('sends an invalid or used link back to the login page', async () => {
    stubGoTrue({ '/auth/v1/verify': () => json({ msg: 'expired' }, 403) })
    const response = await request(app({}).instance).get('/api/auth/confirm?token_hash=hash-12345&type=invite')
    expect(response.headers.location).toBe('/login?error=link')
  })

  it('answers a recovery request the same way whether or not the account exists', async () => {
    const fetchMock = stubGoTrue({ '/auth/v1/recover': () => json({ msg: 'not found' }, 404) })
    const response = await request(app({}).instance).post('/api/auth/recover').send({ email: 'nobody@example.test' })
    expect(response.status).toBe(204)
    expect(String(fetchMock.mock.calls[0][0])).toContain('redirect_to=http%3A%2F%2Flocalhost%3A4173')
  })

  it('signs the password-setup token to one user and a deadline', () => {
    const token = setupLinkToken(config, 'user-a', Date.now() + 1000)
    expect(validSetupLink(config, token, 'user-a')).toBe(true)
    expect(validSetupLink(config, token, 'user-b')).toBe(false)
    expect(validSetupLink(config, token.replace(/.$/, (char) => (char === 'A' ? 'B' : 'A')), 'user-a')).toBe(false)
    expect(validSetupLink(config, setupLinkToken(config, 'user-a', Date.now() - 1), 'user-a')).toBe(false)
  })
})

describe('pending accounts', () => {
  it('lets a pending account read itself but nothing else', async () => {
    const harness = app({ 'waiting-user': 'pending' }, { enabled: false, send: vi.fn() })
    const me = await request(harness.instance).get('/api/auth/me').set('Authorization', 'Bearer token-waiting-user')
    expect(me.status).toBe(200)
    expect(me.body.data.account_status).toBe('pending')
    const blocked = await request(harness.instance).post('/api/auth/me/password').set('Authorization', 'Bearer token-waiting-user')
      .send({ current_password: 'x', new_password: 'a-new-password', confirm_password: 'a-new-password' })
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('ACCOUNT_PENDING')
  })
})
