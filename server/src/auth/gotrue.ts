import crypto from 'node:crypto'
import type { ApiConfig } from '../config/config.js'

/**
 * GoTrue calls the API makes on the browser's behalf. They use plain HTTP
 * rather than a shared supabase-js client so no session is ever kept in
 * process memory between requests.
 */

export type GoTrueSession = { access_token: string; refresh_token: string; expires_in?: number; user?: { id: string; email?: string | null } }
export type EmailLinkType = 'invite' | 'recovery' | 'email_change' | 'signup' | 'email'

type GoTrueConfig = Pick<ApiConfig, 'SUPABASE_URL' | 'SUPABASE_ANON_KEY'>

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

/** Where the browser goes to sign in with a provider (PKCE flow). */
export function oauthAuthorizeUrl(publicUrl: string, provider: string, redirectTo: string, challenge: string) {
  const url = new URL(`${withoutTrailingSlashes(publicUrl)}/auth/v1/authorize`)
  url.searchParams.set('provider', provider)
  url.searchParams.set('redirect_to', redirectTo)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 's256')
  return url.toString()
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
