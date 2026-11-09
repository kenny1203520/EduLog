import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { testConfig } from './test/testConfig.js'

const config = testConfig()

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
})
