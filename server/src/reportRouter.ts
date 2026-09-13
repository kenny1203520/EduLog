import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { initialReportAttendance } from './reportSemantics.js'
import { setAuditContext } from './context.js'

const fields = 'id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,attendance_status,absence_reason,class_participation,classroom_behavior,contact_notes,contact_notes_document,class_notes,class_notes_document,content,content_document,external_link,version,last_edited_by,last_edited_at,created_at,updated_at'
const writable = ['lesson_id', 'is_completed', 'progress_letter', 'attendance_status', 'absence_reason', 'class_participation', 'classroom_behavior', 'contact_notes', 'contact_notes_document', 'class_notes', 'class_notes_document', 'content', 'content_document', 'external_link'] as const
const reportBody = z.object({
  enrollment_id: z.string().uuid().optional(), class_occurrence_id: z.string().uuid().optional(), lesson_id: z.string().uuid().nullable().optional(),
  is_completed: z.boolean().optional(), progress_letter: z.string().regex(/^[A-Z](-[A-Z])?$/).max(32).nullable().optional(), attendance_status: z.enum(['present', 'absent', 'pending']).optional(), absence_reason: z.string().max(64).nullable().optional(),
  class_participation: z.number().min(0).max(5).nullable().optional(), classroom_behavior: z.number().min(0).max(5).nullable().optional(),
  contact_notes: z.string().max(10000).nullable().optional(), contact_notes_document: z.record(z.string(), z.unknown()).nullable().optional(), class_notes: z.string().max(10000).nullable().optional(), class_notes_document: z.record(z.string(), z.unknown()).nullable().optional(),
  content: z.string().max(10000).nullable().optional(), content_document: z.record(z.string(), z.unknown()).nullable().optional(), external_link: z.string().max(2048).nullable().optional(),
  expected_version: z.number().int().min(1).optional(),
}).strict()
type Body = z.infer<typeof reportBody>
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
function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
async function canAccess(req: Request, id: string, permission: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, action: permission.split('.').at(-1) ?? 'read', permission, scopeType: 'occurrence_report' })
  const rpcName = permission.endsWith('.update') || permission.endsWith('.delete') ? 'can_mutate_occurrence_report' : 'can_access_report'
  const result = await req.db.rpc(rpcName, { p_report_id: id, p_permission_key: permission })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to access this report')
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
  const [occurrence, suspensions] = await Promise.all([
    req.db!.from('class_occurrences').select('id,occurrence_date,class_session_id,class_sessions(classroom_id)').eq('id', occurrenceId).maybeSingle(),
    req.db!.from('student_suspensions').select('id,start_date,end_date').eq('enrollment_id', enrollmentId),
  ])
  if (occurrence.error) throw mapDatabaseError(occurrence.error)
  if (suspensions.error) throw mapDatabaseError(suspensions.error)
  if (!occurrence.data?.occurrence_date) return initialReportAttendance({})
  const date = occurrence.data.occurrence_date
  const suspended = (suspensions.data ?? []).some((row) => row.start_date <= date && (!row.end_date || row.end_date >= date))
  const session = Array.isArray(occurrence.data.class_sessions) ? occurrence.data.class_sessions[0] : occurrence.data.class_sessions
  const classroomId = session?.classroom_id ?? null
  const holidays = await req.db!.from('holidays').select('id,kind,classroom_ids,class_session_ids').eq('kind', 'closure').lte('start_date', date).gte('end_date', date)
  if (holidays.error) throw mapDatabaseError(holidays.error)
  const holiday = (holidays.data ?? []).some((row) => {
    const classroomIds = Array.isArray(row.classroom_ids) ? row.classroom_ids : []
    const sessionIds = Array.isArray(row.class_session_ids) ? row.class_session_ids : []
    return sessionIds.includes(occurrence.data!.class_session_id) || (classroomId && classroomIds.includes(classroomId)) || (!sessionIds.length && !classroomIds.length)
  })
  return initialReportAttendance({ holiday, suspended })
}
async function create(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const input = reportBody.parse(req.body); if (!input.enrollment_id || !input.class_occurrence_id) throw new ApiError(422, 'REPORT_CONTEXT_REQUIRED', 'enrollment_id and class_occurrence_id are required')
    assertClientManagedAttendanceReason(input.absence_reason)
    setAuditContext(req, { domain: 'teaching', resource: 'reports', action: 'create', permission: 'teaching.reports.create', scopeId: input.class_occurrence_id, scopeType: 'class_occurrence' })
    const permission = await req.db.rpc('can_create_occurrence_report', { p_enrollment_id: input.enrollment_id, p_class_occurrence_id: input.class_occurrence_id })
  if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to create this report')
  const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const automaticAttendance = await resolveInitialAttendance(req, input.enrollment_id, input.class_occurrence_id)
  const payload = { enrollment_id: input.enrollment_id, class_occurrence_id: input.class_occurrence_id, content: input.content ?? '', version: 1, is_completed: input.is_completed ?? false, attendance_status: input.attendance_status ?? automaticAttendance.attendance_status, ...pick(input), ...(automaticAttendance.attendance_status === 'absent' ? automaticAttendance : {}) }
  const result = await req.db.from('occurrence_reports').insert(payload).select(fields).single(); if (result.error) throw mapDatabaseError(result.error)
    setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: result.data?.id ?? null, teachingId: null, action: 'create', permission: 'teaching.reports.create', scopeId: input.class_occurrence_id, scopeType: 'class_occurrence' })
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, envelope); return res.status(201).json(envelope)
}
async function update(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Report id is required')
  const input = reportBody.parse(req.body); if (input.expected_version === undefined) throw new ApiError(422, 'EXPECTED_VERSION_REQUIRED', 'expected_version is required for report updates')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, action: 'update', permission: 'teaching.reports.update', scopeType: 'occurrence_report' })
  const contextResult = await req.db.rpc('get_occurrence_report_mutation_context', { p_report_id: id, p_permission_key: 'teaching.reports.update' }).maybeSingle()
  if (contextResult.error) throw mapDatabaseError(contextResult.error)
  const context = contextResult.data as MutationContext | null
  if (!context) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to update this report')
  if (context.version !== input.expected_version) throw new ApiError(409, 'VERSION_CONFLICT', 'The report was modified by another user')
  assertReportAttendanceUpdate(context, input)
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.rpc('apply_occurrence_report_lifecycle', { p_report_id: id, p_expected_version: input.expected_version, p_patch: pick(input), p_actor: req.user.id, p_operation: 'update' })
  if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(409, 'VERSION_CONFLICT', 'The report was modified by another user')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, teachingId: context.teaching_id, permission: 'teaching.reports.update', scopeId: context.class_occurrence_id, scopeType: 'class_occurrence' })
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
async function remove(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Report id is required')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, action: 'delete', permission: 'teaching.reports.delete', scopeType: 'occurrence_report' })
  const contextResult = await req.db.rpc('get_occurrence_report_mutation_context', { p_report_id: id, p_permission_key: 'teaching.reports.delete' }).maybeSingle()
  if (contextResult.error) throw mapDatabaseError(contextResult.error)
  const context = contextResult.data as MutationContext | null
  if (!context) {
    const deletedReplay = await replayDeletedReport(req, id)
    if (deletedReplay) return res.status(deletedReplay.status).json(deletedReplay.body)
    throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to delete this report')
  }
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const bound = await req.adminDb!.rpc('bind_api_idempotency_scope', { p_user_id: req.user.id, p_key: req.header('idempotency-key')!.trim(), p_resource_id: id, p_teaching_id: context.teaching_id, p_classroom_id: context.classroom_id, p_class_session_id: context.class_session_id, p_permission_key: 'teaching.reports.delete' })
  if (bound.error) throw mapDatabaseError(bound.error)
  const result = await req.db.rpc('apply_occurrence_report_lifecycle', { p_report_id: id, p_expected_version: context.version, p_patch: {}, p_actor: req.user.id, p_operation: 'delete' }); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
  setAuditContext(req, { domain: 'teaching', resource: 'reports', resourceId: id, teachingId: context.teaching_id, permission: 'teaching.reports.delete', scopeId: context.class_occurrence_id, scopeType: 'class_occurrence' })
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
async function readCollaboration(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Report id is required')
  await canAccess(req, id, 'teaching.reports.read')
  const result = await req.db!.from('report_collab_docs').select('occurrence_report_id,snapshot_base64,base_report_version,updated_at').eq('occurrence_report_id', id).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  return res.json({ data: result.data ?? { occurrence_report_id: id, snapshot_base64: null, base_report_version: null, updated_at: null }, meta: {}, request_id: req.requestId, trace_id: req.traceId })
}

async function saveCollaboration(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Report id is required')
  await canAccess(req, id, 'teaching.reports.update')
  const input = z.object({ snapshot_base64: z.string().max(1400000), base_report_version: z.number().int().min(1) }).strict().parse(req.body)
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('save_report_collab_snapshot', { p_occurrence_report_id: id, p_snapshot_base64: input.snapshot_base64, p_base_report_version: input.base_report_version })
  if (result.error) throw mapDatabaseError(result.error)
  if (result.data !== true) throw new ApiError(409, 'SNAPSHOT_VERSION_CONFLICT', 'The collaboration snapshot is stale')
  const body = { data: { saved: true, occurrence_report_id: id, base_report_version: input.base_report_version }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}
export function createReportRouter() { const router = Router(); router.post('/reports', wrap(create)); router.patch('/reports/:id', wrap(update)); router.delete('/reports/:id', wrap(remove)); router.get('/reports/:id/collaboration', wrap(readCollaboration)); router.post('/reports/:id/collaboration', wrap(saveCollaboration)); return router }
