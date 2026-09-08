import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'

const fields = 'id,enrollment_id,class_occurrence_id,lesson_id,is_completed,progress_letter,attendance_status,absence_reason,class_participation,classroom_behavior,contact_notes,contact_notes_document,class_notes,class_notes_document,content,content_document,external_link,version,last_edited_by,last_edited_at,created_at,updated_at'
const writable = ['lesson_id', 'is_completed', 'progress_letter', 'attendance_status', 'absence_reason', 'class_participation', 'classroom_behavior', 'contact_notes', 'contact_notes_document', 'class_notes', 'class_notes_document', 'content', 'content_document', 'external_link'] as const
const reportBody = z.object({
  enrollment_id: z.string().uuid().optional(), class_occurrence_id: z.string().uuid().optional(), lesson_id: z.string().uuid().nullable().optional(),
  is_completed: z.boolean().optional(), progress_letter: z.string().max(32).nullable().optional(), attendance_status: z.enum(['present', 'absent', 'pending']).optional(), absence_reason: z.string().max(64).nullable().optional(),
  class_participation: z.number().min(0).max(5).nullable().optional(), classroom_behavior: z.number().min(0).max(5).nullable().optional(),
  contact_notes: z.string().max(10000).nullable().optional(), contact_notes_document: z.record(z.string(), z.unknown()).nullable().optional(), class_notes: z.string().max(10000).nullable().optional(), class_notes_document: z.record(z.string(), z.unknown()).nullable().optional(),
  content: z.string().max(10000).nullable().optional(), content_document: z.record(z.string(), z.unknown()).nullable().optional(), external_link: z.string().max(2048).nullable().optional(),
  expected_version: z.number().int().min(1).optional(),
}).strict()
type Body = z.infer<typeof reportBody>
function wrap(handler: (req: Request, res: Response) => Promise<unknown>) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next) }
async function canAccess(req: Request, id: string, permission: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const result = await req.db.rpc('can_access_report', { p_report_id: id, p_permission_key: permission })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to access this report')
}
function pick(input: Body) { return Object.fromEntries(Object.entries(input).filter(([key]) => (writable as readonly string[]).includes(key))) }
async function create(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const input = reportBody.parse(req.body); if (!input.enrollment_id || !input.class_occurrence_id) throw new ApiError(422, 'REPORT_CONTEXT_REQUIRED', 'enrollment_id and class_occurrence_id are required')
  const permission = await req.db.rpc('can_create_occurrence_report', { p_enrollment_id: input.enrollment_id, p_class_occurrence_id: input.class_occurrence_id })
  if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to create this report')
  const replay = await idempotency(req, 201, null); if (replay) return res.status(replay.status).json(replay.body)
  const payload = { enrollment_id: input.enrollment_id, class_occurrence_id: input.class_occurrence_id, content: input.content ?? '', version: 1, is_completed: input.is_completed ?? false, attendance_status: input.attendance_status ?? 'pending', ...pick(input) }
  const result = await req.db.from('occurrence_reports').insert(payload).select(fields).single(); if (result.error) throw mapDatabaseError(result.error)
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 201, envelope); return res.status(201).json(envelope)
}
async function update(req: Request, res: Response) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Report id is required')
  const input = reportBody.parse(req.body); if (input.expected_version === undefined) throw new ApiError(422, 'EXPECTED_VERSION_REQUIRED', 'expected_version is required for report updates')
  await canAccess(req, id, 'teaching.reports.update')
  const current = await req.db.from('occurrence_reports').select('version,absence_reason,attendance_status').eq('id', id).maybeSingle(); if (current.error) throw mapDatabaseError(current.error); if (!current.data) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
  if (current.data.version !== input.expected_version) throw new ApiError(409, 'VERSION_CONFLICT', 'The report was modified by another user')
  const systemManaged = current.data.absence_reason === 'holiday' || current.data.absence_reason === 'suspension'
  if (systemManaged && ((input.attendance_status !== undefined && input.attendance_status !== current.data.attendance_status) || (input.absence_reason !== undefined && input.absence_reason !== current.data.absence_reason))) throw new ApiError(422, 'SYSTEM_MANAGED_REPORT', 'Attendance is managed by the system')
  const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.from('occurrence_reports').update({ ...pick(input), version: input.expected_version + 1, last_edited_by: req.user.id, last_edited_at: new Date().toISOString() }).eq('id', id).eq('version', input.expected_version).select(fields).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(409, 'VERSION_CONFLICT', 'The report was modified by another user')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }; await complete(req, 200, envelope); return res.json(envelope)
}
async function remove(req: Request, res: Response) {
  if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const id = typeof req.params.id === 'string' ? req.params.id : undefined; if (!id) throw new ApiError(400, 'INVALID_ID', 'Report id is required')
  await canAccess(req, id, 'teaching.reports.delete'); const replay = await idempotency(req, 200, null); if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db.from('occurrence_reports').delete().eq('id', id).select(fields).maybeSingle(); if (result.error) throw mapDatabaseError(result.error); if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Report was not found')
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
