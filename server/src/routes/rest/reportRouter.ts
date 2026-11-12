import { Router, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { initialReportAttendance } from '../../domain/reportSemantics.js'
import { setAuditContext } from '../../http/context.js'
import { requireAuthorizationDecision } from '../../auth/authorization.js'
import { measureReportAdoptions } from '../../ai/adoption/adoptionTracker.js'
import { envelope, permission, uuid, wrap } from './domainAccess.js'

const fields = 'id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,lesson_entries,primary_lesson_entry_id,attendance_status,absence_reason,class_participation,classroom_behavior,contact_notes,contact_notes_document,class_notes,class_notes_document,content,content_document,external_link,source_origin,source_admission_id,source_report_id,version,last_edited_by,last_edited_at,created_at,updated_at'
const writable = ['lesson_id', 'is_completed', 'progress_letter', 'lesson_entries', 'primary_lesson_entry_id', 'attendance_status', 'absence_reason', 'class_participation', 'classroom_behavior', 'contact_notes', 'contact_notes_document', 'class_notes', 'class_notes_document', 'content', 'content_document', 'external_link'] as const
const reportLessonEntrySchema = z.object({
  id: uuid,
  enrollment_id: uuid,
  course_id: uuid,
  lesson_id: uuid,
  is_completed: z.boolean(),
  progress_letter: z.string().regex(/^[A-Z](-[A-Z])?$/).max(32).nullable(),
}).strict()
export const reportBodySchema = z.object({
  enrollment_id: z.string().uuid().optional(), class_occurrence_id: z.string().uuid().optional(), lesson_id: z.string().uuid().nullable().optional(),
  is_completed: z.boolean().optional(), progress_letter: z.string().regex(/^[A-Z](-[A-Z])?$/).max(32).nullable().optional(), attendance_status: z.enum(['present', 'absent', 'pending']).optional(), absence_reason: z.string().max(64).nullable().optional(),
  lesson_entries: z.array(reportLessonEntrySchema).max(25).optional(), primary_lesson_entry_id: uuid.nullable().optional(),
  class_participation: z.number().min(0).max(5).nullable().optional(), classroom_behavior: z.number().min(0).max(5).nullable().optional(),
  contact_notes: z.string().max(10000).nullable().optional(), contact_notes_document: z.record(z.string(), z.unknown()).nullable().optional(), class_notes: z.string().max(10000).nullable().optional(), class_notes_document: z.record(z.string(), z.unknown()).nullable().optional(),
  content: z.string().max(10000).nullable().optional(), content_document: z.record(z.string(), z.unknown()).nullable().optional(), external_link: z.string().max(2048).nullable().optional(),
  expected_version: z.number().int().min(1).optional(),
}).strict()
export const reportCreateSchema = reportBodySchema.omit({ expected_version: true, lesson_entries: true, primary_lesson_entry_id: true }).required({ enrollment_id: true, class_occurrence_id: true })
export const reportUpdateSchema = reportBodySchema.omit({ enrollment_id: true, class_occurrence_id: true }).required({ expected_version: true })
export const reportCollaborationSchema = z.object({ snapshot_base64: z.string().max(1400000), base_report_version: z.number().int().min(1) }).strict()
type Body = z.infer<typeof reportBodySchema>
type MutationContext = {
  report_id: string
  version: number
  attendance_status: string
  absence_reason: string | null
  enrollment_id: string
  class_occurrence_id: string
  teaching_id: string
  classroom_id: string | null
  class_session_id: string
  lesson_id: string | null
  is_completed: boolean
}
  export function assertClientManagedAttendanceReason(reason: string | null | undefined) {
    if (reason === 'holiday' || reason === 'suspension') throw new ApiError(422, 'SYSTEM_MANAGED_ATTENDANCE', 'Holiday and suspension attendance are managed by the server')
  }
  export function assertReportAttendanceUpdate(current: { absence_reason: string | null; attendance_status: string }, input: Pick<Body, 'absence_reason' | 'attendance_status'>) {
    const systemManaged = current.absence_reason === 'holiday' || current.absence_reason === 'suspension'
    if (!systemManaged) assertClientManagedAttendanceReason(input.absence_reason)
    if (systemManaged && ((input.attendance_status !== undefined && input.attendance_status !== current.attendance_status) || (input.absence_reason !== undefined && input.absence_reason !== current.absence_reason))) {
      throw new ApiError(422, 'SYSTEM_MANAGED_REPORT', 'Attendance is managed by the system')
    }
  }
export function firstUncompletedSequence(lessons: Array<{ id: string; sequence: number }>, representedLessonIds: Set<string>, currentLessonNumber: number) {
  return lessons.find((lesson) => !representedLessonIds.has(lesson.id))?.sequence ?? currentLessonNumber
}
function reportId(req: Request) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id || !z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Report id is invalid')
  return id
}
async function canAccess(req: Request, id: string, permission: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, action: permission.split('.').at(-1) ?? 'read', permission, scopeType: 'occurrence_report' })
  const rpcName = permission.endsWith('.update') || permission.endsWith('.delete') ? 'can_mutate_occurrence_report' : 'can_access_report'
  const result = await req.db.rpc(rpcName, { p_report_id: id, p_permission_key: permission })
  requireAuthorizationDecision(req, result, { permission, stage: 'report_scope_permission', message: 'You do not have permission to access this report', scopeId: id, scopeType: 'report' })
}
function pick(input: Body) { return Object.fromEntries(Object.entries(input).filter(([key]) => (writable as readonly string[]).includes(key))) }

