import crypto from 'node:crypto'
import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, mapDatabaseError } from './errors.js'
import { reportMissingFlags } from './reportSemantics.js'

const uuid = z.string().uuid()
const date = z.iso.date()
const source = z.literal('https://corp.orangeapple.co')
const text = z.string().trim().min(1).max(256)
const identity = z.string().trim().min(1).max(1024)
const ruleKey = z.string().trim().min(1).max(512)
const short = z.string().max(10000)
const url = z.string().url().max(2048).refine(value => { const u = new URL(value); return u.origin === 'https://corp.orangeapple.co' && !u.username && !u.password && !u.search && !u.hash })
export const integrationRecord = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('student'), data: z.object({ name: text, external_link: url.optional() }).strict() }),
  z.object({ kind: z.literal('course'), data: z.object({ subject: text, stage: text, display_name: text.optional() }).strict() }),
  z.object({ kind: z.literal('class_session'), data: z.object({ name: text, classroom_id: uuid, course_ids: z.array(uuid).min(1).max(10), start_date: date, day_of_week: z.number().int().min(0).max(6), start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), time_zone: z.literal('Asia/Taipei'), external_link: url.optional() }).strict() }),
  z.object({ kind: z.literal('enrollment'), data: z.object({ student_id: uuid, course_id: uuid, class_session_id: uuid, classroom_id: uuid, status: z.enum(['regular', 'trial', 'completed', 'dropped']), start_date: date, time_zone: z.literal('Asia/Taipei'), external_link: url.optional() }).strict() }),
  z.object({ kind: z.literal('occurrence'), data: z.object({ class_session_id: uuid, occurrence_date: date, original_start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), original_end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), time_zone: z.literal('Asia/Taipei') }).strict() }),
  z.object({ kind: z.literal('report'), data: z.object({ enrollment_id: uuid, class_occurrence_id: uuid, lesson_id: uuid.optional(), is_completed: z.boolean().optional(), progress_letter: z.string().regex(/^[A-Z](-[A-Z])?$/).optional(), attendance_status: z.enum(['present', 'absent', 'pending']).optional(), absence_reason: z.string().max(64).optional(), class_participation: z.number().min(0).max(5).optional(), classroom_behavior: z.number().min(0).max(5).optional(), content: short.optional(), contact_notes: short.optional(), class_notes: short.optional(), external_link: url.optional() }).strict() }),
])
export const importRow = z.object({ source_id: text, source_identity: identity.optional(), source_rule: ruleKey.optional(), target_id: uuid, overwrite: z.array(z.string().max(64)).max(20).default([]), record: integrationRecord }).strict().refine(r => !r.source_rule || r.record.kind === 'course' && r.source_rule.startsWith('label:') && /^work:[a-f0-9-]{36}$/i.test(r.source_id), 'Course rules require a work identity')
export const importBatch = z.object({ key: z.string().uuid(), rows: z.array(importRow).min(1).max(50) }).strict().refine(value => new Set(value.rows.map(row => `${row.record.kind}:${row.source_id}`)).size === value.rows.length, 'Duplicate source IDs')
export const importJob = z.object({ source_origin: source, source_class_id: text, date_from: date, date_to: date, classroom_id: uuid, course_id: uuid.optional(), course_ids: z.array(uuid).min(1).max(10).optional(), class_session_id: uuid }).strict().refine(v => v.date_from <= v.date_to, 'Invalid date range').refine(v => Boolean(v.course_id || v.course_ids?.length), 'Select courses').refine(v => !v.course_ids || new Set(v.course_ids).size === v.course_ids.length && (!v.course_id || v.course_ids.includes(v.course_id)), 'Invalid course selection')
export const pendingPush = z.object({ report_id: uuid, report_version: z.number().int().min(1), source_origin: source, source_report_url: url, source_id: text, target_fingerprint: z.string().regex(/^[a-f0-9]{64}$/), idempotency_key: z.string().uuid() }).strict()
export const sourceMapping = z.object({ source_origin: source, source_kind: z.enum(['student', 'course', 'class_session', 'enrollment', 'occurrence', 'report']), source_id: text, target_id: uuid }).strict()
export const jobStatus = z.object({ status: z.enum(['paused', 'applying', 'cancelled', 'complete']) }).strict()
const catalogResource = z.enum(['classrooms', 'courses', 'class_sessions', 'students', 'enrollments', 'occurrences', 'report_targets', 'lessons', 'permissions'])
const cursor = z.string().max(80).regex(/^[0-9a-f-]{36}$|^\d{4}-\d{2}-\d{2}\|[0-9a-f-]{36}$/i).optional()
export const catalogQuery = z.object({
  resource: catalogResource, classroom_id: uuid.optional(), course_id: uuid.optional(), class_session_id: uuid.optional(),
  student_id: uuid.optional(), enrollment_id: uuid.optional(), class_occurrence_id: uuid.optional(),
  date_from: date.optional(), date_to: date.optional(), search: z.string().trim().max(80).optional(), cursor,
  limit: z.coerce.number().int().min(1).max(50).default(50),
}).strict()
export const catalogResolve = z.object({
  source_refs: z.array(z.object({ source_kind: z.enum(['student','course','classroom','class_session','enrollment','occurrence','report']), source_id: text }).strict()).max(50),
  target_refs: z.array(z.object({ kind: catalogResource.exclude(['permissions']), id: uuid }).strict()).max(50),
  source_class_id: text.optional(),
  memory_refs: z.array(z.object({ kind: z.enum(['course_rule','admission','classroom']), key: ruleKey, source_identity: identity.optional() }).strict()).max(50).optional(),
}).strict()
export const memoryConfirmation = z.object({
  source_origin: source, source_class_id: text,
  items: z.array(z.object({ kind: z.enum(['student','course','classroom','class_session','enrollment','admission','course_rule']), key: ruleKey,
    action: z.enum(['confirm','clear']), expected_revision: z.string().max(100).nullable(), source_identity: identity.optional(),
    target_id: uuid.optional(), student_id: uuid.optional(), course_id: uuid.optional(), class_session_id: uuid.optional(),
    versions: z.record(uuid,z.string().regex(/^[a-f0-9]{32}$/)).optional(),
  }).strict()).min(1).max(50),
}).strict()
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void fn(req, res).catch(next)
function databaseError(error: { message: string; code?: string }) {
  const statuses: Record<string, number> = { EXTENSION_AUTH_INVALID: 401, PERMISSION_DENIED: 403, NOT_FOUND: 404, PREVIEW_STALE: 409, SOURCE_MAPPING_CONFLICT: 409, VERSION_CONFLICT: 409, JOB_STOPPED: 409, IDEMPOTENCY_CONFLICT: 409, INVALID_REFERENCE: 422, INVALID_IMPORT: 422 }
  return statuses[error.message] ? new ApiError(statuses[error.message]!, error.message, error.message) : mapDatabaseError(error)
}
export function createExtensionWorkspaceRouter(admin: SupabaseClient) {
  const router = Router()
  const run = async (req: Request, operation: string, input: unknown, rpc = 'web_extension_workspace') => {
    const bearer = req.header('authorization')!.replace(/^Bearer\s+/i, '')
    const result = await admin.rpc(rpc, { p_token_id: req.extensionPrincipal!.tokenId, p_token_hash: crypto.createHash('sha256').update(bearer).digest('hex'), p_operation: operation, p_input: input })
    if (result.error) throw databaseError(result.error)
    return result.data
  }
  const reply = (req: Request, res: Response, data: unknown) => res.json({ data, meta: {}, request_id: req.requestId, trace_id: req.traceId })
  router.get('/context', wrap(async (req, res) => reply(req, res, await run(req, 'context', { offset: z.coerce.number().int().min(0).max(100000).parse(req.query.offset ?? 0) }))))
  router.get('/catalog', wrap(async (req, res) => reply(req, res, await run(req, 'catalog', catalogQuery.parse(req.query), 'web_extension_catalog'))))
  router.post('/catalog/resolve', wrap(async (req, res) => reply(req, res, await run(req, 'resolve', catalogResolve.parse(req.body), 'web_extension_catalog'))))
  router.post('/catalog/confirm', wrap(async (req, res) => reply(req, res, await run(req, 'memory-confirm', memoryConfirmation.parse(req.body), 'web_extension_catalog'))))
  router.get('/reports', wrap(async (req, res) => {
    const summary = z.enum(['true','false']).default('false').parse(req.query.summary) === 'true'
    const search = req.query.search === undefined ? null : z.string().trim().max(80).parse(req.query.search)
    const courseId = req.query.course_id === undefined ? null : uuid.parse(req.query.course_id)
    const enrollmentId = req.query.enrollment_id === undefined ? null : uuid.parse(req.query.enrollment_id)
    const studentId = req.query.student_id === undefined ? null : uuid.parse(req.query.student_id)
    const from = req.query.date_from === undefined ? null : date.parse(req.query.date_from)
    const to = req.query.date_to === undefined ? null : date.parse(req.query.date_to)
    if (from && to && from > to) throw new ApiError(400, 'INVALID_DATE_RANGE', 'Invalid report date range')
    const limit = req.query.limit === undefined ? 50 : z.coerce.number().int().min(1).max(50).parse(req.query.limit)
    const next = cursor.parse(req.query.cursor) ?? null
    const id = req.query.id === undefined ? null : uuid.parse(req.query.id)
    const data = await run(req, 'reports', { offset: z.coerce.number().int().min(0).max(100000).parse(req.query.offset ?? 0), report_id: id, summary, search, course_id: courseId, enrollment_id: enrollmentId, student_id: studentId, date_from: from, date_to: to, cursor: next, limit, detail: Boolean(id) }, req.query.summary !== undefined || req.query.cursor !== undefined || req.query.limit !== undefined || req.query.search !== undefined || req.query.student_id !== undefined || req.query.enrollment_id !== undefined || req.query.course_id !== undefined || req.query.date_from !== undefined || req.query.date_to !== undefined ? 'web_extension_catalog' : 'web_extension_workspace')
    const reports = (data.reports ?? []).map((row: Record<string, unknown>) => {
      const completeness = reportMissingFlags(row as Parameters<typeof reportMissingFlags>[0])
      if (!summary || id) return { ...row, completeness }
      const { content: _content, content_document: _contentDocument, contact_notes: _contact, contact_notes_document: _contactDocument, class_notes: _notes, class_notes_document: _notesDocument, ...card } = row
      return { ...card, completeness }
    })
    reply(req, res, { ...data, reports })
  }))
  router.post('/source-links', wrap(async (req, res) => reply(req, res, await run(req, 'map', sourceMapping.parse(req.body)))))
  router.post('/imports', wrap(async (req, res) => reply(req, res, await run(req, 'job', importJob.parse(req.body)))))
  for (const action of ['preview', 'apply'] as const) router.post(`/imports/:id/${action}`, wrap(async (req, res) => {
    const batch = importBatch.parse(req.body)
    const rows = batch.rows.map(row => ({ ...row, source_fingerprint: crypto.createHash('sha256').update(JSON.stringify({ source_id: row.source_id, record: row.record })).digest('hex') }))
    // Hash the validated payload, never accept a client-provided fingerprint.
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
    reply(req, res, await run(req, action, { job_id: uuid.parse(req.params.id), ...batch, rows, fingerprint }))
  }))
  router.patch('/imports/:id', wrap(async (req, res) => reply(req, res, await run(req, 'job-status', { job_id: uuid.parse(req.params.id), ...jobStatus.parse(req.body) }))))
  router.get('/work', wrap(async (req, res) => reply(req, res, await run(req, 'work', {}))))
  // Confirmation is intentionally absent until the adapter has a verified success contract.
  router.post('/report-pushes', wrap(async (req, res) => reply(req, res, await run(req, 'pending-push', pendingPush.parse(req.body)))))
  return router
}
