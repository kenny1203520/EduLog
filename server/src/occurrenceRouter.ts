import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'

const fields = 'id,class_session_id,occurrence_date,status,notes,original_start_time,original_end_time,actual_start_time,actual_end_time,teacher_ids,teacher_attendance,is_conducted,time_zone,created_at,updated_at'
const bodySchema = z.object({ status: z.enum(['scheduled', 'completed', 'cancelled']).optional(), notes: z.string().max(10000).nullable().optional(), actual_start_time: z.string().max(32).nullable().optional(), actual_end_time: z.string().max(32).nullable().optional(), teacher_attendance: z.record(z.string(), z.boolean()).optional(), is_conducted: z.boolean().optional() }).strict()
function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
async function authorize(req: Request, id: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const occurrence = await req.db.from('class_occurrences').select('class_session_id,occurrence_date').eq('id', id).maybeSingle(); if (occurrence.error) throw mapDatabaseError(occurrence.error); if (!occurrence.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'teaching.occurrences.update', p_classroom_id: null, p_class_session_id: occurrence.data.class_session_id }); if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to modify this occurrence')
  return occurrence.data
}
async function update(req: Request, res: Response) {
  if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Occurrence id is required')
  const context = await authorize(req, id); const input = bodySchema.parse(req.body)
  const session = await req.db.from('class_sessions').select('classroom_id').eq('id', context.class_session_id).maybeSingle(); if (session.error) throw mapDatabaseError(session.error)
  const holidays = await req.db.from('holidays').select('kind,classroom_ids,class_session_ids,teacher_ids').lte('start_date', context.occurrence_date).gte('end_date', context.occurrence_date); if (holidays.error) throw mapDatabaseError(holidays.error)
  const closure = (holidays.data ?? []).some((holiday) => holiday.kind === 'closure' && ((holiday.classroom_ids ?? []).includes(session.data?.classroom_id) || (holiday.class_session_ids ?? []).includes(context.class_session_id)))
  if (closure && (input.is_conducted === true || Object.values(input.teacher_attendance ?? {}).some(Boolean))) throw new ApiError(422, 'HOLIDAY_OCCURRENCE', 'Attendance cannot be marked present during a holiday')
  const leave = (holidays.data ?? []).find((holiday) => holiday.kind === 'teacher_leave' && (holiday.teacher_ids ?? []).some((teacherId: string) => input.teacher_attendance?.[teacherId] === true))
  if (leave) throw new ApiError(422, 'TEACHER_ON_LEAVE', 'Attendance cannot be marked present while a teacher is on leave')
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.from('class_occurrences').update(input).eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
async function remove(req: Request, res: Response) {
  if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Occurrence id is required')
  await authorize(req, id); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.from('class_occurrences').delete().eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
export function createOccurrenceRouter() { const router = Router(); router.patch('/occurrences/:id', wrap(update)); router.delete('/occurrences/:id', wrap(remove)); return router }
