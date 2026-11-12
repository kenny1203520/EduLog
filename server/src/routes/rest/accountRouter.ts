import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import type { ApiConfig } from '../../config/config.js'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { sendCreated, sendData } from '../../http/response.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationRpcDecision } from '../../auth/authorization.js'
import { clearUserValidation } from '../../infra/supabase.js'

/**
 * Account review: accounts that signed up themselves (OAuth, email) wait as
 * 'pending' until someone with system.users.manage approves them. Approval
 * can grant roles at platform scope, which the reviewer must be allowed to
 * assign themselves (rbac_can_grant_role). Invited accounts are approved at once
 * with the default roles. Rejecting uses PATCH /users/:id/status.
 */

const uuid = z.string().uuid()
const roleIds = z.array(uuid).max(20).default([])
const approveBody = z.object({ role_ids: roleIds }).strict()
const defaultRolesBody = z.object({ role_ids: roleIds }).strict()
const inviteBody = z.object({ email: z.string().trim().email().max(320) }).strict()

type RoleRow = { id: string; code: string | null; name: string; domain: 'system' | 'teaching'; is_protected: boolean }

const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { handler(req, res).catch(next) }

function hasPermission(req: Request, permission: string) {
  return req.db!.rpc('has_api_permission', { p_user_id: req.user!.id, p_permission_key: permission, p_classroom_id: null, p_class_session_id: null })
}

function requirePermission(req: Request, permission: string, stage: string) {
  return requireAuthorizationRpcDecision(req, hasPermission(req, permission), { permission, stage })
}

async function loadRoles(req: Request, ids: string[]): Promise<RoleRow[]> {
  if (!ids.length) return []
  const result = await req.adminDb!.from('roles').select('id,code,name,domain,is_protected').in('id', ids)
  if (result.error) throw mapDatabaseError(result.error)
  const rows = (result.data ?? []) as RoleRow[]
  if (rows.length !== new Set(ids).size) throw new ApiError(422, 'ROLE_NOT_FOUND', 'A selected role does not exist')
  if (rows.some((role) => role.is_protected)) throw new ApiError(422, 'PROTECTED_ROLE_NOT_ALLOWED', 'Owner roles cannot be granted this way')
  return rows
}

/**
 * approve_account runs as the service role, so the reviewer's own right to
 * assign each role is asked here, through their own client: they may assign
 * roles of that domain and hold everything the role grants.
 */
async function requireRolesGrantable(req: Request, roles: RoleRow[]) {
  for (const role of roles) {
    const decision = await req.db!.rpc('rbac_can_grant_role', { p_role_id: role.id, p_scope_type: 'system', p_scope_id: null })
    if (decision.error) throw new ApiError(503, 'AUTHORIZATION_CHECK_UNAVAILABLE', 'Authorization could not be verified')
    if (decision.data !== true) throw new ApiError(403, 'GRANT_EXCEEDS_CALLER', 'You cannot grant a role that gives more access than you have')
  }
}

async function defaultRoleIds(req: Request): Promise<string[]> {
  const result = await req.adminDb!.from('account_default_roles').select('role_id')
  if (result.error) throw mapDatabaseError(result.error)
  return ((result.data ?? []) as Array<{ role_id: string }>).map((row) => row.role_id)
}

