import { Router, type Request } from 'express'
import { decodeJwt } from 'jose'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import type { ApiConfig } from '../config/config.js'
import { setAuditContext } from '../http/context.js'
import { ApiError } from '../http/errors.js'
import { sendData } from '../http/response.js'
import type { SupabaseClients } from '../infra/supabase.js'
import { requireAuth } from './auth.js'
import { requireAuthorizationRpcDecision } from './authorization.js'
import { isValidProviderName, resetProviderCache, withoutTrailingSlashes } from './gotrue.js'

export const AUTH_PROVIDERS_MANAGE = 'system.auth.providers.manage'
const resource = 'auth-providers'
const customProviderPath = '/admin/custom-providers'
const maxAuthenticationAgeSeconds = 5 * 60

const identifier = z.string().regex(/^custom:[a-z0-9:-]{2,43}$/)
const url = z.string().trim().min(1).max(2048)
const credentials = {
  identifier,
  name: z.string().trim().min(1).max(100),
  client_id: z.string().trim().min(1).max(512),
  client_secret: z.string().min(1).max(2048),
}
const createSchema = z.discriminatedUnion('provider_type', [
  z.object({
    ...credentials,
    provider_type: z.literal('oidc'),
    issuer: url.optional(),
    discovery_url: url.optional(),
  }).strict(),
  z.object({
    ...credentials,
    provider_type: z.literal('oauth2'),
    authorization_url: url,
    token_url: url,
    userinfo_url: url,
  }).strict(),
])
const updateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enable'), callback_confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal('disable') }).strict(),
  z.object({ action: z.literal('rotate_secret'), client_secret: credentials.client_secret }).strict(),
])
const providerMetadata = z.object({
  id: z.uuid().optional(),
  identifier,
  name: credentials.name,
  provider_type: z.enum(['oidc', 'oauth2']),
  enabled: z.boolean(),
})
const providerEndpoints = z.object({
  issuer: url.nullish(),
  discovery_url: url.nullish(),
  authorization_url: url.nullish(),
  token_url: url.nullish(),
  userinfo_url: url.nullish(),
  jwks_uri: url.nullish(),
})
const discoveryDocument = z.object({
  issuer: url,
  authorization_endpoint: url,
  token_endpoint: url,
  jwks_uri: url,
  userinfo_endpoint: url.optional(),
})
const providersList = z.object({ providers: z.array(providerMetadata) })

/** This token has already been verified by requireAuth; refresh time is not proof of reauthentication. */
export function requireRecentProviderAdminAuthentication(req: Request, now = Math.floor(Date.now() / 1000)) {
  if (!req.cookies?.edulog_access || !req.accessToken) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'A browser session is required')
  }
  const amr = decodeJwt(req.accessToken).amr
  if (!Array.isArray(amr) || !amr.some(method =>
    method && typeof method.timestamp === 'number'
    && method.timestamp <= now + 30 && method.timestamp >= now - maxAuthenticationAgeSeconds,
  )) {
    throw new ApiError(403, 'RECENT_AUTHENTICATION_REQUIRED', 'Sign in again to manage login providers')
  }
}

function providerUrl(value: string, allowedOrigins: readonly string[]): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ApiError(422, 'AUTH_PROVIDER_URL_INVALID', 'Enter a valid HTTPS provider URL')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new ApiError(422, 'AUTH_PROVIDER_URL_INVALID', 'Enter a valid HTTPS provider URL')
  }
  if (!allowedOrigins.includes(parsed.origin)) {
    throw new ApiError(422, 'AUTH_PROVIDER_ORIGIN_BLOCKED', 'The provider origin is not approved for this deployment')
  }
  return parsed
}

async function validateOidc(issuer: string | null | undefined, discovery: string | null | undefined, allowedOrigins: readonly string[]) {
  if (!issuer && !discovery) throw new ApiError(422, 'AUTH_PROVIDER_URL_INVALID', 'Enter an issuer or discovery URL')
  if (issuer) providerUrl(issuer, allowedOrigins)
  const discoveryUrl = providerUrl(discovery ?? withoutTrailingSlashes(issuer!) + '/.well-known/openid-configuration', allowedOrigins)
  let metadata: z.infer<typeof discoveryDocument>
  try {
    const response = await fetch(discoveryUrl, {
      headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error('discovery_failed')
    metadata = discoveryDocument.parse(await response.json())
  } catch {
    throw new ApiError(422, 'AUTH_PROVIDER_DISCOVERY_INVALID', 'The OIDC discovery document could not be verified')
  }
  if (issuer && metadata.issuer !== issuer) {
    throw new ApiError(422, 'AUTH_PROVIDER_ISSUER_MISMATCH', 'The issuer does not match the discovery document')
  }
  for (const endpoint of [metadata.issuer, metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri, metadata.userinfo_endpoint]) {
    if (endpoint) providerUrl(endpoint, allowedOrigins)
  }
  return { issuer: metadata.issuer, discovery_url: discovery ?? undefined }
}

function validateOAuth2(endpoints: z.infer<typeof providerEndpoints>, allowedOrigins: readonly string[]) {
  for (const endpoint of [endpoints.authorization_url, endpoints.token_url, endpoints.userinfo_url]) {
    if (!endpoint) throw new ApiError(422, 'AUTH_PROVIDER_URL_INVALID', 'Enter all three OAuth endpoints')
    providerUrl(endpoint, allowedOrigins)
  }
  if (endpoints.jwks_uri) providerUrl(endpoints.jwks_uri, allowedOrigins)
}

const rejected = () => new ApiError(422, 'AUTH_PROVIDER_REJECTED', 'GoTrue rejected the provider configuration')
const unavailable = () => new ApiError(503, 'AUTH_PROVIDER_ADMIN_UNAVAILABLE', 'GoTrue provider management is temporarily unavailable')

async function callProviderAdmin<T>(config: ApiConfig, path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  let response: globalThis.Response
  try {
    response = await fetch(withoutTrailingSlashes(config.GOTRUE_INTERNAL_URL!) + customProviderPath + path, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: 'Bearer ' + config.SUPABASE_SERVICE_ROLE_KEY, accept: 'application/json', 'content-type': 'application/json' },
    })
  } catch {
    throw unavailable()
  }
  if (response.status === 404 && path) throw new ApiError(404, 'NOT_FOUND', 'The provider was not found')
  if (response.status === 409) throw new ApiError(409, 'AUTH_PROVIDER_CONFLICT', 'The provider already exists')
  if (response.status === 400 || response.status === 422) {
    const payload = await response.json().catch(() => null) as { error_code?: unknown } | null
    if (payload?.error_code === 'conflict') throw new ApiError(409, 'AUTH_PROVIDER_CONFLICT', 'The provider already exists')
    throw rejected()
  }
  if (!response.ok) throw unavailable()
  try {
    return schema.parse(await response.json())
  } catch {
    throw unavailable()
  }
}

