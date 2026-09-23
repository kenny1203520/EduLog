import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { sendData } from './response.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './context.js'
import { clearUserValidation } from './supabase.js'
import { hasOverlappingSystemRoleAssignment } from './systemRoleAssignmentPolicy.js'

const uuid = z.string().uuid()
const nullableUuid = uuid.nullable().optional()
const roleDomain = z.enum(['system', 'teaching'])
const roleListQuery = z.object({
  domain: roleDomain.default('teaching'), teaching_id: uuid.optional(),
  scope_type: z.enum(['system', 'teaching', 'classroom', 'class_session']).optional(), scope_id: nullableUuid,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['name', '-name', 'sort_order', '-sort_order', 'created_at', '-created_at']).default('sort_order'),
}).strict()
const roleCreate = z.object({
  domain: roleDomain, teaching_id: nullableUuid,
  code: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/).nullable().optional(),
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable().optional(),
  parent_role_id: nullableUuid, expected_epoch: z.coerce.number().int().positive(),
}).strict()
const roleUpdate = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/).nullable().optional(),
  name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable().optional(), expected_epoch: z.coerce.number().int().positive(),
}).strict()
const roleDelete = z.object({ expected_epoch: z.coerce.number().int().positive() }).strict()
const capabilityQuery = z.object({
  permission: z.string().trim().min(1).max(200), teaching_id: uuid.optional(), classroom_id: uuid.optional(), class_session_id: uuid.optional(),
}).strict().refine((query) => Number(Boolean(query.teaching_id)) + Number(Boolean(query.classroom_id)) + Number(Boolean(query.class_session_id)) <= 1)
const capabilitiesQuery = z.object({ teaching_id: uuid.optional() }).strict()
const roleScopeQuery = z.object({ scope_type: z.enum(['system', 'teaching', 'classroom', 'class_session']), scope_id: nullableUuid }).strict()
const roleParentUpdate = z.object({ parent_role_id: nullableUuid, expected_epoch: z.coerce.number().int().positive() }).strict()
const rolePolicyUpdate = z.object({
  scope_type: z.enum(['system', 'teaching', 'classroom', 'class_session']), scope_id: nullableUuid,
  expected_epoch: z.coerce.number().int().positive(),
  policies: z.array(z.object({ permission_id: uuid, effect: z.enum(['allow', 'deny']) }).strict()).max(1000),
}).strict()
const policyUpdate = z.object({
  scope: z.object({ type: z.enum(['system', 'teaching', 'classroom', 'class_session']), id: nullableUuid }).strict(),
  policies: z.array(z.object({ role_id: uuid, effect: z.enum(['allow', 'deny']) }).strict()).max(500),
}).strict()
const assignmentListQuery = z.object({
  user_id: uuid.optional(), role_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  sort: z.enum(['created_at', '-created_at', 'effective_from', '-effective_from']).default('-created_at'),
}).strict()
const assignmentMutation = z.object({ user_id: uuid, role_id: uuid, effective_from: z.string().date().optional(), effective_to: z.string().date().nullable().optional(), expected_epoch: z.coerce.number().int().positive() }).strict()
const assignmentDelete = z.object({ expected_epoch: z.coerce.number().int().positive() }).strict()
const userStatusMutation = z.object({ status: z.enum(['active', 'disabled']), reason: z.string().trim().min(3).max(500).nullable().optional(), expected_epoch: z.coerce.number().int().positive() }).strict()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

function requireRequest(req: Request) {
  if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
}

async function rpcBoolean(req: Request, name: string, args: Record<string, unknown>) {
  requireRequest(req)
  const result = await req.db!.rpc(name, args)
  if (result.error) throw mapDatabaseError(result.error)
  return result.data === true
}

async function authorizeRoleDomain(req: Request, domain: 'system' | 'teaching', teachingId: string | null | undefined, action: 'read' | 'manage' = 'manage') {
  if (domain === 'system') {
    const allowed = await rpcBoolean(req, 'has_system_permission', { p_user_id: req.user!.id, p_permission_key: `system.roles.${action}` })
      || (action === 'read' && await rpcBoolean(req, 'has_system_permission', { p_user_id: req.user!.id, p_permission_key: 'system.roles.manage' }))
    if (!allowed) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage system roles')
    return
  }
  if (teachingId) {
    const args = { p_user_id: req.user!.id, p_teaching_id: teachingId, p_classroom_id: null, p_class_session_id: null }
    const allowed = await rpcBoolean(req, 'has_teaching_permission', { ...args, p_permission_key: `teaching.roles.${action}` })
      || (action === 'read' && await rpcBoolean(req, 'has_teaching_permission', { ...args, p_permission_key: 'teaching.roles.manage' }))
    if (!allowed) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage teaching roles')
    return
  }
  const allowed = await rpcBoolean(req, 'has_api_permission', { p_user_id: req.user!.id, p_permission_key: `teaching.roles.${action}`, p_classroom_id: null, p_class_session_id: null })
  if (!allowed) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to read teaching roles')
}

