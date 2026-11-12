import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import pino from 'pino'
import { auditRequest } from './audit.js'

declare global {
  namespace Express {
    interface Request {
      requestId: string
      traceId: string
      traceparent?: string
      startedAt: number
      auditContext?: {
        domain?: string
        action?: string
        resource?: string
        resourceId?: string | null
        teachingId?: string | null
        scopeId?: string | null
        scopeType?: string | null
        permission?: string | null
        errorCode?: string | null
        authorizationStage?: string | null
        authorizationResult?: 'allowed' | 'denied' | 'rpc_error' | 'check_failed' | null
        /** Additional route-owned identifiers for auditable business operations. */
        metadata?: Record<string, string | number | boolean | null>
      }
      user?: { id: string; email?: string; role?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }
      accessToken?: string
      /** Set by requireAuth; 'pending' only on routes that allow it. */
      accountStatus?: 'active' | 'pending'
      extensionPrincipal?: { tokenId: string; userId: string; extensionOrigin: string; connection: { installation_id: string | null; device_name: string | null; browser_name: string | null; platform_name: string | null; extension_version: string | null } }
      db?: import('@supabase/supabase-js').SupabaseClient
      adminDb?: import('@supabase/supabase-js').SupabaseClient
      performancePhases?: Record<string, number>
      databaseCalls?: number
      cacheStatus?: 'hit' | 'miss' | 'bypass'
      log: pino.Logger
    }
  }
}

export function setAuditContext(req: Request, patch: NonNullable<Request['auditContext']>) {
  req.auditContext = { ...(req.auditContext ?? {}), ...patch }
}

export async function measureRequestPhase<T>(req: Request, phase: string, work: () => PromiseLike<T>): Promise<T> {
  const startedAt = performance.now()
  try {
    return await work()
  } finally {
    req.performancePhases ??= {}
    req.performancePhases[phase] = (req.performancePhases[phase] ?? 0) + performance.now() - startedAt
  }
}

export function measureRequestPhaseSync<T>(req: Request, phase: string, work: () => T): T {
  const startedAt = performance.now()
  try {
    return work()
  } finally {
    req.performancePhases ??= {}
    req.performancePhases[phase] = (req.performancePhases[phase] ?? 0) + performance.now() - startedAt
  }
}

export function recordDatabaseCall(req: Request) {
  req.databaseCalls = (req.databaseCalls ?? 0) + 1
}

function serverTiming(req: Request) {
  const phases = Object.entries(req.performancePhases ?? {})
    .filter(([name, duration]) => /^[a-z_]+$/i.test(name) && Number.isFinite(duration))
    .map(([name, duration]) => `${name};dur=${duration.toFixed(1)}`)
  phases.push(`total;dur=${Math.max(0, performance.now() - req.startedAt).toFixed(1)}`)
  return phases.join(', ')
}

export function requestContext(logger: pino.Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const supplied = req.header('x-request-id')?.trim()
    req.requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : `edulog-${crypto.randomUUID()}`
    const suppliedTraceparent = req.header('traceparent')?.trim()
    req.traceparent = suppliedTraceparent && /^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(suppliedTraceparent) ? suppliedTraceparent : undefined
    req.traceId = req.traceparent?.split('-')[1] ?? crypto.randomBytes(16).toString('hex')
    req.startedAt = performance.now()
    req.performancePhases = {}
    req.databaseCalls = 0
    req.cacheStatus = 'bypass'
    const params = req.params as Record<string, unknown>
    req.auditContext = {
      resource: req.path.split('/').filter(Boolean)[1] ?? 'unknown',
      resourceId: typeof params.id === 'string' ? params.id : typeof params.userId === 'string' ? params.userId : null,
      teachingId: null,
      scopeId: null,
      scopeType: null,
    }
    req.log = logger.child({ request_id: req.requestId, trace_id: req.traceId, route: req.path, method: req.method })
    res.setHeader('X-Request-Id', req.requestId)
    res.setHeader('X-Trace-Id', req.traceId)
    const writeHead = res.writeHead.bind(res)
    res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
      if (!res.headersSent) res.setHeader('Server-Timing', serverTiming(req))
      return writeHead(...args)
    }) as Response['writeHead']
    res.on('finish', () => {
      const outcome = res.statusCode >= 500 ? 'failure' : res.statusCode >= 400 ? 'denied' : 'success'
      const payload = res.getHeader('content-length')
      req.log.info({ status: res.statusCode, latency_ms: Math.round(performance.now() - req.startedAt), outcome, database_calls: req.databaseCalls ?? 0, payload_bytes: typeof payload === 'string' ? Number(payload) : undefined, cache_status: req.cacheStatus ?? 'bypass' }, 'api_request')
      void auditRequest(req, res.statusCode).catch((error) => {
        req.log.error({ err: error }, 'audit_request_failed')
      })
    })
    next()
  }
}