async function builtInProviders(config: ApiConfig) {
  try {
    const response = await fetch(withoutTrailingSlashes(config.SUPABASE_URL) + '/auth/v1/settings', {
      headers: { apikey: config.SUPABASE_ANON_KEY },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return null
    const settings = z.object({ external: z.record(z.string(), z.boolean()) }).parse(await response.json())
    return Object.entries(settings.external)
      .filter(([key]) => !key.startsWith('custom:') && isValidProviderName(key))
      .map(([identifier, enabled]) => ({ identifier, enabled }))
  } catch {
    return null
  }
}

export function createProviderAdminRouter(clients: SupabaseClients, config: ApiConfig) {
  const router = Router()
  const limitOptions = { windowMs: 60_000, limit: config.API_RATE_LIMIT_PER_MINUTE, standardHeaders: true, legacyHeaders: false }
  const allowedOrigins = config.AUTH_PROVIDER_ALLOWED_ORIGINS ?? []
  // Enabling this option asserts that the deployment confines GoTrue egress to
  // the same trusted upstreams. GoTrue separately resolves discovery at login.
  const enabled = Boolean(config.AUTH_PROVIDER_ADMIN_ENABLED && config.GOTRUE_INTERNAL_URL && allowedOrigins.length)
  router.use(rateLimit(limitOptions), requireAuth(clients, config), async (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store')
    const decision = req.db!.rpc('has_api_permission', {
      p_user_id: req.user!.id, p_permission_key: AUTH_PROVIDERS_MANAGE, p_classroom_id: null, p_class_session_id: null,
    })
    await requireAuthorizationRpcDecision(req, decision, { permission: AUTH_PROVIDERS_MANAGE, stage: resource, scopeType: 'system' })
    next()
  })

  router.get('/', async (req, res) => {
    const [builtin, custom] = await Promise.all([
      builtInProviders(config),
      enabled ? callProviderAdmin(config, '', providersList).then(list => list.providers).catch(() => null) : null,
    ])
    return sendData(req, res, {
      enabled, builtin, custom,
      callback_url: new URL('/api/auth/bridge/callback', config.EDULOG_WEB_BASE_URL).href,
    })
  })

  function requireWrite(req: Request) {
    if (!enabled) throw new ApiError(403, 'AUTH_PROVIDER_ADMIN_DISABLED', 'Provider management is disabled')
    requireRecentProviderAdminAuthentication(req)
  }

  router.post('/', rateLimit(limitOptions), async (req, res) => {
    requireWrite(req)
    const input = createSchema.parse(req.body)
    setAuditContext(req, { resource, action: 'create-draft', metadata: { provider: input.identifier } })
    const configuration = input.provider_type === 'oidc' ? {
      ...input,
      ...await validateOidc(input.issuer, input.discovery_url, allowedOrigins),
      scopes: ['openid', 'profile', 'email'],
    } : {
      ...input,
      scopes: ['profile', 'email'],
    }
    if (input.provider_type === 'oauth2') validateOAuth2(input, allowedOrigins)
    const draft = await callProviderAdmin(config, '', providerMetadata, {
      method: 'POST', body: JSON.stringify({ ...configuration, enabled: false, pkce_enabled: true }),
    })
    setAuditContext(req, { resourceId: draft.id })
    resetProviderCache()
    res.status(201)
    return sendData(req, res, draft)
  })

  router.patch('/:identifier', rateLimit(limitOptions), async (req, res) => {
    requireWrite(req)
    const key = identifier.parse(req.params.identifier)
    const input = updateSchema.parse(req.body)
    // GoTrue's router validates the raw segment. The schema above excludes URL delimiters.
    const path = '/' + key
    setAuditContext(req, { resource, action: input.action, metadata: { provider: key } })
    if (input.action === 'enable') {
      const draft = await callProviderAdmin(config, path, providerMetadata.extend(providerEndpoints.shape))
      if (draft.provider_type === 'oidc') await validateOidc(draft.issuer, draft.discovery_url, allowedOrigins)
      else validateOAuth2(draft, allowedOrigins)
    }
    const provider = await callProviderAdmin(config, path, providerMetadata, {
      method: 'PUT',
      body: JSON.stringify(input.action === 'rotate_secret' ? { client_secret: input.client_secret } : { enabled: input.action === 'enable' }),
    })
    setAuditContext(req, { resourceId: provider.id })
    resetProviderCache()
    return sendData(req, res, provider)
  })

  return router
}
