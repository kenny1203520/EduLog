import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationDecision } from '../../auth/authorization.js'
import { matchScheduleRule, nextDate, type ScheduleRule } from '../../domain/occurrenceSchedule.js'
import { findReportProgressGaps } from '../../domain/reportProgressGaps.js'
import { envelope, permission, uuid, wrap } from './domainAccess.js'
import { assertOccurrencePermission, transferRpcError } from './transferRouter.js'

const fields = 'id,class_session_id,occurrence_date,status,notes,original_start_time,original_end_time,actual_start_time,actual_end_time,teacher_ids,teacher_attendance,is_conducted,time_zone,created_at,updated_at'
export const occurrenceBodySchema = z.object({ status: z.enum(['scheduled', 'completed', 'cancelled']).optional(), notes: z.string().max(10000).nullable().optional(), actual_start_time: z.string().max(32).nullable().optional(), actual_end_time: z.string().max(32).nullable().optional(), teacher_attendance: z.record(z.string(), z.boolean()).optional(), is_conducted: z.boolean().optional() }).strict()
async function authorize(req: Request, id: string, action: 'update' | 'delete' = 'update') {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const occurrence = await req.db.from('class_occurrences').select('class_session_id,occurrence_date').eq('id', id).maybeSingle(); if (occurrence.error) throw mapDatabaseError(occurrence.error); if (!occurrence.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  setAuditContext(req, { domain: 'teaching', resource: 'occurrences', resourceId: id, action, permission: `teaching.occurrences.${action}`, scopeId: occurrence.data.class_session_id, scopeType: 'class_session' })
  const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: `teaching.occurrences.${action}`, p_classroom_id: null, p_class_session_id: occurrence.data.class_session_id }); requireAuthorizationDecision(req, permission, { permission: `teaching.occurrences.${action}`, stage: 'occurrence_session_permission', message: 'You do not have permission to modify this occurrence', scopeId: occurrence.data.class_session_id, scopeType: 'class_session' })
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


async function generate(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const input = occurrenceGenerationSchema.parse(req.body)
  setAuditContext(req, { domain: 'teaching', resource: 'occurrences', action: 'create', permission: 'teaching.occurrences.create', scopeId: input.class_session_id, scopeType: 'class_session' })
  if (input.start_date > input.end_date) throw new ApiError(422, 'INVALID_DATE_RANGE', 'start_date must not be after end_date')
  const spanDays = Math.floor((Date.parse(`${input.end_date}T00:00:00Z`) - Date.parse(`${input.start_date}T00:00:00Z`)) / 86400000)
  if (!Number.isFinite(spanDays) || spanDays > 3660) throw new ApiError(422, 'DATE_RANGE_TOO_LARGE', 'The generation range is too large')
  const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'teaching.occurrences.create', p_classroom_id: null, p_class_session_id: input.class_session_id })
  requireAuthorizationDecision(req, permission, { permission: 'teaching.occurrences.create', stage: 'occurrence_generation_permission', message: 'You do not have permission to generate occurrences', scopeId: input.class_session_id, scopeType: 'class_session' })
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
  const rules = (session.data.class_session_schedule_rules ?? []) as ScheduleRule[]
  const skip = new Set(input.skip_existing_dates ?? [])
  const rows: Record<string, unknown>[] = []
  for (let date = input.start_date; date <= input.end_date; date = nextDate(date)) {
    if (skip.has(date) || (session.data.start_date && date < session.data.start_date) || (session.data.end_date && date > session.data.end_date)) continue
    const rule = matchScheduleRule(rules, date)
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
export const reportCompletionQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()

/** Counts each lesson's reports in a date range, for the class calendar's completion dot. */
export function summarizeReportCompletion(rows: Array<{ id: string; occurrence_date: string; occurrence_reports?: Array<{ is_completed: boolean | null }> | null }>) {
  return rows.map((row) => {
    const reports = row.occurrence_reports ?? []
    return { occurrence_id: row.id, occurrence_date: row.occurrence_date, total: reports.length, completed: reports.filter((report) => report.is_completed === true).length }
  })
}

async function reportCompletion(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const sessionId = z.string().uuid().parse(req.params.id)
  const query = reportCompletionQuery.parse(req.query)
  if (query.from > query.to) throw new ApiError(422, 'INVALID_DATE_RANGE', 'from must not be after to')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', action: 'list', permission: 'teaching.reports.list', scopeId: sessionId, scopeType: 'class_session' })
  const permission = await req.db.rpc('has_api_permission', { p_user_id: req.user.id, p_permission_key: 'teaching.reports.list', p_classroom_id: null, p_class_session_id: sessionId })
  requireAuthorizationDecision(req, permission, { permission: 'teaching.reports.list', stage: 'report_completion_permission', message: 'You do not have permission to list reports in this class', scopeId: sessionId, scopeType: 'class_session' })
  const result = await req.db.from('class_occurrences').select('id,occurrence_date,occurrence_reports(is_completed)').eq('class_session_id', sessionId).gte('occurrence_date', query.from).lte('occurrence_date', query.to).order('occurrence_date', { ascending: true }).limit(800)
  if (result.error) throw mapDatabaseError(result.error)
  const data = summarizeReportCompletion((result.data ?? []) as Parameters<typeof summarizeReportCompletion>[0])
  return res.json({ data, meta: { from: query.from, to: query.to, total: data.length }, request_id: req.requestId, trace_id: req.traceId })
}

// Occurrence reads, report provisioning and the effective roster.
const occurrenceFields = 'id,class_session_id,occurrence_date,status,original_start_time,original_end_time,actual_start_time,actual_end_time,time_zone,is_conducted,teacher_ids,teacher_attendance,created_at,updated_at,class_sessions(id,name,time_zone,classroom_id,classrooms(id,name,color))'
const reportFields = 'id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,lesson_entries,primary_lesson_entry_id,attendance_status,absence_reason,class_participation,classroom_behavior,contact_notes,contact_notes_document,class_notes,class_notes_document,content,content_document,external_link,source_origin,source_admission_id,source_report_id,version,last_edited_by,last_edited_at,created_at,updated_at'

const occurrenceQuery = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  class_session_id: uuid.optional(),
  session_ids: z.string().optional(),
  ids: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  sort: z.enum(['occurrence_date', '-occurrence_date', 'created_at', '-created_at']).default('occurrence_date'),
}).strict()

