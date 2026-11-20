import express from 'express'
import pino from 'pino'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOutboundOAuthRouter } from './outboundOAuth.js'
import { requestContext } from '../http/context.js'
import { errorHandler } from '../http/errors.js'
import { testConfig } from '../test/testConfig.js'

function harness(gotrueBody: unknown) {
  const config = testConfig({ GOTRUE_INTERNAL_URL: 'http://gotrue.test', AUTH_OUTBOUND_OAUTH_ENABLED: 'true' })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(gotrueBody))
  const app = express()
  app.use(express.json(), requestContext(pino({ level: 'silent' })))
  app.use((req, _res, next) => {
    Object.assign(req, {
      user: { id: '00000000-0000-4000-8000-000000000010' },
      accessToken: 'user-token',
      db: { rpc: async () => ({ data: true, error: null }) },
    })
    next()
  })
  app.use('/outbound', createOutboundOAuthRouter(config, (_req, _res, next) => next()))
  app.use(errorHandler)
  return app
}

afterEach(() => { vi.restoreAllMocks() })

describe('outbound OAuth GoTrue responses', () => {
  it('treats a null client list (an empty Go slice) as no applications', async () => {
    const response = await request(harness({ clients: null })).get('/outbound/clients')
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ clients: [] })
  })

  it('accepts clients whose redirect URI list is null', async () => {
    const client = { client_id: '7c7d3a52-9a0e-4b7e-9d43-2f2d5c3f7a10', client_name: 'Portal', redirect_uris: null, client_type: 'confidential' }
    const response = await request(harness({ clients: [client] })).get('/outbound/clients')
    expect(response.status).toBe(200)
    expect(response.body.data.clients[0].redirect_uris).toEqual([])
  })

  it('treats a null grant list as no grants', async () => {
    const response = await request(harness(null)).get('/outbound/grants')
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual([])
  })
})
