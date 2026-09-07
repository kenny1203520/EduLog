import { serve } from 'https://deno.land/std@0.177.1/http/server.ts'
import { ApiError, type ApiContext, audit, authenticate, beginIdempotency, corsHeaders, emitTelemetry, enforceRateLimit, handleError, requestId, response, traceId } from '../_shared/api.ts'
import { ValidationError } from '../_shared/validation.ts'
import { handleResourceRoutes } from './controllers/resourceController.ts'
import { handleSystemRoutes } from './controllers/systemController.ts'
import { handleTeachingMemberRoutes } from './controllers/teachingMembersController.ts'
import type { RouteHandler } from './controllers/types.ts'
import { OPENAPI } from './openapi.ts'

const routeHandlers: readonly RouteHandler[] = [
  handleSystemRoutes,
  handleTeachingMemberRoutes,
  handleResourceRoutes,
]

function normalizedPath(url: URL) {
  return url.pathname.replace(/^\/api-v1/, '').replace(/^\/api\/v1/, '').replace(/^\/v1/, '') || '/'
}

function routeDomain(path: string): 'system' | 'teaching' {
  return path.startsWith('/roles') || path.startsWith('/permissions') || path.startsWith('/audit-events') ? 'system' : 'teaching'
}

async function dispatch(ctx: ApiContext, req: Request, url: URL, path: string, id: string, headers: HeadersInit) {
  if (path === '/me' && req.method === 'GET') {
    return response({ data: { id: ctx.user.id, email: ctx.user.email, metadata: ctx.user.user_metadata }, meta: null, request_id: id }, 200, id, headers)
  }
  for (const handler of routeHandlers) {
    const result = await handler({ ctx, req, url, path, requestId: id, headers })
    if (result) return result
  }
  throw new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found')
}

serve(async (req) => {
  const id = requestId(req)
  const trace = traceId(req)
  const headers = { ...corsHeaders(req), 'X-Trace-Id': trace }
  const started = performance.now()
  const url = new URL(req.url)
  const path = normalizedPath(url)
  let telemetryOutcome: 'success' | 'denied' | 'failure' = 'success'
  let telemetryStatus = req.method === 'OPTIONS' ? 204 : 200
  let telemetryUserId: string | undefined
  let authenticatedContext: ApiContext | undefined

  try {
    if (req.method === 'OPTIONS') return response(null, 204, id, headers)
    await enforceRateLimit(req, path)
    if (path === '/health' && req.method === 'GET') {
      return response({ data: { status: 'ok', version: '1.0.0' }, meta: null, request_id: id }, 200, id, headers)
    }
    if (path === '/openapi.json' && req.method === 'GET') {
      return response(OPENAPI, 200, id, headers)
    }

    const ctx = await authenticate(req, id, trace, path, started)
    authenticatedContext = ctx
    telemetryUserId = ctx.user.id
    const replay = await beginIdempotency(ctx, req, path)
    if (replay) {
      for (const [name, value] of Object.entries(headers)) replay.headers.set(name, String(value))
      telemetryStatus = replay.status
      return replay
    }

    const result = await dispatch(ctx, req, url, path, id, headers)
    telemetryStatus = result.status
    return result
  } catch (caught) {
    let error: unknown = caught
    if (error instanceof ValidationError) error = new ApiError(400, 'INVALID_QUERY', error.message, error.fields)
    telemetryStatus = error instanceof ApiError ? error.status : 500
    telemetryOutcome = error instanceof ApiError && error.status === 403 ? 'denied' : 'failure'
    if (authenticatedContext) {
      try {
        await audit(authenticatedContext, {
          action: req.method.toLowerCase(),
          domain: routeDomain(path),
          resource: path.split('/')[1] || 'unknown',
          outcome: telemetryOutcome,
          status: telemetryStatus,
        })
      } catch { /* preserve the original response */ }
    }
    return handleError(error, id, trace)
  } finally {
    void emitTelemetry({
      request_id: id,
      trace_id: trace,
      traceparent: req.headers.get('traceparent') ?? undefined,
      user_id: telemetryUserId,
      resource: path.split('/')[1] || undefined,
      route: path,
      method: req.method,
      status: telemetryStatus,
      latency_ms: Math.round(performance.now() - started),
      outcome: telemetryOutcome,
    })
  }
})
