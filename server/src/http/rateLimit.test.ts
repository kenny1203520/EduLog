import express from 'express'
import request from 'supertest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { authAttemptRateLimit, rateLimitMiddleware, rateLimitRoute } from './rateLimit.js'
import { errorHandler } from './errors.js'

const memoryConfig = { API_RATE_LIMIT_PER_MINUTE: 3, API_AUTH_RATE_LIMIT_PER_MINUTE: 2, RATE_LIMIT_STORE: 'memory' as const }
const noClient = {} as SupabaseClient

function appBehindOneProxy(...middleware: express.RequestHandler[]) {
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.post('/login', ...middleware, (_req, res) => { res.status(204).end() })
  app.get('/items/:id', ...middleware, (_req, res) => { res.status(204).end() })
  app.use(errorHandler)
  return app
}

describe('rateLimitRoute', () => {
  it('collapses id-like segments', () => {
    expect(rateLimitRoute('/api/students/7f3c1d2e-1111-4a2b-9c3d-0123456789ab')).toBe('/api/students/:id')
    expect(rateLimitRoute('/api/items/42/history')).toBe('/api/items/:id/history')
    expect(rateLimitRoute('/api/auth/login')).toBe('/api/auth/login')
  })
})

describe('rateLimitMiddleware', () => {
  it('gives each forwarded client its own bucket behind a trusted proxy', async () => {
    const app = appBehindOneProxy(rateLimitMiddleware(memoryConfig, noClient))
    for (let i = 0; i < 3; i++) expect((await request(app).get('/items/1').set('X-Forwarded-For', '198.51.100.1')).status).toBe(204)
    expect((await request(app).get('/items/1').set('X-Forwarded-For', '198.51.100.1')).status).toBe(429)
    expect((await request(app).get('/items/1').set('X-Forwarded-For', '198.51.100.2')).status).toBe(204)
  })

  it('does not hand anonymous callers a fresh allowance per id', async () => {
    const app = appBehindOneProxy(rateLimitMiddleware(memoryConfig, noClient))
    for (let i = 1; i <= 3; i++) expect((await request(app).get(`/items/${i}`)).status).toBe(204)
    expect((await request(app).get('/items/4')).status).toBe(429)
  })
})

describe('authAttemptRateLimit', () => {
  it('limits one email across many addresses', async () => {
    const app = appBehindOneProxy(authAttemptRateLimit(memoryConfig, noClient, 'test-login'))
    const attempt = (ip: string) => request(app).post('/login').set('X-Forwarded-For', ip).send({ email: 'Teacher@Example.test', password: 'x' })
    expect((await attempt('203.0.113.1')).status).toBe(204)
    expect((await attempt('203.0.113.2')).status).toBe(204)
    const blocked = await attempt('203.0.113.3')
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('RATE_LIMITED')
  })

  it('limits one address across many emails', async () => {
    const app = appBehindOneProxy(authAttemptRateLimit(memoryConfig, noClient, 'test-login'))
    const attempt = (email: string) => request(app).post('/login').set('X-Forwarded-For', '203.0.113.9').send({ email, password: 'x' })
    expect((await attempt('a@example.test')).status).toBe(204)
    expect((await attempt('b@example.test')).status).toBe(204)
    expect((await attempt('c@example.test')).status).toBe(429)
  })
})
