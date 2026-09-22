import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './context.js'

const occurrenceFields = 'id,class_session_id,occurrence_date,status,original_start_time,original_end_time,actual_start_time,actual_end_time,time_zone,is_conducted,teacher_ids,teacher_attendance,created_at,updated_at,class_sessions(id,name,time_zone,classroom_id,classrooms(id,name,color))'
const reportFields = 'id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,attendance_status,absence_reason,class_participation,classroom_behavior,contact_notes,contact_notes_document,class_notes,class_notes_document,content,content_document,external_link,version,last_edited_by,last_edited_at,created_at,updated_at'
const reportPatchFields = ['lesson_id', 'is_completed', 'progress_letter', 'attendance_status', 'absence_reason', 'class_participation', 'classroom_behavior', 'contact_notes', 'contact_notes_document', 'class_notes', 'class_notes_document', 'content', 'content_document', 'external_link'] as const
const uuid = z.string().uuid()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

function envelope(req: Request, data: unknown, meta: Record<string, unknown> = {}) {
  return { data, meta, request_id: req.requestId, trace_id: req.traceId }
}

async function permission(req: Request, key: string, sessionId?: string | null) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const result = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: key,
    p_classroom_id: null,
    p_class_session_id: sessionId ?? null,
  })
  setAuditContext(req, { domain: 'teaching', permission: key, action: key.split('.').at(-1) ?? 'read', scopeId: sessionId ?? null, scopeType: sessionId ? 'class_session' : null })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to access this resource')
}

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

async function preferredOccurrence(req: Request, res: Response) {
  const sessionId = uuid.parse(req.params.id)
  const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(req.query)
  await permission(req, 'teaching.occurrences.read', sessionId)
  const previous = await req.db!.from('class_occurrences').select(occurrenceFields).eq('class_session_id', sessionId).lte('occurrence_date', query.date).order('occurrence_date', { ascending: false }).limit(1).maybeSingle()
  if (previous.error) throw mapDatabaseError(previous.error)
  if (previous.data) return res.json(envelope(req, previous.data))
  const next = await req.db!.from('class_occurrences').select(occurrenceFields).eq('class_session_id', sessionId).gt('occurrence_date', query.date).order('occurrence_date', { ascending: true }).limit(1).maybeSingle()
  if (next.error) throw mapDatabaseError(next.error)
  return res.json(envelope(req, next.data ?? null))
}

async function navigation(req: Request, res: Response) {
  const sessionId = uuid.parse(req.params.id)
  const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().parse(req.query)
  await permission(req, 'teaching.occurrences.read', sessionId)
  const [previous, next] = await Promise.all([
    req.db!.from('class_occurrences').select(occurrenceFields).eq('class_session_id', sessionId).lt('occurrence_date', query.date).order('occurrence_date', { ascending: false }).limit(1).maybeSingle(),
    req.db!.from('class_occurrences').select(occurrenceFields).eq('class_session_id', sessionId).gt('occurrence_date', query.date).order('occurrence_date', { ascending: true }).limit(1).maybeSingle(),
  ])
  if (previous.error) throw mapDatabaseError(previous.error)
  if (next.error) throw mapDatabaseError(next.error)
  return res.json(envelope(req, { previous: previous.data ?? null, next: next.data ?? null }))
}

const reportPatch = z.object({
  lesson_id: uuid.nullable().optional(), is_completed: z.boolean().optional(), progress_letter: z.string().regex(/^[A-Z](-[A-Z])?$/).max(32).nullable().optional(),
  attendance_status: z.enum(['present', 'absent', 'pending']).optional(), absence_reason: z.string().max(64).nullable().optional(),
  class_participation: z.number().min(0).max(5).nullable().optional(), classroom_behavior: z.number().min(0).max(5).nullable().optional(),
  contact_notes: z.string().max(10000).nullable().optional(), contact_notes_document: z.record(z.string(), z.unknown()).nullable().optional(),
  class_notes: z.string().max(10000).nullable().optional(), class_notes_document: z.record(z.string(), z.unknown()).nullable().optional(),
  content: z.string().max(10000).nullable().optional(), content_document: z.record(z.string(), z.unknown()).nullable().optional(), external_link: z.string().max(2048).nullable().optional(),
}).strict()

async function reportMutation(req: Request, reportId: string, patch: Record<string, unknown>, expectedVersion: number, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const context = await req.db.rpc('get_occurrence_report_mutation_context', { p_report_id: reportId, p_permission_key: 'teaching.reports.update' }).maybeSingle()
  if (context.error) throw mapDatabaseError(context.error)
  if (!context.data) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to modify this report')
  const mutationContext = context.data as { teaching_id?: string | null; class_occurrence_id?: string | null }
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: reportId, permission: 'teaching.reports.update', action: 'update', teachingId: mutationContext.teaching_id ?? null, scopeId: mutationContext.class_occurrence_id ?? null, scopeType: 'class_occurrence' })
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('apply_occurrence_report_lifecycle', { p_report_id: reportId, p_expected_version: expectedVersion, p_patch: patch, p_actor: req.user!.id, p_operation: 'update' })
  if (result.error) throw mapDatabaseError(result.error)
  const body = envelope(req, result.data)
  await complete(req, 200, body)
  return res.json(body)
}

