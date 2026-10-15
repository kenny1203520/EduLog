import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationDecision, requireAuthorizationRpcDecision } from '../../auth/authorization.js'

const fields = 'id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,time_zone,koding_admission_id,user_id,created_at,updated_at,courses(subject,stage,display_name),classrooms(name,address),class_sessions(id,name,day_of_week,start_time,end_time,capacity,time_zone,session_type,schedule_mode,class_session_schedule_rules(id,schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)),students(name)'
const mutable = ['student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'start_date', 'lesson_number', 'external_link', 'time_zone', 'koding_admission_id'] as const
export const enrollmentBodySchema = z.object({
  student_id: z.string().uuid().optional(), course_id: z.string().uuid().optional(), classroom_id: z.string().uuid().nullable().optional(), class_session_id: z.string().uuid().nullable().optional(),
  status: z.enum(['trial', 'regular', 'dropped', 'completed']).optional(), start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), lesson_number: z.number().int().min(0).nullable().optional(),
  external_link: z.string().max(2048).nullable().optional(), time_zone: z.string().min(1).max(64).optional(), koding_admission_id: z.string().max(255).nullable().optional(),
  target_report_count: z.number().int().min(0).max(200).optional(), target_total_reports: z.number().int().min(0).max(200).optional(),
}).strict()
export const enrollmentCreateSchema = enrollmentBodySchema.required({ student_id: true, course_id: true })
type Input = z.infer<typeof enrollmentBodySchema>
function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
function pick(input: Input) { return Object.fromEntries(Object.entries(input).filter(([key]) => (mutable as readonly string[]).includes(key))) }
async function authorizeExisting(req: Request, action: 'update' | 'delete', enrollmentId: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'teaching', resource: 'enrollments', resourceId: enrollmentId, action, permission: `teaching.enrollments.${action}`, scopeId: enrollmentId, scopeType: 'enrollment' })
  const result = await req.db.rpc('can_access_enrollment', { p_enrollment_id: enrollmentId, p_permission_key: 'teaching.enrollments.' + action })
  requireAuthorizationDecision(req, result, {
    permission: `teaching.enrollments.${action}`,
    stage: 'enrollment_existing_scope',
    message: 'You do not have permission to modify enrollments',
    scopeId: enrollmentId,
    scopeType: 'enrollment',
  })
}