function replayBody(req: Request, row: { response_status?: number | null; response_body?: unknown }) {
  const stored = row.response_body && typeof row.response_body === 'object' ? row.response_body as Record<string, unknown> : null
  if (stored && 'error' in stored && stored.error && typeof stored.error === 'object') {
    return { ...(stored as object), error: { ...(stored.error as Record<string, unknown>), request_id: req.requestId, trace_id: req.traceId }, request_id: req.requestId, trace_id: req.traceId }
  }
  return stored ? { ...stored, request_id: req.requestId, trace_id: req.traceId } : { data: row.response_body ?? null, meta: {}, request_id: req.requestId, trace_id: req.traceId }
}

async function replayDeletedReport(req: Request, id: string) {
  const key = req.header('idempotency-key')?.trim()
  if (!key || !req.user || !req.adminDb) return null
  const result = await req.adminDb.rpc('replay_deleted_report_idempotency', {
    p_user_id: req.user.id,
    p_key: key,
    p_method: req.method,
    p_route: req.originalUrl.split('?')[0],
    p_resource_id: id,
    p_permission_key: 'teaching.reports.delete',
  })
  if (result.error) throw mapDatabaseError(result.error)
  const row = (Array.isArray(result.data) ? result.data[0] : result.data) as { is_replay?: boolean; response_status?: number | null; response_body?: unknown } | null
  return row?.is_replay ? { status: row.response_status ?? 200, body: replayBody(req, row) } : null
}

async function reconcileEnrollmentProgress(req: Request, enrollmentId: string) {
  const enrollment = await req.db!.from('enrollments').select('course_id,lesson_number').eq('id', enrollmentId).maybeSingle()
  if (enrollment.error) throw mapDatabaseError(enrollment.error)
  if (!enrollment.data?.course_id) return
  const lessons = await req.db!.from('lessons').select('id,sequence').eq('course_id', enrollment.data.course_id).order('sequence', { ascending: true })
  if (lessons.error) throw mapDatabaseError(lessons.error)
  const reports = await req.db!.from('occurrence_reports').select('lesson_id,is_completed').eq('enrollment_id', enrollmentId).not('lesson_id', 'is', null)
  if (reports.error) throw mapDatabaseError(reports.error)
  const represented = new Set((reports.data ?? []).filter((row) => row.is_completed === true).map((row) => row.lesson_id).filter((id): id is string => typeof id === 'string'))
  const nextLesson = firstUncompletedSequence((lessons.data ?? []) as Array<{ id: string; sequence: number }>, represented, enrollment.data.lesson_number ?? 1)
  if (nextLesson !== enrollment.data.lesson_number) {
    const updated = await req.db!.from('enrollments').update({ lesson_number: nextLesson }).eq('id', enrollmentId)
    if (updated.error) throw mapDatabaseError(updated.error)
  }
}

