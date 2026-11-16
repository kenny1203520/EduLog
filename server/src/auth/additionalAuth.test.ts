import express, { Router } from 'express'
import cookieParser from 'cookie-parser'
import pino from 'pino'
import request from 'supertest'
import { SignJWT } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureSessionAssurance, registerAdditionalAuthRoutes } from './additionalAuth.js'
import { testConfig } from '../test/testConfig.js'
import { requestContext } from '../http/context.js'
import { errorHandler } from '../http/errors.js'

const config = testConfig({
  GOTRUE_INTERNAL_URL: 'http://auth:9999',
  AUTH_MAIL_DELIVERY_ENABLED: 'true',
  AUTH_EMAIL_OTP_ENABLED: 'true',
  AUTH_MAGIC_LINK_ENABLED: 'true',
})

function testApp() {
  const app = express()
  const router = Router()
  app.use(cookieParser())
  app.use(express.json())
  app.use(requestContext(pino({ level: 'silent' })))
  const sendSession = vi.fn(async () => 'active' as const)
  registerAdditionalAuthRoutes(router, {
    config,
    activeAccount: (_req, _res, next) => next(),
    challengeAccount: (req, _res, next) => {
      req.accessToken = req.cookies?.edulog_access
      next()
    },
    rateLimiter: (_req, _res, next) => next(),
    sendSession,
  })
  app.use('/api/auth', router)
  app.use(errorHandler)
  return { app, sendSession }
}

const factorId = '3ab210f1-7899-4fa7-92b9-a464492b6fe9'
const factor = { id: factorId, factor_type: 'totp', status: 'verified' }
const settings = { external: { email: true, phone: true }, sms_provider: 'twilio', saml_enabled: true }
const secret = new TextEncoder().encode('test-signing-key-for-assurance')
const tokenFor = (aal: 'aal1' | 'aal2') => new SignJWT({ aal }).setProtectedHeader({ alg: 'HS256' }).sign(secret)

afterEach(() => { vi.unstubAllGlobals() })

describe('additional auth routes', () => {
  it('does not expose whether an OTP destination has an account', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json({ code: 'user_not_found' }, { status: 422 }))
    vi.stubGlobal('fetch', fetchMock)
    const { app } = testApp()
    const response = await request(app).post('/api/auth/session/otp').send({ method: 'email', email: 'unknown@example.test' })
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ sent: true })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ email: 'unknown@example.test', create_user: false })
  })

  it('asks for PKCE on SAML and rejects an ACS redirect outside the callback', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json({ url: 'https://idp.example.test/authorize' }))
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'https://example.test/unrelated' } }))
    vi.stubGlobal('fetch', fetchMock)
    const { app } = testApp()
    const login = await request(app).post('/api/auth/session/sso').send({ domain: 'example.test' })
    expect(login.status).toBe(200)
    expect(login.headers['set-cookie'][0]).toContain('edulog_passwordless=')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      domain: 'example.test', code_challenge_method: 's256', code_challenge: expect.any(String),
    })
    const callback = await request(app).post('/api/auth/sso/saml/acs').type('form').send({ SAMLResponse: 'response', RelayState: 'state' })
    expect(callback.headers.location).toBe('/login?error=link')
  })

  it('recognizes a verified factor and requires assurance before accessing application data', async () => {
    await expect(ensureSessionAssurance(config, await tokenFor('aal1'), { factors: [factor] })).rejects.toMatchObject({ code: 'MFA_REQUIRED' })
    await expect(ensureSessionAssurance(config, await tokenFor('aal2'), { factors: [factor] })).resolves.toBeUndefined()
    await expect(ensureSessionAssurance(config, await tokenFor('aal1'), {})).resolves.toBeUndefined()
  })

  it('does not use an unverified factor to step up when a verified factor exists', async () => {
    const enrollmentId = 'd86455e0-0e71-416b-92b8-bd69cbe70cb2'
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({
      factors: [factor, { ...factor, id: enrollmentId, status: 'unverified' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { app } = testApp()
    const response = await request(app).post(`/api/auth/me/factors/${enrollmentId}/challenge`)
      .set('Cookie', `edulog_access=${await tokenFor('aal1')}`).send({})
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('MFA_REQUIRED')
    expect(fetchMock.mock.calls.map(([url]) => new URL(url).pathname)).not.toContain(`/factors/${enrollmentId}/challenge`)
  })
})