async function authorizeScope(req: Request, action: 'create' | 'update', input: Record<string, unknown>, existing?: Record<string, unknown>) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const studentId = (input.student_id ?? existing?.student_id) as string | null | undefined
  const sessionId = (input.class_session_id ?? existing?.class_session_id) as string | null | undefined
  const classroomId = (input.classroom_id ?? existing?.classroom_id) as string | null | undefined
  const courseId = (input.course_id ?? existing?.course_id) as string | null | undefined
  const teachingIds = new Set<string>()
  let session: { teaching_id?: string | null; classroom_id?: string | null; course_ids?: unknown } | null = null
  if (sessionId) {
    const result = await req.db.from('class_sessions').select('teaching_id,classroom_id,course_ids').eq('id', sessionId).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data) throw new ApiError(422, 'INVALID_REFERENCE', 'The class session is invalid')
    session = result.data
    if (typeof session.teaching_id === 'string') teachingIds.add(session.teaching_id)
    if (classroomId && session.classroom_id && classroomId !== session.classroom_id) throw new ApiError(422, 'SESSION_CLASSROOM_MISMATCH', 'The selected classroom is not assigned to this class session')
    if (courseId && Array.isArray(session.course_ids) && !session.course_ids.includes(courseId)) throw new ApiError(422, 'SESSION_COURSE_MISMATCH', 'The selected course is not scheduled for this class session')
  }
  if (classroomId) {
    const result = await req.db.from('classrooms').select('teaching_id').eq('id', classroomId).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data?.teaching_id) throw new ApiError(422, 'INVALID_REFERENCE', 'The classroom is invalid')
    teachingIds.add(result.data.teaching_id)
  }
  if (courseId) {
    const result = await req.db.from('courses').select('teaching_id').eq('id', courseId).maybeSingle()
    if (result.error) throw mapDatabaseError(result.error)
    if (!result.data?.teaching_id) throw new ApiError(422, 'INVALID_REFERENCE', 'The course is invalid')
    teachingIds.add(result.data.teaching_id)
  }
  if (teachingIds.size !== 1) throw new ApiError(422, 'TEACHING_SCOPE_REQUIRED', 'Enrollment references must resolve to one teaching')
  setAuditContext(req, { domain: 'teaching', resource: 'enrollments', action, permission: `teaching.enrollments.${action}`, teachingId: [...teachingIds][0] })
  if (!studentId) throw new ApiError(422, 'STUDENT_REQUIRED', 'student_id is required')
  if (action === 'create') {
    const studentRead = req.db.rpc('has_teaching_permission', {
      p_user_id: req.user.id,
      p_permission_key: 'teaching.students.read',
      p_teaching_id: [...teachingIds][0],
      p_classroom_id: classroomId ?? session?.classroom_id ?? null,
      p_class_session_id: sessionId ?? null,
    })
    await requireAuthorizationRpcDecision(req, studentRead, {
      permission: 'teaching.students.read',
      stage: 'enrollment_student_read_permission',
      message: 'You do not have permission to read students in this scope',
      teachingId: [...teachingIds][0],
      scopeId: sessionId ?? classroomId ?? null,
      scopeType: sessionId ? 'class_session' : classroomId ? 'classroom' : 'teaching',
    })
  }
  const scoped = req.db.rpc('can_access_enrollment_scope', {
    p_student_id: studentId,
    p_course_id: courseId ?? null,
    p_classroom_id: classroomId ?? session?.classroom_id ?? null,
    p_class_session_id: sessionId ?? null,
    p_permission_key: 'teaching.enrollments.' + action,
  })
  await requireAuthorizationRpcDecision(req, scoped, {
    permission: `teaching.enrollments.${action}`,
    stage: 'enrollment_student_and_teaching_scope',
    message: 'You do not have permission to modify enrollments',
    teachingId: [...teachingIds][0],
    scopeId: sessionId ?? classroomId ?? null,
    scopeType: sessionId ? 'class_session' : classroomId ? 'classroom' : 'teaching',
  })
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
async function provisionExistingReports(req: Request, enrollment: { id: string; class_session_id: string | null; start_date: string | null }, targetCount?: number) {
  if (!targetCount || targetCount <= 0) return
  if (!enrollment.class_session_id) return
  if (!req.adminDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The enrollment service is unavailable')
  setAuditContext(req, { authorizationStage: 'enrollment_report_provisioning', authorizationResult: 'allowed' })
  const startDate = enrollment.start_date ?? new Date().toISOString().slice(0, 10)
  const occurrences = await req.adminDb.from('class_occurrences').select('id').eq('class_session_id', enrollment.class_session_id).gte('occurrence_date', startDate).order('occurrence_date', { ascending: true }).limit(targetCount)
  if (occurrences.error) {
    req.log.warn({ event: 'enrollment_occurrence_lookup_failed', database_error_code: occurrences.error.code ?? 'UNKNOWN' }, 'enrollment_occurrence_lookup_failed')
    throw mapDatabaseError(occurrences.error)
  }
  for (const occurrence of occurrences.data ?? []) {
    const provision = await req.db!.rpc('provision_occurrence_reports', { p_occurrence_id: occurrence.id })
    if (provision.error) {
      req.log.warn({ event: 'enrollment_report_provisioning_failed', database_error_code: provision.error.code ?? 'UNKNOWN' }, 'enrollment_report_provisioning_failed')
      throw mapDatabaseError(provision.error)
    }
  }
}
async function create(req: Request, res: Response) {
  if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const input = enrollmentCreateSchema.parse(req.body); const aligned = await align(req, pick(input)); await authorizeScope(req, 'create', aligned); const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const payload = { ...aligned, user_id: req.user.id, status: input.status ?? 'regular', time_zone: input.time_zone ?? 'Asia/Taipei' }
  // Explicit permission checks above authorize this exact student and target
  // scope. Return only the inserted row through the server client so creation
  // does not also require the separate enrollment read/list policy.
  setAuditContext(req, { authorizationStage: 'enrollment_create_write', authorizationResult: 'allowed' })
  const result = await req.adminDb.from('enrollments').insert(payload).select(fields).single()
  if (result.error) {
    req.log.warn({ event: 'enrollment_create_write_failed', database_error_code: result.error.code ?? 'UNKNOWN' }, 'enrollment_create_write_failed')
    throw mapDatabaseError(result.error)
  }
  await provisionExistingReports(req, result.data, input.target_report_count)
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, envelope); return res.status(201).json(envelope)
}
async function update(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const input = enrollmentBodySchema.parse(req.body); const previous = await req.db.from('enrollments').select('id,status,student_id,course_id,classroom_id,class_session_id').eq('id', id).maybeSingle(); if (previous.error) throw mapDatabaseError(previous.error); if (!previous.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  await authorizeExisting(req, 'update', id); const aligned = await align(req, pick(input), previous.data); await authorizeScope(req, 'update', aligned, previous.data); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.from('enrollments').update(aligned).eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  if (input.status === 'regular' && previous.data.status !== 'regular') await provisionExistingReports(req, result.data, input.target_total_reports)
  if (input.status === 'dropped' && previous.data.status !== 'dropped') {
    const pending = await req.db.from('occurrence_reports').select('id,content,class_notes,contact_notes,progress_letter,lesson_id').eq('enrollment_id', id).eq('is_completed', false).eq('attendance_status', 'pending'); if (pending.error) throw mapDatabaseError(pending.error)
    const deletable = (pending.data ?? []).filter((row) => !row.lesson_id && [row.content, row.class_notes, row.contact_notes, row.progress_letter].every((value) => !value?.trim())).map((row) => row.id)
    if (deletable.length) { const cleanup = await req.db.from('occurrence_reports').delete().in('id', deletable); if (cleanup.error) throw mapDatabaseError(cleanup.error) }
  }
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
async function remove(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const existing = await req.db.from('enrollments').select('id,student_id,course_id,classroom_id,class_session_id').eq('id', id).maybeSingle(); if (existing.error) throw mapDatabaseError(existing.error); if (!existing.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  await authorizeExisting(req, 'delete', id); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const reports = await req.db.from('occurrence_reports').delete().eq('enrollment_id', id); if (reports.error) throw mapDatabaseError(reports.error)
  const suspensions = await req.db.from('student_suspensions').delete().eq('enrollment_id', id); if (suspensions.error && suspensions.error.code !== '42P01') throw mapDatabaseError(suspensions.error)
  const result = await req.db.from('enrollments').delete().eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
export function createEnrollmentRouter() { const router = Router(); router.post('/enrollments', wrap(create)); router.patch('/enrollments/:id', wrap(update)); router.delete('/enrollments/:id', wrap(remove)); return router }

