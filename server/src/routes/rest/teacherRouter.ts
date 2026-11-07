import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { envelope, permission, uuid, wrap } from './domainAccess.js'

async function bulkDeleteTeachers(req: Request, res: Response) {
  const input = z.object({ ids: z.array(uuid).min(1).max(100) }).strict().parse(req.body)
  await permission(req, 'teaching.teachers.delete')
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  if (!req.adminDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The teacher service is unavailable')
  const result = await req.adminDb.from('teacher_records').delete().in('id', input.ids).select('id')
  if (result.error) throw mapDatabaseError(result.error)
  const body = envelope(req, { deleted_ids: (result.data ?? []).map((row) => row.id), requested: input.ids.length }); await complete(req, 200, body); return res.json(body)
}

export function createTeacherRouter() {
  const router = Router()
  router.post('/teachers/bulk-delete', wrap(bulkDeleteTeachers))
  return router
}
