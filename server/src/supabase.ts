import crypto from 'node:crypto'
import { jwtVerify } from 'jose'
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { ApiConfig } from './config.js'

export type SupabaseClients = {
  publicClient: SupabaseClient
  adminClient: SupabaseClient
}

type ValidationCacheEntry = { user: User; expiresAt: number; pending?: Promise<User> }
const validationCache = new Map<string, ValidationCacheEntry>()
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

async function verifyAccessTokenLocally(accessToken: string, config?: Pick<ApiConfig, 'SUPABASE_JWT_SECRET' | 'SUPABASE_JWT_ISSUER'>) {
  if (!config?.SUPABASE_JWT_SECRET) return undefined
  try {
    const options = {
      algorithms: ['HS256'],
      audience: 'authenticated',
      ...(config.SUPABASE_JWT_ISSUER ? { issuer: config.SUPABASE_JWT_ISSUER } : {}),
    }
    const { payload } = await jwtVerify(accessToken, new TextEncoder().encode(config.SUPABASE_JWT_SECRET), options)
    if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('AUTH_INVALID')
    return payload.sub
  } catch {
    throw new Error('AUTH_INVALID')
  }
}

export async function validateAccessToken(
  adminClient: SupabaseClient,
  accessToken: string,
  config?: Pick<ApiConfig, 'SUPABASE_JWT_SECRET' | 'SUPABASE_JWT_ISSUER'>,
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
