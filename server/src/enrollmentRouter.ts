import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'

const fields = 'id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,time_zone,koding_admission_id,user_id,created_at,updated_at,courses(subject,stage,display_name),classrooms(name,address),class_sessions(id,name,day_of_week,start_time,end_time,capacity,time_zone,session_type,schedule_mode,class_session_schedule_rules(id,schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)),students(name,email)'
const mutable = ['student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'start_date', 'lesson_number', 'external_link', 'time_zone', 'koding_admission_id'] as const
const bodySchema = z.object({
  student_id: z.string().uuid().optional(), course_id: z.string().uuid().optional(), classroom_id: z.string().uuid().nullable().optional(), class_session_id: z.string().uuid().nullable().optional(),
  status: z.enum(['trial', 'regular', 'dropped', 'completed']).optional(), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), lesson_number: z.number().int().min(0).nullable().optional(),
  external_link: z.string().max(2048).nullable().optional(), time_zone: z.string().min(1).max(64).optional(), koding_admission_id: z.string().max(255).nullable().optional(),
  target_report_count: z.number().int().min(0).max(200).optional(), target_total_reports: z.number().int().min(0).max(200).optional(),
}).strict()
type Input = z.infer<typeof bodySchema>
function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
function pick(input: Input) { return Object.fromEntries(Object.entries(input).filter(([key]) => (mutable as readonly string[]).includes(key))) }
async function authorize(req: Request, action: 'create' | 'update' | 'delete') {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const result = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'teaching.enrollments.' + action, p_classroom_id: null, p_class_session_id: null })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to modify enrollments')
}
async function align(req: Request, input: Record<string, unknown>, existing?: Record<string, unknown>) {
  const sessionId = input.class_session_id !== undefined ? input.class_session_id : existing?.class_session_id
  const courseId = input.course_id ?? existing?.course_id
  if (sessionId === null || sessionId === undefined || sessionId === '') return input
  if (typeof courseId !== 'string') throw new ApiError(422, 'COURSE_REQUIRED_FOR_SESSION', 'course_id is required when class_session_id is set')
  const result = await req.db!.from('class_sessions').select('id,classroom_id,course_ids').eq('id', sessionId).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(422, 'INVALID_REFERENCE', 'The class session is invalid')
  if (!Array.isArray(result.data.course_ids) || !result.data.course_ids.includes(courseId)) throw new ApiError(422, 'SESSION_COURSE_MISMATCH', 'The selected course is not scheduled for this class session')
  return { ...input, classroom_id: result.data.classroom_id ?? null }
}
async function provisionExistingReports(req: Request, enrollmentId: string, targetCount?: number) {
  if (!targetCount || targetCount <= 0) return
  const enrollment = await req.db!.from('enrollments').select('class_session_id,start_date').eq('id', enrollmentId).maybeSingle()
  if (enrollment.error || !enrollment.data?.class_session_id) return
  const startDate = enrollment.data.start_date ?? new Date().toISOString().slice(0, 10)
  const occurrences = await req.db!.from('class_occurrences').select('id').eq('class_session_id', enrollment.data.class_session_id).gte('occurrence_date', startDate).order('occurrence_date', { ascending: true }).limit(targetCount)
  if (occurrences.error || !occurrences.data?.length) return
  const ids = occurrences.data.map((row) => row.id)
  const existing = await req.db!.from('occurrence_reports').select('class_occurrence_id').eq('enrollment_id', enrollmentId).in('class_occurrence_id', ids)
  if (existing.error) throw mapDatabaseError(existing.error)
  const known = new Set((existing.data ?? []).map((row) => row.class_occurrence_id))
  const missing = occurrences.data.filter((row) => !known.has(row.id)).map((row) => ({ enrollment_id: enrollmentId, class_occurrence_id: row.id, content: '', version: 1, is_completed: false, attendance_status: 'pending' }))
  if (missing.length) { const inserted = await req.db!.from('occurrence_reports').insert(missing); if (inserted.error) throw mapDatabaseError(inserted.error) }
}
async function create(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  await authorize(req, 'create'); const input = bodySchema.parse(req.body); const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const payload = { ...(await align(req, pick(input))), user_id: req.user.id, status: input.status ?? 'regular', time_zone: input.time_zone ?? 'Asia/Taipei' }
  const result = await req.db.from('enrollments').insert(payload).select(fields).single(); if (result.error) throw mapDatabaseError(result.error)
  await provisionExistingReports(req, result.data.id, input.target_report_count)
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, envelope); return res.status(201).json(envelope)
}
async function update(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  await authorize(req, 'update'); const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const input = bodySchema.parse(req.body); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const previous = await req.db.from('enrollments').select('id,status,course_id,class_session_id').eq('id', id).maybeSingle(); if (previous.error) throw mapDatabaseError(previous.error); if (!previous.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  const result = await req.db.from('enrollments').update(await align(req, pick(input), previous.data)).eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  if (input.status === 'regular' && previous.data.status !== 'regular') await provisionExistingReports(req, id, input.target_total_reports)
  if (input.status === 'dropped' && previous.data.status !== 'dropped') {
    const pending = await req.db.from('occurrence_reports').select('id,content,class_notes,contact_notes,progress_letter,lesson_id').eq('enrollment_id', id).eq('is_completed', false).eq('attendance_status', 'pending'); if (pending.error) throw mapDatabaseError(pending.error)
    const deletable = (pending.data ?? []).filter((row) => !row.lesson_id && [row.content, row.class_notes, row.contact_notes, row.progress_letter].every((value) => !value?.trim())).map((row) => row.id)
    if (deletable.length) { const cleanup = await req.db.from('occurrence_reports').delete().in('id', deletable); if (cleanup.error) throw mapDatabaseError(cleanup.error) }
  }
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
async function remove(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  await authorize(req, 'delete'); const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const existing = await req.db.from('enrollments').select('id').eq('id', id).maybeSingle(); if (existing.error) throw mapDatabaseError(existing.error); if (!existing.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  const reports = await req.db.from('occurrence_reports').delete().eq('enrollment_id', id); if (reports.error) throw mapDatabaseError(reports.error)
  const suspensions = await req.db.from('student_suspensions').delete().eq('enrollment_id', id); if (suspensions.error && suspensions.error.code !== '42P01') throw mapDatabaseError(suspensions.error)
  const result = await req.db.from('enrollments').delete().eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
export function createEnrollmentRouter() { const router = Router(); router.post('/enrollments', wrap(create)); router.patch('/enrollments/:id', wrap(update)); router.delete('/enrollments/:id', wrap(remove)); return router }

