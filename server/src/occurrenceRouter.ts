import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './context.js'

const fields = 'id,class_session_id,occurrence_date,status,notes,original_start_time,original_end_time,actual_start_time,actual_end_time,teacher_ids,teacher_attendance,is_conducted,time_zone,created_at,updated_at'
export const occurrenceBodySchema = z.object({ status: z.enum(['scheduled', 'completed', 'cancelled']).optional(), notes: z.string().max(10000).nullable().optional(), actual_start_time: z.string().max(32).nullable().optional(), actual_end_time: z.string().max(32).nullable().optional(), teacher_attendance: z.record(z.string(), z.boolean()).optional(), is_conducted: z.boolean().optional() }).strict()
function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
async function authorize(req: Request, id: string, action: 'update' | 'delete' = 'update') {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const occurrence = await req.db.from('class_occurrences').select('class_session_id,occurrence_date').eq('id', id).maybeSingle(); if (occurrence.error) throw mapDatabaseError(occurrence.error); if (!occurrence.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  setAuditContext(req, { domain: 'teaching', resource: 'occurrences', resourceId: id, action, permission: `teaching.occurrences.${action}`, scopeId: occurrence.data.class_session_id, scopeType: 'class_session' })
  const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: `teaching.occurrences.${action}`, p_classroom_id: null, p_class_session_id: occurrence.data.class_session_id }); if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to modify this occurrence')
  return occurrence.data
}
async function update(req: Request, res: Response) {
  if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Occurrence id is required')
  const context = await authorize(req, id); const input = occurrenceBodySchema.parse(req.body)
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
  await authorize(req, id, 'delete'); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.from('class_occurrences').delete().eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
export const occurrenceGenerationSchema = z.object({
  class_session_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  skip_existing_dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(3660).optional(),
}).strict()

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

async function generate(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const input = occurrenceGenerationSchema.parse(req.body)
  setAuditContext(req, { domain: 'teaching', resource: 'occurrences', action: 'create', permission: 'teaching.occurrences.create', scopeId: input.class_session_id, scopeType: 'class_session' })
  if (input.start_date > input.end_date) throw new ApiError(422, 'INVALID_DATE_RANGE', 'start_date must not be after end_date')
  const spanDays = Math.floor((Date.parse(`${input.end_date}T00:00:00Z`) - Date.parse(`${input.start_date}T00:00:00Z`)) / 86400000)
  if (!Number.isFinite(spanDays) || spanDays > 3660) throw new ApiError(422, 'DATE_RANGE_TOO_LARGE', 'The generation range is too large')
  const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'teaching.occurrences.create', p_classroom_id: null, p_class_session_id: input.class_session_id })
  if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to generate occurrences')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const session = await req.db.from('class_sessions').select('id,user_id,start_date,end_date,time_zone,session_type,schedule_mode,class_session_schedule_rules(schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)').eq('id', input.class_session_id).maybeSingle()
  if (session.error) throw mapDatabaseError(session.error)
  if (!session.data) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found')
  const existing = await req.db.from('class_occurrences').select('occurrence_date,teacher_attendance,time_zone').eq('class_session_id', input.class_session_id).gte('occurrence_date', input.start_date).lte('occurrence_date', input.end_date)
  if (existing.error) throw mapDatabaseError(existing.error)
  const existingByDate = new Map((existing.data ?? []).map((row) => [row.occurrence_date, row]))
  const assignments = await req.db.from('class_session_teachers').select('teacher_id,effective_from,effective_to').eq('class_session_id', input.class_session_id)
  if (assignments.error) throw mapDatabaseError(assignments.error)
  const rules = (session.data.class_session_schedule_rules ?? []) as Array<{ schedule_kind: string; day_of_week: number | null; day_of_month: number | null; occurrence_date: string | null; start_time: string; end_time: string }>
  const skip = new Set(input.skip_existing_dates ?? [])
  const rows: Record<string, unknown>[] = []
  for (let date = input.start_date; date <= input.end_date; date = nextDate(date)) {
    if (skip.has(date) || (session.data.start_date && date < session.data.start_date) || (session.data.end_date && date > session.data.end_date)) continue
    const day = new Date(`${date}T00:00:00Z`).getUTCDay()
    const rule = rules.find((candidate) => candidate.schedule_kind === 'specific_dates' ? candidate.occurrence_date === date : candidate.schedule_kind === 'monthly' ? candidate.day_of_month === Number(date.slice(8, 10)) : candidate.day_of_week === day)
    if (!rule) continue
    const activeTeachers = assignments.data.filter((assignment) => assignment.effective_from <= date && (!assignment.effective_to || assignment.effective_to >= date)).map((assignment) => assignment.teacher_id)
    const teacherIds = [...new Set(activeTeachers.length ? activeTeachers : [session.data.user_id].filter(Boolean))]
    const previous = existingByDate.get(date)
    rows.push({ class_session_id: input.class_session_id, occurrence_date: date, status: 'scheduled', original_start_time: rule.start_time, original_end_time: rule.end_time, time_zone: previous?.time_zone || session.data.time_zone || 'Asia/Taipei', is_conducted: true, teacher_ids: teacherIds, teacher_attendance: previous?.teacher_attendance || Object.fromEntries(teacherIds.map((id) => [id, true])) })
  }
  if (!rows.length) {
    const body = { data: [], meta: { generated: 0 }, request_id: req.requestId, trace_id: req.traceId }
    await complete(req, 200, body)
    return res.json(body)
  }
  const result = await req.db.from('class_occurrences').upsert(rows, { onConflict: 'class_session_id,occurrence_date' }).select(fields)
  if (result.error) throw mapDatabaseError(result.error)
  const body = { data: result.data ?? [], meta: { generated: result.data?.length ?? 0 }, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}
export function createOccurrenceRouter() { const router = Router(); router.post('/occurrences/generate', wrap(generate)); router.patch('/occurrences/:id', wrap(update)); router.delete('/occurrences/:id', wrap(remove)); return router }
