import crypto from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiConfig } from './config.js'
import { ApiError } from './errors.js'

export function rateLimitMiddleware(config: ApiConfig, adminClient: SupabaseClient) {
  const memory = new Map<string, { count: number; resetAt: number }>()
  return async (req: Request, res: Response, next: NextFunction) => {
    const identity = req.user?.id ?? req.ip ?? 'anonymous'
    const bucketKey = crypto.createHash('sha256').update(`${identity}:${req.path}`).digest('hex')
    const limit = config.API_RATE_LIMIT_PER_MINUTE
    const windowSeconds = 60
    try {
      let allowed: boolean
      let remaining: number
      let resetAt: number
      if (config.RATE_LIMIT_STORE === 'supabase') {
        const result = await adminClient.rpc('consume_api_rate_limit', { p_bucket_key: bucketKey, p_limit: limit, p_window_seconds: windowSeconds })
        if (result.error || !result.data) throw new ApiError(503, 'RATE_LIMIT_STORE_UNAVAILABLE', 'Rate limit service is unavailable')
        const row = Array.isArray(result.data) ? result.data[0] : result.data
        if (!row || typeof row.allowed !== 'boolean') throw new ApiError(503, 'RATE_LIMIT_STORE_UNAVAILABLE', 'Rate limit service is unavailable')
        allowed = row.allowed; remaining = Number(row.remaining ?? 0); resetAt = new Date(row.reset_at).getTime()
      } else {
        if (config.NODE_ENV === 'production') throw new ApiError(503, 'RATE_LIMIT_STORE_UNAVAILABLE', 'Rate limit service is unavailable')
        const now = Date.now(); const current = memory.get(bucketKey); const nextBucket = !current || current.resetAt <= now ? { count: 1, resetAt: now + 60000 } : { count: current.count + 1, resetAt: current.resetAt }
        memory.set(bucketKey, nextBucket); allowed = nextBucket.count <= limit; remaining = Math.max(0, limit - nextBucket.count); resetAt = nextBucket.resetAt
      }
      res.setHeader('X-RateLimit-Limit', String(limit)); res.setHeader('X-RateLimit-Remaining', String(remaining)); res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)))
      if (!allowed) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests', undefined, Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)))
      next()
    } catch (error) { next(error) }
  }
}

