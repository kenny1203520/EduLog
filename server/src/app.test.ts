import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'

const env = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  API_BASE_URL: 'http://localhost:4173',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  COOKIE_SECRET: 'a'.repeat(32),
  COOKIE_SECURE: 'false',
  RATE_LIMIT_STORE: 'memory',
  API_ALLOWED_ORIGINS: 'http://localhost:4173',
}

describe('Express API boundary', () => {
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
