import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createUserSearchRouter } from './userSearch.js'

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
})
