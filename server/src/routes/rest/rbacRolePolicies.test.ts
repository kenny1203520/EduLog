import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createRbacRouter } from './rbacRouter.js'
import { errorHandler } from '../../http/errors.js'

const user = '00000000-0000-4000-8000-000000000001'
const roleId = '00000000-0000-4000-8000-000000000010'
const sessionId = '00000000-0000-4000-8000-000000000020'
const notify = '00000000-0000-4000-8000-000000000101'
const view = '00000000-0000-4000-8000-000000000102'
const other = '00000000-0000-4000-8000-000000000103'

type Result = { data: unknown; error: unknown }

/** A Supabase-like query builder that records filters and resolves to `result`. */
function query(result: Result, calls: Array<[string, unknown[]]>) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, args]); return builder }
  }
  builder.maybeSingle = () => Promise.resolve(result)
  builder.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return builder
}

function rbacApp(options: { tables?: Record<string, Result>; rpc?: Record<string, Result> } = {}) {
  const calls: Record<string, Array<[string, unknown[]]>> = {}
  const tables: Record<string, Result> = {
    roles: { data: { id: roleId, domain: 'teaching', teaching_id: null, is_protected: false }, error: null },
    ...options.tables,
  }
  const rpcResults: Record<string, Result> = {
    has_api_permission: { data: true, error: null },
    ...options.rpc,
  }
  const db = {
    from: vi.fn((table: string) => query(tables[table] ?? { data: [], error: null }, calls[table] ??= [])),
    rpc: vi.fn((name: string) => Promise.resolve(rpcResults[name] ?? { data: null, error: null })),
  }
  const adminDb = { rpc: vi.fn().mockResolvedValue({ data: [{ is_replay: false }], error: null }) }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { Object.assign(req, { db, adminDb, user: { id: user }, requestId: 'request', traceId: 'trace' }); next() })
  app.use('/api', createRbacRouter())
  app.use(errorHandler)
  return { app, db, calls }
}

describe('GET /roles/permission-policies', () => {
  it('returns every scope of the requested permissions with their key and the RBAC epoch', async () => {
    const { app, calls } = rbacApp({
      tables: {
        rbac_policy_epoch: { data: { epoch: 42 }, error: null },
        permissions: { data: [{ id: notify, key: 'reports.incomplete.receive' }, { id: view, key: 'teaching.dashboard.schedule.view' }], error: null },
        role_permission_policies: { data: [
          { role_id: roleId, permission_id: notify, scope_type: 'system', scope_id: null, effect: 'allow' },
          { role_id: roleId, permission_id: view, scope_type: 'class_session', scope_id: sessionId, effect: 'deny' },
        ], error: null },
      },
    })

    const response = await request(app).get('/api/roles/permission-policies')
      .query('permission_key=reports.incomplete.receive&permission_key=teaching.dashboard.schedule.view')

    expect(response.status).toBe(200)
    expect(response.body.meta).toEqual({ total: 2, epoch: 42, permissions: [{ id: notify, key: 'reports.incomplete.receive' }, { id: view, key: 'teaching.dashboard.schedule.view' }] })
    expect(response.body.data.map((row: { permission_key: string }) => row.permission_key)).toEqual(['reports.incomplete.receive', 'teaching.dashboard.schedule.view'])
    expect(calls.permissions).toContainEqual(['in', ['key', ['reports.incomplete.receive', 'teaching.dashboard.schedule.view']]])
    expect(calls.role_permission_policies).toContainEqual(['in', ['permission_id', [notify, view]]])
  })

  it('rejects an unknown permission key', async () => {
    const { app } = rbacApp({ tables: { rbac_policy_epoch: { data: { epoch: 1 }, error: null }, permissions: { data: [], error: null } } })
    const response = await request(app).get('/api/roles/permission-policies').query({ permission_key: 'missing.key' })
    expect(response.status).toBe(404)
  })
})

describe('PATCH /roles/:id/permissions', () => {
  const current = { data: [
    { permission_id: notify, local_effect: 'deny', epoch: 7 },
    { permission_id: view, local_effect: null, epoch: 7 },
    { permission_id: other, local_effect: 'allow', epoch: 7 },
  ], error: null }

  function patch(app: express.Express, body: Record<string, unknown>) {
    return request(app).patch(`/api/roles/${roleId}/permissions`).set('Idempotency-Key', 'patch-key-0001').send(body)
  }

  it('merges the changes into the role local policies and keeps the others', async () => {
    const { app, db } = rbacApp({ rpc: { rbac_get_role_permissions: current, rbac_replace_role_permissions: { data: 8, error: null } } })

    const response = await patch(app, {
      scope_type: 'class_session', scope_id: sessionId, expected_epoch: 7,
      changes: [{ permission_id: notify, effect: null }, { permission_id: view, effect: 'allow' }],
    })

    expect(response.status).toBe(200)
    expect(response.body.data.epoch).toBe(8)
    expect(db.rpc).toHaveBeenCalledWith('rbac_get_role_permissions', { p_role_id: roleId, p_scope_type: 'class_session', p_scope_id: sessionId })
    expect(db.rpc).toHaveBeenCalledWith('rbac_replace_role_permissions', {
      p_role_id: roleId, p_scope_type: 'class_session', p_scope_id: sessionId, p_expected_epoch: 7,
      p_policies: [{ permission_id: other, effect: 'allow' }, { permission_id: view, effect: 'allow' }],
    })
  })

  it('returns 409 without writing when the epoch is stale', async () => {
    const { app, db } = rbacApp({ rpc: { rbac_get_role_permissions: current } })

    const response = await patch(app, { scope_type: 'class_session', scope_id: sessionId, expected_epoch: 6, changes: [{ permission_id: view, effect: 'deny' }] })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('RBAC_VERSION_CONFLICT')
    expect(db.rpc).not.toHaveBeenCalledWith('rbac_replace_role_permissions', expect.anything())
  })

  it('maps a concurrent change detected by the replace RPC to 409', async () => {
    const { app } = rbacApp({ rpc: {
      rbac_get_role_permissions: current,
      rbac_replace_role_permissions: { data: null, error: { message: 'RBAC_VERSION_CONFLICT', code: 'P0001' } },
    } })

    const response = await patch(app, { scope_type: 'class_session', scope_id: sessionId, expected_epoch: 7, changes: [{ permission_id: view, effect: 'deny' }] })

    expect(response.status).toBe(409)
  })

  it('rejects duplicate permissions in one patch', async () => {
    const { app } = rbacApp()
    const response = await patch(app, {
      scope_type: 'system', expected_epoch: 7,
      changes: [{ permission_id: view, effect: 'deny' }, { permission_id: view, effect: 'allow' }],
    })
    expect(response.status).toBe(422)
  })
})

describe('deprecated permission-centric routes', () => {
  it('are no longer served', async () => {
    const { app } = rbacApp()
    expect((await request(app).get(`/api/permissions/${notify}/policies`)).status).toBe(404)
  })
})
