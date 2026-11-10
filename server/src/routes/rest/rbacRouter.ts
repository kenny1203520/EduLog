import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { sendData } from '../../http/response.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationDecision } from '../../auth/authorization.js'
import { clearUserValidation } from '../../infra/supabase.js'
import { hasOverlappingSystemRoleAssignment } from '../../domain/systemRoleAssignmentPolicy.js'

const uuid = z.string().uuid()
const nullableUuid = uuid.nullable().optional()
const roleDomain = z.enum(['system', 'teaching'])
const roleListQuery = z.object({
  domain: roleDomain.default('teaching'),
  scope_type: z.enum(['system', 'classroom', 'class_session']).optional(), scope_id: nullableUuid,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  search: z.string().trim().max(200).optional(),
  sort: z.enum(['name', '-name', 'sort_order', '-sort_order', 'created_at', '-created_at']).default('sort_order'),
}).strict()
const roleCreate = z.object({
  domain: roleDomain,
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
  permission: z.string().trim().min(1).max(200), classroom_id: uuid.optional(), class_session_id: uuid.optional(),
}).strict().refine((query) => Number(Boolean(query.classroom_id)) + Number(Boolean(query.class_session_id)) <= 1)
const capabilitiesQuery = z.object({}).strict()
const roleScopeQuery = z.object({ scope_type: z.enum(['system', 'classroom', 'class_session']), scope_id: nullableUuid, domain: roleDomain.default('teaching') }).strict()
const rolePolicyUpdate = z.object({
  scope_type: z.enum(['system', 'classroom', 'class_session']), scope_id: nullableUuid,
  expected_epoch: z.coerce.number().int().positive(),
  policies: z.array(z.object({ permission_id: uuid, effect: z.enum(['allow', 'deny']) }).strict()).max(1000),
}).strict()
const rolePolicyPatch = z.object({
  scope_type: z.enum(['system', 'classroom', 'class_session']), scope_id: nullableUuid,
  expected_epoch: z.coerce.number().int().positive(),
  changes: z.array(z.object({ permission_id: uuid, effect: z.enum(['allow', 'deny']).nullable() }).strict()).min(1).max(1000),
}).strict().refine((input) => new Set(input.changes.map((change) => change.permission_id)).size === input.changes.length, { message: 'Each permission may appear only once', path: ['changes'] })
const permissionKey = z.string().trim().min(1).max(128)
const permissionPolicyListQuery = z.object({
  permission_key: z.union([permissionKey, z.array(permissionKey).min(1).max(10)]).transform((value) => [...new Set(Array.isArray(value) ? value : [value])]),
}).strict()
const assignmentListQuery = z.object({
  user_id: uuid.optional(), role_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  sort: z.enum(['created_at', '-created_at', 'effective_from', '-effective_from']).default('-created_at'),
}).strict()
const assignmentMutation = z.object({ user_id: uuid, role_id: uuid, effective_from: z.string().date().optional(), effective_to: z.string().date().nullable().optional(), expected_epoch: z.coerce.number().int().positive() }).strict()
const assignmentDelete = z.object({ expected_epoch: z.coerce.number().int().positive() }).strict()
const classroomAssignmentListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
}).strict()
const classroomAssignmentMutation = z.object({
  user_id: uuid,
  role_id: uuid,
  effective_from: z.string().date(),
  effective_to: z.string().date().nullable().optional(),
  expected_epoch: z.coerce.number().int().positive(),
}).strict()
const exclusionListQuery = z.object({
  scope_type: z.enum(['classroom', 'class_session']), scope_id: uuid,
  user_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
}).strict()
const teachingAssignmentMutation = z.object({
  user_id: uuid, role_id: uuid, effective_from: z.string().date(),
  effective_to: z.string().date().nullable().optional(), expected_epoch: z.coerce.number().int().positive(),
}).strict()
const scopedTeachingAssignmentQuery = z.object({ scope_type: z.enum(['classroom', 'class_session']), scope_id: uuid,
  user_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1_000_000).default(0) }).strict()
const effectiveTeachingRolesQuery = z.object({
  scope_type: z.enum(['system', 'classroom', 'class_session']),
  scope_id: nullableUuid,
  user_id: uuid,
  effective_date: z.string().date().default(() => new Date().toISOString().slice(0, 10)),
}).strict().superRefine((query, context) => {
  if ((query.scope_type === 'system') !== (query.scope_id == null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['scope_id'], message: 'scope_id must be omitted for system scope and supplied otherwise' })
  }
})
const scopedTeachingAssignmentMutation = z.object({
  scope_type: z.enum(['classroom', 'class_session']), scope_id: uuid,
  user_id: uuid, role_id: uuid, effective_from: z.string().date(), effective_to: z.string().date().nullable().optional(),
  expected_epoch: z.coerce.number().int().positive(),
}).strict()
const exclusionMutation = z.object({
  user_id: uuid, role_id: uuid, effective_from: z.string().date(),
  effective_to: z.string().date().nullable().optional(), expected_epoch: z.coerce.number().int().positive(),
}).strict()
const userStatusMutation = z.object({ status: z.enum(['active', 'disabled']), reason: z.string().trim().min(3).max(500).nullable().optional(), expected_epoch: z.coerce.number().int().positive() }).strict()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

