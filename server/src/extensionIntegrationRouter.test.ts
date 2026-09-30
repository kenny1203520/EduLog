import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createExtensionIntegrationRouter } from './extensionIntegrationRouter.js'
import { loadConfig } from './config.js'
import type { SupabaseClients } from './supabase.js'

const extensionOrigin = `chrome-extension://${'a'.repeat(32)}`
const pairingId = '0051a2b5-fb29-4390-86f6-bd5e81ab7a16'

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
    const adminClient = { from: vi.fn(() => query) } as unknown as SupabaseClient
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
