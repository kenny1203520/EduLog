import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { envelope, uuid, wrap } from './domainAccess.js'
import { authorizeResource } from '../../auth/authorization.js'
import { resources } from './resources.js'
import { setAuditContext } from '../../http/context.js'

async function bulkDeleteTeachers(req: Request, res: Response) {
  const input = z.object({ ids: z.array(uuid).min(1).max(100) }).strict().parse(req.body)
  // Same per-teacher check as a single delete, so class-level grants work
  // for bulk deletes too and nothing outside the caller's scope is deleted.
  for (const id of new Set(input.ids)) await authorizeResource(req, resources.teachers, 'teaching.teachers.delete', id)
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  if (!req.adminDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The teacher service is unavailable')
  const result = await req.adminDb.from('teacher_records').delete().in('id', input.ids).select('id')
  if (result.error) throw mapDatabaseError(result.error)
  const body = envelope(req, { deleted_ids: (result.data ?? []).map((row) => row.id), requested: input.ids.length }); await complete(req, 200, body); return res.json(body)
}

/** Archive or restore a teacher (set_teacher_archived checks platform teaching.teachers.update). */
async function setArchived(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = uuid.parse(req.params.id)
  const input = z.object({ archived: z.boolean() }).strict().parse(req.body)
  setAuditContext(req, { domain: 'teaching', resource: 'teachers', resourceId: id, action: 'update', permission: 'teaching.teachers.update', scopeType: 'system' })
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.rpc('set_teacher_archived', { p_teacher_id: id, p_archived: input.archived })
  if (result.error) throw mapDatabaseError(result.error)
  const body = envelope(req, result.data); await complete(req, 200, body); return res.json(body)
}

export function createTeacherRouter() {
  const router = Router()
  router.post('/teachers/bulk-delete', wrap(bulkDeleteTeachers))
  router.patch('/teachers/:id/archive', wrap(setArchived))
  return router
}
