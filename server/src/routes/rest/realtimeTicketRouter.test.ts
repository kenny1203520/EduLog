import express from 'express'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../app.js'
import { csrfProtection } from '../../auth/auth.js'
import { errorHandler } from '../../http/errors.js'
import { redeemTicket } from '../../realtime/realtimeTicket.js'
import { createRealtimeTicketRouter } from './realtimeTicketRouter.js'

const SECRET = 'a'.repeat(32)
const ROOM = 'bbe2ea83-8e94-4197-83c5-f126cf027abc'

const env = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  EDULOG_WEB_BASE_URL: 'http://localhost:4173',
  SUPABASE_URL: 'http://supabase.test',
  SUPABASE_ANON_KEY: 'anon-test-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  COOKIE_SECRET: SECRET,
  COOKIE_SECURE: 'false',
  RATE_LIMIT_STORE: 'memory',
  API_ALLOWED_ORIGINS: 'http://localhost:4173',
  API_EXTENSION_ALLOWED_ORIGINS: '',
}

/** Mounts the router behind CSRF and a stand-in for requireAuth. */
function ticketApp() {
  const app = express()
  app.use(cookieParser())
  app.use(express.json())
  app.use(csrfProtection, (req, _res, next) => {
    if (req.cookies?.edulog_access) req.accessToken = req.cookies.edulog_access
    next()
  })
  app.use('/api', createRealtimeTicketRouter({ COOKIE_SECRET: SECRET }))
  app.use(errorHandler)
  return app
}

describe('POST /api/realtime/ticket', () => {
  it('requires authentication on the protected API', async () => {
    const response = await request(createApp(env)).post('/api/realtime/ticket').send({ room: ROOM })
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('AUTH_REQUIRED')
  })

  it('requires the CSRF token when the session cookie is present', async () => {
    const response = await request(createApp(env)).post('/api/realtime/ticket')
      .set('Cookie', 'edulog_access=access-token; edulog_csrf=csrf-value')
      .send({ room: ROOM })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('CSRF_INVALID')
  })

  it('issues a ticket bound to the requested room', async () => {
    const response = await request(ticketApp()).post('/api/realtime/ticket')
      .set('Cookie', 'edulog_access=access-token; edulog_csrf=csrf-value')
      .set('X-CSRF-Token', 'csrf-value')
      .send({ room: ROOM })
    expect(response.status).toBe(200)
    expect(response.body.data.expires_in).toBe(30)
    expect(redeemTicket(SECRET, response.body.data.ticket, ROOM, 'class_session')).toBeNull()
    expect(redeemTicket(SECRET, response.body.data.ticket, ROOM, 'report')).toBe('access-token')
  })

  it('issues a class-session ticket', async () => {
    const response = await request(ticketApp()).post('/api/realtime/ticket')
      .set('Cookie', 'edulog_access=access-token; edulog_csrf=csrf-value')
      .set('X-CSRF-Token', 'csrf-value')
      .send({ class_session: ROOM })
    expect(response.status).toBe(200)
    expect(redeemTicket(SECRET, response.body.data.ticket, ROOM, 'class_session')).toBe('access-token')
  })

  it.each([
    [{}],
    [{ room: 'not-a-uuid' }],
    [{ room: ROOM, class_session: ROOM }],
  ])('rejects an invalid body %j', async (body) => {
    const response = await request(ticketApp()).post('/api/realtime/ticket')
      .set('Cookie', 'edulog_access=access-token; edulog_csrf=csrf-value')
      .set('X-CSRF-Token', 'csrf-value')
      .send(body)
    expect(response.status).toBe(422)
  })
})
