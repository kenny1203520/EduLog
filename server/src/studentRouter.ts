import { Router, type NextFunction, type Request, type Response } from 'express'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

async function remove(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Student id is required')
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const permission = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: 'teaching.students.delete',
    p_classroom_id: null,
    p_class_session_id: null,
  })
  if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to delete students')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)

  const enrollments = await req.db.from('enrollments').select('id').eq('student_id', id)
  if (enrollments.error) throw mapDatabaseError(enrollments.error)
  const enrollmentIds = (enrollments.data ?? []).map((row) => row.id).filter(Boolean)
  if (enrollmentIds.length) {
    const reports = await req.db.from('occurrence_reports').delete().in('enrollment_id', enrollmentIds)
    if (reports.error) throw mapDatabaseError(reports.error)
    const suspensions = await req.db.from('student_suspensions').delete().in('enrollment_id', enrollmentIds)
    if (suspensions.error && suspensions.error.code !== '42P01') throw mapDatabaseError(suspensions.error)
    const deletedEnrollments = await req.db.from('enrollments').delete().in('id', enrollmentIds)
    if (deletedEnrollments.error) throw mapDatabaseError(deletedEnrollments.error)
  }
  for (const table of ['student_contacts', 'student_schools', 'student_credentials'] as const) {
    const deleted = await req.db.from(table).delete().eq('student_id', id)
    if (deleted.error) throw mapDatabaseError(deleted.error)
  }
  const result = await req.db.from('students').delete().eq('id', id).select('id,name,notes,notes_document,external_link,user_id,created_at,updated_at').maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Student was not found')
  const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

export function createStudentRouter() {
  const router = Router()
  router.delete('/students/:id', wrap(remove))
  return router
}
