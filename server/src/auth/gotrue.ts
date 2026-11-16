import crypto from 'node:crypto'
import type { ApiConfig } from '../config/config.js'
import { ApiError } from '../http/errors.js'

/**
 * GoTrue calls the API makes on the browser's behalf. They use plain HTTP
 * rather than a shared supabase-js client so no session is ever kept in
 * process memory between requests.
 */

export type GoTrueSession = { access_token: string; refresh_token: string; expires_in?: number; user?: { id: string; email?: string | null; factors?: Array<{ status: string }> } }
export type EmailLinkType = 'invite' | 'recovery' | 'email_change' | 'signup' | 'email'

type GoTrueConfig = Pick<ApiConfig, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'GOTRUE_INTERNAL_URL' | 'NODE_ENV'>
type ProviderDiscoveryConfig = GoTrueConfig & Pick<ApiConfig, 'AUTH_CUSTOM_OAUTH_DISCOVERY_ENABLED' | 'SUPABASE_SERVICE_ROLE_KEY'>

/** Settings keys that are not social sign-in providers. */
const NON_OAUTH = new Set(['email', 'phone', 'anonymous_users', 'saml'])
const PROVIDER_PATTERN = /^[a-z][a-z0-9_]{1,40}$/
const CUSTOM_PROVIDER_PATTERN = /^custom:[a-z0-9:-]{2,43}$/
export const OAUTH_PROVIDER_MAX_LENGTH = 50

function withoutTrailingSlashes(url: string) {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  return url.slice(0, end)
}

function authUrl(config: GoTrueConfig, path: string) {
  return `${withoutTrailingSlashes(config.SUPABASE_URL)}/auth/v1${path}`
}