async function ensureNextOccurrenceReport(req: Request, enrollmentId: string, reportId: string) {
  const enrollment = await req.db!.from('enrollments').select('status,class_session_id').eq('id', enrollmentId).maybeSingle()
  if (enrollment.error) throw mapDatabaseError(enrollment.error)
  if (enrollment.data?.status !== 'regular' || !enrollment.data.class_session_id) return
  const current = await req.db!.from('occurrence_reports').select('class_occurrence_id').eq('id', reportId).maybeSingle()
  if (current.error) throw mapDatabaseError(current.error)
  if (!current.data?.class_occurrence_id) return
  const currentOccurrence = await req.db!.from('class_occurrences').select('occurrence_date').eq('id', current.data.class_occurrence_id).maybeSingle()
  if (currentOccurrence.error) throw mapDatabaseError(currentOccurrence.error)
  if (!currentOccurrence.data?.occurrence_date) return
  const reportRows = await req.db!.from('occurrence_reports').select('class_occurrence_id').eq('enrollment_id', enrollmentId)
  if (reportRows.error) throw mapDatabaseError(reportRows.error)
  const occurrenceIds = (reportRows.data ?? []).map((row) => row.class_occurrence_id).filter((id): id is string => typeof id === 'string')
  if (occurrenceIds.length) {
    const future = await req.db!.from('class_occurrences').select('id,occurrence_date').in('id', occurrenceIds).gt('occurrence_date', currentOccurrence.data.occurrence_date).limit(1)
    if (future.error) throw mapDatabaseError(future.error)
    if ((future.data ?? []).length) return
  }
  const nextOccurrence = await req.db!.from('class_occurrences').select('id,occurrence_date').eq('class_session_id', enrollment.data.class_session_id).gt('occurrence_date', currentOccurrence.data.occurrence_date).order('occurrence_date', { ascending: true }).limit(1).maybeSingle()
  if (nextOccurrence.error) throw mapDatabaseError(nextOccurrence.error)
  if (!nextOccurrence.data) return
  const automaticAttendance = await resolveInitialAttendance(req, enrollmentId, nextOccurrence.data.id)
  const result = await req.db!.from('occurrence_reports').upsert({ enrollment_id: enrollmentId, class_occurrence_id: nextOccurrence.data.id, content: '', version: 1, is_completed: false, ...automaticAttendance }, { onConflict: 'enrollment_id,class_occurrence_id', ignoreDuplicates: true })
  if (result.error) throw mapDatabaseError(result.error)
}

