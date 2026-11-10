import crypto from 'node:crypto'
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose'
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { ApiConfig } from '../config/config.js'

export type SupabaseClients = {
  publicClient: SupabaseClient
  adminClient: SupabaseClient
}

type ValidationCacheEntry = { user: User; expiresAt: number; pending?: Promise<User> }
const validationCache = new Map<string, ValidationCacheEntry>()
const accountStatusCache = new Map<string, { status: 'active' | 'disabled' | 'pending'; expiresAt: number }>()
const VALIDATION_CACHE_TTL_MS = 30_000
const VALIDATION_CACHE_MAX_ENTRIES = 512

function tokenCacheKey(token: string) {
  // The cache never stores a bearer token.  A SHA-256 digest also gives us a
  // fixed-size key suitable for bounded, short-lived request coalescing.
  return crypto.createHash('sha256').update(token).digest('hex')
}

function tokenExpiry(token: string) {
  try {
    const payload = token.split('.')[1]
    if (!payload) return undefined
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof decoded.exp === 'number' && Number.isFinite(decoded.exp) ? decoded.exp * 1000 : undefined
  } catch { return undefined }
}

export function clearAccessTokenValidation(accessToken: string | undefined) {
  if (accessToken) validationCache.delete(tokenCacheKey(accessToken))
}

export function clearUserValidation(userId: string) {
  accountStatusCache.delete(userId)
  for (const [key, entry] of validationCache) {
    if (entry.user?.id === userId) validationCache.delete(key)
  }
}

export type AccountStatus = 'active' | 'disabled' | 'pending'

/**
 * The account's status, cached briefly. Disabled accounts always fail with
 * AUTH_DISABLED; pending ones (waiting for administrator approval) fail with
 * AUTH_PENDING unless `allowPending`, which lets them see who they are.
 */
export async function assertUserActive(adminClient: SupabaseClient, userId: string, options: { allowPending?: boolean } = {}): Promise<'active' | 'pending'> {
  const now = Date.now()
  let status: AccountStatus
  const cached = accountStatusCache.get(userId)
  if (cached && cached.expiresAt > now) status = cached.status
  else {
    const { data, error } = await adminClient.from('profiles').select('account_status').eq('auth_user_id', userId).maybeSingle()
    if (error || !data) throw new Error('AUTH_INVALID')
    status = data.account_status === 'disabled' ? 'disabled' : data.account_status === 'pending' ? 'pending' : 'active'
    accountStatusCache.set(userId, { status, expiresAt: now + VALIDATION_CACHE_TTL_MS })
  }
  if (status === 'disabled') throw new Error('AUTH_DISABLED')
  if (status === 'pending' && !options.allowPending) throw new Error('AUTH_PENDING')
  return status
}

export function createSupabaseClients(config: ApiConfig): SupabaseClients {
  const options = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  return {
    publicClient: createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, options),
    adminClient: createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, options),
  }
}

export function createUserClient(config: ApiConfig, accessToken: string): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
}

export async function createAuthenticatedUserClient(config: ApiConfig, accessToken: string, refreshToken: string): Promise<SupabaseClient> {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
  if (error) throw new Error('AUTH_INVALID')
  return client
}

export async function verifyCurrentPassword(config: ApiConfig, email: string, password: string): Promise<Session | null> {
  const client = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user || !data.session) return null
  return data.session
}

type TokenVerificationConfig = Partial<Pick<ApiConfig, 'SUPABASE_URL' | 'SUPABASE_JWT_SECRET' | 'SUPABASE_JWT_ISSUER'>>

// GoTrue signs with ES256/RS256 once asymmetric signing keys (JWT_KEYS) are
// configured; their public keys are published at the Auth JWKS endpoint.
const ASYMMETRIC_ALGORITHMS = ['ES256', 'RS256']
const remoteJwkSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function remoteJwkSet(supabaseUrl: string) {
  const url = new URL('auth/v1/.well-known/jwks.json', supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`)
  let jwks = remoteJwkSets.get(url.href)
  if (!jwks) {
    jwks = createRemoteJWKSet(url)
    remoteJwkSets.set(url.href, jwks)
  }
  return jwks
}

async function verifyAccessTokenLocally(accessToken: string, config?: TokenVerificationConfig) {
  if (!config) return undefined
  let alg: string | undefined
  try { alg = decodeProtectedHeader(accessToken).alg } catch { alg = undefined }
  const asymmetric = alg != null && ASYMMETRIC_ALGORITHMS.includes(alg)
  if (asymmetric ? !config.SUPABASE_URL : !config.SUPABASE_JWT_SECRET) return undefined
  try {
    const options = {
      audience: 'authenticated',
      ...(config.SUPABASE_JWT_ISSUER ? { issuer: config.SUPABASE_JWT_ISSUER } : {}),
    }
    const { payload } = asymmetric
      ? await jwtVerify(accessToken, remoteJwkSet(config.SUPABASE_URL as string), { ...options, algorithms: ASYMMETRIC_ALGORITHMS })
      : await jwtVerify(accessToken, new TextEncoder().encode(config.SUPABASE_JWT_SECRET), { ...options, algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('AUTH_INVALID')
    return payload.sub
  } catch {
    throw new Error('AUTH_INVALID')
  }
}

export async function validateAccessToken(
  adminClient: SupabaseClient,
  accessToken: string,
  config?: TokenVerificationConfig,
): Promise<User> {
  const verifiedSubject = await verifyAccessTokenLocally(accessToken, config)
  const key = tokenCacheKey(accessToken)
  const now = Date.now()
  const expiry = tokenExpiry(accessToken)
  if (expiry != null && expiry <= now) throw new Error('AUTH_INVALID')
  const cached = validationCache.get(key)
  if (cached?.expiresAt && cached.expiresAt > now) {
    if (cached.pending) return cached.pending
    return cached.user
  }

  const validate = adminClient.auth.getUser(accessToken).then(({ data, error }) => {
    if (error || !data.user) throw new Error('AUTH_INVALID')
    if (verifiedSubject && data.user.id !== verifiedSubject) throw new Error('AUTH_INVALID')
    const expiresAt = Math.min(expiry ?? Number.POSITIVE_INFINITY, Date.now() + VALIDATION_CACHE_TTL_MS)
    validationCache.set(key, { user: data.user, expiresAt })
    return data.user
  }).catch((error) => {
    validationCache.delete(key)
    throw error
  })
  validationCache.set(key, { user: cached?.user as User, expiresAt: now + VALIDATION_CACHE_TTL_MS, pending: validate })
  if (validationCache.size > VALIDATION_CACHE_MAX_ENTRIES) {
    const oldest = validationCache.keys().next().value
    if (oldest) validationCache.delete(oldest)
  }
  return validate
}

export async function signIn(publicClient: SupabaseClient, email: string, password: string): Promise<{ user: User; session: Session }> {
  const { data, error } = await publicClient.auth.signInWithPassword({ email, password })
  if (error || !data.user || !data.session) throw new Error('AUTH_INVALID')
  return { user: data.user, session: data.session }
}

export async function refresh(publicClient: SupabaseClient, refreshToken: string): Promise<{ user: User; session: Session }> {
  const { data, error } = await publicClient.auth.refreshSession({ refresh_token: refreshToken })
  if (error || !data.user || !data.session) throw new Error('AUTH_INVALID')
  return { user: data.user, session: data.session }
}

export function safeUser(user: User) {
  return { id: user.id, email: user.email ?? null, role: user.role ?? null, created_at: user.created_at, user_metadata: user.user_metadata ?? {} }
}
