import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'

const historyFields = 'id,created_at,cancelled_at,course_display_name,source_occurrence_date,source_start_time,source_end_time,source_session_name,source_classroom_name,target_occurrence_date,target_start_time,target_end_time,target_session_name,target_classroom_name'
const targetFields = 'transfer_id,source_occurrence_id,target_occurrence_id,is_effective_target,target_report_id'

const transferBody = z.object({
  enrollment_id: z.string().uuid(),
  source_occurrence_id: z.string().uuid(),
  target_occurrence_id: z.string().uuid(),
  report_id: z.string().uuid().nullable().optional(),
}).strict()

const conflictBody = z.object({
  enrollment_id: z.string().uuid(),
  source_occurrence_id: z.string().uuid(),
  target_occurrence_id: z.string().uuid(),
  source_report_id: z.string().uuid().nullable(),
  source_version: z.number().int().min(1).nullable(),
  target_report_id: z.string().uuid(),
  target_version: z.number().int().min(1),
  field_sources: z.object({
    lesson_id: z.enum(['source', 'target']),
    is_completed: z.enum(['source', 'target']),
    progress_letter: z.enum(['source', 'target']),
    attendance: z.enum(['source', 'target']),
    class_participation: z.enum(['source', 'target']),
    classroom_behavior: z.enum(['source', 'target']),
    contact_notes: z.enum(['source', 'target']),
    class_notes: z.enum(['source', 'target']),
    content: z.enum(['source', 'target']),
    external_link: z.enum(['source', 'target']),
  }).strict(),
}).strict()

const repairBody = z.object({ target_occurrence_id: z.string().uuid() }).strict()
const idBody = z.object({ transfer_id: z.string().uuid() }).strict()

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

function transferRpcError(error: { code?: string; message?: string } | null | undefined): ApiError {
  const message = error?.message ?? ''
  if (message.includes('AUTHENTICATION_REQUIRED')) return new ApiError(401, 'AUTH_INVALID', 'Authentication is required')
  if (message.includes('FORBIDDEN')) return new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this transfer')
  if (message.includes('NOT_FOUND') || message.includes('ENROLLMENT_NOT_FOUND') || message.includes('OCCURRENCE_NOT_FOUND')) return new ApiError(404, 'NOT_FOUND', 'The transfer resource was not found')
  if (message.includes('ALREADY_EXISTS') || message.includes('SOURCE_REPORT_ALREADY_EXISTS') || message.includes('REPORT_ALREADY_EXISTS')) return new ApiError(409, 'TRANSFER_CONFLICT', 'The transfer conflicts with an existing report or transfer')
  if (message.includes('DATE_NOT_CLASS_DAY') || message.includes('TARGET_OCCURRENCE_NOT_EFFECTIVE') || message.includes('OCCURRENCES_MATCH') || message.includes('COURSE_MISMATCH')) return new ApiError(422, 'TRANSFER_INVALID', 'The transfer violates a business rule')
  return mapDatabaseError(error)
}

async function enrollmentContext(req: Request, enrollmentId: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const result = await req.db.from('enrollments').select('id,class_session_id').eq('id', enrollmentId).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Enrollment was not found')
  return result.data
}

async function assertPermission(req: Request, sessionId: string | null, action: 'read' | 'update') {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const result = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: `teaching.enrollments.${action}`,
    p_classroom_id: null,
    p_class_session_id: sessionId,
  })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to access this enrollment')
}

async function assertOccurrencePermission(req: Request, occurrenceId: string, action: 'read' | 'update') {
  if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const occurrence = await req.db.from('class_occurrences').select('class_session_id').eq('id', occurrenceId).maybeSingle()
  if (occurrence.error) throw mapDatabaseError(occurrence.error)
  if (!occurrence.data) throw new ApiError(404, 'NOT_FOUND', 'Occurrence was not found')
  const result = await req.db.rpc('has_api_permission', { p_user_id: req.user!.id, p_permission_key: `teaching.occurrences.${action}`, p_classroom_id: null, p_class_session_id: occurrence.data.class_session_id })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to access this occurrence')
}

async function history(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const enrollment = await enrollmentContext(req, id)
  await assertPermission(req, enrollment.class_session_id, 'read')
  const result = await req.db!.rpc('get_single_lesson_transfer_history', { p_enrollment_id: id })
  if (result.error) throw transferRpcError(result.error)
  const data = (result.data ?? []) as unknown[]
  return res.json({ data, meta: { limit: data.length, offset: 0, total: data.length, sort: '-created_at', fields: historyFields }, request_id: req.requestId, trace_id: req.traceId })
}

