import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './http/context.js'
import { requireAuthorizationDecision } from './authorization.js'

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

async function remove(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Student id is required')
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Student id is invalid')
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'teaching', resource: 'students', resourceId: id, action: 'delete', permission: 'teaching.students.delete', scopeId: id, scopeType: 'student' })
  const permission = await req.db.rpc('can_access_student', {
    p_student_id: id,
    p_permission_key: 'teaching.students.delete',
  })
  requireAuthorizationDecision(req, permission, { permission: 'teaching.students.delete', stage: 'student_delete_scope_permission', message: 'You do not have permission to delete students', scopeId: id, scopeType: 'student' })
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

async function credentials(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : ''
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Student id is invalid')
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'teaching', resource: 'student-credentials', resourceId: id, action: 'read', permission: 'teaching.students.read_sensitive', scopeId: id, scopeType: 'student' })
  const permission = await req.db.rpc('can_access_sensitive_student', { p_student_id: id, p_permission_key: 'teaching.students.read_sensitive' })
  requireAuthorizationDecision(req, permission, { permission: 'teaching.students.read_sensitive', stage: 'student_sensitive_data_permission', message: 'You do not have permission to read student credentials', scopeId: id, scopeType: 'student' })
  const result = await req.db.from('student_credentials').select('id,student_id,platform,username,password,url,created_at,updated_at').eq('student_id', id).order('created_at', { ascending: true })
  if (result.error) throw mapDatabaseError(result.error)
  const body = { data: result.data ?? [], meta: { total: result.data?.length ?? 0 }, request_id: req.requestId, trace_id: req.traceId }
  return res.json(body)
}

export function createStudentRouter() {
  const router = Router()
  router.get('/students/:id/credentials', wrap(credentials))
  router.delete('/students/:id', wrap(remove))
  return router
}
