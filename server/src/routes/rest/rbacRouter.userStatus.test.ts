import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../../http/errors.js'
import { createRbacRouter } from './rbacRouter.js'

const TARGET = 'c1000000-0000-4000-8000-000000000001'

function app(options: { allowed: boolean; statusError?: { code: string; message: string }; restoreFails?: boolean }) {
  const updateUserById = vi.fn(async (_id: string, attributes: { ban_duration: string }) => {
    if (options.restoreFails && attributes.ban_duration === 'none') return { data: null, error: { message: 'auth down' } }
    return { data: {}, error: null }
  })
  const profileRead = vi.fn(async () => ({ data: { account_status: 'active' }, error: null }))
  const adminRpc = vi.fn(async (name: string) => name === 'reserve_api_idempotency'
    ? { data: [{ is_replay: false }], error: null }
    : { data: null, error: null })
  const userRpc = vi.fn(async (name: string) => {
    if (name === 'has_api_permission') return { data: options.allowed, error: null }
    if (name === 'set_system_user_status') return options.statusError
      ? { data: null, error: options.statusError }
      : { data: { id: TARGET, account_status: 'disabled' }, error: null }
    return { data: null, error: null }
  })
  const logError = vi.fn()
  const instance = express()
  instance.use(express.json())
  instance.use((req, _res, next) => {
    req.user = { id: 'caller' } as never
    req.db = { rpc: userRpc } as never
    req.adminDb = {
      rpc: adminRpc,
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: profileRead }) }) }),
      auth: { admin: { updateUserById } },
    } as never
    req.auditContext = {} as never
    req.log = { error: logError, warn: () => {} } as never
    next()
  })
  instance.use('/api', createRbacRouter())
  instance.use(errorHandler)
  const disable = () => request(instance).patch(`/api/users/${TARGET}/status`).set('Idempotency-Key', 'status-test-key')
    .send({ status: 'disabled', reason: 'left the school', expected_epoch: 1 })
  return { disable, updateUserById, profileRead, userRpc, logError }
}

describe('PATCH /users/:id/status', () => {
  it('refuses a caller without system.users.manage before touching the account', async () => {
    const harness = app({ allowed: false })
    const response = await harness.disable()
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('PERMISSION_DENIED')
    expect(harness.updateUserById).not.toHaveBeenCalled()
    expect(harness.profileRead).not.toHaveBeenCalled()
    expect(harness.userRpc).not.toHaveBeenCalledWith('set_system_user_status', expect.anything())
  })

  it('bans in Auth and records the status for a user manager', async () => {
    const harness = app({ allowed: true })
    const response = await harness.disable()
    expect(response.status).toBe(200)
    expect(harness.updateUserById).toHaveBeenCalledTimes(1)
    expect(harness.updateUserById).toHaveBeenCalledWith(TARGET, { ban_duration: '876000h' })
  })

  it('lifts the ban again when the database refuses the change', async () => {
    const harness = app({ allowed: true, statusError: { code: 'P0001', message: 'LAST_SYSTEM_OWNER' } })
    const response = await harness.disable()
    expect(response.status).toBe(409)
    expect(harness.updateUserById).toHaveBeenLastCalledWith(TARGET, { ban_duration: 'none' })
    expect(harness.logError).not.toHaveBeenCalled()
  })

  it('logs when the ban could not be lifted again', async () => {
    const harness = app({ allowed: true, statusError: { code: 'P0001', message: 'OWNER_ROLE_REQUIRED' }, restoreFails: true })
    const response = await harness.disable()
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('OWNER_ROLE_REQUIRED')
    expect(harness.logError).toHaveBeenCalledWith({ target_user_id: TARGET, expected_status: 'active' }, 'user_status_ban_restore_failed')
  })
})
