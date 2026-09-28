import type { SupabaseClient } from '@supabase/supabase-js'
import type { Request } from 'express'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function safeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null
}

export function auditRequest(req: Request, status: number) {
  if (!req.adminDb || !req.user || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return Promise.resolve()
  const segments = req.path.split('/').filter(Boolean)
  const resource = req.auditContext?.resource ?? segments[1] ?? 'unknown'
  const outcome = status >= 500 ? 'failure' : status >= 400 ? 'denied' : 'success'
  const domain = ['roles', 'permissions', 'audit-events', 'users'].includes(resource) ? 'system' : 'teaching'
  // Only explicit route context may identify a resource.  Guessing from URL
  // segments turns teaching/session scope ids into resource ids and produces
  // misleading audit records.
  const resourceId = safeUuid(req.auditContext?.resourceId)
  const teachingId = safeUuid(req.auditContext?.teachingId)
    ?? (resource === 'teachings' ? safeUuid(segments[2]) : null)
  const scopeId = safeUuid(req.auditContext?.scopeId)
  const scopeType = req.auditContext?.scopeType ?? null
  const event = { actor_user_id: req.user.id, action: req.auditContext?.action ?? req.method.toLowerCase(), domain: req.auditContext?.domain ?? domain, resource, resource_id: resourceId, scope_id: scopeId, request_id: req.requestId, outcome, metadata: { user_id: req.user.id, teaching_id: teachingId, resource, resource_id: resourceId, scope_type: scopeType, scope_id: scopeId, permission: req.auditContext?.permission ?? null, authorization_stage: req.auditContext?.authorizationStage ?? null, authorization_result: req.auditContext?.authorizationResult ?? null, error_code: req.auditContext?.errorCode ?? null, route: req.route?.path ?? req.path, method: req.method, status, latency_ms: Math.round(performance.now() - req.startedAt), request_id: req.requestId, trace_id: req.traceId, outcome } }
  return insertAudit(req.adminDb, event, req)
}

async function insertAudit(client: SupabaseClient, event: Record<string, unknown>, req: Request) {
  try {
    const { error } = await client.from('audit_events').insert(event)
    if (error) req.log.error({ type: 'audit_write_failed', outcome: 'failure', code: 'AUDIT_WRITE_FAILED', request_id: req.requestId, trace_id: req.traceId }, 'audit_write_failed')
  } catch {
    req.log.error({ type: 'audit_write_failed', outcome: 'failure', code: 'AUDIT_WRITE_FAILED', request_id: req.requestId, trace_id: req.traceId }, 'audit_write_failed')
  }
}