async function call<T>(config: GoTrueConfig, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(authUrl(config, path), {
    ...init,
    headers: { apikey: config.SUPABASE_ANON_KEY, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: init.signal ?? AbortSignal.timeout(10_000),
    redirect: init.redirect ?? 'error',
  })
  if (!response.ok) {
    const error = new Error('GOTRUE_REQUEST_FAILED') as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return (response.status === 204 ? null : await response.json()) as T
}

export type GoTrueSettings = {
  external: Record<string, unknown>
  sms_provider?: string
  saml_enabled?: boolean
  passkeys_enabled?: boolean
}

async function readSettings(config: GoTrueConfig) {
  const settings = await call<GoTrueSettings>(config, '/settings')
  if (!settings?.external || typeof settings.external !== 'object' || Array.isArray(settings.external)) {
    throw new Error('INVALID_GOTRUE_SETTINGS')
  }
  return settings
}

type CustomProviders = { providers: string[]; labels: Record<string, string>; available: boolean }

async function readCustomProviders(config: ProviderDiscoveryConfig): Promise<CustomProviders> {
  if (!config.AUTH_CUSTOM_OAUTH_DISCOVERY_ENABLED) return { providers: [], labels: {}, available: false }
  if (!config.GOTRUE_INTERNAL_URL) throw new Error('GOTRUE_INTERNAL_URL_REQUIRED')
  const response = await fetch(oauthAuthUrl(config, '/admin/custom-providers'), {
    headers: { authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  })
  if (response.status === 404 || response.status === 501) {
    await response.body?.cancel()
    return { providers: [], labels: {}, available: false }
  }
  if (!response.ok) throw new Error('GOTRUE_CUSTOM_PROVIDERS_UNAVAILABLE')
  const payload = await response.json() as { providers?: Array<{ identifier?: unknown; enabled?: unknown; name?: unknown }> }
  if (!Array.isArray(payload?.providers)) throw new Error('INVALID_GOTRUE_CUSTOM_PROVIDERS')
  const providers: string[] = []
  const labels: Record<string, string> = {}
  for (const item of payload.providers) {
    if (item?.enabled !== true || typeof item.identifier !== 'string' || !CUSTOM_PROVIDER_PATTERN.test(item.identifier)) continue
    providers.push(item.identifier)
    if (typeof item.name === 'string' && item.name.trim()) labels[item.identifier] = item.name.trim().slice(0, 100)
  }
  return { available: true, providers, labels }
}

async function readSamlProviders(config: ProviderDiscoveryConfig) {
  if (!config.GOTRUE_INTERNAL_URL) return false
  const response = await fetch(oauthAuthUrl(config, '/admin/sso/providers'), {
    headers: { authorization: `Bearer ${config.SUPABASE_SERVICE_ROLE_KEY}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  })
  if (!response.ok) throw new Error('GOTRUE_SAML_PROVIDERS_UNAVAILABLE')
  const payload = await response.json() as { items?: Array<{ disabled?: boolean; domains?: unknown[] }> }
  if (!Array.isArray(payload.items)) throw new Error('INVALID_GOTRUE_SAML_PROVIDERS')
  return payload.items.some(item => item.disabled !== true && Array.isArray(item.domains) && item.domains.length > 0)
}

const PROVIDER_CACHE_MS = 60_000

function cacheSuccessfulRead<T>(read: (config: ProviderDiscoveryConfig) => Promise<T>) {
  let entries = new WeakMap<ProviderDiscoveryConfig, { at: number; value: Promise<T> }>()
  return {
    get(config: ProviderDiscoveryConfig, now: number) {
      const cached = entries.get(config)
      if (cached && now - cached.at < PROVIDER_CACHE_MS) return cached.value
      const value = read(config).catch(error => {
        if (entries.get(config)?.value === value) entries.delete(config)
        throw error
      })
      entries.set(config, { at: now, value })
      return value
    },
    reset() { entries = new WeakMap() },
  }
}

const settingsRead = cacheSuccessfulRead(readSettings)
const customProvidersRead = cacheSuccessfulRead(readCustomProviders)
const samlProvidersRead = cacheSuccessfulRead(readSamlProviders)

export function hasSamlProvider(config: ProviderDiscoveryConfig, now = Date.now()) {
  return samlProvidersRead.get(config, now)
}

/** Credentials and provider metadata stay inside GoTrue. */
export async function discoverAuthProviders(config: ProviderDiscoveryConfig, now = Date.now()) {
  const [settingsResult, customResult] = await Promise.allSettled([
    settingsRead.get(config, now), customProvidersRead.get(config, now),
  ])
  const settings = settingsResult.status === 'fulfilled' ? settingsResult.value : undefined
  const custom = customResult.status === 'fulfilled' ? customResult.value : undefined
  const builtin = Object.entries(settings?.external ?? {})
    .filter(([name, enabled]) => enabled === true && !NON_OAUTH.has(name) && PROVIDER_PATTERN.test(name))
    .map(([name]) => name)
  const providers = [...new Set([...builtin, ...(custom?.providers ?? [])])].sort((a, b) => a.localeCompare(b))
  return { settings, custom, providers }
}

export async function enabledOAuthProviders(config: ProviderDiscoveryConfig, now = Date.now()): Promise<string[]> {
  const { settings, custom, providers } = await discoverAuthProviders(config, now)
  if (!settings && !custom?.available) {
    throw new ApiError(503, 'OAUTH_PROVIDERS_UNAVAILABLE', 'Third-party sign-in options are temporarily unavailable', undefined, 1)
  }
  return providers
}

export function resetProviderCache() {
  settingsRead.reset()
  customProvidersRead.reset()
  samlProvidersRead.reset()
}

export function isValidProviderName(provider: string) {
  return CUSTOM_PROVIDER_PATTERN.test(provider) || (PROVIDER_PATTERN.test(provider) && !NON_OAUTH.has(provider))
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function oauthAuthUrl(config: GoTrueConfig, path: string) {
  if (!config.GOTRUE_INTERNAL_URL) return authUrl(config, path)
  return `${withoutTrailingSlashes(config.GOTRUE_INTERNAL_URL)}${path}`
}

export function validProviderAuthorizeLocation(value: string, config: GoTrueConfig) {
  try {
    const url = new URL(value)
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
    const localHttp = config.NODE_ENV !== 'production' && url.protocol === 'http:' && localHosts.has(url.hostname)
    return (url.protocol === 'https:' || localHttp) && !url.username && !url.password && !url.hash
  } catch {
    return false
  }
}

/** Ask internal GoTrue to start OAuth and return its validated provider redirect. */
export async function startOAuthAuthorization(config: GoTrueConfig, provider: string, redirectTo: string, challenge: string) {
  const url = new URL(oauthAuthUrl(config, '/authorize'))
  url.searchParams.set('provider', provider)
  url.searchParams.set('redirect_to', redirectTo)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 's256')
  const response = await fetch(url, {
    headers: { apikey: config.SUPABASE_ANON_KEY, accept: 'text/html', 'cache-control': 'no-store' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  })
  const location = response.headers.get('location')
  await response.body?.cancel().catch(() => undefined)
  if (![302, 303, 307, 308].includes(response.status) || !location || !validProviderAuthorizeLocation(location, config)) {
    throw new Error('GOTRUE_OAUTH_AUTHORIZE_FAILED')
  }
  return location
}

/** Forward an OAuth provider callback to GoTrue's one fixed callback route. */
export function forwardOAuthCallback(config: GoTrueConfig, method: 'GET' | 'POST', parameters: URLSearchParams) {
  const url = new URL(oauthAuthUrl(config, '/callback'))
  const init: RequestInit = {
    method,
    headers: { apikey: config.SUPABASE_ANON_KEY, 'cache-control': 'no-store' },
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  }
  if (method === 'GET') url.search = parameters.toString()
  else {
    init.headers = { ...init.headers, 'content-type': 'application/x-www-form-urlencoded' }
    init.body = parameters.toString()
  }
  return fetch(url, init)
}

export function exchangeAuthCode(config: GoTrueConfig, authCode: string, codeVerifier: string) {
  return call<GoTrueSession>(config, '/token?grant_type=pkce', {
    method: 'POST', body: JSON.stringify({ auth_code: authCode, code_verifier: codeVerifier }),
  })
}

export async function startIdentityLink(config: GoTrueConfig, token: string, provider: string, redirectTo: string, challenge: string) {
  const url = new URL(oauthAuthUrl(config, '/user/identities/authorize'))
  url.search = new URLSearchParams({ provider, redirect_to: redirectTo, code_challenge: challenge, code_challenge_method: 's256', skip_http_redirect: 'true' }).toString()
  const response = await fetch(url, {
    headers: { apikey: config.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new ApiError(503, 'OAUTH_LINK_UNAVAILABLE', 'Third-party account linking is unavailable')
  const data = await response.json() as { url?: string }
  if (typeof data.url !== 'string' || !validProviderAuthorizeLocation(data.url, config)) throw new ApiError(502, 'OAUTH_LINK_UNAVAILABLE', 'Third-party account linking is unavailable')
  return data.url
}

export function readIdentityUser(config: GoTrueConfig, token: string) {
  return call<{ id: string; email?: string; email_confirmed_at?: string; identities?: Array<{ identity_id: string; provider: string; identity_data?: { email?: string } }> }>(
    config, '/user', { headers: { authorization: `Bearer ${token}` }, redirect: 'error' })
}

export function deleteIdentity(config: GoTrueConfig, token: string, id: string) {
  return call(config, `/user/identities/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${token}` }, redirect: 'error',
  })
}

/** Consume a one-time link from an email (invite, recovery, email change, sign-up). */
export function verifyEmailLink(config: GoTrueConfig, tokenHash: string, type: EmailLinkType) {
  return call<GoTrueSession>(config, '/verify', {
    method: 'POST', body: JSON.stringify({ token_hash: tokenHash, type }),
  })
}

/** Ask GoTrue to mail a password-reset link. */
export function requestPasswordRecovery(config: GoTrueConfig, email: string, redirectTo: string) {
  return call<null>(config, `/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST', body: JSON.stringify({ email }),
  })
}
