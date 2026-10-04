import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createExtensionIntegrationRouter, buildExtensionSettingsUrl } from './extensionIntegrationRouter.js'
import { loadConfig } from './config.js'
import type { SupabaseClients } from './supabase.js'

const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`
const pairingId = '0051a2b5-fb29-4390-86f6-bd5e81ab7a16'

describe('extension settings URLs', () => {
  it.each([
    ['http://localhost:5173', 'http://localhost:5173/dashboard/settings?tab=integrations'],
    ['https://web.example:8443/edulog/', 'https://web.example:8443/edulog/dashboard/settings?tab=integrations'],
  ])('preserves frontend port and prefix for %s', (base, expected) => {
    expect(buildExtensionSettingsUrl(base)).toBe(expected)
  })
})

describe('extension pairing authorization URL', () => {
  it.each([
    ['http://localhost:5173', 'http://localhost:5173/dashboard/settings?tab=integrations&extension_pair=0051a2b5-fb29-4390-86f6-bd5e81ab7a16'],
    ['http://localhost:4173', 'http://localhost:4173/dashboard/settings?tab=integrations&extension_pair=0051a2b5-fb29-4390-86f6-bd5e81ab7a16'],
    ['https://school.example.test', 'https://school.example.test/dashboard/settings?tab=integrations&extension_pair=0051a2b5-fb29-4390-86f6-bd5e81ab7a16'],
    ['https://school.example.test/edulog/', 'https://school.example.test/edulog/dashboard/settings?tab=integrations&extension_pair=0051a2b5-fb29-4390-86f6-bd5e81ab7a16'],
  ])('returns the web frontend URL for %s', async (webBaseUrl, expectedUrl) => {
    const query = {
      insert: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: { id: pairingId, expires_at: '2026-09-30T12:00:00.000Z' }, error: null }),
    }
    query.insert.mockReturnValue(query)
    query.select.mockReturnValue(query)
    const adminClient = { from: vi.fn(() => query), rpc: vi.fn().mockResolvedValue({ data: { workspace_version: 1 }, error: null }) } as unknown as SupabaseClient
    const clients = { adminClient, publicClient: {} as SupabaseClient } as SupabaseClients
    const loadedConfig = loadConfig({
      NODE_ENV: 'test',
      SUPABASE_URL: 'http://supabase.test',
      SUPABASE_ANON_KEY: 'anon-test-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
      COOKIE_SECRET: 'a'.repeat(32),
      EDULOG_WEB_BASE_URL: webBaseUrl,
      API_EXTENSION_ALLOWED_ORIGINS: extensionOrigin,
    })
    // Simulate an old deployment value that points at the API; it must be ignored.
    const config = { ...loadedConfig, API_BASE_URL: 'http://localhost:3000' }
    const app = express()
    app.use(express.json())
    app.use('/api/extension', createExtensionIntegrationRouter(clients, config))

    const response = await request(app)
      .post('/api/extension/pair-requests')
      .set('Origin', extensionOrigin)
      .send({ code_challenge: 'a'.repeat(64) })

    expect(response.status).toBe(201)
    expect(response.body.data.authorize_url).toBe(expectedUrl)
    expect(new URL(response.body.data.authorize_url).port).not.toBe('3000')
  })
})

describe('extension token origin validation', () => {
  const token = 'a'.repeat(64)
  const tokenId = '5a03e0a7-a3d0-4db5-9aaf-6eea5402074a'
  const userId = 'b4cf6d4f-cc29-41db-9601-8c20cb8a3cde'

  function createTokenApp(allowedOrigins = extensionOrigin, tokenOrigin = extensionOrigin, rpc = vi.fn().mockResolvedValue({ data: { workspace_version: 1 }, error: null })) {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      is: vi.fn(),
      gt: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: tokenId, user_id: userId, extension_origin: tokenOrigin, expires_at: '2099-01-01T00:00:00.000Z', revoked_at: null },
        error: null,
      }),
      update: vi.fn(),
    }
    for (const method of [query.select, query.eq, query.is, query.gt, query.update]) method.mockReturnValue(query)
    const adminClient = { from: vi.fn(() => query), rpc } as unknown as SupabaseClient
    const clients = { adminClient, publicClient: {} as SupabaseClient } as SupabaseClients
    const config = loadConfig({
      NODE_ENV: 'test',
      SUPABASE_URL: 'http://supabase.test',
      SUPABASE_ANON_KEY: 'anon-test-key',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
      COOKIE_SECRET: 'a'.repeat(32),
      EDULOG_WEB_BASE_URL: 'http://localhost:5173',
      API_EXTENSION_ALLOWED_ORIGINS: allowedOrigins,
    })
    const app = express()
    app.use('/api/extension', createExtensionIntegrationRouter(clients, config))
    return { app, query }
  }

  it('validates an allowlisted, token-bound extension when GET omits Origin', async () => {
    const { app, query } = createTokenApp()
    const response = await request(app)
      .get('/api/extension/v1/me')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(200)
    expect(response.body.data.user_id).toBe(userId)
    expect(response.body.data.settings_url).toBe('http://localhost:5173/dashboard/settings?tab=integrations')
    expect(query.eq).toHaveBeenCalledWith('token_hash', crypto.createHash('sha256').update(token).digest('hex'))
  })

  it('reports catalog capability only when migration 1000119 is available', async () => {
    const rpc = vi.fn((name: string) => Promise.resolve({ data: name === 'web_extension_catalog' ? { catalog_version: 1 } : { workspace_version: 1 }, error: null }))
    const { app } = createTokenApp(extensionOrigin, extensionOrigin, rpc)
    const response = await request(app).get('/api/extension/v1/me').set('Authorization', `Bearer ${token}`)
    expect(response.body.data.capabilities).toMatchObject({ teaching_data_import: true, report_prefill: true, catalog_v1: true })
    expect(rpc).toHaveBeenCalledWith('web_extension_catalog', expect.objectContaining({ p_operation: 'capabilities' }))
  })

  it('reports transferred occurrence import only when migration 1000125 is available', async () => {
    const rpc = vi.fn((name: string) => Promise.resolve({
      data: name === 'web_extension_workspace'
        ? { workspace_version: 1, transferred_occurrence_import: true }
        : name === 'web_extension_catalog'
          ? { catalog_version: 1 }
          : { field_mapping_memory: true },
      error: null,
    }))
    const { app } = createTokenApp(extensionOrigin, extensionOrigin, rpc)
    const response = await request(app).get('/api/extension/v1/me').set('Authorization', `Bearer ${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data.capabilities.transferred_occurrence_import).toBe(true)

    const oldRpc = vi.fn((name: string) => Promise.resolve({
      data: name === 'web_extension_catalog' ? { catalog_version: 1 } : { workspace_version: 1 },
      error: null,
    }))
    const old = createTokenApp(extensionOrigin, extensionOrigin, oldRpc)
    const oldResponse = await request(old.app).get('/api/extension/v1/me').set('Authorization', `Bearer ${token}`)
    expect(oldResponse.body.data.capabilities.transferred_occurrence_import).toBe(false)
  })

  it('still rejects a present Origin that differs from the token binding', async () => {
    const otherExtensionOrigin = `chrome-extension://${'b'.repeat(32)}`
    const { app } = createTokenApp(`${extensionOrigin},${otherExtensionOrigin}`)
    const response = await request(app)
      .get('/api/extension/v1/me')
      .set('Origin', otherExtensionOrigin)
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(403)
  })

  it('rejects an originless token request when its bound extension is no longer allowlisted', async () => {
    const removedOrigin = `chrome-extension://${'b'.repeat(32)}`
    const { app } = createTokenApp(removedOrigin)
    const response = await request(app)
      .get('/api/extension/v1/me')
      .set('Authorization', `Bearer ${token}`)

    expect(response.status).toBe(403)
  })
})
