import express from 'express'
import { SignJWT } from 'jose'
import pino from 'pino'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { csrfProtection } from './auth.js'
import { AUTH_PROVIDERS_MANAGE, createProviderAdminRouter } from './providerAdmin.js'
import { requestContext } from '../http/context.js'
import { errorHandler } from '../http/errors.js'
import { testConfig } from '../test/testConfig.js'

const userId = '00000000-0000-4000-8000-000000000010'
const key = 'custom:authentik'
const origin = 'https://idp.example.test'
const issuer = origin + '/application/o/edulog/'
const discoveryUrl = issuer + '.well-known/openid-configuration'
const now = Math.floor(Date.now() / 1000)
const jwtSecret = 'a'.repeat(32)

const provider = {
  id: '00000000-0000-4000-8000-000000000011',
  identifier: key,
  name: 'Authentik',
  provider_type: 'oidc',
  enabled: false,
  issuer,
  discovery_url: discoveryUrl,
  client_secret: 'not-for-browser',
  client_id: 'client-id',
}
const create = {
  identifier: key, name: 'Authentik', provider_type: 'oidc',
  client_id: provider.client_id, client_secret: provider.client_secret, discovery_url: discoveryUrl,
}
const json = (value: unknown, status = 200) => Response.json(value, { status })

async function harness(options: { permitted?: boolean; enabled?: boolean; authenticatedAt?: number; blockedTokenOrigin?: boolean } = {}) {
  const config = testConfig({
    SUPABASE_JWT_SECRET: jwtSecret,
    GOTRUE_INTERNAL_URL: 'http://gotrue.test',
    AUTH_PROVIDER_ADMIN_ENABLED: String(options.enabled ?? true),
    AUTH_PROVIDER_ALLOWED_ORIGINS: origin,
  })
  const app = express()
  app.use(express.json(), requestContext(pino({ level: 'silent' })))
  app.use((req, _res, next) => {
    req.cookies = { edulog_access: req.header('x-fixture-token'), edulog_csrf: 'provider-csrf' }
    next()
  })
  const adminClient = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { account_status: 'active' }, error: null }),
        }),
      }),
    }),
  }
  const calls: Array<{ method: string; data: unknown }> = []
  let current = { ...provider }
  const fetcher = vi.fn(async (input: URL | string | globalThis.Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof globalThis.Request ? input.url : String(input))
    const method = input instanceof globalThis.Request ? input.method : init.method ?? 'GET'
    if (url.pathname === '/rest/v1/rpc/has_api_permission') {
      const arguments_ = input instanceof globalThis.Request ? await input.json() : JSON.parse(String(init.body))
      expect(arguments_.p_permission_key).toBe(AUTH_PROVIDERS_MANAGE)
      return json(options.permitted ?? true)
    }
    if (url.pathname === '/auth/v1/settings') return json({ external: { github: true, google: false, email: true } })
    if (url.href === discoveryUrl) {
      expect(init.redirect).toBe('error')
      return json({
        issuer,
        authorization_endpoint: origin + '/authorize',
        token_endpoint: options.blockedTokenOrigin ? 'https://other.example.test/token' : origin + '/token',
        jwks_uri: origin + '/jwks',
      })
    }
    if (url.origin !== 'http://gotrue.test') throw new Error('unexpected origin')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer service-role-test-key')
    if (method === 'GET') return json(url.pathname === '/admin/custom-providers' ? { providers: [current] } : current)
    const data = JSON.parse(String(init.body))
    calls.push({ method, data })
    current = { ...current, ...data }
    return json(current, method === 'POST' ? 201 : 200)
  })
  vi.stubGlobal('fetch', fetcher)
  app.use('/api/auth/provider-admin', csrfProtection, createProviderAdminRouter({ adminClient } as never, config))
  app.use(errorHandler)
  const token = await new SignJWT({
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: options.authenticatedAt ?? now }],
  }).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setAudience('authenticated')
    .setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(jwtSecret))
  const socket = request(app)
  const prefix = '/api/auth/provider-admin'
  function session(req: ReturnType<typeof socket.get>, csrf = true) {
    req.set('x-fixture-token', token)
    if (csrf) req.set('x-csrf-token', 'provider-csrf')
    return req
  }
  return {
    get: () => session(socket.get(prefix)),
    post: (csrf?: boolean) => session(socket.post(prefix), csrf),
    patch: () => session(socket.patch(prefix + '/' + encodeURIComponent(key))),
    calls,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('provider administration', () => {
  it('redacts credentials and reports built-in providers independently', async () => {
    const app = await harness()
    const response = await app.get().expect(200)
    expect(response.body.data).toMatchObject({
      enabled: true,
      builtin: [{ identifier: 'github', enabled: true }, { identifier: 'google', enabled: false }],
      custom: [{ identifier: key, enabled: false }],
    })
    expect(response.text).not.toContain(provider.client_secret)
    expect(response.text).not.toContain(provider.client_id)
  })

  it('saves a discovery-URL-only OIDC draft and enables only after callback confirmation', async () => {
    const app = await harness()
    const draft = await app.post().send(create).expect(201)
    expect(draft.body.data.enabled).toBe(false)
    expect(draft.text).not.toContain(provider.client_secret)
    expect(app.calls[0]).toMatchObject({ method: 'POST', data: { issuer, enabled: false, pkce_enabled: true } })
    await app.patch().send({ action: 'enable' }).expect(422)
    await app.patch().send({ action: 'enable', callback_confirmed: true }).expect(200)
    expect(app.calls[1]).toEqual({ method: 'PUT', data: { enabled: true } })
    await app.patch().send({ action: 'rotate_secret', client_secret: 'next-secret' }).expect(200)
    await app.patch().send({ action: 'disable' }).expect(200)
    expect(app.calls.slice(2)).toEqual([
      { method: 'PUT', data: { client_secret: 'next-secret' } },
      { method: 'PUT', data: { enabled: false } },
    ])
  })

  it('rejects discovery advertising a token endpoint outside the approved origins', async () => {
    const app = await harness({ blockedTokenOrigin: true })
    const response = await app.post().send(create).expect(422)
    expect(response.body.error.code).toBe('AUTH_PROVIDER_ORIGIN_BLOCKED')
    expect(app.calls).toHaveLength(0)
  })

  it('persists the validated discovery URL when an OIDC draft supplies only an issuer', async () => {
    const app = await harness()
    await app.post().send({ ...create, discovery_url: undefined, issuer }).expect(201)
    expect(app.calls[0]).toMatchObject({
      method: 'POST',
      data: { issuer, discovery_url: discoveryUrl, enabled: false, pkce_enabled: true },
    })
  })

  it.each([
    [{ permitted: false }, true, 'PERMISSION_DENIED'],
    [{ enabled: false }, true, 'AUTH_PROVIDER_ADMIN_DISABLED'],
    [{ authenticatedAt: now - 301 }, true, 'RECENT_AUTHENTICATION_REQUIRED'],
    [{}, false, 'CSRF_INVALID'],
  ] as const)('rejects an unauthorized write %#', async (options, csrf, code) => {
    const app = await harness(options)
    const response = await app.post(csrf).send(create).expect(403)
    expect(response.body.error.code).toBe(code)
    expect(app.calls).toHaveLength(0)
  })
})