async function targets(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const enrollment = await enrollmentContext(req, id)
  await assertPermission(req, enrollment.class_session_id, 'read')
  const result = await req.db!.rpc('get_effective_single_lesson_transfer_targets', { p_enrollment_id: id })
  if (result.error) throw transferRpcError(result.error)
  const data = (result.data ?? []) as unknown[]
  return res.json({ data, meta: { limit: data.length, offset: 0, total: data.length, sort: 'target_occurrence_id', fields: targetFields }, request_id: req.requestId, trace_id: req.traceId })
}

async function repair(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is required')
  const input = repairBody.parse(req.body)
  const enrollment = await enrollmentContext(req, id)
  await assertPermission(req, enrollment.class_session_id, 'update')
  await assertOccurrencePermission(req, input.target_occurrence_id, 'update')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('repair_single_lesson_transfer_report', { p_enrollment_id: id, p_target_occurrence_id: input.target_occurrence_id })
  if (result.error) throw transferRpcError(result.error)
  const body = { data: { report_id: result.data }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

async function singleLesson(req: Request, res: Response) {
  const input = transferBody.parse(req.body)
  if (input.source_occurrence_id === input.target_occurrence_id) throw new ApiError(422, 'TRANSFER_INVALID', 'Source and target occurrences must differ')
  const enrollment = await enrollmentContext(req, input.enrollment_id)
  await assertPermission(req, enrollment.class_session_id, 'update')
  await assertOccurrencePermission(req, input.target_occurrence_id, 'update')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('transfer_single_lesson', { p_enrollment_id: input.enrollment_id, p_source_occurrence_id: input.source_occurrence_id, p_target_occurrence_id: input.target_occurrence_id, p_report_id: input.report_id ?? null })
  if (result.error) throw transferRpcError(result.error)
  const body = { data: { status: 'completed', transfer_id: result.data }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

async function resolveConflict(req: Request, res: Response) {
  const input = conflictBody.parse(req.body)
  const enrollment = await enrollmentContext(req, input.enrollment_id)
  await assertPermission(req, enrollment.class_session_id, 'update')
  await assertOccurrencePermission(req, input.target_occurrence_id, 'update')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('resolve_single_lesson_transfer_conflict', { p_enrollment_id: input.enrollment_id, p_source_occurrence_id: input.source_occurrence_id, p_target_occurrence_id: input.target_occurrence_id, p_source_report_id: input.source_report_id, p_source_version: input.source_version, p_target_report_id: input.target_report_id, p_target_version: input.target_version, p_field_sources: input.field_sources })
  if (result.error) throw transferRpcError(result.error)
  const transferId = result.data && typeof result.data === 'object' ? (result.data as { transfer_id?: string }).transfer_id : result.data
  const body = { data: { status: 'completed', transfer_id: transferId }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

async function cancel(req: Request, res: Response) {
  const input = idBody.parse(req.body)
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('cancel_single_lesson_transfer', { p_transfer_id: input.transfer_id })
  if (result.error) throw transferRpcError(result.error)
  const body = { data: { cancelled: true, transfer_id: input.transfer_id }, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, body)
  return res.json(body)
}

async function roster(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Occurrence id is required')
  await assertOccurrencePermission(req, id, 'read')
  const result = await req.db!.rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: id })
  if (result.error) throw transferRpcError(result.error)
  const data = ((result.data ?? []) as Array<{ enrollment_id: string }>).map((row) => row.enrollment_id)
  return res.json({ data, meta: { limit: data.length, offset: 0, total: data.length, sort: 'enrollment_id' }, request_id: req.requestId, trace_id: req.traceId })
}

export function createTransferRouter() {
  const router = Router()
  router.get('/enrollments/:id/transfer-history', wrap(history))
  router.get('/enrollments/:id/effective-transfer-targets', wrap(targets))
  router.post('/enrollments/:id/repair-transfer-report', wrap(repair))
  router.post('/enrollment-transfers/single-lesson', wrap(singleLesson))
  router.post('/enrollment-transfers/conflicts/resolve', wrap(resolveConflict))
  router.post('/enrollment-transfers/cancel', wrap(cancel))
  router.get('/occurrences/:id/roster', wrap(roster))
  return router
}
