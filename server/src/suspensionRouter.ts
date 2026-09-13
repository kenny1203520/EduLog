import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './context.js'

const fields = 'id,enrollment_id,start_date,end_date,time_zone,reason,created_at,updated_at'
export const suspensionCreateSchema = z.object({ enrollment_id: z.string().uuid(), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), time_zone: z.string().min(1).max(64).optional(), reason: z.string().max(2000).nullable().optional() }).strict()
export const suspensionUpdateSchema = suspensionCreateSchema.omit({ enrollment_id: true }).partial().strict()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
function validRange(start: string, end?: string | null) { if (end && end < start) throw new ApiError(422, 'INVALID_DATE_RANGE', 'end_date must not be before start_date') }
function safeTimezone(value?: string | null) { return value && value.length <= 64 ? value : 'Asia/Taipei' }

async function enrollment(req: Request, id: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'teaching', resource: 'student-suspensions', resourceId: null, action: 'manage', permission: 'teaching.students.update', scopeId: id, scopeType: 'enrollment' })
  const result = await req.db.from('enrollments').select('id,class_session_id').eq('id', id).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  const permission = await req.db.rpc('can_access_enrollment', { p_enrollment_id: id, p_permission_key: 'teaching.students.update' })
  if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to manage suspensions')
  return result.data
}

async function syncReports(req: Request, enrollmentId: string, start: string, end?: string | null) {
  let query = req.db!.from('class_occurrences').select('id').gte('occurrence_date', start)
  if (end) query = query.lte('occurrence_date', end)
  const occurrences = await query
  if (occurrences.error) throw mapDatabaseError(occurrences.error)
  const ids = (occurrences.data ?? []).map((row) => row.id)
  if (!ids.length) return
  const result = await req.db!.from('occurrence_reports').update({ attendance_status: 'absent', absence_reason: 'suspension' }).eq('enrollment_id', enrollmentId).in('class_occurrence_id', ids).or('content.eq.,content.is.null')
  if (result.error) throw mapDatabaseError(result.error)
}

async function revertReports(req: Request, suspension: { enrollment_id: string; start_date: string; end_date?: string | null }) {
  let query = req.db!.from('class_occurrences').select('id').gte('occurrence_date', suspension.start_date)
  if (suspension.end_date) query = query.lte('occurrence_date', suspension.end_date)
  const occurrences = await query
  if (occurrences.error) throw mapDatabaseError(occurrences.error)
  const ids = (occurrences.data ?? []).map((row) => row.id)
  if (!ids.length) return
  const result = await req.db!.from('occurrence_reports').update({ attendance_status: 'pending', absence_reason: null }).eq('enrollment_id', suspension.enrollment_id).in('class_occurrence_id', ids).eq('attendance_status', 'absent').eq('absence_reason', 'suspension')
  if (result.error) throw mapDatabaseError(result.error)
}

async function ensureReports(req: Request, enrollmentId: string, start: string, end?: string | null) {
  const enrollmentRow = await req.db!.from('enrollments').select('class_session_id').eq('id', enrollmentId).maybeSingle()
  if (enrollmentRow.error) throw mapDatabaseError(enrollmentRow.error)
  if (!enrollmentRow.data?.class_session_id) return
  let query = req.db!.from('class_occurrences').select('id').eq('class_session_id', enrollmentRow.data.class_session_id).eq('is_conducted', true).gte('occurrence_date', start)
  if (end) query = query.lte('occurrence_date', end)
  const occurrences = await query
  if (occurrences.error) throw mapDatabaseError(occurrences.error)
  const ids = (occurrences.data ?? []).map((row) => row.id)
  if (!ids.length) return
  const existing = await req.db!.from('occurrence_reports').select('class_occurrence_id').eq('enrollment_id', enrollmentId).in('class_occurrence_id', ids)
  if (existing.error) throw mapDatabaseError(existing.error)
  const known = new Set((existing.data ?? []).map((row) => row.class_occurrence_id))
  const missing = ids.filter((id) => !known.has(id)).map((class_occurrence_id) => ({ enrollment_id: enrollmentId, class_occurrence_id, content: '', version: 1, is_completed: false, attendance_status: 'pending' }))
  if (missing.length) { const result = await req.db!.from('occurrence_reports').insert(missing); if (result.error) throw mapDatabaseError(result.error) }
}

async function create(req: Request, res: Response) {
  const input = suspensionCreateSchema.parse(req.body); validRange(input.start_date, input.end_date)
  await enrollment(req, input.enrollment_id)
  const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const existing = await req.db!.from('student_suspensions').select('id,start_date,end_date').eq('enrollment_id', input.enrollment_id)
  if (existing.error) throw mapDatabaseError(existing.error)
  if ((existing.data ?? []).some((row) => input.start_date <= (row.end_date ?? '9999-12-31') && (input.end_date ?? '9999-12-31') >= row.start_date)) throw new ApiError(409, 'SUSPENSION_OVERLAP', 'Suspension period overlaps an existing suspension')
  const result = await req.db!.from('student_suspensions').insert({ ...input, time_zone: safeTimezone(input.time_zone) }).select(fields).single()
  if (result.error) throw mapDatabaseError(result.error)
  setAuditContext(req, { resourceId: result.data?.id ?? null, scopeId: input.enrollment_id, permission: 'teaching.students.update', scopeType: 'enrollment' })
  await syncReports(req, input.enrollment_id, input.start_date, input.end_date)
  const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, body); return res.status(201).json(body)
}

async function update(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Suspension id is required')
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Suspension id is invalid')
  const input = suspensionUpdateSchema.parse(req.body)
  const current = await req.db!.from('student_suspensions').select(fields).eq('id', id).maybeSingle(); if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Suspension was not found')
  await enrollment(req, current.data.enrollment_id)
  const start = input.start_date ?? current.data.start_date; const end = input.end_date === undefined ? current.data.end_date : input.end_date; validRange(start, end)
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('student_suspensions').update({ ...input, time_zone: input.time_zone === undefined ? undefined : safeTimezone(input.time_zone) }).eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Suspension was not found')
  setAuditContext(req, { resourceId: result.data.id, scopeId: result.data.enrollment_id, permission: 'teaching.students.update', scopeType: 'enrollment' })
  const shortened = Boolean(
    (current.data.end_date && result.data.end_date && result.data.end_date < current.data.end_date)
      || (!current.data.end_date && result.data.end_date),
  )
  if (shortened) {
    const revertStart = result.data.end_date
      ? new Date(Date.parse(result.data.end_date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)
      : current.data.start_date
    await revertReports(req, { enrollment_id: result.data.enrollment_id, start_date: revertStart, end_date: current.data.end_date })
    await ensureReports(req, result.data.enrollment_id, revertStart, current.data.end_date)
  }
  await syncReports(req, result.data.enrollment_id, result.data.start_date, result.data.end_date)
  const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
}

async function remove(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Suspension id is required')
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Suspension id is invalid')
  const current = await req.db!.from('student_suspensions').select(fields).eq('id', id).maybeSingle(); if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Suspension was not found')
  await enrollment(req, current.data.enrollment_id); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('student_suspensions').delete().eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Suspension was not found')
  setAuditContext(req, { resourceId: result.data.id, scopeId: result.data.enrollment_id, permission: 'teaching.students.update', scopeType: 'enrollment' })
  await revertReports(req, result.data)
  const body = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
}

export function createSuspensionRouter() { const router = Router(); router.post('/student-suspensions', wrap(create)); router.patch('/student-suspensions/:id', wrap(update)); router.delete('/student-suspensions/:id', wrap(remove)); return router }
