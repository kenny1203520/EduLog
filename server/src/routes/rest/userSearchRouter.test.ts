import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createUserSearchRouter } from './userSearchRouter.js'

describe('user search directory', () => {
  it('returns disabled account details only after system.users.list is authorized', async () => {
    const account = {
      id: 'c69668a3-b810-4a10-9d84-52a26c82f732',
      email: 'disabled@example.test',
      display_name: 'Disabled user',
      account_status: 'disabled',
      disabled_at: '2026-09-25T09:30:00Z',
      disabled_reason: 'No longer assigned',
      created_at: '2026-01-01T00:00:00Z',
    }
    const permissionCheck = vi.fn().mockResolvedValue({ data: true, error: null })
    const selects: string[] = []
    const app = express()

    app.use((req, _res, next) => {
      const query = {
        select(columns: string) { selects.push(columns); return this },
        ilike() { return this },
        limit: async () => ({ data: [account], error: null }),
      }
      Object.assign(req, {
        db: { rpc: permissionCheck },
        adminDb: { from: () => query },
        user: { id: '25291e73-863e-4987-9d50-edca6813768a' },
        requestId: 'request-test',
        traceId: 'trace-test',
      })
      next()
    })
    app.use(createUserSearchRouter())

    const response = await request(app).get('/search?query=disabled')

    expect(response.status).toBe(200)
    expect(permissionCheck).toHaveBeenCalledWith('has_api_permission', expect.objectContaining({
      p_permission_key: 'system.users.list',
    }))
    expect(selects).toHaveLength(3)
    expect(selects.every(columns => columns.includes('disabled_at,disabled_reason'))).toBe(true)
    expect(response.body.data).toEqual([{
      id: account.id,
      email: account.email,
      display_name: account.display_name,
      account_status: account.account_status,
      disabled_at: account.disabled_at,
      disabled_reason: account.disabled_reason,
      created_at: account.created_at,
      last_sign_in_at: null,
    }])
  })

  it('parses only_unlinked as the literal true or false', async () => {
    const tables: string[] = []
    const app = express()
    app.use((req, _res, next) => {
      const query = {
        select() { return this }, ilike() { return this }, in: async () => ({ data: [], error: null }),
        limit: async () => ({ data: [{ id: 'u1', email: 'a@example.test', display_name: null, account_status: 'active', disabled_at: null, disabled_reason: null, created_at: '2026-01-01T00:00:00Z' }], error: null }),
        then(resolve: (value: unknown) => void) { resolve({ data: [], error: null }) },
      }
      Object.assign(req, { db: { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) }, adminDb: { from: (table: string) => { tables.push(table); return query } }, user: { id: 'admin' }, requestId: 'r', traceId: 't' })
      next()
    })
    app.use(createUserSearchRouter())
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(422).json({ error: String(error) }))

    expect((await request(app).get('/search?query=a&only_unlinked=false')).status).toBe(200)
    expect(tables).not.toContain('teacher_records')
    expect((await request(app).get('/search?query=a&only_unlinked=true')).status).toBe(200)
    expect(tables).toContain('teacher_records')
    for (const value of ['1', 'yes', 'FALSE', '']) {
      expect((await request(app).get(`/search?query=a&only_unlinked=${value}`)).status).toBe(422)
    }
  })
})
