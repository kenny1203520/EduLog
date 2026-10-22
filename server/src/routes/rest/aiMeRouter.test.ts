import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../../http/errors.js'
import { PendingPkceStore } from '../../ai/credentials/openRouterOAuth.js'
import type { ApiConfig } from '../../config/config.js'
import { createAiMeRouter, openRouterReturnOrigin } from './aiMeRouter.js'

type Row = Record<string, unknown>

/** Just enough of the Supabase query builder for these routes. */
function memoryDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = (tables[table] ??= [])
      let filters: Array<(row: Row) => boolean> = []
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
      let payload: Row = {}
      let columns: string | null = null
      const project = (row: Row) => columns ? Object.fromEntries(columns.split(',').map((c) => [c, row[c] ?? null])) : row
      const run = () => {
        if (op === 'insert') { rows.push({ ...payload }); return [payload] }
        const matched = rows.filter((row) => filters.every((f) => f(row)))
        if (op === 'update') matched.forEach((row) => Object.assign(row, payload))
        if (op === 'delete') tables[table] = rows.filter((row) => !matched.includes(row))
        return matched
      }
      const builder = {
        select(cols?: string) { columns = cols ?? null; return builder },
        insert(value: Row) { op = 'insert'; payload = value; return builder },
        update(value: Row) { op = 'update'; payload = value; return builder },
        delete() { op = 'delete'; return builder },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return builder },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return builder },
        order() { return builder },
        async single() { return { data: project(run()[0]), error: null } },
        async maybeSingle() { const row = run()[0]; return { data: row ? project(row) : null, error: null } },
        then(resolve: (value: { data: Row[], error: null }) => void) { resolve({ data: run().map(project), error: null }) },
      }
      return builder
    },
  }
}

const config = { AI_SECRET_KEY: Buffer.alloc(32, 3).toString('base64'), EDULOG_WEB_BASE_URL: 'https://edulog.example' } as ApiConfig

function app(tables: Record<string, Row[]>, userId = 'u1', fetchImpl: typeof fetch = fetch, pending = new PendingPkceStore(), routerConfig: ApiConfig = config, chatgptPending = new PendingPkceStore()) {
  const instance = express()
  instance.use(express.json())
  instance.use((req, _res, next) => {
    req.user = { id: userId } as never
    req.adminDb = memoryDb(tables) as never
    req.auditContext = {} as never
    next()
  })
  instance.use('/api', createAiMeRouter(routerConfig, pending, fetchImpl, chatgptPending))
  instance.use(errorHandler)
  return instance
}

describe('personal AI credentials', () => {
  it('stores an encrypted key and only ever returns the masked hint', async () => {
    const tables: Record<string, Row[]> = { ai_credentials: [], ai_models: [] }
    const created = await request(app(tables)).post('/api/ai/me/credentials').send({ provider: 'anthropic', label: 'My Claude', secret: 'sk-ant-api03-supersecretvalue' })
    expect(created.status).toBe(201)
    expect(JSON.stringify(created.body)).not.toContain('supersecret')
    expect(created.body.data.secret_hint).toBe('sk-ant-…alue')
    expect(String(tables.ai_credentials[0].secret_ciphertext)).not.toContain('supersecret')

    const listed = await request(app(tables)).get('/api/ai/me/credentials')
    expect(JSON.stringify(listed.body)).not.toContain('secret_ciphertext')
  })

  it('refuses personal Ollama or custom endpoints', async () => {
    const response = await request(app({ ai_credentials: [] })).post('/api/ai/me/credentials').send({ provider: 'ollama', label: 'x', secret: 'y' })
    expect(response.status).toBe(422)
  })

  it('hides other users’ credentials', async () => {
    const tables: Record<string, Row[]> = { ai_credentials: [{ id: 'a1000000-0000-4000-8000-000000000001', scope: 'user', owner_user_id: 'someone-else' }] }
    const response = await request(app(tables)).delete('/api/ai/me/credentials/a1000000-0000-4000-8000-000000000001')
    expect(response.status).toBe(404)
    expect(tables.ai_credentials).toHaveLength(1)
  })

  it('connects OpenRouter through PKCE and stores the returned key as an OAuth credential', async () => {
    const tables: Record<string, Row[]> = { ai_credentials: [] }
    const pending = new PendingPkceStore()
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: 'sk-or-v1-teacherkey123456' }), { status: 200 }))

    const start = await request(app(tables, 'u1', fetchImpl, pending)).post('/api/ai/me/openrouter/start').send({})
    const url = new URL(start.body.data.url)
    expect(url.searchParams.get('callback_url')).toBe('https://edulog.example/dashboard/settings?tab=personal&ai_oauth=openrouter')

    const exchanged = await request(app(tables, 'u1', fetchImpl, pending)).post('/api/ai/me/openrouter/exchange').send({ code: 'auth-code' })
    expect(exchanged.status).toBe(201)
    expect(tables.ai_credentials[0]).toMatchObject({ scope: 'user', owner_user_id: 'u1', provider: 'openrouter', auth_type: 'oauth' })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).code_verifier).toBeTruthy()

    const replay = await request(app(tables, 'u1', fetchImpl, pending)).post('/api/ai/me/openrouter/exchange').send({ code: 'auth-code' })
    expect(replay.status).toBe(409)
  })
})

