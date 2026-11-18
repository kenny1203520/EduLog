import express from 'express'
import cookieParser from 'cookie-parser'
import pino from 'pino'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthRouter, csrfProtection } from './auth.js'
import { evaluateSession, SESSION_ABSOLUTE_MAX_MS, SESSION_IDLE_TIMEOUT_MS, SessionActivityStore, sessionIdOf } from './sessionPolicy.js'
import { requestContext } from '../http/context.js'
import { errorHandler } from '../http/errors.js'
import { testConfig } from '../test/testConfig.js'

const sessionId = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const userId = 'user-a'
const HOUR = 60 * 60 * 1000
const unsignedJwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

type Row = { session_id: string; user_id: string; started_at: string; last_activity_at: string }
/** Enough of the service-role query builder for the activity table. */
function fakeAdmin(rows = new Map<string, Row>()) {
  const writes: Array<{ op: string; values?: unknown }> = []
  const from = vi.fn((table: string) => {
    if (table !== 'api_session_activity') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { account_status: 'active' }, error: null }) }) }) }
    }
    const filters: Record<string, string> = {}
    let op = 'select', values: Partial<Row> = {}
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: string) => { filters[column] = value; return builder },
      lt: () => builder,
      update: (next: Partial<Row>) => { op = 'update'; values = next; return builder },
      delete: () => { op = 'delete'; return builder },
      upsert: async (row: Row, options: { ignoreDuplicates?: boolean }) => {
        writes.push({ op: 'upsert', values: row })
        if (!(options.ignoreDuplicates && rows.has(row.session_id))) rows.set(row.session_id, row)
        return { error: null }
      },
      maybeSingle: async () => {
        const row = rows.get(filters.session_id)
        if (op === 'update') {
          writes.push({ op, values })
          if (!row || (filters.user_id && row.user_id !== filters.user_id)) return { data: null, error: null }
          Object.assign(row, values)
          return { data: { session_id: row.session_id }, error: null }
        }
        return { data: row ?? null, error: null }
      },
      then: (resolve: (value: unknown) => void) => {
        writes.push({ op, values })
        const row = rows.get(filters.session_id)
        if (op === 'update' && row && (!filters.user_id || row.user_id === filters.user_id)) Object.assign(row, values)
        if (op === 'delete' && filters.session_id) rows.delete(filters.session_id)
        resolve({ data: null, error: null })
      },
    }
    return builder
  })
  return { from, rows, writes }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('session policy evaluation', () => {
  it('allows activity within 8 hours and 30 days', () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    expect(evaluateSession(start, start, start + SESSION_IDLE_TIMEOUT_MS - 1).ok).toBe(true)
  })
  it('ends a session idle for 8 hours', () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    expect(evaluateSession(start, start + HOUR, start + HOUR + SESSION_IDLE_TIMEOUT_MS)).toMatchObject({ ok: false, reason: 'idle' })
  })
  it('ends an active session at 30 days', () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    const now = start + SESSION_ABSOLUTE_MAX_MS
    expect(evaluateSession(start, now - 1000, now)).toMatchObject({ ok: false, reason: 'absolute', absoluteExpiresAt: new Date(now).toISOString() })
  })
  it('reads the GoTrue session id claim and nothing else', () => {
    expect(sessionIdOf(unsignedJwt({ session_id: sessionId }))).toBe(sessionId)
    expect(sessionIdOf(unsignedJwt({ session_id: 'not-a-uuid' }))).toBeNull()
    expect(sessionIdOf('opaque-token')).toBeNull()
    expect(sessionIdOf(undefined)).toBeNull()
  })
})

