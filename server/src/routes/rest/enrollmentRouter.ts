import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationDecision, requireAuthorizationRpcDecision } from '../../auth/authorization.js'
import { matchScheduleRule, plannedLessonDates, type ScheduleRule } from '../../domain/occurrenceSchedule.js'

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
type ReportSyncResult = {
  start_date: string
  target_count: number
  created_dates: string[]
  removed_dates: string[]
  fixed_before_start_dates: string[]
  missing_count: number
}

/** Today's calendar date in the enrollment's time zone (not the server's UTC date). */
export function todayIn(timeZone: string, now = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) }
  catch { return now.toISOString().slice(0, 10) }
}

/**
 * Inserts lessons the schedule rules call for but that were never generated,
 * so a new enrollment can get its full report count. Insert-only: existing
 * lessons, including cancelled ones, are left untouched. A caller without
 * occurrence-create permission simply keeps the lessons that already exist.
 */
async function ensurePlannedLessons(req: Request, sessionId: string, fromDate: string, count: number) {
  if (count <= 0) return
  const session = await req.db!.from('class_sessions').select('id,user_id,start_date,end_date,time_zone,class_session_schedule_rules(schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)').eq('id', sessionId).maybeSingle()
  const sessionRow = session.data
  if (session.error || !sessionRow) return
  const rules = (sessionRow.class_session_schedule_rules ?? []) as ScheduleRule[]
  const dates = plannedLessonDates(rules, sessionRow, fromDate, count)
  if (!dates.length) return
  const existing = await req.db!.from('class_occurrences').select('occurrence_date').eq('class_session_id', sessionId).in('occurrence_date', dates)
  if (existing.error) return
  const existingDates = new Set((existing.data ?? []).map((row) => row.occurrence_date))
  const missing = dates.filter((date) => !existingDates.has(date))
  if (!missing.length) return
  const assignments = await req.db!.from('class_session_teachers').select('teacher_id,effective_from,effective_to').eq('class_session_id', sessionId)
  if (assignments.error) return
  const rows = missing.map((date) => {
    const rule = matchScheduleRule(rules, date)!
    const active = (assignments.data ?? []).filter((assignment) => assignment.effective_from <= date && (!assignment.effective_to || assignment.effective_to >= date)).map((assignment) => assignment.teacher_id)
    const teacherIds = [...new Set(active.length ? active : [sessionRow.user_id].filter(Boolean))]
    return { class_session_id: sessionId, occurrence_date: date, status: 'scheduled', original_start_time: rule.start_time, original_end_time: rule.end_time, time_zone: sessionRow.time_zone || 'Asia/Taipei', is_conducted: true, teacher_ids: teacherIds, teacher_attendance: Object.fromEntries(teacherIds.map((id) => [id, true])) }
  })
  const inserted = await req.db!.from('class_occurrences').upsert(rows, { onConflict: 'class_session_id,occurrence_date', ignoreDuplicates: true })
  if (inserted.error) req.log.warn({ event: 'enrollment_lesson_generation_skipped', database_error_code: inserted.error.code ?? 'UNKNOWN' }, 'enrollment_lesson_generation_skipped')
}

/**
 * Places this enrollment's blank placeholder reports on its first eligible
 * lessons from the start date (see sync_enrollment_reports). Reports with
 * content are never moved or deleted.
 */
async function syncEnrollmentReports(req: Request, enrollment: { id: string; class_session_id: string | null }, options: { targetCount?: number; startDate?: string; dryRun?: boolean } = {}): Promise<ReportSyncResult | null> {
  if (!enrollment.class_session_id) return null
  setAuditContext(req, { authorizationStage: 'enrollment_report_provisioning', authorizationResult: 'allowed' })
  const call = (dryRun: boolean) => req.db!.rpc('sync_enrollment_reports', { p_enrollment_id: enrollment.id, p_target_count: options.targetCount ?? null, p_start_date: options.startDate ?? null, p_dry_run: dryRun })
  const plan = await call(true)
  if (plan.error) {
    req.log.warn({ event: 'enrollment_report_provisioning_failed', database_error_code: plan.error.code ?? 'UNKNOWN' }, 'enrollment_report_provisioning_failed')
    throw mapDatabaseError(plan.error)
  }
  if (options.dryRun) return plan.data as ReportSyncResult
  const planned = plan.data as ReportSyncResult
  // Leave headroom for cancelled lessons and lessons transferred away.
  if (planned.missing_count > 0) await ensurePlannedLessons(req, enrollment.class_session_id, planned.start_date, planned.target_count + planned.missing_count + 4)
  const result = await call(false)
  if (result.error) {
    req.log.warn({ event: 'enrollment_report_provisioning_failed', database_error_code: result.error.code ?? 'UNKNOWN' }, 'enrollment_report_provisioning_failed')
    throw mapDatabaseError(result.error)
  }
  return result.data as ReportSyncResult
}

