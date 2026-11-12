import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { testConfig } from './test/testConfig.js'
import { EMAIL_TEMPLATES } from './mail/emailTemplates.js'

const config = testConfig()

afterEach(() => { vi.unstubAllGlobals() })

describe('Express API boundary', () => {

  it('serves extension preflight only for configured extension ids', async () => {
    const extensionOrigin = `chrome-extension://${'b'.repeat(32)}`
    const app = createApp(testConfig({ API_EXTENSION_ALLOWED_ORIGINS: extensionOrigin }))
    const allowed = await request(app).options('/api/extension/v1/me')
      .set('Origin', extensionOrigin)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')
    const denied = await request(app).options('/api/extension/pair-requests').set('Origin', `chrome-extension://${'c'.repeat(32)}`).set('Access-Control-Request-Method', 'POST')
    expect(allowed.status).toBe(204)
    expect(allowed.headers['access-control-allow-origin']).toBe(extensionOrigin)
    expect(allowed.headers['access-control-allow-headers'].toLowerCase().split(/,\s*/)).toContain('authorization')
    expect(denied.status).toBe(403)
  })

  it('lets a local browser origin reach auth validation', async () => {
    const app = createApp(testConfig({ API_ALLOWED_ORIGINS: '' }))
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'invalid@example.test', password: 'invalid-password' })
    expect(response.status).not.toBe(403)
    expect(response.body.error.code).not.toBe('ORIGIN_FORBIDDEN')
  })
  it('returns JSON health responses for both public health paths', async () => {
    const app = createApp(config)
    const root = await request(app).get('/healthz')
    const api = await request(app).get('/api/healthz')
    expect(root.status).toBe(200)
    expect(root.body.status).toBe('ok')
    expect(api.status).toBe(200)
    expect(api.body.data.status).toBe('ok')
    expect(api.headers['x-request-id']).toBeTruthy()
    expect(api.headers['x-trace-id']).toBeTruthy()
    expect(api.headers['server-timing']).toMatch(/total;dur=/)
    expect(api.headers['cache-control']).toBe('private, no-store')
    expect(api.headers['content-security-policy']).toContain("default-src 'self'")
  })

  it.each(Object.keys(EMAIL_TEMPLATES))('serves the %s GoTrue template over the internal API route', async (name) => {
    const response = await request(createApp(config)).get('/email-templates/' + name + '.html')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/html/)
    expect(response.text).toBe(EMAIL_TEMPLATES[name as keyof typeof EMAIL_TEMPLATES])
  })

  it('does not serve unknown GoTrue template names', async () => {
    const response = await request(createApp(config)).get('/email-templates/password_changed_notification.html')
    expect(response.status).toBe(404)
  })

  it('never returns SPA HTML or allows an unauthenticated resource request', async () => {
    const app = createApp(config)
    const response = await request(app).get('/api/users')
    expect(response.status).toBe(401)
    expect(response.headers['content-type']).toMatch(/json/)
    expect(response.body.error.code).toBe('AUTH_REQUIRED')
  })

  it('rejects an untrusted origin before resource access', async () => {
    const app = createApp(config)
    const response = await request(app).get('/api/users').set('Origin', 'https://evil.example')
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('ORIGIN_FORBIDDEN')
  })

  it('accepts Apple form_post only at the OAuth bridge without granting CORS', async () => {
    const state = '123e4567-e89b-42d3-a456-426614174000'
    const rpc = vi.fn(async () => ({ data: { allowed: true, remaining: 9, reset_at: new Date(Date.now() + 60_000).toISOString() }, error: null }))
    const client = { rpc }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://localhost:4173/api/auth/oauth/callback?code=pkce-code' } })))
    const app = createApp(testConfig({
      GOTRUE_INTERNAL_URL: 'http://auth:9999',
      RATE_LIMIT_STORE: 'supabase',
    }), { adminClient: client, publicClient: client } as never)
    const response = await request(app).post('/api/auth/bridge/callback').set('Origin', 'https://appleid.apple.com').set('Cookie', 'edulog_access=session-cookie').type('form').send({ state, code: 'provider-code', user: '{}' })
    expect(response.status).toBe(303)
    expect(response.headers.location).toBe('http://localhost:4173/api/auth/oauth/callback?code=pkce-code')
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('consume_api_rate_limit', expect.objectContaining({ p_limit: 120, p_window_seconds: 60 }))
  })

  it('keeps one persistent API limit on OAuth starts alongside the route limiter', async () => {
    const rpc = vi.fn(async () => ({ data: { allowed: true, remaining: 119, reset_at: new Date(Date.now() + 60_000).toISOString() }, error: null }))
    const client = { rpc }
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/auth/v1/settings')) return new Response(JSON.stringify({ external: { github: true } }), { headers: { 'content-type': 'application/json' } })
      return new Response(null, { status: 302, headers: { location: 'https://github.com/login/oauth/authorize?client_id=test' } })
    }))
    const app = createApp(testConfig({
      GOTRUE_INTERNAL_URL: 'http://auth:9999',
      RATE_LIMIT_STORE: 'supabase',
    }), { adminClient: client, publicClient: client } as never)

    const response = await request(app).get('/api/auth/oauth/github')

    expect(response.status).toBe(303)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('consume_api_rate_limit', expect.objectContaining({ p_limit: 120, p_window_seconds: 60 }))
  })
})