async function getOccurrence(req: Request, id: string) {
  const result = await req.db!.from('class_occurrences').select(occurrenceFields).eq('id', id).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  const session = Array.isArray(result.data.class_sessions) ? result.data.class_sessions[0] : result.data.class_sessions
  if (!session?.id) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  await permission(req, 'teaching.occurrences.read', session.id)
  return result.data
}

async function listOccurrences(req: Request, res: Response) {
  const query = occurrenceQuery.parse(req.query)
  if (query.start && query.end && query.start > query.end) throw new ApiError(422, 'INVALID_DATE_RANGE', 'end must not be before start')
  await permission(req, 'teaching.occurrences.list', query.class_session_id)
  let builder = req.db!.from('class_occurrences').select(occurrenceFields, { count: 'exact' })
  const sessionIds = query.session_ids?.split(',').filter(Boolean) ?? []
  const ids = query.ids?.split(',').filter(Boolean) ?? []
  if (sessionIds.length) {
    if (sessionIds.some((value) => !uuid.safeParse(value).success)) throw new ApiError(400, 'INVALID_QUERY', 'session_ids contains an invalid id')
    builder = builder.in('class_session_id', sessionIds)
  } else if (query.class_session_id) builder = builder.eq('class_session_id', query.class_session_id)
  if (ids.length) {
    if (ids.some((value) => !uuid.safeParse(value).success)) throw new ApiError(400, 'INVALID_QUERY', 'ids contains an invalid id')
    builder = builder.in('id', ids)
  }
  if (query.start) builder = builder.gte('occurrence_date', query.start)
  if (query.end) builder = builder.lte('occurrence_date', query.end)
  if (query.date) builder = builder.eq('occurrence_date', query.date)
  const descending = query.sort.startsWith('-')
  const field = descending ? query.sort.slice(1) : query.sort
  const result = await builder.order(field, { ascending: !descending }).range(query.offset, query.offset + query.limit - 1)
  if (result.error) throw mapDatabaseError(result.error)
  return res.json(envelope(req, result.data ?? [], { limit: query.limit, offset: query.offset, total: result.count ?? 0, sort: query.sort }))
}

