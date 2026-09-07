import type { SupabaseClient } from '@supabase/supabase-js'
import type { Request } from 'express'

export function auditRequest(req: Request, status: number) {
  if (!req.adminDb || !req.user || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return
  const segments = req.path.split('/').filter(Boolean)
  const resource = segments[1] ?? 'unknown'
  const outcome = status >= 500 ? 'failure' : status >= 400 ? 'denied' : 'success'
  const domain = ['roles', 'permissions', 'audit-events', 'users'].includes(resource) ? 'system' : 'teaching'
  const event = { actor_user_id: req.user.id, action: req.method.toLowerCase(), domain, resource, resource_id: segments[2] ?? null, scope_id: null, request_id: req.requestId, outcome, metadata: { user_id: req.user.id, teaching_id: null, resource, route: req.path, method: req.method, status, latency_ms: Math.round(performance.now() - req.startedAt), request_id: req.requestId, trace_id: req.traceId, outcome } }
  void insertAudit(req.adminDb, event)
}

async function insertAudit(client: SupabaseClient, event: Record<string, unknown>) {
  const { error } = await client.from('audit_events').insert(event)
  if (error) console.error(JSON.stringify({ type: 'audit_write_failed', outcome: 'failure', code: 'AUDIT_WRITE_FAILED' }))
}