async function restoreVersion(req: Request, res: Response) {
  const reportId = uuid.parse(req.params.reportId); const versionId = uuid.parse(req.params.versionId)
  const input = z.object({ expected_version: z.number().int().min(1) }).strict().parse(req.body)
  const version = await req.db!.from('report_versions').select('id,occurrence_report_id,version,snapshot,content').eq('id', versionId).eq('occurrence_report_id', reportId).maybeSingle()
  if (version.error) throw mapDatabaseError(version.error)
  if (!version.data) throw new ApiError(404, 'NOT_FOUND', 'Report version was not found')
  const snapshot: Record<string, unknown> = version.data.snapshot && typeof version.data.snapshot === 'object' ? version.data.snapshot as Record<string, unknown> : { content: version.data.content }
  const patch = Object.fromEntries(reportPatchFields.filter((field) => field in snapshot).map((field) => [field, snapshot[field]]))
  return reportMutation(req, reportId, reportPatch.parse(patch), input.expected_version, res)
}

async function resolveConflict(req: Request, res: Response) {
  const reportId = uuid.parse(req.params.reportId)
  const input = z.object({ expected_version: z.number().int().min(1), report: reportPatch }).strict().parse(req.body)
  return reportMutation(req, reportId, input.report, input.expected_version, res)
}