async function resolveInitialAttendance(req: Request, enrollmentId: string, occurrenceId: string) {
  const result = await req.db!.rpc('get_effective_attendance', {
    p_enrollment_id: enrollmentId,
    p_occurrence_id: occurrenceId,
  }).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) return initialReportAttendance({})
  const attendance = result.data as { attendance_status?: 'present' | 'absent' | 'pending'; absence_reason?: string | null }
  return {
    attendance_status: attendance.attendance_status ?? 'pending',
    absence_reason: attendance.absence_reason ?? null,
  }
}
async function create(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const input = reportCreateSchema.parse(req.body)
    assertClientManagedAttendanceReason(input.absence_reason)
    setAuditContext(req, { domain: 'teaching', resource: 'reports', action: 'create', permission: 'teaching.reports.create', scopeId: input.class_occurrence_id, scopeType: 'class_occurrence' })
    const permission = await req.db.rpc('can_create_occurrence_report', { p_enrollment_id: input.enrollment_id, p_class_occurrence_id: input.class_occurrence_id })
  requireAuthorizationDecision(req, permission, { permission: 'teaching.reports.create', stage: 'report_creation_scope_permission', message: 'You do not have permission to create this report', scopeId: input.class_occurrence_id, scopeType: 'occurrence' })
  const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const automaticAttendance = await resolveInitialAttendance(req, input.enrollment_id, input.class_occurrence_id)
  const payload = { enrollment_id: input.enrollment_id, class_occurrence_id: input.class_occurrence_id, content: input.content ?? '', version: 1, is_completed: input.is_completed ?? false, attendance_status: input.attendance_status ?? automaticAttendance.attendance_status, ...pick(input), ...(automaticAttendance.attendance_status === 'absent' ? automaticAttendance : {}) }
  const result = await req.db.from('occurrence_reports').insert(payload).select(fields).single(); if (result.error) throw mapDatabaseError(result.error)
    setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: result.data?.id ?? null, teachingId: null, action: 'create', permission: 'teaching.reports.create', scopeId: input.class_occurrence_id, scopeType: 'class_occurrence' })
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, envelope); return res.status(201).json(envelope)
}
async function update(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = reportId(req)
  const input = reportUpdateSchema.parse(req.body)
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, action: 'update', permission: 'teaching.reports.update', scopeType: 'occurrence_report' })
  const contextResult = await req.db.rpc('get_occurrence_report_mutation_context', { p_report_id: id, p_permission_key: 'teaching.reports.update' }).maybeSingle()
  if (contextResult.error) throw mapDatabaseError(contextResult.error)
  const context = contextResult.data as MutationContext | null
  if (!context) {
    requireAuthorizationDecision(req, { data: false, error: null }, { permission: 'teaching.reports.update', stage: 'report_mutation_context', message: 'You do not have permission to update this report', scopeId: id, scopeType: 'occurrence_report' })
    return
  }
  if (context.version !== input.expected_version) throw new ApiError(409, 'VERSION_CONFLICT', 'The report was modified by another user')
  assertReportAttendanceUpdate(context, input)
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.rpc('apply_occurrence_report_lifecycle', { p_report_id: id, p_expected_version: input.expected_version, p_patch: pick(input), p_actor: req.user.id, p_operation: 'update' })
  if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(409, 'VERSION_CONFLICT', 'The report was modified by another user')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, teachingId: context.teaching_id, permission: 'teaching.reports.update', scopeId: context.class_occurrence_id, scopeType: 'class_occurrence' })
  // Track how much adopted AI text the saved report keeps; never blocks or fails the save.
  if (input.content !== undefined && req.adminDb) void measureReportAdoptions(req.adminDb, id, 'save').catch((error) => req.log?.warn({ err: error, report_id: id }, 'ai_adoption_measure_failed'))
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}

