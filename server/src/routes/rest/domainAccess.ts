import type { Request } from 'express'
import { z } from 'zod'
import { ApiError } from '../../http/errors.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationDecision } from '../../auth/authorization.js'

// Shared by the occurrence, report, enrollment, teacher and copy-template
// workflow routes.
export const uuid = z.string().uuid()

export function envelope(req: Request, data: unknown, meta: Record<string, unknown> = {}) {
  return { data, meta, request_id: req.requestId, trace_id: req.traceId }
}

/** Checks a permission at platform or class-session scope via has_api_permission. */
export async function permission(req: Request, key: string, sessionId?: string | null) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const result = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: key,
    p_classroom_id: null,
    p_class_session_id: sessionId ?? null,
  })
  setAuditContext(req, { domain: 'teaching', permission: key, action: key.split('.').at(-1) ?? 'read', scopeId: sessionId ?? null, scopeType: sessionId ? 'class_session' : null })
  requireAuthorizationDecision(req, result, { permission: key, stage: 'domain_route_permission', message: 'You do not have permission to access this resource', scopeId: sessionId ?? null, scopeType: sessionId ? 'class_session' : null })
}