async function authorizeRoleScope(req: Request, domain: 'system' | 'teaching', scope: { type: 'system' | 'teaching' | 'classroom' | 'class_session'; id?: string | null }, action: 'read' | 'manage') {
  if (domain === 'system') return authorizeRoleDomain(req, domain, null, action)
  if (scope.type === 'system') throw new ApiError(400, 'INVALID_POLICY_SCOPE', 'System policies are reserved for system roles')
  if (scope.type === 'teaching' && !scope.id) {
    const allowed = await rpcBoolean(req, 'has_system_permission', { p_user_id: req.user!.id, p_permission_key: 'system.roles.manage' })
    if (!allowed) throw new ApiError(403, 'PERMISSION_DENIED', 'Global teaching role policies require system role management permission')
    return
  }
  if (!scope.id) throw new ApiError(400, 'INVALID_POLICY_SCOPE', 'A scoped policy requires a scope id')
  if (scope.type === 'teaching') return authorizeRoleDomain(req, 'teaching', scope.id, action)
  const allowed = await rpcBoolean(req, 'has_api_permission', {
    p_user_id: req.user!.id,
    p_permission_key: `teaching.roles.${action}`,
    p_classroom_id: scope.type === 'classroom' ? scope.id : null,
    p_class_session_id: scope.type === 'class_session' ? scope.id : null,
  }) || (action === 'read' && await rpcBoolean(req, 'has_api_permission', {
    p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage',
    p_classroom_id: scope.type === 'classroom' ? scope.id : null,
    p_class_session_id: scope.type === 'class_session' ? scope.id : null,
  }))
  if (!allowed) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to read or manage teaching roles in this scope')
}

async function roleById(req: Request, id: string) {
  requireRequest(req)
  const result = await req.db!.from('roles').select('id,code,name,description,domain,teaching_id,is_builtin,is_protected,is_system,sort_order,created_at,updated_at').eq('id', id).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Role was not found')
  return result.data
}

async function authorizePolicyScope(req: Request, scope: z.infer<typeof policyUpdate>['scope']) {
  requireRequest(req)
  setAuditContext(req, { domain: scope.type === 'system' ? 'system' : 'teaching', resource: 'rbac-policies', action: 'manage', scopeId: scope.id ?? null, scopeType: scope.type, permission: scope.type === 'system' ? 'system.roles.manage' : 'teaching.roles.manage' })
  if (scope.type === 'system') {
    if (!await rpcBoolean(req, 'has_system_permission', { p_user_id: req.user!.id, p_permission_key: 'system.roles.manage' })) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage RBAC policies')
    return
  }
  if (!scope.id) throw new ApiError(400, 'INVALID_POLICY_SCOPE', 'A scoped policy requires a scope id')
  const result = scope.type === 'teaching'
    ? await req.db!.rpc('has_teaching_permission', { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_teaching_id: scope.id, p_classroom_id: null, p_class_session_id: null })
    : await req.db!.rpc('has_api_permission', { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_classroom_id: scope.type === 'classroom' ? scope.id : null, p_class_session_id: scope.type === 'class_session' ? scope.id : null })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage RBAC policies')
}

