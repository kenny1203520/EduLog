import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import crypto from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createExtensionIntegrationRouter } from './extensionIntegrationRouter.js'
import { testConfig } from '../../test/testConfig.js'
import type { SupabaseClients } from '../../infra/supabase.js'

const user = '11111111-1111-4111-8111-111111111111'
const id = '22222222-2222-4222-8222-222222222222'
const installation = { installation_id: '33333333-3333-4333-8333-333333333333', device_name: 'Teaching laptop', browser_name: 'Chrome', platform_name: 'Windows', extension_version: '0.1.0' }
const origin = 'chrome-extension://' + 'a'.repeat(32)
vi.mock('../../auth/auth.js', () => ({
  csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuth: () => (req: Request, _res: Response, next: NextFunction) => { req.user = { id: '11111111-1111-4111-8111-111111111111' } as Request['user']; next() },
}))
function setup(row: unknown = { id, user_id: user, extension_origin: origin, expires_at: '2099-01-01T00:00:00Z', ...installation }) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select','insert','update','eq','is','gt','order','limit']) q[method] = vi.fn(() => q)
  q.maybeSingle = vi.fn(async () => ({ data: row, error: null }))
  q.single = vi.fn(async () => ({ data: row, error: null }))
  q.then = vi.fn(resolve => resolve({ data: row ? [row] : [], error: null }))
  const rpcResult = { single: vi.fn(async () => ({ data: { token_id: id, expires_at: '2099-01-01T00:00:00Z' }, error: null })) }
  const rpc = vi.fn(() => rpcResult)
  const admin = { from: vi.fn(() => q), rpc }
  const config = testConfig({ EDULOG_WEB_BASE_URL: 'http://localhost:5173', API_EXTENSION_ALLOWED_ORIGINS: origin })
  const app = express()
  app.use(express.json())
  app.use('/api/extension', createExtensionIntegrationRouter({ adminClient: admin, publicClient: {} } as unknown as SupabaseClients, config))
  app.use((error: { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => res.status(error.status || 422).json({ code: error.code }))
  return { app, q, rpc, rpcResult }
}
const accountStatus = vi.hoisted(() => ({ assertUserActive: vi.fn() }))
vi.mock('../../infra/supabase.js', async (original) => ({ ...(await original<typeof import('../../infra/supabase.js')>()), assertUserActive: accountStatus.assertUserActive }))
beforeEach(() => { accountStatus.assertUserActive.mockResolvedValue('active') })

describe('extension installations API', () => {
  it('accepts complete installation metadata and rejects partial identity', async () => {
    const { app, q } = setup()
    const created = await request(app).post('/api/extension/pair-requests').set('Origin',origin).send({ code_challenge: 'a'.repeat(64), ...installation })
    expect(created.status).toBe(201)
    expect(created.body.data.confirmation_code).toMatch(/^\d{6}$/)
    expect(q.insert).toHaveBeenCalledWith({ extension_origin: origin, code_challenge: 'a'.repeat(64), ...installation, confirmation_code: created.body.data.confirmation_code })
    expect((await request(app).post('/api/extension/pair-requests').set('Origin',origin).send({ code_challenge: 'a'.repeat(64), installation_id: installation.installation_id })).status).toBe(422)
  })
  it('issues credentials only through the atomic claim RPC with hashes', async () => {
    const { app, rpc, q } = setup()
    const response = await request(app).post('/api/extension/pair-requests/' + id + '/claim').set('Origin',origin).send({ code_verifier: 'c'.repeat(64) })
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('claim_web_extension_pairing', { p_request_id: id, p_origin: origin, p_verifier_hash: crypto.createHash('sha256').update('c'.repeat(64)).digest('hex'), p_token_hash: crypto.createHash('sha256').update(response.body.data.token).digest('hex') })
    expect(q.insert).not.toHaveBeenCalled()
  })
  it('maps duplicate claim to conflict without returning credentials', async () => {
    const { app, rpcResult } = setup()
    rpcResult.single.mockResolvedValue({ data: null!, error: { message: 'PAIRING_ALREADY_CLAIMED' } as never })
    const response = await request(app).post('/api/extension/pair-requests/' + id + '/claim').set('Origin',origin).send({ code_verifier: 'c'.repeat(64) })
    expect(response.status).toBe(409)
    expect(response.body.data).toBeUndefined()
  })
  it('lists only current user active tokens and renames only owned active tokens', async () => {
    const { app, q } = setup()
    expect((await request(app).get('/api/extension/tokens')).status).toBe(200)
    expect(q.eq).toHaveBeenCalledWith('user_id',user)
    expect(q.is).toHaveBeenCalledWith('revoked_at',null)
    expect(q.gt).toHaveBeenCalledWith('expires_at',expect.any(String))
    expect((await request(app).patch('/api/extension/tokens/' + id).send({ device_name: 'Office laptop' })).status).toBe(200)
    expect(q.update).toHaveBeenCalledWith({ device_name: 'Office laptop' })
    expect(q.eq).toHaveBeenCalledWith('id',id)
    expect((await request(app).patch('/api/extension/tokens/' + id).send({ device_name: ' ' })).status).toBe(422)
  })
  it('hides approval details owned by another account', async () => {
    const { app } = setup({ id, user_id: 'other-user', status: 'claimed', expires_at: '2099-01-01T00:00:00Z' })
    expect((await request(app).get('/api/extension/pair-requests/' + id + '/approval')).status).toBe(404)
  })
  it('returns device metadata without a token hash and executes activity updates', async () => {
    const { app, q } = setup()
    const response = await request(app).get('/api/extension/v1/me').set('Authorization','Bearer ' + 'a'.repeat(64))
    expect(response.status).toBe(200)
    expect(response.body.data.connection).toEqual(installation)
    expect(response.body.data.capabilities.report_prefill).toBe(false)
    expect(response.body.data).not.toHaveProperty('token_hash')
    expect(q.update).toHaveBeenCalledWith({ last_used_at: expect.any(String) })
    expect(q.then).toHaveBeenCalled()
  })
  it('binds legacy installation using the authenticated token ID exclusively', async () => {
    const { app, rpc } = setup()
    rpc.mockReturnValue({ data: null, error: null } as never)
    const response = await request(app).patch('/api/extension/v1/installation').set('Authorization','Bearer ' + 'a'.repeat(64)).send(installation)
    expect(response.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('bind_web_extension_installation', { p_token_id: id, p_installation_id: installation.installation_id, p_device_name: installation.device_name, p_browser_name: installation.browser_name, p_platform_name: installation.platform_name, p_extension_version: '0.1.0' })
    expect((await request(app).patch('/api/extension/v1/installation').set('Authorization','Bearer ' + 'a'.repeat(64)).send({ ...installation, token_id: 'someone-else' })).status).toBe(422)
  })
})

describe('extension pairing confirmation', () => {
  const pending = { id, status: 'pending', user_id: null, extension_origin: origin, expires_at: '2099-01-01T00:00:00Z', confirmation_code: '042917' }
  it('generates a fresh six-digit code for each pair request', async () => {
    const codes = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const { app } = setup()
      const response = await request(app).post('/api/extension/pair-requests').set('Origin', origin).send({ code_challenge: 'a'.repeat(64) })
      expect(response.body.data.confirmation_code).toMatch(/^\d{6}$/)
      codes.add(response.body.data.confirmation_code)
    }
    expect(codes.size).toBeGreaterThan(1)
  })
  it('shows the code on the approval page only while the request is pending', async () => {
    expect((await request(setup(pending).app).get('/api/extension/pair-requests/' + id + '/approval')).body.data.confirmation_code).toBe('042917')
    const approved = await request(setup({ ...pending, status: 'approved', user_id: user }).app).get('/api/extension/pair-requests/' + id + '/approval')
    expect(approved.body.data.confirmation_code).toBeNull()
  })
  it('requires the confirmation code to approve', async () => {
    const { app, q } = setup(pending)
    expect((await request(app).post('/api/extension/pair-requests/' + id + '/approve').send({ device_name: 'Office' })).status).toBe(422)
    expect((await request(app).post('/api/extension/pair-requests/' + id + '/approve').send({ confirmation_code: '12345' })).status).toBe(422)
    expect(q.update).not.toHaveBeenCalled()
  })
  it('approves a matching code bound to that code', async () => {
    const { app, q } = setup(pending)
    const response = await request(app).post('/api/extension/pair-requests/' + id + '/approve').send({ device_name: 'Office', confirmation_code: '042917' })
    expect(response.status).toBe(200)
    expect(q.update).toHaveBeenCalledWith({ user_id: user, status: 'approved', approved_at: expect.any(String), device_name: 'Office' })
    expect(q.eq).toHaveBeenCalledWith('confirmation_code', '042917')
  })
  it('revokes the request on a wrong code so it cannot be guessed', async () => {
    const { app, q } = setup(pending)
    const response = await request(app).post('/api/extension/pair-requests/' + id + '/approve').send({ confirmation_code: '000000' })
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('PAIRING_CODE_MISMATCH')
    expect(q.update).toHaveBeenCalledWith({ status: 'revoked' })
    expect(q.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }))
  })
  it('refuses requests created before codes existed, and expired or used requests', async () => {
    expect((await request(setup({ ...pending, confirmation_code: null }).app).post('/api/extension/pair-requests/' + id + '/approve').send({ confirmation_code: '042917' })).status).toBe(409)
    expect((await request(setup({ ...pending, expires_at: '2000-01-01T00:00:00Z' }).app).post('/api/extension/pair-requests/' + id + '/approve').send({ confirmation_code: '042917' })).status).toBe(404)
    expect((await request(setup({ ...pending, status: 'claimed' }).app).post('/api/extension/pair-requests/' + id + '/approve').send({ confirmation_code: '042917' })).status).toBe(404)
  })
})