async function occurrenceItem(req: Request, res: Response) {
  const id = uuid.parse(req.params.id)
  const data = await getOccurrence(req, id)
  return res.json(envelope(req, data))
}

/** Nearest occurrence of a session before (lt/lte) or after (gt) a date. */
function adjacentOccurrence(req: Request, sessionId: string, date: string, op: 'lt' | 'lte' | 'gt') {
  const builder = req.db!.from('class_occurrences').select(occurrenceFields).eq('class_session_id', sessionId)
  const filtered = op === 'gt' ? builder.gt('occurrence_date', date) : op === 'lt' ? builder.lt('occurrence_date', date) : builder.lte('occurrence_date', date)
  return filtered.order('occurrence_date', { ascending: op === 'gt' }).limit(1).maybeSingle()
}

/** Parses `:id` and `?date=` and checks occurrence read access on that session. */
async function readSessionDate(req: Request) {
  const sessionId = uuid.parse(req.params.id)
  const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(req.query)
  await permission(req, 'teaching.occurrences.read', sessionId)
  return { sessionId, query }
}

async function preferredOccurrence(req: Request, res: Response) {
  const { sessionId, query } = await readSessionDate(req)
  const previous = await adjacentOccurrence(req, sessionId, query.date, 'lte')
  if (previous.error) throw mapDatabaseError(previous.error)
  if (previous.data) return res.json(envelope(req, previous.data))
  const next = await adjacentOccurrence(req, sessionId, query.date, 'gt')
  if (next.error) throw mapDatabaseError(next.error)
  return res.json(envelope(req, next.data ?? null))
}

async function navigation(req: Request, res: Response) {
  const { sessionId, query } = await readSessionDate(req)
  const [previous, next] = await Promise.all([
    adjacentOccurrence(req, sessionId, query.date, 'lt'),
    adjacentOccurrence(req, sessionId, query.date, 'gt'),
  ])
  if (previous.error) throw mapDatabaseError(previous.error)
  if (next.error) throw mapDatabaseError(next.error)
  return res.json(envelope(req, { previous: previous.data ?? null, next: next.data ?? null }))
}

