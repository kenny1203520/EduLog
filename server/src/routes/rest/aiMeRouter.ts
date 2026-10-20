import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import type { ApiConfig } from '../../config/config.js'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { setAuditContext } from '../../http/context.js'
import { SecretCipher } from '../../ai/credentials/secretCipher.js'
import {
  createCredential,
  credentialPatchInput,
  CREDENTIAL_FIELDS,
  MODEL_FIELDS,
  modelInput,
  personalCredentialInput,
  testCredential,
  updateCredential,
} from '../../ai/credentials/credentialStore.js'
import {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeCodeForKey,
  OpenRouterExchangeError,
  PendingPkceStore,
} from '../../ai/credentials/openRouterOAuth.js'

const uuid = z.string().uuid()
const personalModelInput = modelInput.pick({ model_id: true, display_name: true, enabled: true }).strict()
const testInput = z.object({ model_id: z.string().trim().min(1).max(200) }).strict()
const exchangeInput = z.object({ code: z.string().trim().min(1).max(2048) }).strict()

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
  const row = await req.adminDb!.from('ai_credentials').select('id,owner_user_id,scope').eq('id', id).maybeSingle()
  if (row.error) throw mapDatabaseError(row.error)
  if (!row.data || row.data.scope !== 'user' || row.data.owner_user_id !== req.user!.id) throw new ApiError(404, 'NOT_FOUND', 'Credential was not found')
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
export function createAiMeRouter(config: ApiConfig, pending = new PendingPkceStore(), fetchImpl: typeof fetch = fetch) {
  const cipher = config.AI_SECRET_KEY ? SecretCipher.fromBase64(config.AI_SECRET_KEY) : null
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
      secret_storage_available: cipher !== null,
    }))
  }))

  router.post('/ai/me/credentials', wrap(async (req, res) => {
    const userId = userOf(req)
    const input = personalCredentialInput.parse(req.body)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', action: 'create' })
    const created = await createCredential(req.adminDb!, cipher, {
      scope: 'user', ownerUserId: userId, provider: input.provider, authType: 'api_key', secret: input.secret, label: input.label, createdBy: userId,
    })
    return res.status(201).json(envelope(req, created))
  }))

  router.patch('/ai/me/credentials/:id', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    // Personal credentials never get a custom endpoint (see PERSONAL_PROVIDERS).
    const input = credentialPatchInput.omit({ base_url: true }).strict().parse(req.body)
    await ownCredential(req, id)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', resourceId: id, action: 'update' })
    return res.json(envelope(req, await updateCredential(req.adminDb!, cipher, id, input)))
  }))

  router.delete('/ai/me/credentials/:id', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    await ownCredential(req, id)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_credentials', resourceId: id, action: 'delete' })
    const result = await req.adminDb!.from('ai_credentials').delete().eq('id', id)
    if (result.error) throw mapDatabaseError(result.error)
    return res.json(envelope(req, { id, deleted: true }))
  }))

  router.post('/ai/me/credentials/:id/models', wrap(async (req, res) => {
    userOf(req)
    const id = idParam(req)
    const input = personalModelInput.parse(req.body)
    await ownCredential(req, id)
    setAuditContext(req, { domain: 'teaching', resource: 'ai_models', action: 'create' })
    const result = await req.adminDb!.from('ai_models').insert({ credential_id: id, model_id: input.model_id, display_name: input.display_name, enabled: input.enabled ?? true, quota_weight: 0 }).select(MODEL_FIELDS).single()
    if (result.error) throw mapDatabaseError(result.error)
    return res.status(201).json(envelope(req, result.data))
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
    return res.json(envelope(req, await testCredential(req.adminDb!, cipher, id, input.model_id)))
  }))

  router.post('/ai/me/openrouter/start', wrap(async (req, res) => {
    const userId = userOf(req)
    if (!cipher) throw new ApiError(503, 'AI_SECRET_KEY_MISSING', 'AI_SECRET_KEY is not configured on the server')
    const { verifier, challenge } = createPkcePair()
    pending.put(userId, verifier)
    const callback = new URL('/dashboard/settings', config.EDULOG_WEB_BASE_URL)
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

  return router
}
