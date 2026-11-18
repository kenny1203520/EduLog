import express from 'express'
import pino from 'pino'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testConfig } from '../test/testConfig.js'
import { requestContext } from '../http/context.js'
import { errorHandler } from '../http/errors.js'

const auth = vi.hoisted(() => ({
  proof: vi.fn(),
  update: vi.fn(),
  sessionClient: vi.fn(),
}))
vi.mock('../infra/supabase.js', async importOriginal => {
  const original = await importOriginal<typeof import('../infra/supabase.js')>()
  return {
    ...original,
    validateAccessToken: vi.fn(async () => ({ id: 'same-user', email: 'person@example.test', factors: [] })),
    assertUserActive: vi.fn(async () => 'active'),
    verifyCurrentPassword: auth.proof,
    createAuthenticatedUserClient: auth.sessionClient,
  }
})

import { createAuthRouter, csrfProtection } from './auth.js'

function app() {
  const instance = express()
  instance.use(express.json(), requestContext(pino({ level: 'silent' })))
  instance.use((req, _res, next) => {
    req.cookies = { edulog_access: req.header('x-fixture-access'), edulog_refresh: 'browser-refresh', edulog_csrf: 'fixture' }
    next()
  })
  instance.use('/api/auth', csrfProtection, createAuthRouter({ adminClient: {} } as never, testConfig()))
  instance.use(errorHandler)
  return instance
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.proof.mockResolvedValue({ access_token: 'password-proof-aal1', refresh_token: 'proof-refresh', user: { id: 'same-user' } })
  auth.update.mockResolvedValue({ error: null })
  auth.sessionClient.mockResolvedValue({ auth: { updateUser: auth.update, getSession: async () => ({ data: { session: null } }) } })
})

describe('account changes after MFA', () => {
  it.each([
    ['/me/email', { email: 'new@example.test', current_password: 'existing-password' }],
    ['/me/password', { new_password: 'new-password', confirm_password: 'new-password', current_password: 'existing-password' }],
  ])('updates %s with the authenticated browser session after proving the password', async (path, body) => {
    const response = await request(app()).post('/api/auth' + path)
      .set('x-fixture-access', 'browser-aal2')
      .set('x-csrf-token', 'fixture').send(body)
    expect(response.status).toBe(200)
    expect(auth.sessionClient).toHaveBeenCalledWith(expect.anything(), 'browser-aal2', 'browser-refresh')
    expect(auth.update).toHaveBeenCalledOnce()
  })

  it('rejects password proof that belongs to another account', async () => {
    auth.proof.mockResolvedValue({ access_token: 'other-user', refresh_token: 'other-refresh', user: { id: 'different-user' } })
    const response = await request(app()).post('/api/auth/me/email')
      .set('x-fixture-access', 'browser-aal2')
      .set('x-csrf-token', 'fixture').send({ email: 'new@example.test', current_password: 'existing-password' })
    expect(response.status).toBe(403)
    expect(auth.update).not.toHaveBeenCalled()
  })
})