export function createAccountRouter(config: Pick<ApiConfig, 'EDULOG_WEB_BASE_URL'>) {
  const router = Router()

  router.get('/accounts/pending', wrap(async (req, res) => {
    await requirePermission(req, 'system.users.manage', 'account_review')
    const result = await req.adminDb!.rpc('list_pending_accounts')
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, { accounts: result.data ?? [], default_role_ids: await defaultRoleIds(req) })
  }))

  // The sidebar badge asks on every page; people who cannot review get 0
  // rather than a logged denial.
  router.get('/accounts/pending/count', wrap(async (req, res) => {
    const allowed = await hasPermission(req, 'system.users.manage')
    if (allowed.error) throw new ApiError(503, 'AUTHORIZATION_CHECK_UNAVAILABLE', 'Authorization could not be verified')
    if (allowed.data !== true) return sendData(req, res, { count: 0, can_review: false })
    const result = await req.adminDb!.rpc('count_pending_accounts')
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, { count: Number(result.data ?? 0), can_review: true })
  }))

  router.post('/accounts/:id/approve', wrap(async (req, res) => {
    const userId = uuid.parse(req.params.id)
    const input = approveBody.parse(req.body)
    setAuditContext(req, { domain: 'system', resource: 'users', resourceId: userId, action: 'approve', permission: 'system.users.manage' })
    await requirePermission(req, 'system.users.manage', 'account_review')
    await requireRolesGrantable(req, await loadRoles(req, input.role_ids))
    const result = await req.adminDb!.rpc('approve_account', { p_user_id: userId, p_role_ids: input.role_ids, p_actor: req.user!.id })
    if (result.error) {
      if (result.error.message?.includes('ACCOUNT_NOT_PENDING')) throw new ApiError(409, 'ACCOUNT_NOT_PENDING', 'This account is not waiting for approval')
      if (result.error.message?.includes('USER_NOT_FOUND')) throw new ApiError(404, 'NOT_FOUND', 'User was not found')
      throw mapDatabaseError(result.error)
    }
    clearUserValidation(userId)
    return sendData(req, res, result.data)
  }))

  router.get('/settings/account-default-roles', wrap(async (req, res) => {
    await requirePermission(req, 'system.users.manage', 'account_default_roles')
    const roles = await req.adminDb!.from('roles').select('id,code,name,domain,is_protected').eq('is_protected', false).order('domain').order('sort_order')
    if (roles.error) throw mapDatabaseError(roles.error)
    const options = ((roles.data ?? []) as RoleRow[]).map(({ id, code, name, domain }) => ({ id, code, name, domain }))
    return sendData(req, res, { role_ids: await defaultRoleIds(req), roles: options })
  }))

  router.put('/settings/account-default-roles', wrap(async (req, res) => {
    const input = defaultRolesBody.parse(req.body)
    setAuditContext(req, { domain: 'system', resource: 'account-default-roles', action: 'update', permission: 'system.users.manage' })
    await requirePermission(req, 'system.users.manage', 'account_default_roles')
    await requireRolesGrantable(req, await loadRoles(req, input.role_ids))
    const result = await req.adminDb!.rpc('set_account_default_roles', { p_role_ids: input.role_ids, p_actor: req.user!.id })
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, { role_ids: result.data ?? [] })
  }))

  /** Invite by email: GoTrue mails the link; the account is approved with the default roles. */
  router.post('/accounts/invite', wrap(async (req, res) => {
    const input = inviteBody.parse(req.body)
    setAuditContext(req, { domain: 'system', resource: 'users', action: 'invite', permission: 'system.users.manage' })
    await requirePermission(req, 'system.users.manage', 'account_invite')
    const defaults = await defaultRoleIds(req)
    await requireRolesGrantable(req, await loadRoles(req, defaults))
    const invited = await req.adminDb!.auth.admin.inviteUserByEmail(input.email, { redirectTo: config.EDULOG_WEB_BASE_URL })
    if (invited.error || !invited.data.user) {
      const status = (invited.error as { status?: number } | null)?.status
      if (status === 422 || /already/i.test(invited.error?.message ?? '')) throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account with this email already exists')
      req.log.warn({ auth_error_code: invited.error?.code ?? 'UNKNOWN' }, 'account_invite_failed')
      throw new ApiError(503, 'AUTH_ADMIN_UNAVAILABLE', 'The invitation could not be sent')
    }
    const userId = invited.data.user.id
    const approved = await req.adminDb!.rpc('approve_account', { p_user_id: userId, p_role_ids: defaults, p_actor: req.user!.id })
    if (approved.error) throw mapDatabaseError(approved.error)
    clearUserValidation(userId)
    return sendCreated(req, res, { id: userId, email: input.email, role_ids: defaults })
  }))

  return router
}