async function provisionReports(req: Request, res: Response) {
  const occurrenceId = uuid.parse(req.params.occurrenceId)
  const occurrence = await req.db!.from('class_occurrences').select('id,class_session_id,occurrence_date').eq('id', occurrenceId).maybeSingle()
  if (occurrence.error) throw mapDatabaseError(occurrence.error)
  if (!occurrence.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  await permission(req, 'teaching.reports.create', occurrence.data.class_session_id)
  const replay = await idempotency(req, 201, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const roster = await req.db!.rpc('get_provisionable_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })
  if (roster.error) throw mapDatabaseError(roster.error)
  const enrollmentIds = ((roster.data ?? []) as Array<{ enrollment_id: string }>).map((row) => row.enrollment_id)
  if (!enrollmentIds.length) { const body = envelope(req, []); await complete(req, 201, body); return res.status(201).json(body) }
  const existing = await req.db!.from('occurrence_reports').select('enrollment_id').eq('class_occurrence_id', occurrenceId).in('enrollment_id', enrollmentIds)
  if (existing.error) throw mapDatabaseError(existing.error)
  const existingIds = new Set((existing.data ?? []).map((row) => row.enrollment_id))
  const missingCount = enrollmentIds.filter((enrollmentId) => !existingIds.has(enrollmentId)).length
  const provision = await req.db!.rpc('provision_occurrence_reports', { p_occurrence_id: occurrenceId })
  if (provision.error) throw mapDatabaseError(provision.error)
  const reports = await req.db!.from('occurrence_reports').select(reportFields).eq('class_occurrence_id', occurrenceId).in('enrollment_id', enrollmentIds)
  if (reports.error) throw mapDatabaseError(reports.error)
  const body = envelope(req, reports.data ?? [], { provisioned: missingCount, total: reports.data?.length ?? 0 })
  await complete(req, 201, body)
  return res.status(201).json(body)
}

async function progressSummaryReports(req: Request, res: Response) {
  const query = z.object({
    enrollment_ids: z.string().min(1).max(10000),
    limit: z.coerce.number().int().min(1).max(1000).default(1000),
    sort: z.enum(['created_at', '-created_at', 'updated_at', '-updated_at']).default('-created_at'),
  }).strict().parse(req.query)
  const enrollmentIds = [...new Set(query.enrollment_ids.split(',').filter(Boolean))]
  if (enrollmentIds.length > 100 || enrollmentIds.some((id) => !uuid.safeParse(id).success)) throw new ApiError(400, 'INVALID_QUERY', 'enrollment_ids contains an invalid id')
  for (const enrollmentId of enrollmentIds) {
    const enrollment = await req.db!.from('enrollments').select('id,class_session_id').eq('id', enrollmentId).maybeSingle()
    if (enrollment.error) throw mapDatabaseError(enrollment.error)
    if (!enrollment.data) continue
    await permission(req, 'teaching.reports.list', enrollment.data.class_session_id)
  }
  const descending = query.sort.startsWith('-')
  const field = descending ? query.sort.slice(1) : query.sort
  const result = await req.db!.from('occurrence_reports').select('id,enrollment_id,lesson_id,is_completed,progress_letter,attendance_status,created_at,updated_at,class_occurrences(occurrence_date)').in('enrollment_id', enrollmentIds).order(field, { ascending: !descending }).limit(query.limit)
  if (result.error) throw mapDatabaseError(result.error)
  return res.json(envelope(req, result.data ?? [], { limit: query.limit, offset: 0, total: result.data?.length ?? 0, sort: query.sort }))
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
    original_last_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict().parse(req.body)
  const current = await req.db!.from('enrollments').select('id,course_id,class_session_id').eq('id', enrollmentId).maybeSingle()
  if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  if (!current.data.class_session_id) throw new ApiError(422, 'TRANSFER_INVALID', 'Enrollment has no current class session')
  if (current.data.class_session_id === input.target_class_session_id) throw new ApiError(422, 'TARGET_SESSION_SAME_AS_CURRENT', 'The target class session is already assigned')
  await permission(req, 'teaching.enrollments.update', current.data.class_session_id)
  const target = await req.db!.from('class_sessions').select('id,classroom_id,course_ids,teaching_id').eq('id', input.target_class_session_id).maybeSingle()
  if (target.error) throw mapDatabaseError(target.error); if (!target.data) throw new ApiError(404, 'NOT_FOUND', 'Target class session was not found')
  const courseIds = Array.isArray(target.data.course_ids) ? target.data.course_ids : []
  if (!courseIds.includes(current.data.course_id)) throw new ApiError(422, 'COURSE_MISMATCH', 'The target class session does not contain the enrollment course')
  await permission(req, 'teaching.enrollments.update', target.data.id)
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  // The write is performed with the caller JWT so enrollment RLS remains the
  // final boundary. Placeholder report migration is intentionally delegated to
  // the existing RLS/RPC lifecycle and is never performed with service-role.
  const updated = await req.db!.from('enrollments').update({ class_session_id: target.data.id, classroom_id: target.data.classroom_id ?? null }).eq('id', enrollmentId).select('id,student_id,course_id,classroom_id,class_session_id,status,lesson_number,updated_at').single()
  if (updated.error) throw mapDatabaseError(updated.error)
  const body = envelope(req, updated.data, { transfer_date: input.transfer_date, original_last_date: input.original_last_date ?? null })
  await complete(req, 200, body); return res.json(body)
}

async function bulkDeleteTeachers(req: Request, res: Response) {
  const input = z.object({ ids: z.array(uuid).min(1).max(100) }).strict().parse(req.body)
  await permission(req, 'teaching.teachers.delete')
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('teachers').delete().in('id', input.ids).select('id')
  if (result.error) throw mapDatabaseError(result.error)
  const body = envelope(req, { deleted_ids: (result.data ?? []).map((row) => row.id), requested: input.ids.length }); await complete(req, 200, body); return res.json(body)
}

async function putCopyTemplate(req: Request, res: Response) {
  const params = z.object({ templateType: z.string().trim().min(1).max(64), scopeType: z.string().trim().min(1).max(64), scopeEntityId: uuid }).parse(req.params)
  const input = z.object({ template_text: z.string().max(100000).nullable().optional(), template_document: z.record(z.string(), z.unknown()).nullable().optional() }).strict().parse(req.body)
  await permission(req, 'system.users.update')
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('copy_templates').upsert({ user_id: req.user!.id, template_type: params.templateType, scope_type: params.scopeType, scope_entity_id: params.scopeEntityId, ...input }, { onConflict: 'user_id,template_type,scope_type,scope_entity_id' }).select('id,user_id,template_type,scope_type,scope_entity_id,template_text,template_document,created_at,updated_at').single()
  if (result.error) throw mapDatabaseError(result.error)
  const body = envelope(req, result.data); await complete(req, 200, body); return res.json(body)
}

export function createDomainRouter() {
  const router = Router()
  router.get('/occurrences', wrap(listOccurrences))
  router.get('/occurrences/:id/preferred', wrap(preferredOccurrence))
  router.get('/occurrences/:id/navigation', wrap(navigation))
  router.get('/occurrences/:id', wrap(occurrenceItem))
  router.post('/occurrences/:occurrenceId/reports', wrap(provisionReports))
  router.get('/reports/progress-summary', wrap(progressSummaryReports))
  router.post('/reports/:reportId/versions/:versionId/restore', wrap(restoreVersion))
  router.post('/reports/:reportId/conflicts/resolve', wrap(resolveConflict))
  router.get('/enrollments/:id/progress', wrap(enrollmentProgress))
  router.post('/enrollments/:id/progress/recalculate', wrap(recalculateProgress))
  router.post('/enrollments/:id/transfers/class', wrap(transferClass))
  router.post('/teachers/bulk-delete', wrap(bulkDeleteTeachers))
  router.put('/copy-templates/:templateType/:scopeType/:scopeEntityId', wrap(putCopyTemplate))
  return router
}
