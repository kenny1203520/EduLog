import crypto from 'node:crypto'
import type { ApiConfig } from '../config/config.js'

/**
 * GoTrue calls the API makes on the browser's behalf. They use plain HTTP
 * rather than a shared supabase-js client so no session is ever kept in
 * process memory between requests.
 */

export type GoTrueSession = { access_token: string; refresh_token: string; expires_in?: number; user?: { id: string; email?: string | null } }
export type EmailLinkType = 'invite' | 'recovery' | 'email_change' | 'signup' | 'email'

type GoTrueConfig = Pick<ApiConfig, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY' | 'GOTRUE_INTERNAL_URL' | 'NODE_ENV'>

/** Settings keys that are not social sign-in providers. */
const NON_OAUTH = new Set(['email', 'phone', 'anonymous_users', 'saml'])
const PROVIDER_PATTERN = /^[a-z][a-z0-9_]{1,40}$/

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
  })
  if (!response.ok) {
    const error = new Error('GOTRUE_REQUEST_FAILED') as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return (response.status === 204 ? null : await response.json()) as T
}

let providerCache: { at: number; providers: string[] } | null = null
const PROVIDER_CACHE_MS = 60_000

/** OAuth providers GoTrue has enabled, read from its public settings. */
export async function enabledOAuthProviders(config: GoTrueConfig, now = Date.now()): Promise<string[]> {
  if (providerCache && now - providerCache.at < PROVIDER_CACHE_MS) return providerCache.providers
  try {
    const settings = await call<{ external?: Record<string, unknown> }>(config, '/settings')
    const providers = Object.entries(settings?.external ?? {})
      .filter(([name, enabled]) => enabled === true && !NON_OAUTH.has(name) && PROVIDER_PATTERN.test(name))
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b))
    providerCache = { at: now, providers }
    return providers
  } catch {
    // Never cache a failure: the next page load tries again.
    return []
  }
}

export function resetProviderCache() { providerCache = null }

export function isValidProviderName(provider: string) {
  return PROVIDER_PATTERN.test(provider) && !NON_OAUTH.has(provider)
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

function validProviderAuthorizeLocation(value: string, config: GoTrueConfig) {
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
