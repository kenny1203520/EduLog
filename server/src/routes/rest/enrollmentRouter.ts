import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationDecision, requireAuthorizationRpcDecision } from '../../auth/authorization.js'
import { ensurePlannedLessons, fillPlannedLessons } from '../../services/lessonProvisioning.js'
import { orderByRelation } from '../../services/relationOrder.js'
import { transferRpcError } from './transferRouter.js'
import { envelope, permission, uuid } from './domainAccess.js'

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
  // Always fill in scheduled lessons from the start date: lessons are usually
  // generated from today onward, so a back-dated start would otherwise skip
  // the lessons between it and today. Keep generating while cancelled lessons,
  // closures or lessons transferred away leave the count short.
  if (planned.target_count > 0) {
    await fillPlannedLessons(req, enrollment.class_session_id, planned.start_date, planned.target_count, async () => {
      const check = await call(true)
      if (check.error) throw mapDatabaseError(check.error)
      return (check.data as ReportSyncResult).missing_count
    })
  }
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
// Enrollment progress, class transfer and roster read models.
async function enrollmentReportProgressContext(req: Request, res: Response) {
  const enrollmentId = uuid.parse(req.params.id)
  const query = z.object({
    occurrence_id: uuid,
    report_id: uuid,
  }).strict().parse(req.query)
  const enrollment = await req.db!.from('enrollments').select('id,course_id').eq('id', enrollmentId).maybeSingle()
  if (enrollment.error) throw mapDatabaseError(enrollment.error)
  if (!enrollment.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  const occurrence = await req.db!.from('class_occurrences').select('id,class_session_id,occurrence_date').eq('id', query.occurrence_id).maybeSingle()
  if (occurrence.error) throw mapDatabaseError(occurrence.error)
  if (!occurrence.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  await permission(req, 'teaching.reports.list', occurrence.data.class_session_id)

  const currentReport = await req.db!.from('occurrence_reports').select('id,enrollment_id,class_occurrence_id').eq('id', query.report_id).maybeSingle()
  if (currentReport.error) throw mapDatabaseError(currentReport.error)
  if (currentReport.data?.enrollment_id !== enrollmentId || currentReport.data.class_occurrence_id !== occurrence.data.id) {
    throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
  }

  const lessons = await req.db!.from('lessons').select('id,sequence,title').eq('course_id', enrollment.data.course_id).order('sequence', { ascending: true })
  if (lessons.error) throw mapDatabaseError(lessons.error)

  const reports: Array<Record<string, any>> = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    let builder = req.db!.from('occurrence_reports')
      .select('id,lesson_id,is_completed,progress_letter,attendance_status,class_occurrences!inner(occurrence_date,actual_start_time,original_start_time)')
      .eq('enrollment_id', enrollmentId)
      .eq('attendance_status', 'present')
      .not('lesson_id', 'is', null)
      .lt('class_occurrences.occurrence_date', occurrence.data.occurrence_date)
    builder = orderByRelation(builder.neq('id', query.report_id), 'class_occurrences', 'occurrence_date', true).order('id', { ascending: true })
    const result = await builder.range(offset, offset + pageSize - 1)
    if (result.error) throw mapDatabaseError(result.error)
    const page = (result.data ?? []) as Array<Record<string, any>>
    reports.push(...page)
    if (page.length < pageSize) break
  }

  const lessonById = new Map((lessons.data ?? []).map((lesson) => [lesson.id, lesson]))
  const summaries = reports
    .filter((report) => lessonById.has(report.lesson_id))
    .map((report) => ({
      id: report.id,
      lesson_id: report.lesson_id,
      is_completed: report.is_completed,
      progress_letter: report.progress_letter,
      attendance_status: report.attendance_status,
      occurrence_date: Array.isArray(report.class_occurrences) ? report.class_occurrences[0]?.occurrence_date : report.class_occurrences?.occurrence_date,
    }))
  const latestPriorReport = summaries.at(-1) ?? null
  return res.json(envelope(req, { enrollment_id: enrollmentId, occurrence_date: occurrence.data.occurrence_date, lessons: lessons.data ?? [], reports: summaries, latest_prior_report: latestPriorReport }))
}

async function enrollmentProgress(req: Request, res: Response) {
  const enrollmentId = uuid.parse(req.params.id)
  const enrollment = await req.db!.from('enrollments').select('id,course_id,lesson_number,status,class_session_id').eq('id', enrollmentId).maybeSingle()
  if (enrollment.error) throw mapDatabaseError(enrollment.error)
  if (!enrollment.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  await permission(req, 'teaching.enrollments.read', enrollment.data.class_session_id)
  const lessons = await req.db!.from('lessons').select('id,sequence,title').eq('course_id', enrollment.data.course_id).order('sequence', { ascending: true })
  const reports = await req.db!.from('occurrence_reports').select('lesson_id,is_completed').eq('enrollment_id', enrollmentId).not('lesson_id', 'is', null)
  if (lessons.error) throw mapDatabaseError(lessons.error); if (reports.error) throw mapDatabaseError(reports.error)
  const completed = new Set((reports.data ?? []).filter((row) => row.is_completed).map((row) => row.lesson_id))
  const nextLesson = (lessons.data ?? []).find((lesson) => !completed.has(lesson.id)) ?? null
  return res.json(envelope(req, { enrollment_id: enrollmentId, current_lesson_number: enrollment.data.lesson_number, next_lesson: nextLesson, completed_lesson_ids: [...completed] }))
}

async function recalculateProgress(req: Request, res: Response) {
  const enrollmentId = uuid.parse(req.params.id)
  const enrollment = await req.db!.from('enrollments').select('id,course_id,lesson_number,class_session_id').eq('id', enrollmentId).maybeSingle()
  if (enrollment.error) throw mapDatabaseError(enrollment.error); if (!enrollment.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  await permission(req, 'teaching.enrollments.update', enrollment.data.class_session_id)
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const [lessons, reports] = await Promise.all([
    req.db!.from('lessons').select('id,sequence').eq('course_id', enrollment.data.course_id).order('sequence', { ascending: true }),
    req.db!.from('occurrence_reports').select('lesson_id,is_completed').eq('enrollment_id', enrollmentId).not('lesson_id', 'is', null),
  ])
  if (lessons.error) throw mapDatabaseError(lessons.error); if (reports.error) throw mapDatabaseError(reports.error)
  const completed = new Set((reports.data ?? []).filter((row) => row.is_completed).map((row) => row.lesson_id))
  const lessonNumber = (lessons.data ?? []).find((lesson) => !completed.has(lesson.id))?.sequence ?? enrollment.data.lesson_number ?? 1
  const updated = await req.db!.from('enrollments').update({ lesson_number: lessonNumber }).eq('id', enrollmentId).select('id,lesson_number').single()
  if (updated.error) throw mapDatabaseError(updated.error)
  const body = envelope(req, updated.data); await complete(req, 200, body); return res.json(body)
}

async function transferClass(req: Request, res: Response) {
  const enrollmentId = uuid.parse(req.params.id)
  const input = z.object({
    target_class_session_id: uuid,
    transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    note: z.string().trim().max(200).nullable().optional(),
  }).strict().parse(req.body)
  const current = await req.db!.from('enrollments').select('id,course_id,class_session_id,start_date').eq('id', enrollmentId).maybeSingle()
  if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  if (!current.data.class_session_id) throw new ApiError(422, 'TRANSFER_INVALID', 'Enrollment has no current class session')
  await permission(req, 'teaching.enrollments.update', current.data.class_session_id)
  const target = await req.db!.from('class_sessions').select('id,classroom_id,course_ids,teaching_id').eq('id', input.target_class_session_id).maybeSingle()
  if (target.error) throw mapDatabaseError(target.error); if (!target.data) throw new ApiError(404, 'NOT_FOUND', 'Target class session was not found')
  const courseIds = Array.isArray(target.data.course_ids) ? target.data.course_ids : []
  if (!courseIds.includes(current.data.course_id)) throw new ApiError(422, 'COURSE_MISMATCH', 'The target class session does not contain the enrollment course')
  await permission(req, 'teaching.enrollments.update', target.data.id)
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  // Generate the target class's lessons first so the student keeps the same
  // number of reports: one per report on/after the date, plus the target
  // lessons that cannot hold one (cancelled or rescheduled).
  const effectiveDate = current.data.start_date && current.data.start_date > input.transfer_date ? current.data.start_date : input.transfer_date
  const [later, unusable] = await Promise.all([
    req.db!.from('occurrence_reports').select('id,class_occurrences!inner(occurrence_date)', { count: 'exact', head: true }).eq('enrollment_id', enrollmentId).gte('class_occurrences.occurrence_date', effectiveDate),
    req.db!.from('class_occurrences').select('id', { count: 'exact', head: true }).eq('class_session_id', target.data.id).gte('occurrence_date', effectiveDate).in('status', ['cancelled', 'rescheduled']),
  ])
  if (later.error) throw mapDatabaseError(later.error); if (unusable.error) throw mapDatabaseError(unusable.error)
  await ensurePlannedLessons(req, target.data.id, effectiveDate, (later.count ?? 0) + (unusable.count ?? 0))
  // The RPC runs with the caller JWT and re-checks both class permissions. It
  // rewrites the class history from the date, keeps reports with content in
  // place, moves blank placeholders, keeps the report count and logs the
  // transfer in enrollment_class_transfers.
  const transferred = await req.db!.rpc('transfer_enrollment_class', { p_enrollment_id: enrollmentId, p_target_session_id: target.data.id, p_effective_date: input.transfer_date, p_note: input.note || null })
  if (transferred.error) throw transferRpcError(transferred.error)
  const summary = (transferred.data ?? {}) as { transfer_id?: string; effective_date?: string; moved_reports?: number; created_reports?: number; removed_placeholders?: number; retained_reports?: unknown[]; missing_count?: number }
  const updated = await req.db!.from('enrollments').select('id,student_id,course_id,classroom_id,class_session_id,status,lesson_number,updated_at').eq('id', enrollmentId).single()
  if (updated.error) throw mapDatabaseError(updated.error)
  const body = envelope(req, updated.data, { transfer_id: summary.transfer_id ?? null, transfer_date: summary.effective_date ?? input.transfer_date, moved_reports: summary.moved_reports ?? 0, created_reports: summary.created_reports ?? 0, removed_placeholders: summary.removed_placeholders ?? 0, retained_reports: summary.retained_reports ?? [], missing_count: summary.missing_count ?? 0 })
  await complete(req, 200, body); return res.json(body)
}

/** Class history, transfer log, single-lesson transfers and report placements for one enrollment. */
async function enrollmentClassTimeline(req: Request, res: Response) {
  const enrollmentId = uuid.parse(req.params.id)
  const enrollment = await req.db!.from('enrollments').select('id,class_session_id').eq('id', enrollmentId).maybeSingle()
  if (enrollment.error) throw mapDatabaseError(enrollment.error); if (!enrollment.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  await permission(req, 'teaching.enrollments.read', enrollment.data.class_session_id)
  const result = await req.db!.rpc('get_enrollment_class_timeline', { p_enrollment_id: enrollmentId })
  if (result.error) throw transferRpcError(result.error)
  return res.json(envelope(req, result.data))
}

const rosterFlagsQuery = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()

/** Students who joined or left a class lesson by transfer within a date range (at most 120 days). */
async function classSessionRosterFlags(req: Request, res: Response) {
  const sessionId = uuid.parse(req.params.id)
  const query = rosterFlagsQuery.parse(req.query)
  if (query.start > query.end) throw new ApiError(422, 'INVALID_DATE_RANGE', 'end must not be before start')
  if ((Date.parse(query.end) - Date.parse(query.start)) / 86400000 > 120) throw new ApiError(422, 'INVALID_DATE_RANGE', 'The range must not exceed 120 days')
  await permission(req, 'teaching.class_sessions.read', sessionId)
  const result = await req.db!.rpc('get_class_session_roster_flags', { p_session_id: sessionId, p_start: query.start, p_end: query.end })
  if (result.error) throw transferRpcError(result.error)
  return res.json(envelope(req, result.data ?? [], { start: query.start, end: query.end }))
}

// Enrollment history browsing and binding are authorized inside the
// SECURITY DEFINER `enrollment_history_access` RPC, which runs with the caller's
// user JWT. The BFF only names the operation; it never widens the RPC surface.
export const enrollmentHistoryOperations = ['list', 'candidates', 'bind-preview', 'bind-apply'] as const
const enrollmentHistoryOperation = z.enum(enrollmentHistoryOperations)
const historyText = z.string().max(200)
const historyDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
/** Every key the RPC reads from p_input; unknown keys are rejected before the database call. */
export const enrollmentHistoryInput = z.object({
  id: z.string().uuid(), student_id: z.string().uuid(), enrollment_id: z.string().uuid(), course_id: z.string().uuid(),
  history_id: z.string().uuid(), history_version: z.number().int(), class_occurrence_id: z.string().uuid(), key: z.string().uuid(),
  cursor: historyText, limit: z.number().int().min(1).max(100), sort: historyText, unlinked_only: z.boolean(),
  anchor_date: historyDate, date_from: historyDate, date_to: historyDate, dates: z.array(historyDate).max(100),
  source_admission_id: historyText, overwrite: z.array(historyText).max(50), include_internal: z.boolean(), include_fields: z.array(historyText).max(50),
}).partial().strict()
async function enrollmentHistory(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const operation = enrollmentHistoryOperation.safeParse(req.params.operation)
  if (!operation.success) throw new ApiError(404, 'NOT_FOUND', 'Route was not found')
  const input = enrollmentHistoryInput.parse(req.body ?? {})
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const { data, error } = await req.db.rpc('enrollment_history_access', { p_operation: operation.data, p_input: input })
  if (error) throw mapDatabaseError(error)
  const body = { data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, body); return res.json(body)
}
export function createEnrollmentRouter() {
  const router = Router()
  router.post('/enrollments', wrap(create))
  router.patch('/enrollments/:id', wrap(update))
  router.get('/enrollments/:id/start-date-impact', wrap(startDateImpact))
  router.delete('/enrollments/:id', wrap(remove))
  router.post('/enrollment-history/:operation', wrap(enrollmentHistory))
  router.get('/enrollments/:id/report-progress-context', wrap(enrollmentReportProgressContext))
  router.get('/enrollments/:id/progress', wrap(enrollmentProgress))
  router.post('/enrollments/:id/progress/recalculate', wrap(recalculateProgress))
  router.post('/enrollments/:id/transfers/class', wrap(transferClass))
  router.get('/enrollments/:id/class-timeline', wrap(enrollmentClassTimeline))
  router.get('/class-sessions/:id/roster-flags', wrap(classSessionRosterFlags))
  return router
}

