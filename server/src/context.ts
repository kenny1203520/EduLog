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
      }
      user?: { id: string; email?: string; role?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }
      accessToken?: string
      db?: import('@supabase/supabase-js').SupabaseClient
      adminDb?: import('@supabase/supabase-js').SupabaseClient
      log: pino.Logger
    }
  }
}

export function setAuditContext(req: Request, patch: NonNullable<Request['auditContext']>) {
  req.auditContext = { ...(req.auditContext ?? {}), ...patch }
}

export function requestContext(logger: pino.Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const supplied = req.header('x-request-id')?.trim()
    req.requestId = supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : `edulog-${crypto.randomUUID()}`
    const suppliedTraceparent = req.header('traceparent')?.trim()
    req.traceparent = suppliedTraceparent && /^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(suppliedTraceparent) ? suppliedTraceparent : undefined
    req.traceId = req.traceparent?.split('-')[1] ?? crypto.randomBytes(16).toString('hex')
    req.startedAt = performance.now()
    const params = req.params as Record<string, unknown>
    req.auditContext = {
      resource: req.path.split('/').filter(Boolean)[1] ?? 'unknown',
      resourceId: typeof params.id === 'string' ? params.id : typeof params.userId === 'string' ? params.userId : null,
      teachingId: typeof params.teachingId === 'string' ? params.teachingId : null,
        scopeId: typeof params.teachingId === 'string' ? params.teachingId : null,
        scopeType: typeof params.teachingId === 'string' ? 'teaching' : null,
    }
    req.log = logger.child({ request_id: req.requestId, trace_id: req.traceId, route: req.path, method: req.method })
    res.setHeader('X-Request-Id', req.requestId)
    res.setHeader('X-Trace-Id', req.traceId)
    res.on('finish', () => {
      const outcome = res.statusCode >= 500 ? 'failure' : res.statusCode >= 400 ? 'denied' : 'success'
      req.log.info({ status: res.statusCode, latency_ms: Math.round(performance.now() - req.startedAt), outcome }, 'api_request')
      auditRequest(req, res.statusCode)
    })
    next()
  }
}
