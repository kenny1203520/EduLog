import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../../http/errors.js'
import { createAccountRouter } from './accountRouter.js'
import { createMailer, pendingAccountMessage } from '../../mail/mailer.js'

const TEACHER = 'a1000000-0000-4000-8000-000000000001'
const USER_MANAGER = 'a1000000-0000-4000-8000-000000000002'
const OWNER = 'a1000000-0000-4000-8000-000000000003'
const PENDING = 'b1000000-0000-4000-8000-000000000001'

const roles = [
  { id: TEACHER, code: 'teacher', name: 'Teacher', domain: 'teaching', is_protected: false },
  { id: USER_MANAGER, code: 'user_manager', name: 'User manager', domain: 'system', is_protected: false },
  { id: OWNER, code: 'teaching_owner', name: 'Owner', domain: 'teaching', is_protected: true },
]

function app(granted: string[], defaults: string[] = [TEACHER]) {
  const adminRpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'approve_account') return { data: { id: args!.p_user_id, account_status: 'active' }, error: null }
    if (name === 'list_pending_accounts') return { data: [{ id: PENDING, email: 'new@example.test', provider: 'github' }], error: null }
    if (name === 'count_pending_accounts') return { data: 1, error: null }
    if (name === 'set_account_default_roles') return { data: args!.p_role_ids, error: null }
    return { data: null, error: null }
  })
  const inviteUserByEmail = vi.fn(async () => ({ data: { user: { id: PENDING } }, error: null }))
  const query = (rows: unknown[]) => {
    const builder = {
      select: () => builder, eq: () => builder, order: () => builder,
      in: (_column: string, ids: string[]) => Promise.resolve({ data: (rows as Array<{ id: string }>).filter((row) => ids.includes(row.id)), error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
    }
    return builder
  }
  const instance = express()
  instance.use(express.json())
  instance.use((req, _res, next) => {
    req.user = { id: 'admin' } as never
    req.db = { rpc: async (_name: string, args: { p_permission_key: string }) => ({ data: granted.includes(args.p_permission_key), error: null }) } as never
    req.adminDb = {
      rpc: adminRpc,
      from: (table: string) => table === 'roles' ? query(roles) : query(defaults.map((role_id) => ({ role_id }))),
      auth: { admin: { inviteUserByEmail } },
    } as never
    req.auditContext = {} as never
    req.log = { warn: () => {} } as never
    next()
  })
  instance.use('/api', createAccountRouter({ EDULOG_WEB_BASE_URL: 'http://localhost:4173' }))
  instance.use(errorHandler)
  return { instance, adminRpc, inviteUserByEmail }
}

describe('account review', () => {
  it('lists pending accounts with the default roles for user managers only', async () => {
    const allowed = await request(app(['system.users.manage']).instance).get('/api/accounts/pending')
    expect(allowed.body.data).toEqual({ accounts: [{ id: PENDING, email: 'new@example.test', provider: 'github' }], default_role_ids: [TEACHER] })
    const denied = await request(app([]).instance).get('/api/accounts/pending')
    expect(denied.status).toBe(403)
    const badge = await request(app([]).instance).get('/api/accounts/pending/count')
    expect(badge.body.data).toEqual({ count: 0, can_review: false })
    const reviewer = await request(app(['system.users.manage']).instance).get('/api/accounts/pending/count')
    expect(reviewer.body.data).toEqual({ count: 1, can_review: true })
  })

  it('approves with teaching roles only when teaching role assignment is allowed', async () => {
    const harness = app(['system.users.manage', 'teaching.role_assignments.manage'])
    const approved = await request(harness.instance).post(`/api/accounts/${PENDING}/approve`).send({ role_ids: [TEACHER] })
    expect(approved.status).toBe(200)
    expect(harness.adminRpc).toHaveBeenCalledWith('approve_account', { p_user_id: PENDING, p_role_ids: [TEACHER], p_actor: 'admin' })

    const systemRole = await request(harness.instance).post(`/api/accounts/${PENDING}/approve`).send({ role_ids: [USER_MANAGER] })
    expect(systemRole.status).toBe(403)
  })

  it('never grants an owner role, as approval or as a default', async () => {
    const harness = app(['system.users.manage', 'teaching.role_assignments.manage'])
    const approval = await request(harness.instance).post(`/api/accounts/${PENDING}/approve`).send({ role_ids: [OWNER] })
    expect(approval.body.error.code).toBe('PROTECTED_ROLE_NOT_ALLOWED')
    const defaults = await request(harness.instance).put('/api/settings/account-default-roles').send({ role_ids: [OWNER] })
    expect(defaults.body.error.code).toBe('PROTECTED_ROLE_NOT_ALLOWED')
    expect(harness.adminRpc).not.toHaveBeenCalledWith('approve_account', expect.anything())
  })

  it('invites by email and approves the new account with the default roles', async () => {
    const harness = app(['system.users.manage', 'teaching.role_assignments.manage'])
    const response = await request(harness.instance).post('/api/accounts/invite').send({ email: 'invitee@example.test' })
    expect(response.status).toBe(201)
    expect(harness.inviteUserByEmail).toHaveBeenCalledWith('invitee@example.test', { redirectTo: 'http://localhost:4173' })
    expect(harness.adminRpc).toHaveBeenCalledWith('approve_account', { p_user_id: PENDING, p_role_ids: [TEACHER], p_actor: 'admin' })
  })
})

describe('mailer', () => {
  it('is off without an SMTP host', () => {
    expect(createMailer({ SMTP_PORT: 587 }).enabled).toBe(false)
    expect(createMailer({ SMTP_HOST: 'smtp.example.test', SMTP_PORT: 587, SMTP_ADMIN_EMAIL: 'edulog@example.test' }).enabled).toBe(true)
  })

  it('escapes account details in the notice', () => {
    const message = pendingAccountMessage('<b>x</b>@example.test', 'github', 'http://localhost:4173/dashboard/settings')
    expect(message.html).not.toContain('<b>x</b>')
    expect(message.html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
