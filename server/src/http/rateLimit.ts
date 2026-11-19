import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiConfig } from '../config/config.js'
import { ApiError } from './errors.js'
import { measureRequestPhase } from './context.js'

type RateLimitConfig = Pick<ApiConfig, 'API_RATE_LIMIT_PER_MINUTE' | 'RATE_LIMIT_STORE'>

export interface RateLimitOptions {
  /** Requests allowed per bucket per minute; defaults to API_RATE_LIMIT_PER_MINUTE. */
  limit?: number
  /** Separates this limiter's buckets from other limiters on the same path. */
  scope?: string
  /** Bucket identities for one request; every bucket must have room. */
  identities?: (req: Request) => string[]
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|[A-Za-z0-9_-]{20,})$/i

/** Collapses id-like path segments so `/x/1` and `/x/2` share one bucket. */
export function rateLimitRoute(path: string) {
  return path.split('/').map(segment => ID_SEGMENT.test(segment) ? ':id' : segment).join('/')
}

function defaultIdentities(req: Request) {
  // Signed-in users keep per-path buckets; anonymous callers cannot obtain a
  // fresh allowance by changing an id in the URL.
  return req.user?.id ? [`user:${req.user.id}`] : [`ip:${req.ip ?? 'unknown'}`]
}

/** Per-IP bucket plus a per-email bucket when the JSON body names an account. */
export function ipAndEmailIdentities(req: Request) {
  const identities = [`ip:${req.ip ?? 'unknown'}`]
  const email: unknown = req.body?.email
  if (typeof email === 'string' && email.trim()) identities.push(`email:${email.trim().toLowerCase()}`)
  return identities
}

export function rateLimitMiddleware(config: RateLimitConfig, adminClient: SupabaseClient, options: RateLimitOptions = {}) {
  const memory = new Map<string, { count: number; resetAt: number }>()
  const limit = options.limit ?? config.API_RATE_LIMIT_PER_MINUTE
  const windowSeconds = 60

  async function consume(req: Request, bucketKey: string) {
    if (config.RATE_LIMIT_STORE === 'supabase') {
      const result = await measureRequestPhase(req, 'rate_limit', () => adminClient.rpc('consume_api_rate_limit', { p_bucket_key: bucketKey, p_limit: limit, p_window_seconds: windowSeconds }))
      if (result.error || !result.data) throw new ApiError(503, 'RATE_LIMIT_STORE_UNAVAILABLE', 'Rate limit service is unavailable')
      const row = Array.isArray(result.data) ? result.data[0] : result.data
      if (!row || typeof row.allowed !== 'boolean') throw new ApiError(503, 'RATE_LIMIT_STORE_UNAVAILABLE', 'Rate limit service is unavailable')
      return { allowed: row.allowed as boolean, remaining: Number(row.remaining ?? 0), resetAt: new Date(row.reset_at).getTime() }
    }
    // loadConfig refuses RATE_LIMIT_STORE=memory in production.
    const now = Date.now(); const current = memory.get(bucketKey)
    const nextBucket = !current || current.resetAt <= now ? { count: 1, resetAt: now + windowSeconds * 1000 } : { count: current.count + 1, resetAt: current.resetAt }
    memory.set(bucketKey, nextBucket)
    return { allowed: nextBucket.count <= limit, remaining: Math.max(0, limit - nextBucket.count), resetAt: nextBucket.resetAt }
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const identities = (options.identities ?? defaultIdentities)(req)
      const path = req.user?.id && !options.identities ? req.path : rateLimitRoute(req.path)
      let remaining = limit
      let resetAt = 0
      let allowed = true
      for (const identity of identities) {
        const bucketKey = crypto.createHash('sha256').update(`${options.scope ?? 'api'}:${identity}:${req.method}:${path}`).digest('hex')
        const bucket = await consume(req, bucketKey)
        allowed &&= bucket.allowed
        remaining = Math.min(remaining, bucket.remaining)
        resetAt = Math.max(resetAt, bucket.resetAt)
      }
      res.setHeader('X-RateLimit-Limit', String(limit)); res.setHeader('X-RateLimit-Remaining', String(remaining)); res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
      if (!allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests', undefined, Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)))
      next()
    } catch (error) { next(error) }
  }
}

/** Strict limiter for credential, recovery and pairing endpoints. */
export function authAttemptRateLimit(config: RateLimitConfig & Pick<ApiConfig, 'API_AUTH_RATE_LIMIT_PER_MINUTE'>, adminClient: SupabaseClient, scope: string) {
  return rateLimitMiddleware(config, adminClient, { limit: config.API_AUTH_RATE_LIMIT_PER_MINUTE, scope, identities: ipAndEmailIdentities })
}
