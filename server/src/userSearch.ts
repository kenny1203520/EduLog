import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { ApiError } from './errors.js'

const searchSchema = z.object({ query: z.string().trim().min(1).max(200), only_unlinked: z.coerce.boolean().optional() }).strict()

export function createUserSearchRouter() {
  const router = Router()
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
      const input = searchSchema.parse(req.query)
      const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'system.users.list', p_classroom_id: null, p_class_session_id: null })
      if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to search users')
      const escapedQuery = input.query.replace(/[\\%_]/g, (character) => `\\${character}`)
      const pattern = `%${escapedQuery}%`
      const [emailMatches, nameMatches] = await Promise.all([
        req.adminDb.from('profiles').select('id,email,display_name,created_at').ilike('email', pattern).limit(20),
        req.adminDb.from('profiles').select('id,email,display_name,created_at').ilike('display_name', pattern).limit(20),
      ])
      if (emailMatches.error || nameMatches.error) throw new ApiError(502, 'USER_DIRECTORY_ERROR', 'The user directory is unavailable')
      const byId = new Map<string, { id: string; email: string; display_name: string | null; created_at: string; last_sign_in_at: null }>()
      for (const profile of [...(emailMatches.data ?? []), ...(nameMatches.data ?? [])]) {
        if (!profile.email || byId.has(profile.id)) continue
        byId.set(profile.id, { id: profile.id, email: profile.email, display_name: profile.display_name, created_at: profile.created_at, last_sign_in_at: null })
      }
      let users = [...byId.values()].slice(0, 20)
      if (input.only_unlinked) {
        const linked = await req.adminDb.from('teachers').select('user_id')
        if (linked.error) throw new ApiError(502, 'AUTH_PROVIDER_ERROR', 'The authentication provider is unavailable')
        const linkedIds = new Set((linked.data ?? []).map((row) => row.user_id).filter(Boolean))
        users = users.filter((user) => !linkedIds.has(user.id))
      }
      res.json({ data: users, meta: { limit: users.length, offset: 0, total: users.length, sort: 'email' }, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error) }
  })
  return router
}
