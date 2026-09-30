import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp, resolveAllowedOrigins } from './app.js'

const env = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  EDULOG_WEB_BASE_URL: 'http://localhost:4173',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  COOKIE_SECRET: 'a'.repeat(32),
  COOKIE_SECURE: 'false',
  RATE_LIMIT_STORE: 'memory',
  API_ALLOWED_ORIGINS: 'http://localhost:4173',
  API_EXTENSION_ALLOWED_ORIGINS: '',
}

describe('Express API boundary', () => {
  it('allows the local Vite browser origins in development', () => {
    expect(resolveAllowedOrigins({ ...env, API_ALLOWED_ORIGINS: '', NODE_ENV: 'development' })).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://[::1]:5173',
    ])
  })

  it('rejects wildcard origins instead of combining them with credentials', () => {
    expect(() => resolveAllowedOrigins({ ...env, API_ALLOWED_ORIGINS: '*', NODE_ENV: 'production' })).toThrow(/wildcard/)
  })

  it('fails closed when production has no explicit origin allowlist', () => {
    expect(() => resolveAllowedOrigins({ ...env, API_ALLOWED_ORIGINS: '', NODE_ENV: 'production' })).toThrow(/explicit API_ALLOWED_ORIGINS/)
  })

  it('allows only explicitly configured extension origins', () => {
    const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`
    expect(resolveAllowedOrigins({ ...env, NODE_ENV: 'test', API_EXTENSION_ALLOWED_ORIGINS: extensionOrigin })).toContain(extensionOrigin)
    expect(() => resolveAllowedOrigins({ ...env, NODE_ENV: 'test', API_EXTENSION_ALLOWED_ORIGINS: 'chrome-extension://*' })).toThrow(/exact Chrome extension origins/)
  })

  it('serves extension preflight only for configured extension ids', async () => {
    const extensionOrigin = `chrome-extension://${'b'.repeat(32)}`
    const app = createApp({ ...env, API_EXTENSION_ALLOWED_ORIGINS: extensionOrigin })
    const allowed = await request(app).options('/api/extension/pair-requests').set('Origin', extensionOrigin).set('Access-Control-Request-Method', 'POST')
    const denied = await request(app).options('/api/extension/pair-requests').set('Origin', `chrome-extension://${'c'.repeat(32)}`).set('Access-Control-Request-Method', 'POST')
    expect(allowed.status).toBe(204)
    expect(allowed.headers['access-control-allow-origin']).toBe(extensionOrigin)
    expect(denied.status).toBe(403)
  })

  it('lets a local browser origin reach auth validation', async () => {
    const app = createApp({ ...env, API_ALLOWED_ORIGINS: '' })
    const response = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send({ email: 'invalid@example.test', password: 'invalid-password' })
    expect(response.status).not.toBe(403)
    expect(response.body.error.code).not.toBe('ORIGIN_FORBIDDEN')
  })
  it('returns JSON health responses for both public health paths', async () => {
    const app = createApp(env)
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
  })

  it('never returns SPA HTML or allows an unauthenticated resource request', async () => {
    const app = createApp(env)
    const response = await request(app).get('/api/users')
    expect(response.status).toBe(401)
    expect(response.headers['content-type']).toMatch(/json/)
    expect(response.body.error.code).toBe('AUTH_REQUIRED')
  })

  it('rejects an untrusted origin before resource access', async () => {
    const app = createApp(env)
    const response = await request(app).get('/api/users').set('Origin', 'https://evil.example')
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('ORIGIN_FORBIDDEN')
  })
})