function requireRequest(req: Request) {
  if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
}

/** Wraps data in the API envelope, records the idempotent result and sends it. */
async function sendCompleted(req: Request, res: Response, status: number, data: unknown) {
  const body = { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, status, body)
  return res.status(status).json(body)
}

/** Attaches each row's user account when the caller may list users; otherwise user is null. */
async function withUsers(req: Request, rows: any[]) {
  const canListUsers = await rpcBoolean(req, 'has_api_permission', { p_user_id: req.user!.id, p_permission_key: 'system.users.list', p_classroom_id: null, p_class_session_id: null })
  if (!canListUsers || !rows.length) return { data: rows.map(row => ({ ...row, user: null })), canListUsers }
  const users = await req.adminDb!.from('user_accounts').select('id,email,display_name').in('id', [...new Set(rows.map(row => row.user_id))])
  if (users.error) throw mapDatabaseError(users.error)
  const byId = new Map((users.data ?? []).map((user: any) => [user.id, user]))
  return { data: rows.map(row => ({ ...row, user: byId.get(row.user_id) ?? null })), canListUsers }
}

async function rpcBoolean(req: Request, name: string, args: Record<string, unknown>) {
  requireRequest(req)
  const result = await req.db!.rpc(name, args)
  if (result.error) throw mapDatabaseError(result.error)
  return result.data === true
}

async function requireAnyAuthorization(
  req: Request,
  checks: Array<{ rpc: 'has_api_permission' | 'has_system_permission'; permission: string; args: Record<string, unknown> }>,
  details: { permission: string; stage: string; message: string; scopeId?: string | null; scopeType?: string | null },
) {
  requireRequest(req)
  for (const check of checks) {
    const result = await req.db!.rpc(check.rpc, check.args)
    if (result.error) requireAuthorizationDecision(req, result, { ...details, permission: check.permission })
    if (result.data === true) {
      requireAuthorizationDecision(req, result, { ...details, permission: check.permission })
      return
    }
  }
  requireAuthorizationDecision(req, { data: false, error: null }, details)
}

async function authorizeRoleDomain(req: Request, domain: 'system' | 'teaching', _legacyTeachingId: string | null | undefined, action: 'read' | 'manage' = 'manage') {
  if (domain === 'system') {
    await requireAnyAuthorization(req, [
      { rpc: 'has_system_permission', permission: `system.roles.${action}`, args: { p_user_id: req.user!.id, p_permission_key: `system.roles.${action}` } },
      ...(action === 'read' ? [{ rpc: 'has_system_permission' as const, permission: 'system.roles.manage', args: { p_user_id: req.user!.id, p_permission_key: 'system.roles.manage' } }] : []),
    ], { permission: `system.roles.${action}`, stage: `system_roles_${action}`, message: 'You do not have permission to manage system roles', scopeType: 'system' })
    return
  }
  // Teaching roles are platform-root roles. Legacy teaching IDs are ignored.
  await requireAnyAuthorization(req, [
    { rpc: 'has_api_permission', permission: `teaching.roles.${action}`, args: { p_user_id: req.user!.id, p_permission_key: `teaching.roles.${action}`, p_classroom_id: null, p_class_session_id: null } },
    ...(action === 'read' ? [{ rpc: 'has_api_permission' as const, permission: 'teaching.roles.manage', args: { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_classroom_id: null, p_class_session_id: null } }] : []),
  ], { permission: `teaching.roles.${action}`, stage: `teaching_roles_${action}`, message: 'You do not have permission to read teaching roles', scopeType: 'system' })
}