/** Course and lesson choices for the same student inside the report's teaching. */
export async function reportLessonEntryOptions(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  if (!req.adminDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The report service is unavailable')
  const id = uuid.parse(req.params.reportId)
  const contextResult = await req.db.rpc('get_occurrence_report_mutation_context', { p_report_id: id, p_permission_key: 'teaching.reports.update' }).maybeSingle()
  if (contextResult.error) throw mapDatabaseError(contextResult.error)
  const context = contextResult.data as Pick<MutationContext, 'enrollment_id' | 'teaching_id'> | null
  requireAuthorizationDecision(req, { data: Boolean(context), error: null }, { permission: 'teaching.reports.update', stage: 'report_scope_permission', message: 'You do not have permission to access this report', scopeId: id, scopeType: 'occurrence_report', teachingId: context?.teaching_id ?? null })
  if (!context) {
    return
  }
  const anchor = await req.adminDb.from('enrollments').select('student_id,course_id').eq('id', context.enrollment_id).maybeSingle()
  if (anchor.error) throw mapDatabaseError(anchor.error)
  if (!anchor.data?.student_id) throw new ApiError(404, 'NOT_FOUND', 'Report student was not found')
  let courseQuery = req.adminDb.from('courses').select('id,subject,stage,display_name')
  // A null teaching scope is legacy/unscoped data. Fail closed to the anchor
  // course instead of exposing every unscoped course for this student.
  courseQuery = context.teaching_id
    ? courseQuery.eq('teaching_id', context.teaching_id)
    : courseQuery.eq('id', anchor.data.course_id)
  const courses = await courseQuery
  if (courses.error) throw mapDatabaseError(courses.error)
  const courseRows = (courses.data ?? []) as Array<{ id: string; subject: string | null; stage: string | null; display_name: string | null }>
  const courseIds = [...new Set(courseRows.map((course) => course.id))]
  if (!courseIds.length) return res.json(envelope(req, { enrollments: [] }))
  const [enrollments, lessons] = await Promise.all([
    req.adminDb.from('enrollments').select('id,course_id,status').eq('student_id', anchor.data.student_id).in('course_id', courseIds).neq('status', 'dropped'),
    req.adminDb.from('lessons').select('id,course_id,sequence,title').in('course_id', courseIds).order('sequence', { ascending: true }),
  ])
  if (enrollments.error) throw mapDatabaseError(enrollments.error)
  if (lessons.error) throw mapDatabaseError(lessons.error)
  const rows = (enrollments.data ?? []) as Array<{ id: string; course_id: string; status: string | null }>
  const courseById = new Map(courseRows.map((course) => [course.id, course]))
  const lessonsByCourse = new Map<string, Array<{ id: string; sequence: number; title: string }>>()
  for (const lesson of lessons.data ?? []) {
    const list = lessonsByCourse.get(lesson.course_id) ?? []
    list.push({ id: lesson.id, sequence: lesson.sequence, title: lesson.title })
    lessonsByCourse.set(lesson.course_id, list)
  }
  return res.json(envelope(req, {
    enrollments: rows.map((row) => {
      const course = courseById.get(row.course_id)
      return {
        id: row.id,
        course_id: row.course_id,
        course_name: course?.display_name || [course?.subject, course?.stage].filter(Boolean).join(' '),
        lessons: lessonsByCourse.get(row.course_id) ?? [],
      }
    }),
  }))
}
export async function remove(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = reportId(req)
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, action: 'delete', permission: 'teaching.reports.delete', scopeType: 'occurrence_report' })
  const contextResult = await req.db.rpc('get_occurrence_report_mutation_context', { p_report_id: id, p_permission_key: 'teaching.reports.delete' }).maybeSingle()
  if (contextResult.error) throw mapDatabaseError(contextResult.error)
  const context = contextResult.data as MutationContext | null
  if (!context) {
    const deletedReplay = await replayDeletedReport(req, id)
    if (deletedReplay) return res.status(deletedReplay.status).json(deletedReplay.body)
    requireAuthorizationDecision(req, { data: false, error: null }, { permission: 'teaching.reports.delete', stage: 'report_mutation_context', message: 'You do not have permission to delete this report', scopeId: id, scopeType: 'occurrence_report' })
    return
  }
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const bound = await req.adminDb!.rpc('bind_api_idempotency_scope', { p_user_id: req.user.id, p_key: req.header('idempotency-key')!.trim(), p_resource_id: id, p_teaching_id: context.teaching_id, p_classroom_id: context.classroom_id, p_class_session_id: context.class_session_id, p_permission_key: 'teaching.reports.delete' })
  if (bound.error) throw mapDatabaseError(bound.error)
  const result = await req.db.rpc('apply_occurrence_report_lifecycle', { p_report_id: id, p_expected_version: context.version, p_patch: {}, p_actor: req.user.id, p_operation: 'delete' }); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, teachingId: context.teaching_id, permission: 'teaching.reports.delete', scopeId: context.class_occurrence_id, scopeType: 'class_occurrence' })
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
export async function readCollaboration(req: Request, res: Response) {
  const id = reportId(req)
  await canAccess(req, id, 'teaching.reports.read')
  const result = await req.db!.from('report_collab_docs').select('occurrence_report_id,snapshot_base64,base_report_version,updated_at:last_updated_at').eq('occurrence_report_id', id).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  return res.json({ data: result.data ?? { occurrence_report_id: id, snapshot_base64: null, base_report_version: null, updated_at: null }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
}

async function saveCollaboration(req: Request, res: Response) {
  const id = reportId(req)
  await canAccess(req, id, 'teaching.reports.update')
  const input = reportCollaborationSchema.parse(req.body)
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('save_report_collab_snapshot', { p_occurrence_report_id: id, p_snapshot_base64: input.snapshot_base64, p_base_report_version: input.base_report_version })
  if (result.error) throw mapDatabaseError(result.error)
  if (result.data !== true) throw new ApiError(409, 'SNAPSHOT_VERSION_CONFLICT', 'The collaboration snapshot is stale')
  const body = { data: { saved: true, occurrence_report_id: id, base_report_version: input.base_report_version }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}
// Report version restore, conflict resolution and progress summaries.
const reportPatch = reportBodySchema.omit({ enrollment_id: true, class_occurrence_id: true, expected_version: true })

async function reportMutation(req: Request, reportId: string, patch: Record<string, unknown>, expectedVersion: number, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const context = await req.db.rpc('get_occurrence_report_mutation_context', { p_report_id: reportId, p_permission_key: 'teaching.reports.update' }).maybeSingle()
  if (context.error) throw mapDatabaseError(context.error)
  requireAuthorizationDecision(req, { data: Boolean(context.data), error: null }, { permission: 'teaching.reports.update', stage: 'report_mutation_context', message: 'You do not have permission to modify this report', scopeId: reportId, scopeType: 'occurrence_report' })
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

export function legacySnapshotHasLessonState(snapshot: Record<string, unknown>) {
  return ['lesson_id', 'is_completed', 'progress_letter'].some((field) => Object.prototype.hasOwnProperty.call(snapshot, field))
}

async function restoreVersion(req: Request, res: Response) {
  const reportId = uuid.parse(req.params.reportId); const versionId = uuid.parse(req.params.versionId)
  const input = z.object({ expected_version: z.number().int().min(1) }).strict().parse(req.body)
  const version = await req.db!.from('report_versions').select('id,occurrence_report_id,version,snapshot,content').eq('id', versionId).eq('occurrence_report_id', reportId).maybeSingle()
  if (version.error) throw mapDatabaseError(version.error)
  if (!version.data) throw new ApiError(404, 'NOT_FOUND', 'Report version was not found')
  const snapshot: Record<string, unknown> = version.data.snapshot && typeof version.data.snapshot === 'object' ? version.data.snapshot as Record<string, unknown> : { content: version.data.content }
  const patch = Object.fromEntries(writable.filter((field) => field in snapshot).map((field) => [field, snapshot[field]]))
  if (snapshot.lesson_entries === undefined && legacySnapshotHasLessonState(snapshot)) {
    const current = await req.db!.from('occurrence_reports').select('enrollment_id').eq('id', reportId).maybeSingle()
    if (current.error) throw mapDatabaseError(current.error)
    if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
    const enrollment = await req.db!.from('enrollments').select('id,course_id').eq('id', current.data.enrollment_id).maybeSingle()
    if (enrollment.error) throw mapDatabaseError(enrollment.error)
    if (!enrollment.data) throw new ApiError(409, 'REPORT_VERSION_RESTORE_UNAVAILABLE', 'The report enrollment is no longer available')
    const lessonId = typeof snapshot.lesson_id === 'string' ? snapshot.lesson_id : null
    const entryId = lessonId ? randomUUID() : null
    patch.lesson_entries = lessonId ? [{
      id: entryId,
      enrollment_id: enrollment.data.id,
      course_id: enrollment.data.course_id,
      lesson_id: lessonId,
      is_completed: snapshot.is_completed === true,
      progress_letter: typeof snapshot.progress_letter === 'string' ? snapshot.progress_letter : null,
    }] : []
    patch.primary_lesson_entry_id = entryId
  }
  return reportMutation(req, reportId, reportPatch.parse(patch), input.expected_version, res)
}

async function resolveConflict(req: Request, res: Response) {
  const reportId = uuid.parse(req.params.reportId)
  const input = z.object({ expected_version: z.number().int().min(1), report: reportPatch }).strict().parse(req.body)
  return reportMutation(req, reportId, input.report, input.expected_version, res)
}

async function progressSummaryReports(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  if (!req.adminDb) throw new ApiError(503, 'RESOURCE_SERVICE_UNAVAILABLE', 'The report service is unavailable')
  const query = z.object({
    enrollment_ids: z.string().min(1).max(10000),
    limit: z.coerce.number().int().min(1).max(1000).default(1000),
    sort: z.enum(['created_at', '-created_at', 'updated_at', '-updated_at']).default('-created_at'),
  }).strict().parse(req.query)
  const enrollmentIds = [...new Set(query.enrollment_ids.split(',').filter(Boolean))]
  if (enrollmentIds.length > 100 || enrollmentIds.some((id) => !uuid.safeParse(id).success)) throw new ApiError(400, 'INVALID_QUERY', 'enrollment_ids contains an invalid id')
  const enrollmentById = new Map<string, { id: string; class_session_id: string | null; course_id: string }>()
  for (const enrollmentId of enrollmentIds) {
    const enrollment = await req.db!.from('enrollments').select('id,class_session_id,course_id').eq('id', enrollmentId).maybeSingle()
    if (enrollment.error) throw mapDatabaseError(enrollment.error)
    if (!enrollment.data) continue
    enrollmentById.set(enrollmentId, enrollment.data)
    await permission(req, 'teaching.reports.list', enrollment.data.class_session_id)
  }
  const descending = query.sort.startsWith('-')
  const field = descending ? query.sort.slice(1) : query.sort
  const reportRows = new Map<string, Record<string, any>>()
  for (const enrollmentId of enrollmentIds) {
    if (!enrollmentById.has(enrollmentId)) continue
    const [anchored, linked] = await Promise.all([
      req.adminDb.from('occurrence_reports').select('id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,lesson_entries,attendance_status,created_at,updated_at,class_occurrences(occurrence_date)').eq('enrollment_id', enrollmentId).order(field, { ascending: !descending }).limit(query.limit),
      req.adminDb.from('occurrence_reports').select('id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,lesson_entries,attendance_status,created_at,updated_at,class_occurrences(occurrence_date)').contains('lesson_entries', [{ enrollment_id: enrollmentId }]).order(field, { ascending: !descending }).limit(query.limit),
    ])
    if (anchored.error) throw mapDatabaseError(anchored.error)
    if (linked.error) throw mapDatabaseError(linked.error)
    for (const row of [...(anchored.data ?? []), ...(linked.data ?? [])] as Array<Record<string, any>>) reportRows.set(`${enrollmentId}:${row.id}`, row)
  }
  const flattened = [...reportRows.entries()].flatMap(([key, report]) => {
    const enrollmentId = key.slice(0, key.indexOf(':'))
    const entries = Array.isArray(report.lesson_entries) ? report.lesson_entries as Array<Record<string, any>> : []
    const matching = entries.filter((entry) => entry.enrollment_id === enrollmentId && entry.course_id === enrollmentById.get(enrollmentId)?.course_id)
    const progressRows = matching.length
      ? matching
      : entries.length === 0 && report.enrollment_id === enrollmentId && report.lesson_id
        ? [{ id: `${report.id}:legacy`, lesson_id: report.lesson_id, is_completed: report.is_completed, progress_letter: report.progress_letter }]
        : []
    return progressRows.map((entry) => ({
      id: report.id,
      lesson_entry_id: entry.id,
      enrollment_id: enrollmentId,
      class_occurrence_id: report.class_occurrence_id,
      lesson_id: entry.lesson_id,
      is_completed: entry.is_completed,
      progress_letter: entry.progress_letter,
      attendance_status: report.attendance_status,
      created_at: report.created_at,
      updated_at: report.updated_at,
      class_occurrences: report.class_occurrences,
    }))
  }).sort((left, right) => {
    const a = String(field === 'updated_at' ? left.updated_at : left.created_at)
    const b = String(field === 'updated_at' ? right.updated_at : right.created_at)
    return (a.localeCompare(b) || left.id.localeCompare(right.id)) * (descending ? -1 : 1)
  }).slice(0, query.limit)
  return res.json(envelope(req, flattened, { limit: query.limit, offset: 0, total: flattened.length, sort: query.sort }))
}

export function createReportRouter() {
  const router = Router()
  router.post('/reports', wrap(create))
  router.get('/reports/:reportId/lesson-entry-options', wrap(reportLessonEntryOptions))
  router.patch('/reports/:id', wrap(update))
  router.delete('/reports/:id', wrap(remove))
  router.get('/reports/:id/collaboration', wrap(readCollaboration))
  router.post('/reports/:id/collaboration', wrap(saveCollaboration))
  router.get('/reports/progress-summary', wrap(progressSummaryReports))
  router.post('/reports/:reportId/versions/:versionId/restore', wrap(restoreVersion))
  router.post('/reports/:reportId/conflicts/resolve', wrap(resolveConflict))
  return router
}