export async function provisionReports(req: Request, res: Response) {
  const occurrenceId = uuid.parse(req.params.occurrenceId)
  const occurrence = await req.db!.from('class_occurrences').select('id,class_session_id,occurrence_date').eq('id', occurrenceId).maybeSingle()
  if (occurrence.error) throw mapDatabaseError(occurrence.error)
  if (!occurrence.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  await permission(req, 'teaching.reports.create', occurrence.data.class_session_id)
  // This endpoint also returns report data. Check read access before any
  // provisioning side effects so create-only users do not create reports and
  // then receive a misleading authorization failure.
  await permission(req, 'teaching.reports.list', occurrence.data.class_session_id)
  const replay = await idempotency(req, 201, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const roster = await req.db!.rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })
  if (roster.error) throw mapDatabaseError(roster.error)
  const enrollmentIds = [...new Set(((roster.data ?? []) as Array<{ enrollment_id: string }>).map((row) => row.enrollment_id))]

  // Provisioning has a deliberately narrower scope (active regular
  // enrollments). Existing reports for completed and makeup students are
  // still part of the effective occurrence roster and must be returned.
  let missingCount = 0
  if (enrollmentIds.length) {
    const provisionable = await req.db!.rpc('get_provisionable_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })
    if (provisionable.error) throw mapDatabaseError(provisionable.error)
    const provisionableIds = [...new Set(((provisionable.data ?? []) as Array<{ enrollment_id: string }>).map((row) => row.enrollment_id))]
    if (provisionableIds.length) {
      const existing = await req.db!.from('occurrence_reports').select('enrollment_id').eq('class_occurrence_id', occurrenceId).in('enrollment_id', provisionableIds)
      if (existing.error) throw mapDatabaseError(existing.error)
      const existingIds = new Set((existing.data ?? []).map((row) => row.enrollment_id))
      missingCount = provisionableIds.filter((enrollmentId) => !existingIds.has(enrollmentId)).length
      const provision = await req.db!.rpc('provision_occurrence_reports', { p_occurrence_id: occurrenceId })
      if (provision.error) throw mapDatabaseError(provision.error)
    }
  }

  const reportsQuery = req.db!.from('occurrence_reports').select(reportFields).eq('class_occurrence_id', occurrenceId)
  const reports = enrollmentIds.length ? await reportsQuery.in('enrollment_id', enrollmentIds) : { data: [], error: null }
  if (reports.error) throw mapDatabaseError(reports.error)
  const body = envelope(req, reports.data ?? [], { provisioned: missingCount, total: reports.data?.length ?? 0 })
  await complete(req, 201, body)
  return res.status(201).json(body)
}

async function occurrenceReportProgressGaps(req: Request, res: Response) {
  if (!req.adminDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The report service is unavailable')
  const occurrenceId = uuid.parse(req.params.id)
  const query = z.object({ enrollment_ids: z.string().min(1).max(10000) }).strict().parse(req.query)
  const enrollmentIds = [...new Set(query.enrollment_ids.split(',').filter(Boolean))]
  if (!enrollmentIds.length || enrollmentIds.length > 100 || enrollmentIds.some((id) => !uuid.safeParse(id).success)) {
    throw new ApiError(400, 'INVALID_QUERY', 'enrollment_ids contains an invalid id')
  }

  const occurrence = await req.db!.from('class_occurrences').select('id,class_session_id,occurrence_date').eq('id', occurrenceId).maybeSingle()
  if (occurrence.error) throw mapDatabaseError(occurrence.error)
  if (!occurrence.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  await permission(req, 'teaching.reports.list', occurrence.data.class_session_id)

  const effectiveRoster = await req.db!.rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })
  if (effectiveRoster.error) throw mapDatabaseError(effectiveRoster.error)
  const effectiveIds = new Set(((effectiveRoster.data ?? []) as Array<{ enrollment_id: string }>).map((row) => row.enrollment_id))
  if (enrollmentIds.some((id) => !effectiveIds.has(id))) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found in this occurrence')

  const enrollments = await req.adminDb.from('enrollments').select('id,course_id').in('id', enrollmentIds)
  if (enrollments.error) throw mapDatabaseError(enrollments.error)
  if ((enrollments.data ?? []).length !== enrollmentIds.length) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  const courseIds = [...new Set((enrollments.data ?? []).map((row) => row.course_id).filter((id): id is string => Boolean(id)))]
  const courseIdByEnrollment = new Map((enrollments.data ?? []).map((enrollment) => [enrollment.id, enrollment.course_id]))

  const [lessonResult, currentReports] = await Promise.all([
    courseIds.length
      ? req.adminDb.from('lessons').select('id,course_id,sequence,title').in('course_id', courseIds).order('sequence', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    req.adminDb.from('occurrence_reports').select('enrollment_id,lesson_id,lesson_entries,primary_lesson_entry_id').eq('class_occurrence_id', occurrenceId),
  ])
  if (lessonResult.error) throw mapDatabaseError(lessonResult.error)
  if (currentReports.error) throw mapDatabaseError(currentReports.error)

  const priorReports: Array<{ enrollment_id: string; lesson_id: string }> = []
  for (const enrollmentId of enrollmentIds) {
    const [anchored, linked] = await Promise.all([
      req.adminDb.from('occurrence_reports').select('id,enrollment_id,lesson_id,lesson_entries,class_occurrences!inner(occurrence_date)').eq('enrollment_id', enrollmentId).eq('attendance_status', 'present').lt('class_occurrences.occurrence_date', occurrence.data.occurrence_date).range(0, 999),
      req.adminDb.from('occurrence_reports').select('id,enrollment_id,lesson_id,lesson_entries,class_occurrences!inner(occurrence_date)').contains('lesson_entries', [{ enrollment_id: enrollmentId }]).eq('attendance_status', 'present').lt('class_occurrences.occurrence_date', occurrence.data.occurrence_date).range(0, 999),
    ])
    if (anchored.error) throw mapDatabaseError(anchored.error)
    if (linked.error) throw mapDatabaseError(linked.error)
    const rows = new Map<string, Record<string, any>>()
    for (const report of [...(anchored.data ?? []), ...(linked.data ?? [])] as Array<Record<string, any>>) rows.set(report.id, report)
    for (const report of rows.values()) {
      const entries = Array.isArray(report.lesson_entries) ? report.lesson_entries as Array<Record<string, any>> : []
      const matching = entries.filter((entry) => entry.enrollment_id === enrollmentId && entry.course_id === courseIdByEnrollment.get(enrollmentId))
      if (matching.length) priorReports.push(...matching.filter((entry) => typeof entry.lesson_id === 'string').map((entry) => ({ enrollment_id: enrollmentId, lesson_id: entry.lesson_id as string })))
      else if (entries.length === 0 && report.enrollment_id === enrollmentId && typeof report.lesson_id === 'string') priorReports.push({ enrollment_id: enrollmentId, lesson_id: report.lesson_id })
    }
  }

  const lessonByCourse = new Map<string, Array<{ id: string; sequence: number; title: string }>>()
  for (const lesson of lessonResult.data ?? []) {
    const lessons = lessonByCourse.get(lesson.course_id) ?? []
    lessons.push({ id: lesson.id, sequence: lesson.sequence, title: lesson.title })
    lessonByCourse.set(lesson.course_id, lessons)
  }
  const recordedByEnrollment = new Map<string, string[]>()
  for (const report of priorReports) {
    const lessonIds = recordedByEnrollment.get(report.enrollment_id) ?? []
    lessonIds.push(report.lesson_id)
    recordedByEnrollment.set(report.enrollment_id, lessonIds)
  }
  const selectedLessonByEnrollment = new Map<string, string>()
  for (const report of currentReports.data ?? []) {
    const entries = Array.isArray(report.lesson_entries) ? report.lesson_entries as Array<Record<string, any>> : []
    const targetCourseId = courseIdByEnrollment.get(report.enrollment_id)
    const matching = entries.filter((entry) => entry.enrollment_id === report.enrollment_id && entry.course_id === targetCourseId)
    const primary = matching.find((entry) => entry.id === report.primary_lesson_entry_id) ?? matching[0]
    if (primary?.lesson_id) selectedLessonByEnrollment.set(report.enrollment_id, primary.lesson_id)
    else if (entries.length === 0 && report.lesson_id) selectedLessonByEnrollment.set(report.enrollment_id, report.lesson_id)
  }

  const summaries = enrollmentIds.map((enrollmentId) => {
    const courseId = courseIdByEnrollment.get(enrollmentId)
    return {
      enrollment_id: enrollmentId,
      gaps: findReportProgressGaps(
        courseId ? lessonByCourse.get(courseId) ?? [] : [],
        recordedByEnrollment.get(enrollmentId) ?? [],
        selectedLessonByEnrollment.get(enrollmentId),
      ),
    }
  })
  return res.json(envelope(req, summaries, { total: summaries.length }))
}

/** Effective roster (enrollment ids) of one occurrence, including single-lesson transfers. */
async function roster(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Occurrence id is required')
  await assertOccurrencePermission(req, id, 'read')
  const result = await req.db!.rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: id })
  if (result.error) throw transferRpcError(result.error)
  const data = ((result.data ?? []) as Array<{ enrollment_id: string }>).map((row) => row.enrollment_id)
  return res.json({ data, meta: { limit: data.length, offset: 0, total: data.length, sort: 'enrollment_id' }, request_id: req.requestId, trace_id: req.traceId })
}

export function createOccurrenceRouter() {
  const router = Router()
  router.get('/class-sessions/:id/report-completion', wrap(reportCompletion))
  router.post('/occurrences/generate', wrap(generate))
  router.patch('/occurrences/:id', wrap(update))
  router.delete('/occurrences/:id', wrap(remove))
  router.get('/occurrences', wrap(listOccurrences))
  router.get('/occurrences/:id/preferred', wrap(preferredOccurrence))
  router.get('/occurrences/:id/navigation', wrap(navigation))
  router.get('/occurrences/:id', wrap(occurrenceItem))
  router.get('/occurrences/:id/report-progress-gaps', wrap(occurrenceReportProgressGaps))
  router.post('/occurrences/:occurrenceId/reports', wrap(provisionReports))
  router.get('/occurrences/:id/roster', wrap(roster))
  return router
}
