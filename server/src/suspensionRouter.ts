import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './http/context.js'
import { requireAuthorizationDecision } from './auth/authorization.js'

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
  requireAuthorizationDecision(req, permission, { permission: 'teaching.students.update', stage: 'suspension_enrollment_permission', message: 'You do not have permission to manage suspensions', scopeId: id, scopeType: 'enrollment' })
  return result.data
}

async function create(req: Request, res: Response) {
  const input = suspensionCreateSchema.parse(req.body); validRange(input.start_date, input.end_date)
  await enrollment(req, input.enrollment_id)
  const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('apply_student_suspension', {
    p_operation: 'create', p_enrollment_id: input.enrollment_id, p_start_date: input.start_date,
    p_end_date: input.end_date ?? null, p_time_zone: safeTimezone(input.time_zone), p_reason: input.reason ?? null,
  }).single()
  if (result.error) throw mapDatabaseError(result.error)
  const data = result.data as any
  setAuditContext(req, { resourceId: data?.id ?? null, scopeId: input.enrollment_id, permission: 'teaching.students.update', scopeType: 'enrollment' })
  const body = { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, body); return res.status(201).json(body)
}

async function update(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Suspension id is required')
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Suspension id is invalid')
  const input = suspensionUpdateSchema.parse(req.body)
  const current = await req.db!.from('student_suspensions').select(fields).eq('id', id).maybeSingle(); if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Suspension was not found')
  await enrollment(req, current.data.enrollment_id)
  const start = input.start_date ?? current.data.start_date; const end = input.end_date === undefined ? current.data.end_date : input.end_date; validRange(start, end)
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('apply_student_suspension', {
    p_operation: 'update', p_suspension_id: id, p_start_date: input.start_date ?? null,
    p_end_date: input.end_date === undefined ? current.data.end_date : input.end_date,
    p_time_zone: input.time_zone === undefined ? current.data.time_zone : safeTimezone(input.time_zone),
    p_reason: input.reason === undefined ? current.data.reason : input.reason,
    p_end_date_set: input.end_date !== undefined,
    p_reason_set: input.reason !== undefined,
  }).single(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Suspension was not found')
  const data = result.data as any
  setAuditContext(req, { resourceId: data.id, scopeId: data.enrollment_id, permission: 'teaching.students.update', scopeType: 'enrollment' })
  const body = { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
}

async function remove(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Suspension id is required')
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Suspension id is invalid')
  const current = await req.db!.from('student_suspensions').select(fields).eq('id', id).maybeSingle(); if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Suspension was not found')
  await enrollment(req, current.data.enrollment_id); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('apply_student_suspension', { p_operation: 'delete', p_suspension_id: id }).single(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Suspension was not found')
  const data = result.data as any
  setAuditContext(req, { resourceId: data.id, scopeId: data.enrollment_id, permission: 'teaching.students.update', scopeType: 'enrollment' })
  const body = { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
}

export function createSuspensionRouter() { const router = Router(); router.post('/student-suspensions', wrap(create)); router.patch('/student-suspensions/:id', wrap(update)); router.delete('/student-suspensions/:id', wrap(remove)); return router }