async function create(req: Request, res: Response) {
  if (!req.db || !req.adminDb || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const input = enrollmentCreateSchema.parse(req.body); const aligned = await align(req, pick(input)); await authorizeScope(req, 'create', aligned); const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const timeZone = input.time_zone ?? 'Asia/Taipei'
  const payload = { ...aligned, user_id: req.user.id, status: input.status ?? 'regular', time_zone: timeZone, start_date: input.start_date ?? todayIn(timeZone) }
  // Explicit permission checks above authorize this exact student and target
  // scope. Return only the inserted row through the server client so creation
  // does not also require the separate enrollment read/list policy.
  setAuditContext(req, { authorizationStage: 'enrollment_create_write', authorizationResult: 'allowed' })
  const result = await req.adminDb.from('enrollments').insert(payload).select(fields).single()
  if (result.error) {
    req.log.warn({ event: 'enrollment_create_write_failed', database_error_code: result.error.code ?? 'UNKNOWN' }, 'enrollment_create_write_failed')
    throw mapDatabaseError(result.error)
  }
  const reports = input.target_report_count ? await syncEnrollmentReports(req, result.data, { targetCount: input.target_report_count }) : null
  const envelope = { data: result.data, meta: reports ? { report_sync: reports } : {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, envelope); return res.status(201).json(envelope)
}
async function update(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const input = enrollmentBodySchema.parse(req.body); const previous = await req.db.from('enrollments').select('id,status,start_date,student_id,course_id,classroom_id,class_session_id').eq('id', id).maybeSingle(); if (previous.error) throw mapDatabaseError(previous.error); if (!previous.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  await authorizeExisting(req, 'update', id); const aligned = await align(req, pick(input), previous.data); await authorizeScope(req, 'update', aligned, previous.data); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.from('enrollments').update(aligned).eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  let reports: ReportSyncResult | null = null
  if (input.status === 'regular' && previous.data.status !== 'regular' && input.target_total_reports) reports = await syncEnrollmentReports(req, result.data, { targetCount: input.target_total_reports })
  // A new start date shifts the same number of placeholders; content is kept.
  else if (input.start_date && input.start_date !== previous.data.start_date && result.data.status !== 'dropped') reports = await syncEnrollmentReports(req, result.data)
  if (input.status === 'dropped' && previous.data.status !== 'dropped') {
    const pending = await req.db.from('occurrence_reports').select('id,content,class_notes,contact_notes,progress_letter,lesson_id').eq('enrollment_id', id).eq('is_completed', false).eq('attendance_status', 'pending'); if (pending.error) throw mapDatabaseError(pending.error)
    const deletable = (pending.data ?? []).filter((row) => !row.lesson_id && [row.content, row.class_notes, row.contact_notes, row.progress_letter].every((value) => !value?.trim())).map((row) => row.id)
    if (deletable.length) { const cleanup = await req.db.from('occurrence_reports').delete().in('id', deletable); if (cleanup.error) throw mapDatabaseError(cleanup.error) }
  }
  const envelope = { data: result.data, meta: reports ? { report_sync: reports } : {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
/** Previews what a start-date edit would do to the enrollment's reports. */
async function startDateImpact(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const query = z.object({ start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(req.query)
  await authorizeExisting(req, 'update', id)
  const enrollment = await req.db.from('enrollments').select('id,class_session_id').eq('id', id).maybeSingle(); if (enrollment.error) throw mapDatabaseError(enrollment.error); if (!enrollment.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  const plan = await syncEnrollmentReports(req, enrollment.data, { startDate: query.start_date, dryRun: true })
  return res.json({ data: plan, meta: {}, request_id: req.requestId, trace_id: req.traceId })
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
export function createEnrollmentRouter() { const router = Router(); router.post('/enrollments', wrap(create)); router.patch('/enrollments/:id', wrap(update)); router.get('/enrollments/:id/start-date-impact', wrap(startDateImpact)); router.delete('/enrollments/:id', wrap(remove)); return router }