export function createRbacRouter() {
  const router = Router()

  router.get('/pages/settings/overview', wrap(async (req, res) => {
    requireRequest(req)
    const teachingId = typeof req.query.teaching_id === 'string' ? uuid.parse(req.query.teaching_id) : null
    const [preferences, teachings, capabilities] = await Promise.all([
      req.db!.from('user_preferences').select('time_zone,editor_settings,created_at,updated_at').eq('user_id', req.user!.id).maybeSingle(),
      req.db!.from('teachings').select('id,name,owner_user_id').order('name'),
      req.db!.rpc('get_rbac_capabilities', { p_teaching_id: teachingId }),
    ])
    if (preferences.error) throw mapDatabaseError(preferences.error)
    if (teachings.error) throw mapDatabaseError(teachings.error)
    if (capabilities.error) throw mapDatabaseError(capabilities.error)
    const caps = (capabilities.data ?? {}) as Record<string, unknown>
    const system = (caps.system ?? {}) as Record<string, unknown>
    const teaching = (caps.teaching ?? {}) as Record<string, unknown>
    return sendData(req, res, {
      preferences: preferences.data, teachings: teachings.data ?? [], capabilities: caps,
      tabs: {
        personal: true,
        teaching: Boolean(teaching.members_manage || teaching.roles_manage || teaching.permissions_read),
        system: Boolean(system.users_manage || system.roles_manage || system.assignments_manage || system.permissions_read || system.audit_read || system.is_owner),
      },
      sections: { teaching: { members: Boolean(teaching.members_manage), roles: Boolean(teaching.roles_manage), permissions: Boolean(teaching.permissions_read) }, system },
    })
  }))

  router.get('/rbac/capability', wrap(async (req, res) => {
    const query = capabilityQuery.parse(req.query); requireRequest(req)
    const result = query.teaching_id
      ? await req.db!.rpc('has_teaching_permission', { p_user_id: req.user!.id, p_permission_key: query.permission, p_teaching_id: query.teaching_id, p_classroom_id: null, p_class_session_id: null })
      : await req.db!.rpc('has_api_permission', { p_user_id: req.user!.id, p_permission_key: query.permission, p_classroom_id: query.classroom_id ?? null, p_class_session_id: query.class_session_id ?? null })
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, { allowed: result.data === true })
  }))

  router.get('/rbac/scoped-capability', wrap(async (req, res) => {
    const query = roleScopeQuery.parse(req.query); requireRequest(req)
    if (query.scope_type === 'system' || (query.scope_type === 'teaching' && !query.scope_id)) {
      const allowed = await rpcBoolean(req, 'has_system_permission', { p_user_id: req.user!.id, p_permission_key: 'system.roles.manage' })
      return sendData(req, res, { allowed })
    }
    if (!query.scope_id) throw new ApiError(400, 'INVALID_POLICY_SCOPE', 'A scoped policy requires a scope id')
    const allowed = query.scope_type === 'teaching'
      ? await rpcBoolean(req, 'has_teaching_permission', { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_teaching_id: query.scope_id, p_classroom_id: null, p_class_session_id: null })
      : await rpcBoolean(req, 'has_api_permission', { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_classroom_id: query.scope_type === 'classroom' ? query.scope_id : null, p_class_session_id: query.scope_type === 'class_session' ? query.scope_id : null })
    return sendData(req, res, { allowed })
  }))

  router.get('/rbac/capabilities', wrap(async (req, res) => {
    const query = capabilitiesQuery.parse(req.query); requireRequest(req)
    const result = await req.db!.rpc('get_rbac_capabilities', { p_teaching_id: query.teaching_id ?? null })
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? {})
  }))

  router.get('/roles', wrap(async (req, res) => {
    const query = roleListQuery.parse(req.query)
    if (query.domain === 'teaching' && query.scope_type) await authorizeRoleScope(req, query.domain, { type: query.scope_type, id: query.scope_id }, 'read')
    else await authorizeRoleDomain(req, query.domain, query.teaching_id, 'read')
    const sort = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
    let builder = req.db!.from('roles').select('id,code,name,description,domain,teaching_id,is_builtin,is_protected,is_system,sort_order,created_at,updated_at', { count: 'exact' }).eq('domain', query.domain)
    if (query.domain === 'teaching' && query.teaching_id) builder = builder.or(`is_builtin.eq.true,teaching_id.eq.${query.teaching_id}`)
    else if (query.domain === 'teaching' && query.scope_type === 'teaching' && !query.scope_id) builder = builder.is('teaching_id', null)
    if (query.search) {
      const search = query.search.replace(/[%_,()]/g, '')
      builder = builder.or(`name.ilike.%${search}%,code.ilike.%${search}%`)
    }
    const result = await builder.order(sort, { ascending: !query.sort.startsWith('-') }).range(query.offset, query.offset + query.limit - 1)
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? [], { limit: query.limit, offset: query.offset, total: result.count ?? 0, sort: query.sort })
  }))

  router.post('/roles', wrap(async (req, res) => {
    const input = roleCreate.parse(req.body)
    await authorizeRoleDomain(req, input.domain, input.teaching_id, 'manage')
    setAuditContext(req, { domain: input.domain, resource: 'roles', action: 'create', teachingId: input.teaching_id ?? null, scopeId: input.teaching_id ?? null, scopeType: input.domain === 'system' ? 'system' : 'teaching', permission: `${input.domain}.roles.manage` })
    const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_create_role', { p_domain: input.domain, p_teaching_id: input.teaching_id ?? null, p_code: input.code ?? null, p_name: input.name, p_description: input.description ?? null, p_parent_role_id: input.parent_role_id ?? null, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, body); return res.status(201).json(body)
  }))

  router.get('/roles/:id', wrap(async (req, res) => {
    const role = await roleById(req, uuid.parse(req.params.id))
    await authorizeRoleDomain(req, role.domain as 'system' | 'teaching', role.teaching_id as string | null, 'read')
    return sendData(req, res, role)
  }))

  router.patch('/roles/:id', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id); const input = roleUpdate.parse(req.body); const role = await roleById(req, id)
    await authorizeRoleDomain(req, role.domain as 'system' | 'teaching', role.teaching_id as string | null, 'manage')
    setAuditContext(req, { domain: role.domain as string, resource: 'roles', resourceId: id, action: 'update', teachingId: role.teaching_id as string | null, permission: `${role.domain}.roles.manage` })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_update_role', { p_role_id: id, p_name: input.name, p_description: input.description ?? null, p_code: input.code ?? role.code ?? null, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }))

  router.delete('/roles/:id', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id); const input = roleDelete.parse(req.body); const role = await roleById(req, id)
    await authorizeRoleDomain(req, role.domain as 'system' | 'teaching', role.teaching_id as string | null, 'manage')
    setAuditContext(req, { domain: role.domain as string, resource: 'roles', resourceId: id, action: 'delete', teachingId: role.teaching_id as string | null, permission: `${role.domain}.roles.manage` })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_delete_role', { p_role_id: id, p_expected_epoch: input.expected_epoch }); if (result.error) throw mapDatabaseError(result.error)
    const body = { data: { id, deleted: true }, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }))

  router.get('/roles/:id/parent', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id); const role = await roleById(req, id)
    await authorizeRoleDomain(req, role.domain as 'system' | 'teaching', role.teaching_id as string | null, 'read')
    const result = await req.db!.from('role_inheritance').select('role_id,parent_role_id,created_at').eq('role_id', id).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? { role_id: id, parent_role_id: null })
  }))

  router.put('/roles/:id/parent', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id); const input = roleParentUpdate.parse(req.body); const role = await roleById(req, id)
    await authorizeRoleDomain(req, role.domain as 'system' | 'teaching', role.teaching_id as string | null, 'manage')
    setAuditContext(req, { domain: role.domain as string, resource: 'role-inheritance', resourceId: id, action: 'replace', teachingId: role.teaching_id as string | null, scopeId: role.teaching_id as string | null, scopeType: role.domain === 'system' ? 'system' : 'teaching', permission: `${role.domain}.roles.manage` })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_set_role_parent', { p_role_id: id, p_parent_role_id: input.parent_role_id ?? null, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    const body = { data: { role_id: id, parent_role_id: input.parent_role_id ?? null, epoch: result.data }, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }))

  router.get('/roles/:id/permissions', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id); const query = roleScopeQuery.parse(req.query); const role = await roleById(req, id)
    await authorizeRoleScope(req, role.domain as 'system' | 'teaching', { type: query.scope_type, id: query.scope_id }, 'read')
    const result = await req.db!.rpc('rbac_get_role_permissions', { p_role_id: id, p_scope_type: query.scope_type, p_scope_id: query.scope_id ?? null })
    if (result.error) throw mapDatabaseError(result.error)
    const rows = result.data ?? []
    return sendData(req, res, rows, { total: rows.length, epoch: rows[0]?.epoch ?? null })
  }))

  router.put('/roles/:id/permissions', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id); const input = rolePolicyUpdate.parse(req.body); const role = await roleById(req, id)
    await authorizeRoleScope(req, role.domain as 'system' | 'teaching', { type: input.scope_type, id: input.scope_id }, 'manage')
    setAuditContext(req, { domain: role.domain as string, resource: 'role-permissions', resourceId: id, action: 'replace', teachingId: input.scope_type === 'teaching' ? input.scope_id ?? null : null, scopeId: input.scope_id ?? null, scopeType: input.scope_type, permission: `${role.domain}.roles.manage` })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_replace_role_permissions', { p_role_id: id, p_scope_type: input.scope_type, p_scope_id: input.scope_id ?? null, p_expected_epoch: input.expected_epoch, p_policies: input.policies })
    if (result.error) throw mapDatabaseError(result.error)
    const body = { data: { role_id: id, scope_type: input.scope_type, scope_id: input.scope_id ?? null, epoch: result.data }, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }))

  router.get('/rbac/effective-permissions', wrap(async (req, res) => {
    const roleId = uuid.parse(req.query.role_id); const query = roleScopeQuery.parse({ scope_type: req.query.scope_type, scope_id: req.query.scope_id })
    const role = await roleById(req, roleId)
    await authorizeRoleDomain(req, role.domain as 'system' | 'teaching', query.scope_id ?? role.teaching_id as string | null, 'read')
    const result = await req.db!.rpc('rbac_get_role_permissions', { p_role_id: roleId, p_scope_type: query.scope_type, p_scope_id: query.scope_id ?? null })
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? [], { total: result.data?.length ?? 0, epoch: result.data?.[0]?.epoch ?? null })
  }))

  router.get('/system-role-assignments', wrap(async (req, res) => {
    requireRequest(req); const query = assignmentListQuery.parse(req.query)
    const canRead = await rpcBoolean(req, 'has_system_permission', { p_user_id: req.user!.id, p_permission_key: 'system.role_assignments.read' }) || await rpcBoolean(req, 'has_system_permission', { p_user_id: req.user!.id, p_permission_key: 'system.role_assignments.manage' })
    if (!canRead) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to read system role assignments')
    const sort = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
    let builder = req.db!.from('user_role_assignments').select('id,user_id,role_id,scope_type,scope_id,effective_from,effective_to,created_at,updated_at,roles(id,code,name,domain,is_protected)', { count: 'exact' }).eq('scope_type', 'system')
    if (query.user_id) builder = builder.eq('user_id', query.user_id); if (query.role_id) builder = builder.eq('role_id', query.role_id)
    const result = await builder.order(sort, { ascending: !query.sort.startsWith('-') }).range(query.offset, query.offset + query.limit - 1)
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? [], { limit: query.limit, offset: query.offset, total: result.count ?? 0, sort: query.sort })
  }))

  const mutateAssignment = async (req: Request, res: Response) => {
    requireRequest(req); const input = assignmentMutation.parse(req.body); const assignmentId = req.params.id ? uuid.parse(req.params.id) : null
    setAuditContext(req, { domain: 'system', resource: 'role-assignments', resourceId: assignmentId, action: assignmentId ? 'update' : 'create', permission: 'system.role_assignments.manage' })
    const replay = await idempotency(req, assignmentId ? 200 : 201, null); if (replay) return res.status(replay.status).json(replay.body)
    let previous: { effective_from: string; effective_to: string | null } | null = null
    if (assignmentId) {
      const current = await req.db!.from('user_role_assignments').select('effective_from,effective_to').eq('id', assignmentId).eq('scope_type', 'system').maybeSingle()
      if (current.error) throw mapDatabaseError(current.error)
      previous = current.data
    }
    const effectiveFrom = input.effective_from ?? previous?.effective_from ?? new Date().toISOString().slice(0, 10)
    const effectiveTo = input.effective_to === undefined ? previous?.effective_to ?? null : input.effective_to
    if (effectiveTo && effectiveTo < effectiveFrom) throw new ApiError(422, 'INVALID_DATE_RANGE', 'The end date must not be before the start date')
    const existingResult = await req.db!.from('user_role_assignments')
      .select('id,user_id,role_id,effective_from,effective_to')
      .eq('scope_type', 'system').eq('user_id', input.user_id).eq('role_id', input.role_id)
    if (existingResult.error) throw mapDatabaseError(existingResult.error)
    const overlaps = hasOverlappingSystemRoleAssignment(existingResult.data ?? [], input.user_id, input.role_id, effectiveFrom, effectiveTo, assignmentId)
    if (overlaps) throw new ApiError(409, 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP', 'The user already has this system role during an overlapping date range')
    const result = await req.db!.rpc('rbac_upsert_system_assignment', { p_assignment_id: assignmentId, p_user_id: input.user_id, p_role_id: input.role_id, p_effective_from: effectiveFrom, p_effective_to: effectiveTo, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    const status = assignmentId ? 200 : 201; const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, status, body); return res.status(status).json(body)
  }
  router.post('/system-role-assignments', wrap(mutateAssignment))
  router.patch('/system-role-assignments/:id', wrap(mutateAssignment))
  router.delete('/system-role-assignments/:id', wrap(async (req, res) => {
    requireRequest(req); const id = uuid.parse(req.params.id); const input = assignmentDelete.parse(req.body)
    setAuditContext(req, { domain: 'system', resource: 'role-assignments', resourceId: id, action: 'delete', permission: 'system.role_assignments.manage' })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_delete_system_assignment', { p_assignment_id: id, p_expected_epoch: input.expected_epoch }); if (result.error) throw mapDatabaseError(result.error)
    const body = { data: { id, deleted: true }, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }))

  router.patch('/users/:id/status', wrap(async (req, res) => {
    requireRequest(req); const userId = uuid.parse(req.params.id); const input = userStatusMutation.parse(req.body)
    setAuditContext(req, { domain: 'system', resource: 'users', resourceId: userId, action: 'status', permission: 'system.users.manage' })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    // The profile read remains on the caller's JWT/RLS client. The
    // service-role client is used only for the Auth ban/unban operation.
    const previous = await req.db!.from('profiles').select('account_status').eq('id', userId).maybeSingle()
    if (previous.error) throw mapDatabaseError(previous.error); if (!previous.data) throw new ApiError(404, 'NOT_FOUND', 'User was not found')
    const authResult = await req.adminDb!.auth.admin.updateUserById(userId, { ban_duration: input.status === 'disabled' ? '876000h' : 'none' })
    if (authResult.error) throw new ApiError(503, 'AUTH_ADMIN_UNAVAILABLE', 'The account status could not be updated')
    const result = await req.db!.rpc('set_system_user_status', { p_user_id: userId, p_status: input.status, p_reason: input.status === 'disabled' ? input.reason ?? null : null, p_expected_epoch: input.expected_epoch })
    if (result.error) {
      await req.adminDb!.auth.admin.updateUserById(userId, { ban_duration: previous.data.account_status === 'disabled' ? '876000h' : 'none' }).catch(() => undefined)
      throw mapDatabaseError(result.error)
    }
    clearUserValidation(userId)
    const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
  }))

  // Deprecated permission-centric adapter. New clients save a complete role
  // matrix through PUT /roles/:id/permissions.
  router.get('/permissions/:permissionId/policies', wrap(async (req, res) => {
    requireRequest(req); res.setHeader('Deprecation', 'true'); res.setHeader('Link', '</api/roles/{id}/permissions>; rel="successor-version"')
    const permissionId = uuid.parse(req.params.permissionId)
    const result = await req.db!.from('role_permission_policies').select('id,role_id,permission_id,scope_type,scope_id,effect,created_at,updated_at').eq('permission_id', permissionId)
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? [], { total: result.data?.length ?? 0, limit: result.data?.length ?? 0, offset: 0, sort: 'created_at' })
  }))

  router.patch('/permissions/:permissionId/policies', wrap(async (req, res) => {
    requireRequest(req); res.setHeader('Deprecation', 'true'); res.setHeader('Link', '</api/roles/{id}/permissions>; rel="successor-version"')
    const permissionId = uuid.parse(req.params.permissionId); const input = policyUpdate.parse(req.body)
    const permission = await req.db!.from('permissions').select('id,key').eq('id', permissionId).maybeSingle()
    if (permission.error) throw mapDatabaseError(permission.error); if (!permission.data) throw new ApiError(404, 'NOT_FOUND', 'Permission was not found')
    await authorizePolicyScope(req, input.scope)
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const scopeId = input.scope.type === 'system' ? null : input.scope.id ?? null
    const result = await req.db!.rpc('replace_role_permission_policies', { p_permission_key: permission.data.key, p_scope_type: input.scope.type, p_scope_id: scopeId, p_policies: input.policies })
    if (result.error) throw mapDatabaseError(result.error)
    const body = { data: { permission_id: permissionId, permission_key: permission.data.key, scope: { ...input.scope, id: scopeId }, policies: input.policies }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
    await complete(req, 200, body); return res.json(body)
  }))

  return router
}