async function authorizeRoleScope(req: Request, domain: 'system' | 'teaching', scope: { type: 'system' | 'classroom' | 'class_session'; id?: string | null }, action: 'read' | 'manage') {
  if (domain === 'system') {
    if (scope.type !== 'system') throw new ApiError(400, 'INVALID_POLICY_SCOPE', 'System role policies only support the system scope')
    return authorizeRoleDomain(req, domain, null, action)
  }
  if (scope.type === 'system') {
    const required = `teaching.roles.${action}`
    await requireAnyAuthorization(req, [
      { rpc: 'has_api_permission', permission: required, args: { p_user_id: req.user!.id, p_permission_key: required, p_classroom_id: null, p_class_session_id: null } },
      ...(action === 'read' ? [{ rpc: 'has_api_permission' as const, permission: 'teaching.roles.manage', args: { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_classroom_id: null, p_class_session_id: null } }] : []),
    ], { permission: required, stage: `platform_teaching_roles_${action}`, message: 'Platform teaching role policies require platform teaching role management permission', scopeId: null, scopeType: 'system' })
    return
  }
  if (!scope.id) throw new ApiError(400, 'INVALID_POLICY_SCOPE', 'A scoped policy requires a scope id')
  const scopeArgs = { p_classroom_id: scope.type === 'classroom' ? scope.id : null, p_class_session_id: scope.type === 'class_session' ? scope.id : null }
  await requireAnyAuthorization(req, [
    { rpc: 'has_api_permission', permission: `teaching.roles.${action}`, args: { p_user_id: req.user!.id, p_permission_key: `teaching.roles.${action}`, ...scopeArgs } },
    ...(action === 'read' ? [{ rpc: 'has_api_permission' as const, permission: 'teaching.roles.manage', args: { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', ...scopeArgs } }] : []),
  ], { permission: `teaching.roles.${action}`, stage: `scoped_teaching_roles_${action}`, message: 'You do not have permission to read or manage teaching roles in this scope', scopeId: scope.id, scopeType: scope.type })
}

async function roleById(req: Request, id: string) {
  requireRequest(req)
  const result = await req.db!.from('roles').select('id,code,name,description,domain,teaching_id,is_builtin,is_protected,is_system,sort_order,created_at,updated_at').eq('id', id).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Role was not found')
  return result.data
}

export function createRbacRouter() {
  const router = Router()

  router.get('/rbac/capability', wrap(async (req, res) => {
    const query = capabilityQuery.parse(req.query); requireRequest(req)
    const result = await req.db!.rpc('has_api_permission', { p_user_id: req.user!.id, p_permission_key: query.permission, p_classroom_id: query.classroom_id ?? null, p_class_session_id: query.class_session_id ?? null })
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, { allowed: result.data === true })
  }))

  router.get('/rbac/scoped-capability', wrap(async (req, res) => {
    const query = roleScopeQuery.parse(req.query); requireRequest(req)
    if (query.scope_type === 'system') {
      const key = query.domain === 'system' ? 'system.roles.manage' : 'teaching.roles.manage'
      const allowed = await rpcBoolean(req, 'has_api_permission', { p_user_id: req.user!.id, p_permission_key: key, p_classroom_id: null, p_class_session_id: null })
      return sendData(req, res, { allowed })
    }
    if (!query.scope_id) throw new ApiError(400, 'INVALID_POLICY_SCOPE', 'A scoped policy requires a scope id')
    const allowed = await rpcBoolean(req, 'has_api_permission', { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_classroom_id: query.scope_type === 'classroom' ? query.scope_id : null, p_class_session_id: query.scope_type === 'class_session' ? query.scope_id : null })
    return sendData(req, res, { allowed })
  }))

  router.get('/rbac/capabilities', wrap(async (req, res) => {
    const query = capabilitiesQuery.parse(req.query); requireRequest(req)
    const result = await req.db!.rpc('get_rbac_capabilities', { p_teaching_id: null })
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? {})
  }))

  router.get('/roles', wrap(async (req, res) => {
    const query = roleListQuery.parse(req.query)
    if (query.domain === 'teaching' && query.scope_type) await authorizeRoleScope(req, query.domain, { type: query.scope_type, id: query.scope_id }, 'read')
    else await authorizeRoleDomain(req, query.domain, null, 'read')
    const sort = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
    // Role catalog visibility is gated above at the requested policy scope;
    // teaching roles are shared definitions and have no workspace owner.
    const roleDb = query.domain === 'teaching' ? req.adminDb! : req.db!
    let builder = roleDb.from('roles').select('id,code,name,description,domain,teaching_id,is_builtin,is_protected,is_system,sort_order,created_at,updated_at', { count: 'exact' }).eq('domain', query.domain)
    if (query.domain === 'teaching') builder = builder.is('teaching_id', null)
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
    await authorizeRoleDomain(req, input.domain, null, 'manage')
    setAuditContext(req, { domain: input.domain, resource: 'roles', action: 'create', scopeType: 'system', permission: `${input.domain}.roles.manage` })
    const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_create_role', { p_domain: input.domain, p_teaching_id: null, p_code: input.code ?? null, p_name: input.name, p_description: input.description ?? null, p_parent_role_id: input.parent_role_id ?? null, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 201, result.data)
  }))

  // Every scope's local policies for the given permissions, across all roles,
  // plus the RBAC epoch to send back with PATCH /roles/:id/permissions. The
  // epoch is read before the rows, so a change in between only causes a 409.
  // Row visibility is enforced by role_permission_policies RLS.
  router.get('/roles/permission-policies', wrap(async (req, res) => {
    requireRequest(req); const query = permissionPolicyListQuery.parse(req.query)
    const epoch = await req.db!.from('rbac_policy_epoch').select('epoch').eq('singleton', true).maybeSingle()
    if (epoch.error) throw mapDatabaseError(epoch.error)
    const permissions = await req.db!.from('permissions').select('id,key').in('key', query.permission_key)
    if (permissions.error) throw mapDatabaseError(permissions.error)
    const keyById = new Map((permissions.data ?? []).map((permission) => [permission.id as string, permission.key as string]))
    const missing = query.permission_key.filter((key) => ![...keyById.values()].includes(key))
    if (missing.length) throw new ApiError(404, 'NOT_FOUND', `Permission was not found: ${missing.join(', ')}`)
    const result = await req.db!.from('role_permission_policies').select('id,role_id,permission_id,scope_type,scope_id,effect,created_at,updated_at').in('permission_id', [...keyById.keys()])
    if (result.error) throw mapDatabaseError(result.error)
    const rows = (result.data ?? []).map((row) => ({ ...row, permission_key: keyById.get(row.permission_id as string) }))
    return sendData(req, res, rows, { total: rows.length, epoch: epoch.data?.epoch ?? null, permissions: [...keyById].map(([id, key]) => ({ id, key })) })
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
    return sendCompleted(req, res, 200, result.data)
  }))

  router.delete('/roles/:id', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id); const input = roleDelete.parse(req.body); const role = await roleById(req, id)
    await authorizeRoleDomain(req, role.domain as 'system' | 'teaching', role.teaching_id as string | null, 'manage')
    setAuditContext(req, { domain: role.domain as string, resource: 'roles', resourceId: id, action: 'delete', teachingId: role.teaching_id as string | null, permission: `${role.domain}.roles.manage` })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_delete_role', { p_role_id: id, p_expected_epoch: input.expected_epoch }); if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 200, { id, deleted: true })
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
    setAuditContext(req, { domain: role.domain as string, resource: 'role-permissions', resourceId: id, action: 'replace', scopeId: input.scope_id ?? null, scopeType: input.scope_type, permission: `${role.domain}.roles.manage` })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_replace_role_permissions', { p_role_id: id, p_scope_type: input.scope_type, p_scope_id: input.scope_id ?? null, p_expected_epoch: input.expected_epoch, p_policies: input.policies })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 200, { role_id: id, scope_type: input.scope_type, scope_id: input.scope_id ?? null, epoch: result.data })
  }))

  // Partial update of one role's local policies at one scope. Permissions not
  // listed in `changes` keep their local effect; `effect: null` removes the
  // local policy so the role inherits again. The read-merge-replace runs
  // against `expected_epoch`, so a concurrent RBAC change yields 409.
  router.patch('/roles/:id/permissions', wrap(async (req, res) => {
    const id = uuid.parse(req.params.id); const input = rolePolicyPatch.parse(req.body); const role = await roleById(req, id)
    const scopeId = input.scope_type === 'system' ? null : input.scope_id ?? null
    await authorizeRoleScope(req, role.domain as 'system' | 'teaching', { type: input.scope_type, id: scopeId }, 'manage')
    setAuditContext(req, { domain: role.domain as string, resource: 'role-permissions', resourceId: id, action: 'patch', scopeId, scopeType: input.scope_type, permission: `${role.domain}.roles.manage` })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const current = await req.db!.rpc('rbac_get_role_permissions', { p_role_id: id, p_scope_type: input.scope_type, p_scope_id: scopeId })
    if (current.error) throw mapDatabaseError(current.error)
    const rows = (current.data ?? []) as Array<{ permission_id: string; local_effect: 'allow' | 'deny' | null; epoch: number }>
    if (rows[0] && Number(rows[0].epoch) !== input.expected_epoch) throw new ApiError(409, 'RBAC_VERSION_CONFLICT', 'The permission configuration changed; reload before saving')
    const local = new Map(rows.filter((row) => row.local_effect).map((row) => [row.permission_id, row.local_effect as 'allow' | 'deny']))
    for (const change of input.changes) {
      if (change.effect) local.set(change.permission_id, change.effect)
      else local.delete(change.permission_id)
    }
    const policies = [...local].map(([permission_id, effect]) => ({ permission_id, effect }))
    const result = await req.db!.rpc('rbac_replace_role_permissions', { p_role_id: id, p_scope_type: input.scope_type, p_scope_id: scopeId, p_expected_epoch: input.expected_epoch, p_policies: policies })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 200, { role_id: id, scope_type: input.scope_type, scope_id: scopeId, epoch: result.data, changes: input.changes })
  }))

  router.get('/system-role-assignments', wrap(async (req, res) => {
    requireRequest(req); const query = assignmentListQuery.parse(req.query)
    await requireAnyAuthorization(req, [
      { rpc: 'has_system_permission', permission: 'system.role_assignments.read', args: { p_user_id: req.user!.id, p_permission_key: 'system.role_assignments.read' } },
      { rpc: 'has_system_permission', permission: 'system.role_assignments.manage', args: { p_user_id: req.user!.id, p_permission_key: 'system.role_assignments.manage' } },
    ], { permission: 'system.role_assignments.read', stage: 'system_role_assignments_read', message: 'You do not have permission to read system role assignments', scopeType: 'system' })
    const sort = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
    let builder = req.adminDb!.from('user_role_assignments').select('id,user_id,role_id,scope_type,scope_id,status,effective_from,effective_to,created_at,updated_at,roles!inner(id,code,name,domain,is_protected)', { count: 'exact' }).eq('scope_type', 'system').eq('roles.domain', 'system')
    if (query.user_id) builder = builder.eq('user_id', query.user_id); if (query.role_id) builder = builder.eq('role_id', query.role_id)
    const result = await builder.order(sort, { ascending: !query.sort.startsWith('-') }).range(query.offset, query.offset + query.limit - 1)
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data ?? [], { limit: query.limit, offset: query.offset, total: result.count ?? 0, sort: query.sort })
  }))

  const createAssignment = async (req: Request, res: Response) => {
    requireRequest(req); const input = assignmentMutation.parse(req.body)
    setAuditContext(req, { domain: 'system', resource: 'role-assignments', resourceId: null, action: 'create', permission: 'system.role_assignments.manage' })
    const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
    const effectiveFrom = input.effective_from ?? new Date().toISOString().slice(0, 10)
    const effectiveTo = input.effective_to ?? null
    if (effectiveTo && effectiveTo < effectiveFrom) throw new ApiError(422, 'INVALID_DATE_RANGE', 'The end date must not be before the start date')
    const existingResult = await req.db!.from('user_role_assignments')
      .select('id,user_id,role_id,effective_from,effective_to')
      .eq('scope_type', 'system').eq('user_id', input.user_id).eq('role_id', input.role_id)
    if (existingResult.error) throw mapDatabaseError(existingResult.error)
    const overlaps = hasOverlappingSystemRoleAssignment(existingResult.data ?? [], input.user_id, input.role_id, effectiveFrom, effectiveTo, null)
    if (overlaps) throw new ApiError(409, 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP', 'The user already has this system role during an overlapping date range')
    const result = await req.db!.rpc('rbac_upsert_system_assignment', { p_assignment_id: null, p_user_id: input.user_id, p_role_id: input.role_id, p_effective_from: effectiveFrom, p_effective_to: effectiveTo, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 201, result.data)
  }
  router.post('/system-role-assignments', wrap(createAssignment))
  router.delete('/system-role-assignments/:id', wrap(async (req, res) => {
    requireRequest(req); const id = uuid.parse(req.params.id); const input = assignmentDelete.parse(req.body)
    setAuditContext(req, { domain: 'system', resource: 'role-assignments', resourceId: id, action: 'delete', permission: 'system.role_assignments.manage' })
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_delete_system_assignment', { p_assignment_id: id, p_expected_epoch: input.expected_epoch }); if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 200, { id, deleted: true })
  }))

  router.get('/classrooms/:classroomId/role-assignments', wrap(async (req, res) => {
    requireRequest(req)
    const classroomId = uuid.parse(req.params.classroomId)
    const query = classroomAssignmentListQuery.parse(req.query)
    await authorizeRoleScope(req, 'teaching', { type: 'classroom', id: classroomId }, 'read')

    const assignments = await req.adminDb!.from('user_role_assignments')
      .select('id,user_id,role_id,scope_type,scope_id,effective_from,effective_to,created_at,updated_at,roles(id,code,name,domain,is_builtin)', { count: 'exact' })
      .eq('scope_type', 'classroom').eq('scope_id', classroomId)
      .order('effective_from', { ascending: false })
      .range(query.offset, query.offset + query.limit - 1)
    if (assignments.error) throw mapDatabaseError(assignments.error)

    const { data, canListUsers } = await withUsers(req, assignments.data ?? [])
    return sendData(req, res, data, { limit: query.limit, offset: query.offset, total: assignments.count ?? 0, can_list_users: canListUsers })
  }))

  const mutateClassroomAssignment = async (req: Request, res: Response) => {
    requireRequest(req)
    const classroomId = uuid.parse(req.params.classroomId)
    const assignmentId = req.params.assignmentId ? uuid.parse(req.params.assignmentId) : null
    const input = classroomAssignmentMutation.parse(req.body)
    await authorizeRoleScope(req, 'teaching', { type: 'classroom', id: classroomId }, 'manage')
    await requireAnyAuthorization(req, [{ rpc: 'has_api_permission', permission: 'system.users.list', args: {
      p_user_id: req.user!.id, p_permission_key: 'system.users.list', p_classroom_id: null, p_class_session_id: null,
    } }], { permission: 'system.users.list', stage: 'classroom_role_user_directory_permission', message: 'You need user directory access to assign a classroom role', scopeId: classroomId, scopeType: 'classroom' })

    const classroom = await req.adminDb!.from('classrooms').select('id').eq('id', classroomId).maybeSingle()
    if (classroom.error) throw mapDatabaseError(classroom.error)
    if (!classroom.data) throw new ApiError(404, 'NOT_FOUND', 'Classroom was not found')
    const roleResult = await req.adminDb!.from('roles').select('id,domain').eq('id', input.role_id).maybeSingle()
    if (roleResult.error) throw mapDatabaseError(roleResult.error)
    const role = roleResult.data
    if (!role || role.domain !== 'teaching') {
      throw new ApiError(422, 'BUSINESS_VALIDATION_FAILED', 'The selected role is not a teaching role')
    }
    if (input.effective_to && input.effective_to < input.effective_from) {
      throw new ApiError(422, 'INVALID_DATE_RANGE', 'The end date must not be before the start date')
    }

    setAuditContext(req, {
      domain: 'teaching', resource: 'classroom-role-assignments', resourceId: assignmentId,
      action: assignmentId ? 'update' : 'create', scopeId: classroomId, scopeType: 'classroom',
      permission: 'teaching.roles.manage',
    })
    const replay = await idempotency(req, assignmentId ? 200 : 201, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_upsert_scoped_teaching_assignment', {
      p_assignment_id: assignmentId,
      p_user_id: input.user_id,
      p_role_id: input.role_id,
      p_scope_type: 'classroom',
      p_scope_id: classroomId,
      p_effective_from: input.effective_from,
      p_effective_to: input.effective_to ?? null,
      p_expected_epoch: input.expected_epoch,
    })
    if (result.error) throw mapDatabaseError(result.error)
    const status = assignmentId ? 200 : 201
    const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
    await complete(req, status, body)
    return res.status(status).json(body)
  }
  router.post('/classrooms/:classroomId/role-assignments', wrap(mutateClassroomAssignment))
  router.patch('/classrooms/:classroomId/role-assignments/:assignmentId', wrap(mutateClassroomAssignment))
  router.delete('/classrooms/:classroomId/role-assignments/:assignmentId', wrap(async (req, res) => {
    requireRequest(req)
    const classroomId = uuid.parse(req.params.classroomId)
    const assignmentId = uuid.parse(req.params.assignmentId)
    const input = assignmentDelete.parse(req.body)
    await authorizeRoleScope(req, 'teaching', { type: 'classroom', id: classroomId }, 'manage')
    setAuditContext(req, {
      domain: 'teaching', resource: 'classroom-role-assignments', resourceId: assignmentId,
      action: 'delete', scopeId: classroomId, scopeType: 'classroom', permission: 'teaching.roles.manage',
    })
    const replay = await idempotency(req, 200, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_delete_scoped_teaching_assignment', {
      p_assignment_id: assignmentId, p_scope_type: 'classroom', p_scope_id: classroomId, p_expected_epoch: input.expected_epoch,
    })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 200, { id: assignmentId, deleted: true })
  }))

  // Platform teaching-role assignments are separate from system role grants.
  // They are root grants and flow down to all current and future classrooms.
  router.get('/teaching-role-assignments', wrap(async (req, res) => {
    requireRequest(req)
    const query = assignmentListQuery.parse(req.query)
    await requireAnyAuthorization(req, [
      { rpc: 'has_api_permission', permission: 'teaching.roles.read', args: { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.read', p_classroom_id: null, p_class_session_id: null } },
      { rpc: 'has_api_permission', permission: 'teaching.roles.manage', args: { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_classroom_id: null, p_class_session_id: null } },
    ], { permission: 'teaching.roles.read', stage: 'platform_teaching_role_assignments_read', message: 'You do not have permission to read platform teaching-role assignments', scopeType: 'system' })
    const sort = query.sort.startsWith('-') ? query.sort.slice(1) : query.sort
    let builder = req.adminDb!.from('user_role_assignments')
      .select('id,user_id,role_id,scope_type,scope_id,status,effective_from,effective_to,created_at,updated_at,roles!inner(id,code,name,description,domain,is_builtin)', { count: 'exact' })
      .eq('scope_type', 'system').eq('roles.domain', 'teaching')
    if (query.user_id) builder = builder.eq('user_id', query.user_id)
    if (query.role_id) builder = builder.eq('role_id', query.role_id)
    const result = await builder.order(sort, { ascending: !query.sort.startsWith('-') }).range(query.offset, query.offset + query.limit - 1)
    if (result.error) throw mapDatabaseError(result.error)
    const { data, canListUsers } = await withUsers(req, result.data ?? [])
    return sendData(req, res, data, { limit: query.limit, offset: query.offset, total: result.count ?? 0, can_list_users: canListUsers })
  }))

  const createTeachingAssignment = async (req: Request, res: Response) => {
    requireRequest(req)
    const input = teachingAssignmentMutation.parse(req.body)
    await requireAnyAuthorization(req, [{ rpc: 'has_api_permission', permission: 'teaching.roles.manage', args: { p_user_id: req.user!.id, p_permission_key: 'teaching.roles.manage', p_classroom_id: null, p_class_session_id: null } }], { permission: 'teaching.roles.manage', stage: 'platform_teaching_role_assignment_manage', message: 'Platform teaching-role assignment requires platform role management permission', scopeType: 'system' })
    if (input.effective_to && input.effective_to < input.effective_from) throw new ApiError(422, 'INVALID_DATE_RANGE', 'The end date must not be before the start date')
    setAuditContext(req, { domain: 'teaching', resource: 'platform-role-assignments', resourceId: null, action: 'create', scopeType: 'system', permission: 'teaching.roles.manage' })
    const replay = await idempotency(req, 201, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_upsert_platform_teaching_assignment', {
      p_assignment_id: null, p_user_id: input.user_id, p_role_id: input.role_id,
      p_effective_from: input.effective_from, p_effective_to: input.effective_to ?? null,
      p_expected_epoch: input.expected_epoch,
    })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 201, result.data)
  }
  router.post('/teaching-role-assignments', wrap(createTeachingAssignment))
  router.delete('/teaching-role-assignments/:id', wrap(async (req, res) => {
    requireRequest(req)
    const id = uuid.parse(req.params.id); const input = assignmentDelete.parse(req.body)
    setAuditContext(req, { domain: 'teaching', resource: 'platform-role-assignments', resourceId: id, action: 'delete', scopeType: 'system', permission: 'teaching.roles.manage' })
    const replay = await idempotency(req, 200, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_delete_platform_teaching_assignment', { p_assignment_id: id, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 200, { id, deleted: true })
  }))

  router.get('/teaching-role-assignments/scoped', wrap(async (req, res) => {
    requireRequest(req)
    const query = scopedTeachingAssignmentQuery.parse(req.query)
    await authorizeRoleScope(req, 'teaching', { type: query.scope_type, id: query.scope_id }, 'read')
    let builder = req.adminDb!.from('user_role_assignments')
      .select('id,user_id,role_id,scope_type,scope_id,status,effective_from,effective_to,created_at,updated_at,roles!inner(id,code,name,description,domain,is_builtin)', { count: 'exact' })
      .eq('scope_type', query.scope_type).eq('scope_id', query.scope_id).eq('roles.domain', 'teaching')
    if (query.user_id) builder = builder.eq('user_id', query.user_id)
    const result = await builder.order('effective_from', { ascending: false }).range(query.offset, query.offset + query.limit - 1)
    if (result.error) throw mapDatabaseError(result.error)
    const { data, canListUsers } = await withUsers(req, result.data ?? [])
    return sendData(req, res, data, { limit: query.limit, offset: query.offset, total: result.count ?? 0, can_list_users: canListUsers })
  }))

  router.get('/teaching-role-assignments/effective', wrap(async (req, res) => {
    requireRequest(req)
    const query = effectiveTeachingRolesQuery.parse(req.query)
    await authorizeRoleScope(req, 'teaching', { type: query.scope_type, id: query.scope_id }, 'read')
    setAuditContext(req, { domain: 'teaching', resource: 'effective-role-assignments', action: 'read', scopeId: query.scope_id, scopeType: query.scope_type, permission: 'teaching.roles.read | teaching.roles.manage' })
    const result = await req.db!.rpc('get_effective_teaching_roles', {
      p_user_id: query.user_id,
      p_scope_type: query.scope_type,
      p_scope_id: query.scope_id,
      p_effective_date: query.effective_date,
    })
    if (result.error) {
      req.log?.error({
        event: 'effective_teaching_roles_query_failed',
        operation: 'get_effective_teaching_roles',
        database_error_code: result.error.code ?? 'UNKNOWN',
        request_id: req.requestId,
        trace_id: req.traceId,
      }, 'effective_teaching_roles_query_failed')
      throw mapDatabaseError(result.error)
    }
    return sendData(req, res, result.data ?? [], { effective_date: query.effective_date, scope_type: query.scope_type, scope_id: query.scope_id })
  }))

  const createScopedTeachingAssignment = async (req: Request, res: Response) => {
    requireRequest(req)
    const input = scopedTeachingAssignmentMutation.parse(req.body)
    await authorizeRoleScope(req, 'teaching', { type: input.scope_type, id: input.scope_id }, 'manage')
    if (input.effective_to && input.effective_to < input.effective_from) throw new ApiError(422, 'INVALID_DATE_RANGE', 'The end date must not be before the start date')
    setAuditContext(req, { domain: 'teaching', resource: 'scoped-role-assignments', resourceId: null, action: 'create', scopeId: input.scope_id, scopeType: input.scope_type, permission: 'teaching.roles.manage' })
    const replay = await idempotency(req, 201, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_upsert_scoped_teaching_assignment', {
      p_assignment_id: null, p_user_id: input.user_id, p_role_id: input.role_id,
      p_scope_type: input.scope_type, p_scope_id: input.scope_id,
      p_effective_from: input.effective_from, p_effective_to: input.effective_to ?? null,
      p_expected_epoch: input.expected_epoch,
    })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 201, result.data)
  }
  router.post('/teaching-role-assignments/scoped', wrap(createScopedTeachingAssignment))
  router.delete('/teaching-role-assignments/scoped/:id', wrap(async (req, res) => {
    requireRequest(req)
    const query = scopedTeachingAssignmentQuery.parse(req.query)
    const input = assignmentDelete.parse(req.body); const id = uuid.parse(req.params.id)
    await authorizeRoleScope(req, 'teaching', { type: query.scope_type, id: query.scope_id }, 'manage')
    setAuditContext(req, { domain: 'teaching', resource: 'scoped-role-assignments', resourceId: id, action: 'delete', scopeId: query.scope_id, scopeType: query.scope_type, permission: 'teaching.roles.manage' })
    const replay = await idempotency(req, 200, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_delete_scoped_teaching_assignment', { p_assignment_id: id, p_scope_type: query.scope_type, p_scope_id: query.scope_id, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 200, { id, deleted: true })
  }))

  router.get('/teaching-role-exclusions', wrap(async (req, res) => {
    requireRequest(req)
    const query = exclusionListQuery.parse(req.query)
    await authorizeRoleScope(req, 'teaching', { type: query.scope_type, id: query.scope_id }, 'read')
    let builder = req.adminDb!.from('user_role_assignment_exclusions')
      .select('id,user_id,role_id,scope_type,scope_id,effective_from,effective_to,created_at,updated_at,roles(id,code,name,domain,is_builtin)', { count: 'exact' })
      .eq('scope_type', query.scope_type).eq('scope_id', query.scope_id)
    if (query.user_id) builder = builder.eq('user_id', query.user_id)
    const result = await builder.order('effective_from', { ascending: false }).range(query.offset, query.offset + query.limit - 1)
    if (result.error) throw mapDatabaseError(result.error)
    const { data, canListUsers } = await withUsers(req, result.data ?? [])
    return sendData(req, res, data, { limit: query.limit, offset: query.offset, total: result.count ?? 0, can_list_users: canListUsers })
  }))

  const createExclusion = async (req: Request, res: Response) => {
    requireRequest(req)
    const query = exclusionListQuery.parse(req.query)
    const input = exclusionMutation.parse(req.body)
    await authorizeRoleScope(req, 'teaching', { type: query.scope_type, id: query.scope_id }, 'manage')
    if (input.effective_to && input.effective_to < input.effective_from) throw new ApiError(422, 'INVALID_DATE_RANGE', 'The end date must not be before the start date')
    setAuditContext(req, { domain: 'teaching', resource: 'role-assignment-exclusions', resourceId: null, action: 'create', scopeId: query.scope_id, scopeType: query.scope_type, permission: 'teaching.roles.manage' })
    const replay = await idempotency(req, 201, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_upsert_role_assignment_exclusion', {
      p_exclusion_id: null, p_user_id: input.user_id, p_role_id: input.role_id,
      p_scope_type: query.scope_type, p_scope_id: query.scope_id,
      p_effective_from: input.effective_from, p_effective_to: input.effective_to ?? null,
      p_expected_epoch: input.expected_epoch,
    })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 201, result.data)
  }
  router.post('/teaching-role-exclusions', wrap(createExclusion))
  router.delete('/teaching-role-exclusions/:id', wrap(async (req, res) => {
    requireRequest(req)
    const query = exclusionListQuery.parse(req.query)
    const input = assignmentDelete.parse(req.body); const id = uuid.parse(req.params.id)
    await authorizeRoleScope(req, 'teaching', { type: query.scope_type, id: query.scope_id }, 'manage')
    setAuditContext(req, { domain: 'teaching', resource: 'role-assignment-exclusions', resourceId: id, action: 'delete', scopeId: query.scope_id, scopeType: query.scope_type, permission: 'teaching.roles.manage' })
    const replay = await idempotency(req, 200, null)
    if (replay) return res.status(replay.status).json(replay.body)
    const result = await req.db!.rpc('rbac_delete_role_assignment_exclusion', { p_exclusion_id: id, p_scope_type: query.scope_type, p_scope_id: query.scope_id, p_expected_epoch: input.expected_epoch })
    if (result.error) throw mapDatabaseError(result.error)
    return sendCompleted(req, res, 200, { id, deleted: true })
  }))

  router.patch('/users/:id/status', wrap(async (req, res) => {
    requireRequest(req); const userId = uuid.parse(req.params.id); const input = userStatusMutation.parse(req.body)
    setAuditContext(req, { domain: 'system', resource: 'users', resourceId: userId, action: 'status', permission: 'system.users.manage' })
    // Authorize before anything else: the Auth ban below runs as the service
    // role, and an unauthorized caller must not learn whether the account exists.
    const allowed = await req.db!.rpc('has_api_permission', { p_user_id: req.user!.id, p_permission_key: 'system.users.manage', p_classroom_id: null, p_class_session_id: null })
    if (allowed.error) throw new ApiError(503, 'AUTHORIZATION_CHECK_UNAVAILABLE', 'Authorization could not be verified')
    if (allowed.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action')
    const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
    const previous = await req.adminDb!.from('profiles').select('account_status').eq('auth_user_id', userId).maybeSingle()
    if (previous.error) throw mapDatabaseError(previous.error); if (!previous.data) throw new ApiError(404, 'NOT_FOUND', 'User was not found')
    const authResult = await req.adminDb!.auth.admin.updateUserById(userId, { ban_duration: input.status === 'disabled' ? '876000h' : 'none' })
    if (authResult.error) throw new ApiError(503, 'AUTH_ADMIN_UNAVAILABLE', 'The account status could not be updated')
    const result = await req.db!.rpc('set_system_user_status', { p_user_id: userId, p_status: input.status, p_reason: input.status === 'disabled' ? input.reason ?? null : null, p_expected_epoch: input.expected_epoch })
    if (result.error) {
      // The status was not changed, so put the Auth ban back as it was. If that
      // fails the two disagree: say so in the log instead of hiding it.
      const restored = await req.adminDb!.auth.admin.updateUserById(userId, { ban_duration: previous.data.account_status === 'disabled' ? '876000h' : 'none' })
        .catch((error: unknown) => ({ error }))
      if (restored.error) req.log.error({ target_user_id: userId, expected_status: previous.data.account_status }, 'user_status_ban_restore_failed')
      throw mapDatabaseError(result.error)
    }
    clearUserValidation(userId)
    return sendCompleted(req, res, 200, result.data)
  }))

  return router
}
