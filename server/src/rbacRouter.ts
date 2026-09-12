import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { sendData } from './response.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './context.js'

const capabilityQuery = z.object({ permission: z.string().trim().min(1).max(200) }).strict()
const policyUpdate = z.object({
  scope: z.object({
    type: z.enum(['system', 'teaching', 'classroom', 'class_session']),
    id: z.string().uuid().nullable().optional(),
  }).strict(),
  policies: z.array(z.object({ role_id: z.string().uuid(), effect: z.enum(['allow', 'deny']) }).strict()).max(500),
}).strict()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

async function authorizePolicyScope(req: Request, scope: z.infer<typeof policyUpdate>['scope']) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: scope.type === 'system' ? 'system' : 'teaching', resource: 'rbac-policies', action: 'manage', scopeId: scope.id ?? null, scopeType: scope.type, permission: scope.type === 'system' ? 'system.roles.manage' : 'teaching.members.manage' })
  if (scope.type === 'system') {
    const result = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'system.roles.manage', p_classroom_id: null, p_class_session_id: null })
    if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage RBAC policies')
    return
  }
  if (!scope.id) throw new ApiError(400, 'INVALID_POLICY_SCOPE', 'A scoped policy requires a scope id')
  if (scope.type === 'teaching') {
    const result = await req.db.rpc('has_teaching_permission', { p_user_id: req.user.id, p_permission_key: 'teaching.members.manage', p_teaching_id: scope.id, p_classroom_id: null, p_class_session_id: null })
    if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage RBAC policies')
    return
  }
  const result = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: 'teaching.members.manage',
    p_classroom_id: scope.type === 'classroom' ? scope.id : null,
    p_class_session_id: scope.type === 'class_session' ? scope.id : null,
  })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage RBAC policies')
}

export function createRbacRouter() {
  const router = Router()

  router.get('/rbac/capability', wrap(async (req, res) => {
    const { permission } = capabilityQuery.parse(req.query)
    if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const { data, error } = await req.db.rpc('resolve_user_permission', {
      p_user_id: req.user.id,
      p_permission_key: permission,
      p_classroom_id: null,
      p_class_session_id: null,
    })
    if (error) throw mapDatabaseError(error)
    const result = Array.isArray(data) ? data[0] : data
    return sendData(req, res, { allowed: Boolean(result?.is_allowed && !result?.is_denied) })
  }))

  router.get('/permissions/:permissionId/policies', wrap(async (req, res) => {
    if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const permissionId = z.string().uuid().parse(req.params.permissionId)
    const permission = await req.db.from('permissions').select('id,key').eq('id', permissionId).maybeSingle()
    if (permission.error) throw mapDatabaseError(permission.error)
    if (!permission.data) throw new ApiError(404, 'NOT_FOUND', 'Permission was not found')
    const result = await req.db.from('role_permission_policies').select('id,role_id,permission_id,scope_type,scope_id,effect,created_at,updated_at').eq('permission_id', permissionId)
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? [], { total: result.data?.length ?? 0, limit: result.data?.length ?? 0, offset: 0, sort: 'created_at' })
  }))

  router.patch('/permissions/:permissionId/policies', wrap(async (req, res) => {
    if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const permissionId = z.string().uuid().parse(req.params.permissionId)
    const input = policyUpdate.parse(req.body)
    const permission = await req.db.from('permissions').select('id,key').eq('id', permissionId).maybeSingle()
    if (permission.error) throw mapDatabaseError(permission.error)
    if (!permission.data) throw new ApiError(404, 'NOT_FOUND', 'Permission was not found')
    await authorizePolicyScope(req, input.scope)
    const replay = await idempotency(req, 200, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const scopeId = input.scope.type === 'system' ? null : input.scope.id ?? null
    const result = await req.db.rpc('replace_role_permission_policies', {
      p_permission_key: permission.data.key,
      p_scope_type: input.scope.type,
      p_scope_id: scopeId,
      p_policies: input.policies,
    })
    if (result.error) throw mapDatabaseError(result.error)
    const body = { data: { permission_id: permissionId, permission_key: permission.data.key, scope: { ...input.scope, id: scopeId }, policies: input.policies }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
    await complete(req, 200, body)
    return res.json(body)
  }))

  return router
}