describe('Sign in with ChatGPT', () => {
  const siwcConfig = {
    ...config,
    OPENAI_SIWC_CLIENT_ID: 'oaiapp_edulog',
    OPENAI_SIWC_CLIENT_SECRET: 'client-secret',
    OPENAI_SIWC_AUTHORIZE_URL: 'https://auth.openai.com/api/accounts/authorize',
    OPENAI_SIWC_TOKEN_URL: 'https://auth.openai.com/api/accounts/oauth/token',
  } as ApiConfig

  it('is hidden and refused until an approved client is configured', async () => {
    const listed = await request(app({ ai_credentials: [] })).get('/api/ai/me/credentials')
    expect(listed.body.data.chatgpt_available).toBe(false)
    const start = await request(app({ ai_credentials: [] })).post('/api/ai/me/chatgpt/start').send({})
    expect(start.status).toBe(404)
    expect(start.body.error.code).toBe('AI_CHATGPT_NOT_CONFIGURED')
  })

  it('connects with PKCE and state, storing only the encrypted refresh token', async () => {
    const tables: Record<string, Row[]> = { ai_credentials: [] }
    const chatgptPending = new PendingPkceStore()
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'chatgpt-access', refresh_token: 'chatgpt-refresh-token-value', expires_in: 3600,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    }), { status: 200 }))
    const make = () => app(tables, 'u1', fetchImpl, new PendingPkceStore(), siwcConfig, chatgptPending)

    expect((await request(make()).get('/api/ai/me/credentials')).body.data.chatgpt_available).toBe(true)
    const start = await request(make()).post('/api/ai/me/chatgpt/start').send({})
    const url = new URL(start.body.data.url)
    expect(url.searchParams.get('client_id')).toBe('oaiapp_edulog')
    expect(url.searchParams.get('redirect_uri')).toBe('https://edulog.example/dashboard/settings?tab=personal&ai_oauth=chatgpt')
    const state = url.searchParams.get('state')!

    const wrongState = await request(make()).post('/api/ai/me/chatgpt/exchange').send({ code: 'code-1', state: 'forged' })
    expect(wrongState.status).toBe(409)

    await request(make()).post('/api/ai/me/chatgpt/start').send({})
    const restart = new URL((await request(make()).post('/api/ai/me/chatgpt/start').send({})).body.data.url)
    const exchanged = await request(make()).post('/api/ai/me/chatgpt/exchange').send({ code: 'code-1', state: restart.searchParams.get('state') })
    expect(exchanged.status).toBe(201)
    expect(tables.ai_credentials[0]).toMatchObject({ provider: 'openai', auth_type: 'oauth', owner_user_id: 'u1', label: 'ChatGPT' })
    expect(JSON.stringify(exchanged.body)).not.toContain('chatgpt-refresh-token-value')
    expect(String(tables.ai_credentials[0].secret_ciphertext)).not.toContain('chatgpt-refresh-token-value')
    expect(state).not.toBe(restart.searchParams.get('state'))
  })

  it('explains when the plan scope was not granted', async () => {
    const chatgptPending = new PendingPkceStore()
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: 'openid profile email' }), { status: 200 }))
    const make = () => app({ ai_credentials: [] }, 'u1', fetchImpl, new PendingPkceStore(), siwcConfig, chatgptPending)
    const state = new URL((await request(make()).post('/api/ai/me/chatgpt/start').send({})).body.data.url).searchParams.get('state')
    const response = await request(make()).post('/api/ai/me/chatgpt/exchange').send({ code: 'c', state })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('AI_CHATGPT_PLAN_NOT_GRANTED')
  })
})

