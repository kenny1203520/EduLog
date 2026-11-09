import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import type { ApiConfig } from '../../config/config.js'
import type { AiServices } from '../../ai/aiServices.js'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { setAuditContext } from '../../http/context.js'
import {
  createCredential,
  credentialPatchInput,
  personalCredentialPatchInput,
  CREDENTIAL_FIELDS,
  MODEL_FIELDS,
  modelInput,
  personalCredentialInput,
  testCredential,
  loadUsableCredential,
  updateCredential,
} from '../../ai/credentials/credentialStore.js'
import { fetchModelCatalog, sharedModelCatalogCache } from '../../ai/providers/modelCatalog.js'
import { createPublicOllamaFetch } from '../../ai/providers/publicOllamaTransport.js'
import {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeCodeForKey,
  OpenRouterExchangeError,
  PendingPkceStore,
} from '../../ai/credentials/openRouterOAuth.js'
import {
  buildChatGptAuthorizationUrl,
  ChatGptOAuthError,
  createOAuthState,
  exchangeChatGptCode,
} from '../../ai/credentials/chatgptPlanOAuth.js'
import { isChatGptPlanCredential } from '../../ai/credentials/chatgptPlanTokens.js'

const uuid = z.string().uuid()
const personalModelInput = modelInput.pick({ model_id: true, display_name: true, enabled: true }).strict()
const personalModelPatch = modelInput.pick({ display_name: true, enabled: true }).partial().strict()
const testInput = z.object({ model_id: z.string().trim().min(1).max(200) }).strict()
const exchangeInput = z.object({ code: z.string().trim().min(1).max(2048) }).strict()
const chatgptExchangeInput = z.object({ code: z.string().trim().min(1).max(4096), state: z.string().trim().min(1).max(200) }).strict()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}
function envelope(req: Request, data: unknown) { return { data, meta: {}, request_id: req.requestId, trace_id: req.traceId } }
function userOf(req: Request): string {
  if (!req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  return req.user.id
}
function idParam(req: Request, name = 'id'): string {
  const value = req.params[name]
  if (typeof value !== 'string' || !uuid.safeParse(value).success) throw new ApiError(400, 'INVALID_ID', `${name} is invalid`)
  return value
}

/** The teacher's own credential, or 404 (never reveals other users' rows). */
async function ownCredential(req: Request, id: string) {
  const row = await req.adminDb!.from('ai_credentials').select('id,owner_user_id,scope,provider').eq('id', id).maybeSingle()
  if (row.error) throw mapDatabaseError(row.error)
  if (!row.data || row.data.scope !== 'user' || row.data.owner_user_id !== req.user!.id) throw new ApiError(404, 'NOT_FOUND', 'Credential was not found')
  return row.data as { id: string, owner_user_id: string, scope: 'user', provider: string }
}

/**
 * Personal AI credentials (Settings → Personal):
 *
 * - GET    /ai/me/credentials                     own credentials with their models
 * - POST   /ai/me/credentials                     add an API key
 * - PATCH  /ai/me/credentials/:id                 rename, replace key, disable
 * - DELETE /ai/me/credentials/:id
 * - POST   /ai/me/credentials/:id/models          add a model id to use with it
 * - DELETE /ai/me/models/:id
 * - POST   /ai/me/credentials/:id/test            tiny fixed prompt, no student data
 * - POST   /ai/me/openrouter/start                OAuth PKCE authorization URL
 * - POST   /ai/me/openrouter/exchange             turn the returned code into a credential
 */
export function createAiMeRouter(
  config: Pick<ApiConfig, 'EDULOG_WEB_BASE_URL' | 'API_ALLOWED_ORIGINS' | 'NODE_ENV'>,
  { cipher, siwc, chatgptTokens }: Pick<AiServices, 'cipher' | 'siwc' | 'chatgptTokens'>,
  pending = new PendingPkceStore(),
  fetchImpl: typeof fetch = fetch,
  chatgptPending = new PendingPkceStore(),
  createOllamaFetch: (baseUrl: string) => typeof fetch = createPublicOllamaFetch,
) {
  const resolveTokenFor = (req: Request) => async (credential: { provider: string, authType: string, credentialId: string }) =>
    chatgptTokens && isChatGptPlanCredential(credential) ? chatgptTokens.getAccessToken(req.adminDb!, credential.credentialId) : undefined
  const chatgptCallback = () => {
    const url = new URL('/dashboard/settings', config.EDULOG_WEB_BASE_URL)
    url.searchParams.set('tab', 'personal')
    url.searchParams.set('ai_oauth', 'chatgpt')
    return url.toString()
  }
  const router = Router()

  router.get('/ai/me/credentials', wrap(async (req, res) => {
    const userId = userOf(req)
    const credentials = await req.adminDb!.from('ai_credentials').select(CREDENTIAL_FIELDS).eq('scope', 'user').eq('owner_user_id', userId).order('created_at')
    if (credentials.error) throw mapDatabaseError(credentials.error)
    const ids = (credentials.data ?? []).map((row) => row.id)
    const models = ids.length ? await req.adminDb!.from('ai_models').select(MODEL_FIELDS).in('credential_id', ids).order('display_name') : { data: [], error: null }
    if (models.error) throw mapDatabaseError(models.error)
    return res.json(envelope(req, {
      credentials: (credentials.data ?? []).map((credential) => ({ ...credential, models: (models.data ?? []).filter((model) => model.credential_id === credential.id) })),
      openrouter_available: true,
      chatgpt_available: chatgptTokens !== null,
      secret_storage_available: cipher !== null,
    }))
  }))

  router.post('/ai/me/credentials', wrap(async (req, res) => {
    const userId = userOf(req)
    const input = personalCredentialInput.parse(req.body)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', action: 'create' })
    const created = await createCredential(req.adminDb!, cipher, {
      scope: 'user', ownerUserId: userId, provider: input.provider, authType: input.secret ? 'api_key' : 'none', secret: input.secret, baseUrl: input.base_url, label: input.label, createdBy: userId,
    })
    return res.status(201).json(envelope(req, created))
  }))

  router.patch('/ai/me/credentials/:id', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    const credential = await ownCredential(req, id)
    const input = credential.provider === 'ollama'
      ? personalCredentialPatchInput.parse(req.body)
      : credentialPatchInput.omit({ base_url: true }).strict().parse(req.body)
    if (credential.provider !== 'ollama' && input.secret === null) throw new ApiError(400, 'INVALID_CREDENTIAL', 'Only Ollama credentials may remove their secret')
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', resourceId: id, action: 'update' })
    sharedModelCatalogCache.forget(id)
    return res.json(envelope(req, await updateCredential(req.adminDb!, cipher, id, input)))
  }))

  router.delete('/ai/me/credentials/:id', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    await ownCredential(req, id)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', resourceId: id, action: 'delete' })
    const result = await req.adminDb!.from('ai_credentials').delete().eq('id', id)
    if (result.error) throw mapDatabaseError(result.error)
    chatgptTokens?.forget(id)
    sharedModelCatalogCache.forget(id)
    return res.json(envelope(req, { id, deleted: true }))
  }))

  /** Models this credential can use (cached an hour; ?refresh=1 to reload). ChatGPT plans fall back to manual entry. */
  router.get('/ai/me/credentials/:id/catalog', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    await ownCredential(req, id)
    const catalog = await sharedModelCatalogCache.get(id, req.query.refresh === '1', async () => {
      const credential = await loadUsableCredential(req.adminDb!, cipher, id)
      return fetchModelCatalog(
        { provider: credential.provider, authType: credential.authType, apiKey: credential.apiKey, baseUrl: credential.baseUrl },
        credential.provider === 'ollama' && credential.baseUrl ? createOllamaFetch(credential.baseUrl) : fetch,
      )
    })
    return res.json(envelope(req, catalog))
  }))

  router.post('/ai/me/credentials/:id/models', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    const input = personalModelInput.parse(req.body)
    await ownCredential(req, id)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_models', action: 'create' })
    const result = await req.adminDb!.from('ai_models').insert({ credential_id: id, model_id: input.model_id, display_name: input.display_name, enabled: input.enabled ?? true, quota_weight: 0, supports_structured_output: sharedModelCatalogCache.structuredOutputSupport(id, input.model_id) }).select(MODEL_FIELDS).single()
    if (result.error) throw mapDatabaseError(result.error)
    return res.status(201).json(envelope(req, result.data))
  }))

  router.patch('/ai/me/models/:id', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    const input = personalModelPatch.parse(req.body)
    const model = await req.adminDb!.from('ai_models').select('id,credential_id').eq('id', id).maybeSingle()
    if (model.error) throw mapDatabaseError(model.error)
    if (!model.data) throw new ApiError(404, 'NOT_FOUND', 'Model was not found')
    await ownCredential(req, model.data.credential_id)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_models', resourceId: id, action: 'update' })
    const saved = await req.adminDb!.from('ai_models').update(input).eq('id', id).select(MODEL_FIELDS).single()
    if (saved.error) throw mapDatabaseError(saved.error)
    return res.json(envelope(req, saved.data))
  }))

  router.delete('/ai/me/models/:id', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    const model = await req.adminDb!.from('ai_models').select('id,credential_id').eq('id', id).maybeSingle()
    if (model.error) throw mapDatabaseError(model.error)
    if (!model.data) throw new ApiError(404, 'NOT_FOUND', 'Model was not found')
    await ownCredential(req, model.data.credential_id)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_models', resourceId: id, action: 'delete' })
    const result = await req.adminDb!.from('ai_models').delete().eq('id', id)
    if (result.error) throw mapDatabaseError(result.error)
    return res.json(envelope(req, { id, deleted: true }))
  }))

  router.post('/ai/me/credentials/:id/test', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    const input = testInput.parse(req.body)
    await ownCredential(req, id)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', resourceId: id, action: 'test' })
    return res.json(envelope(req, await testCredential(req.adminDb!, cipher, id, input.model_id, { resolveToken: resolveTokenFor(req) })))
  }))

  router.post('/ai/me/openrouter/start', wrap(async (req, res) => {
    const userId = userOf(req)
    if (!cipher) throw new ApiError(503, 'AI_SECRET_KEY_MISSING', 'AI_SECRET_KEY is not configured on the server')
    const { verifier, challenge } = createPkcePair()
    pending.put(userId, verifier)
    // OpenRouter may replace this query with ?code=; the settings page also
    // remembers the pending sign-in itself (see MyAiCredentials.vue).
    const callback = new URL('/dashboard/settings', openRouterReturnOrigin(config, req.get('origin')))
    callback.searchParams.set('tab', 'personal')
    callback.searchParams.set('ai_oauth', 'openrouter')
    return res.json(envelope(req, { url: buildAuthorizationUrl(callback.toString(), challenge) }))
  }))

  router.post('/ai/me/openrouter/exchange', wrap(async (req, res) => {
    const userId = userOf(req)
    const input = exchangeInput.parse(req.body)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', action: 'oauth_connect' })
    const verifier = pending.take(userId)
    if (!verifier) throw new ApiError(409, 'AI_OAUTH_EXPIRED', 'The OpenRouter sign-in expired; start again')
    let key: string
    try {
      key = await exchangeCodeForKey(input.code, verifier, fetchImpl)
    } catch (error) {
      if (error instanceof OpenRouterExchangeError) throw new ApiError(502, 'AI_OAUTH_FAILED', 'OpenRouter did not accept the sign-in')
      throw error
    }
    const created = await createCredential(req.adminDb!, cipher, {
      scope: 'user', ownerUserId: userId, provider: 'openrouter', authType: 'oauth', secret: key, label: 'OpenRouter', createdBy: userId,
    })
    return res.status(201).json(envelope(req, created))
  }))

  /** Sign in with ChatGPT: spend the teacher's own Plus/Pro allowance (OpenAI-approved client only). */
  router.post('/ai/me/chatgpt/start', wrap(async (req, res) => {
    const userId = userOf(req)
    if (!siwc || !chatgptTokens) throw new ApiError(404, 'AI_CHATGPT_NOT_CONFIGURED', 'Sign in with ChatGPT is not available on this server')
    const { verifier, challenge } = createPkcePair()
    const state = createOAuthState()
    chatgptPending.put(userId, JSON.stringify({ verifier, state }))
    return res.json(envelope(req, { url: buildChatGptAuthorizationUrl(siwc, chatgptCallback(), challenge, state) }))
  }))

  router.post('/ai/me/chatgpt/exchange', wrap(async (req, res) => {
    const userId = userOf(req)
    if (!siwc || !chatgptTokens) throw new ApiError(404, 'AI_CHATGPT_NOT_CONFIGURED', 'Sign in with ChatGPT is not available on this server')
    const input = chatgptExchangeInput.parse(req.body)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', action: 'oauth_connect' })
    const stored = chatgptPending.take(userId)
    const pendingFlow = stored ? JSON.parse(stored) as { verifier: string, state: string } : null
    if (!pendingFlow || pendingFlow.state !== input.state) throw new ApiError(409, 'AI_OAUTH_EXPIRED', 'The ChatGPT sign-in expired; start again')
    let tokens
    try {
      tokens = await exchangeChatGptCode(siwc, { code: input.code, verifier: pendingFlow.verifier, redirectUri: chatgptCallback() }, fetchImpl)
    } catch (error) {
      if (error instanceof ChatGptOAuthError && error.code === 'plan_not_granted') {
        throw new ApiError(403, 'AI_CHATGPT_PLAN_NOT_GRANTED', 'ChatGPT plan usage was not granted; a Plus or Pro plan and consent are required')
      }
      if (error instanceof ChatGptOAuthError) throw new ApiError(502, 'AI_OAUTH_FAILED', 'OpenAI did not accept the sign-in')
      throw error
    }
    // The refresh token is the stored secret; the first access token is cached in memory.
    const created = await createCredential(req.adminDb!, cipher, {
      scope: 'user', ownerUserId: userId, provider: 'openai', authType: 'oauth', secret: tokens.refreshToken!, label: 'ChatGPT', createdBy: userId,
    })
    chatgptTokens.remember(created.id as string, tokens.accessToken, tokens.expiresIn)
    return res.status(201).json(envelope(req, created))
  }))

  return router
}

/**
 * OpenRouter sends the teacher back to the page that started the sign-in, so
 * it works whatever port or host the web app is served from. Only origins the
 * API already trusts are used (configured origins, the web base URL, and
 * localhost outside production); anything else falls back to the base URL.
 */
export function openRouterReturnOrigin(config: Pick<ApiConfig, 'EDULOG_WEB_BASE_URL' | 'API_ALLOWED_ORIGINS' | 'NODE_ENV'>, origin: string | undefined): string {
  const base = new URL(config.EDULOG_WEB_BASE_URL).origin
  if (!origin) return base
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return base
  }
  if (parsed.origin !== origin) return base
  const localDevelopment = config.NODE_ENV !== 'production' && parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)
  return origin === base || config.API_ALLOWED_ORIGINS.includes(origin) || localDevelopment ? origin : base
}