describe('session activity store', () => {
  it('keeps the original start when the same session signs in again (MFA step-up)', async () => {
    const admin = fakeAdmin()
    const store = new SessionActivityStore(admin as never)
    const t0 = Date.parse('2026-01-01T00:00:00Z')
    await store.start(sessionId, userId, t0)
    await store.start(sessionId, userId, t0 + 5 * HOUR)
    expect(admin.rows.get(sessionId)).toMatchObject({ started_at: new Date(t0).toISOString(), last_activity_at: new Date(t0 + 5 * HOUR).toISOString() })
  })
  it('throttles activity writes to one a minute', async () => {
    const admin = fakeAdmin()
    const store = new SessionActivityStore(admin as never)
    const t0 = Date.parse('2026-01-01T00:00:00Z')
    await store.start(sessionId, userId, t0)
    const before = admin.writes.length
    await store.touch(sessionId, userId, t0 + 30_000)
    expect(admin.writes.length).toBe(before)
    await store.touch(sessionId, userId, t0 + 61_000)
    expect(admin.rows.get(sessionId)!.last_activity_at).toBe(new Date(t0 + 61_000).toISOString())
  })
  it('adopts a session signed in before tracking existed, then enforces idle', async () => {
    const admin = fakeAdmin()
    const store = new SessionActivityStore(admin as never)
    const t0 = Date.parse('2026-01-01T00:00:00Z')
    expect((await store.check(sessionId, userId, t0)).ok).toBe(true)
    expect((await store.check(sessionId, userId, t0 + SESSION_IDLE_TIMEOUT_MS)).reason).toBe('idle')
  })
  it('refuses a session id recorded for another user', async () => {
    const admin = fakeAdmin(new Map([[sessionId, { session_id: sessionId, user_id: 'user-b', started_at: '2026-01-01T00:00:00Z', last_activity_at: '2026-01-01T00:00:00Z' }]]))
    expect((await new SessionActivityStore(admin as never).check(sessionId, userId, Date.parse('2026-01-01T01:00:00Z'))).ok).toBe(false)
  })
})

describe('refresh enforces the session policy', () => {
  const config = testConfig({ GOTRUE_INTERNAL_URL: 'http://auth:9999' })
  function harness(row?: Partial<Row>) {
    const admin = fakeAdmin()
    if (row) admin.rows.set(sessionId, { session_id: sessionId, user_id: userId, started_at: new Date().toISOString(), last_activity_at: new Date().toISOString(), ...row })
    const signOut = vi.fn(async () => ({}))
    const adminClient = { from: admin.from, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { admin: { signOut } } }
    const instance = express()
    instance.use(cookieParser()); instance.use(express.json()); instance.use(requestContext(pino({ level: 'silent' })))
    instance.use('/api/auth', csrfProtection, createAuthRouter({ adminClient } as never, config, { enabled: false, send: vi.fn() }))
    instance.use(errorHandler)
    const accessToken = unsignedJwt({ sub: userId, session_id: sessionId, aal: 'aal1', exp: Math.floor(Date.now() / 1000) + 3600 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, refresh_token: 'rotated', user: { id: userId, email: 'a@example.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated' } }), { status: 200, headers: { 'content-type': 'application/json' } })))
    return { instance, admin, signOut }
  }

  it('issues new tokens for an active session, capped at the remaining absolute time', async () => {
    const started = new Date(Date.now() - 29 * 24 * HOUR).toISOString()
    const { instance } = harness({ started_at: started })
    const response = await request(instance).post('/api/auth/refresh').set('Cookie', 'edulog_refresh=old')
    expect(response.status).toBe(200)
    expect(response.body.meta.session).toEqual({ idle_timeout_seconds: 8 * 3600, absolute_expires_at: new Date(Date.parse(started) + SESSION_ABSOLUTE_MAX_MS).toISOString() })
    const refreshCookie = (response.headers['set-cookie'] as unknown as string[]).find(cookie => cookie.startsWith('edulog_refresh=rotated'))!
    const maxAge = Number(/Max-Age=(\d+)/.exec(refreshCookie)![1])
    expect(maxAge).toBeLessThanOrEqual(24 * 3600)
    expect(maxAge).toBeGreaterThan(23 * 3600)
  })
  it('rejects refresh after 8 idle hours and revokes the rotated session', async () => {
    const { instance, signOut, admin } = harness({ last_activity_at: new Date(Date.now() - 9 * HOUR).toISOString() })
    const response = await request(instance).post('/api/auth/refresh').set('Cookie', 'edulog_refresh=old')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('SESSION_EXPIRED')
    expect(response.body.error.details.reason).toBe('idle')
    expect(signOut).toHaveBeenCalledWith(expect.any(String), 'local')
    expect(String(response.headers['set-cookie'])).not.toContain('edulog_refresh=rotated')
    expect(admin.rows.has(sessionId)).toBe(false)
  })
  it('rejects refresh after 30 days even when active', async () => {
    const { instance } = harness({ started_at: new Date(Date.now() - 31 * 24 * HOUR).toISOString() })
    const response = await request(instance).post('/api/auth/refresh').set('Cookie', 'edulog_refresh=old')
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('SESSION_EXPIRED')
  })
})