describe('personal models and catalog', () => {
  const credentialId = 'a1000000-0000-4000-8000-000000000011'
  const modelId = 'b1000000-0000-4000-8000-000000000011'

  it('renames only models on the teacher’s own credentials', async () => {
    const tables: Record<string, Row[]> = {
      ai_credentials: [{ id: credentialId, scope: 'user', owner_user_id: 'u1' }],
      ai_models: [{ id: modelId, credential_id: credentialId, model_id: 'gpt-5', display_name: 'old' }],
    }
    const renamed = await request(app(tables)).patch(`/api/ai/me/models/${modelId}`).send({ display_name: '我的 GPT' })
    expect(renamed.status).toBe(200)
    expect(tables.ai_models[0].display_name).toBe('我的 GPT')

    const someoneElse = await request(app(tables, 'u2')).patch(`/api/ai/me/models/${modelId}`).send({ display_name: 'x' })
    expect(someoneElse.status).toBe(404)
    const idChange = await request(app(tables)).patch(`/api/ai/me/models/${modelId}`).send({ model_id: 'other' })
    expect(idChange.status).toBe(422)
  })

  it('returns the provider list for an own credential', async () => {
    const { SecretCipher } = await import('../../ai/credentials/secretCipher.js')
    const { credentialAssociatedData } = await import('../../ai/report/reportGenerationService.js')
    const cipher = SecretCipher.fromBase64(config.AI_SECRET_KEY!)
    const tables: Record<string, Row[]> = {
      ai_credentials: [{ id: credentialId, scope: 'user', owner_user_id: 'u1', provider: 'anthropic', auth_type: 'api_key', base_url: null, secret_ciphertext: cipher.encrypt('sk-ant-x', credentialAssociatedData(credentialId)) }],
    }
    const providerFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] }), { status: 200 }))
    vi.stubGlobal('fetch', providerFetch)
    try {
      const response = await request(app(tables)).get(`/api/ai/me/credentials/${credentialId}/catalog?refresh=1`)
      expect(response.body.data).toMatchObject({ supported: true, models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', textCapable: true }] })
      expect(providerFetch.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-x')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('openRouterReturnOrigin', () => {
  const config = { EDULOG_WEB_BASE_URL: 'https://edulog.example', API_ALLOWED_ORIGINS: 'https://edulog.example,https://staging.edulog.example', NODE_ENV: 'development' as const }

  it('returns to the page that started the sign-in when its origin is trusted', () => {
    expect(openRouterReturnOrigin(config, 'https://staging.edulog.example')).toBe('https://staging.edulog.example')
    expect(openRouterReturnOrigin(config, 'http://localhost:5174')).toBe('http://localhost:5174')
  })

  it('falls back to the web base URL for unknown or missing origins', () => {
    expect(openRouterReturnOrigin(config, 'https://evil.example')).toBe('https://edulog.example')
    expect(openRouterReturnOrigin(config, undefined)).toBe('https://edulog.example')
    expect(openRouterReturnOrigin(config, 'not a url')).toBe('https://edulog.example')
    expect(openRouterReturnOrigin({ ...config, NODE_ENV: 'production' }, 'http://localhost:5174')).toBe('https://edulog.example')
  })
})
