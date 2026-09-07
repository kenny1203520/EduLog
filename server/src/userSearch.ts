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
      const result = await req.adminDb.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (result.error) throw new ApiError(502, 'AUTH_PROVIDER_ERROR', 'The authentication provider is unavailable')
      const query = input.query.toLowerCase()
      const users = result.data.users
        .filter((user) => Boolean(user.email && user.email.toLowerCase().includes(query)))
        .map((user) => ({ id: user.id, email: user.email!, created_at: user.created_at, last_sign_in_at: user.last_sign_in_at ?? null }))
      res.json({ data: users, meta: { limit: users.length, offset: 0, total: users.length, sort: 'email' }, request_id: req.requestId, trace_id: req.traceId })
    } catch (error) { next(error) }
  })
  return router
}