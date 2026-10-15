import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ApiError } from './http/errors.js'
import { requireAuthorizationDecision } from './authorization.js'

const searchSchema = z.object({ query: z.string().trim().min(1).max(200), only_unlinked: z.coerce.boolean().optional() }).strict()

export function createUserSearchRouter() {
  const router = Router()
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      const input = searchSchema.parse(req.query)
      const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'system.users.list', p_classroom_id: null, p_class_session_id: null })
      requireAuthorizationDecision(req, permission, { permission: 'system.users.list', stage: 'user_directory_permission', message: 'You do not have permission to search users', scopeType: 'system' })
      const escapedQuery = input.query.replace(/[\\%_]/g, (character) => `\\${character}`)
      const pattern = `%${escapedQuery}%`
      const [emailMatches, fullNameMatches, nicknameMatches] = await Promise.all([
        req.adminDb.from('user_accounts').select('id,email,display_name,account_status,disabled_at,disabled_reason,created_at').ilike('email', pattern).limit(20),
        req.adminDb.from('user_accounts').select('id,email,display_name,account_status,disabled_at,disabled_reason,created_at').ilike('full_name', pattern).limit(20),
        req.adminDb.from('user_accounts').select('id,email,display_name,account_status,disabled_at,disabled_reason,created_at').ilike('nickname', pattern).limit(20),
      ])
      if (emailMatches.error || fullNameMatches.error || nicknameMatches.error) throw new ApiError(502, 'USER_DIRECTORY_ERROR', 'The user directory is unavailable')
      const byId = new Map<string, { id: string; email: string; display_name: string | null; account_status: string | null; disabled_at: string | null; disabled_reason: string | null; created_at: string; last_sign_in_at: null }>()
      for (const profile of [...(emailMatches.data ?? []), ...(fullNameMatches.data ?? []), ...(nicknameMatches.data ?? [])]) {
        if (!profile.id || !profile.email || byId.has(profile.id)) continue
        byId.set(profile.id, { id: profile.id, email: profile.email, display_name: profile.display_name, account_status: profile.account_status, disabled_at: profile.disabled_at, disabled_reason: profile.disabled_reason, created_at: profile.created_at, last_sign_in_at: null })
      }
      let users = [...byId.values()].slice(0, 20)
      if (input.only_unlinked) {
        const linked = await req.adminDb.from('teacher_records').select('profile_id')
        if (linked.error) throw new ApiError(502, 'AUTH_PROVIDER_ERROR', 'The authentication provider is unavailable')
        const linkedProfileIds = (linked.data ?? []).map((row) => row.profile_id).filter((id): id is string => typeof id === 'string')
        const linkedProfiles = linkedProfileIds.length ? await req.adminDb.from('profiles').select('auth_user_id').in('id', linkedProfileIds) : { data: [], error: null }
        if (linkedProfiles.error) throw new ApiError(502, 'AUTH_PROVIDER_ERROR', 'The authentication provider is unavailable')
        const linkedIds = new Set((linkedProfiles.data ?? []).map((row) => row.auth_user_id).filter(Boolean))
        users = users.filter((user) => !linkedIds.has(user.id))
      }
      res.json({ data: users, meta: { limit: users.length, offset: 0, total: users.length, sort: 'email' }, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error) }
  })
  return router
}
