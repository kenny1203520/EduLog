import { Router, type Request, type RequestHandler } from 'express'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { ApiConfig } from '../config/config.js'
import { ApiError } from '../http/errors.js'
import { setAuditContext } from '../http/context.js'
import { sendCreated, sendData } from '../http/response.js'
import { requireAuthorizationRpcDecision } from './authorization.js'
import { requireRecentProviderAdminAuthentication } from './providerAdmin.js'

const managementPermission = 'system.auth.oauth_clients.manage'
const uuid = z.string().uuid()
const authorizationId = z.string().min(10).max(128).regex(/^[a-zA-Z0-9_-]+$/)
const callbackUrl = z.string().max(2048).url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash
}, 'An HTTPS callback without credentials or a fragment is required')
const registration = z.object({
  client_name: z.string().trim().min(1).max(120),
  redirect_uris: z.array(callbackUrl).min(1).max(10),
}).strict()
const consent = z.object({ action: z.enum(['approve', 'deny']) }).strict()
const clientSummary = z.object({
  client_id: uuid,
  client_name: z.string(),
  // GoTrue (Go) serialises an empty slice as null.
  redirect_uris: z.array(z.string()).nullable().transform(value => value ?? []),
  client_type: z.enum(['public', 'confidential']),
})
const clientRegistration = clientSummary.extend({ client_secret: z.string().min(1) })
const consentRedirect = z.object({ redirect_url: callbackUrl })
const consentDetails = z.object({
  client: z.object({ id: uuid, name: z.string().optional() }),
  user: z.object({ id: uuid, email: z.string().optional() }),
  redirect_uri: callbackUrl,
  scope: z.string(),
})
const grants = z.array(z.object({
  client: consentDetails.shape.client,
  scopes: z.array(z.string()).nullable().transform(value => value ?? []),
  granted_at: z.string(),
})).nullable().transform(value => value ?? [])

function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ApiError(422, 'INVALID_VALUE', 'The OAuth application settings or request are invalid')
  return result.data
}

async function callGoTrue<T>(config: ApiConfig, path: string, schema: z.ZodType<T>, token: string, init: RequestInit = {}) {
  if (!config.GOTRUE_INTERNAL_URL) throw new ApiError(503, 'OAUTH_SERVER_UNAVAILABLE', 'OAuth provider is unavailable')
  let response: Response
  try {
    response = await fetch(new URL(path, config.GOTRUE_INTERNAL_URL), {
      ...init,
      redirect: 'error',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new ApiError(503, 'OAUTH_SERVER_UNAVAILABLE', 'OAuth provider is unavailable')
  }
  if (!response.ok) {
    if (response.status === 404) throw new ApiError(404, 'OAUTH_REQUEST_NOT_FOUND', 'The OAuth request or app was not found')
    if ([400, 409, 422].includes(response.status)) throw new ApiError(422, 'OAUTH_REQUEST_REJECTED', 'The OAuth provider rejected the request')
    throw new ApiError(503, 'OAUTH_SERVER_UNAVAILABLE', 'OAuth provider is unavailable')
  }
  const json: unknown = response.status === 204 ? null : await response.json().catch(() => undefined)
  const result = schema.safeParse(json)
  if (!result.success) throw new ApiError(503, 'OAUTH_SERVER_UNAVAILABLE', 'OAuth provider returned an invalid response')
  return result.data
}

async function requireManagement(req: Request) {
  await requireAuthorizationRpcDecision(req, req.db!.rpc('has_api_permission', {
    p_user_id: req.user!.id,
    p_permission_key: managementPermission,
    p_classroom_id: null,
    p_class_session_id: null,
  }), { permission: managementPermission, stage: 'outbound_oauth.management' })
}

export function createOutboundOAuthRouter(config: ApiConfig, activeAccount: RequestHandler) {
  const router = Router()
  const limitOptions = { windowMs: 60_000, limit: config.API_RATE_LIMIT_PER_MINUTE, standardHeaders: true, legacyHeaders: false }
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store')
    if (!config.AUTH_OUTBOUND_OAUTH_ENABLED) return next(new ApiError(404, 'OAUTH_SERVER_DISABLED', 'OAuth is not enabled'))
    next()
  }, activeAccount)

  router.get('/clients', async (req, res) => {
    await requireManagement(req)
    const page = input(z.coerce.number().int().min(1).max(1000).default(1), req.query.page)
    const data = await callGoTrue(config, `/admin/oauth/clients?page=${page}&per_page=50`,
      z.object({ clients: z.array(clientSummary).nullable().transform(value => value ?? []) }), config.SUPABASE_SERVICE_ROLE_KEY)
    sendData(req, res, data)
  })
  router.post('/clients', rateLimit(limitOptions), async (req, res) => {
    await requireManagement(req)
    requireRecentProviderAdminAuthentication(req)
    const data = await callGoTrue(config, '/admin/oauth/clients', clientRegistration,
      config.SUPABASE_SERVICE_ROLE_KEY, {
        method: 'POST',
        body: JSON.stringify({ ...input(registration, req.body), token_endpoint_auth_method: 'client_secret_basic' }),
      })
    setAuditContext(req, { domain: 'system', resource: 'oauth_clients', action: 'create', resourceId: data.client_id })
    sendCreated(req, res, data)
  })
  router.delete('/clients/:id', rateLimit(limitOptions), async (req, res) => {
    await requireManagement(req)
    requireRecentProviderAdminAuthentication(req)
    const id = input(uuid, req.params.id)
    setAuditContext(req, { domain: 'system', resource: 'oauth_clients', action: 'delete', resourceId: id })
    await callGoTrue(config, `/admin/oauth/clients/${id}`, z.null(), config.SUPABASE_SERVICE_ROLE_KEY, { method: 'DELETE' })
    res.sendStatus(204)
  })

  router.get('/authorizations/:id', async (req, res) => {
    const id = input(authorizationId, req.params.id)
    const data = await callGoTrue(config, `/oauth/authorizations/${id}`,
      z.union([consentRedirect, consentDetails]), req.accessToken!)
    if ('user' in data && data.user.id !== req.user!.id) throw new ApiError(404, 'OAUTH_REQUEST_NOT_FOUND', 'The OAuth request or app was not found')
    sendData(req, res, data)
  })
  router.post('/authorizations/:id/consent', async (req, res) => {
    const id = input(authorizationId, req.params.id)
    const decision = input(consent, req.body)
    const data = await callGoTrue(config, `/oauth/authorizations/${id}/consent`, consentRedirect,
      req.accessToken!, { method: 'POST', body: JSON.stringify(decision) })
    setAuditContext(req, { domain: 'system', resource: 'oauth_grants', action: decision.action })
    sendData(req, res, data)
  })
  router.get('/grants', async (req, res) => {
    sendData(req, res, await callGoTrue(config, '/user/oauth/grants', grants, req.accessToken!))
  })
  router.delete('/grants/:id', async (req, res) => {
    const id = input(uuid, req.params.id)
    setAuditContext(req, { domain: 'system', resource: 'oauth_grants', action: 'revoke', resourceId: id })
    await callGoTrue(config, `/user/oauth/grants?client_id=${id}`, z.null(), req.accessToken!, { method: 'DELETE' })
    res.sendStatus(204)
  })
  return router
}
