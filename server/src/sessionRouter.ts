import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { complete, idempotency } from './resourceRouter.js'
import { setAuditContext } from './context.js'

const sessionFields = 'id,name,classroom_id,course_ids,day_of_week,start_time,end_time,capacity,lesson_number,external_link,start_date,end_date,time_zone,session_type,schedule_mode,teaching_id,user_id,created_at,updated_at,class_session_schedule_rules(id,class_session_id,schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)'

const scheduleRuleSchema = z.object({
  // Existing rules are returned with their persisted id. It is accepted for
  // round-trip compatibility only; save_class_session_with_schedule replaces
  // the rule set atomically and intentionally does not trust this id.
  id: z.string().uuid().optional(),
  schedule_kind: z.enum(['weekly', 'monthly', 'specific_dates']),
  day_of_week: z.number().int().min(0).max(6).nullable().optional(),
  day_of_month: z.number().int().min(1).max(31).nullable().optional(),
  occurrence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
}).strict()

export const sessionSchema = z.object({
  name: z.string().trim().min(1).max(255),
  classroom_id: z.string().uuid().nullable().optional(),
  course_ids: z.array(z.string().uuid()).max(100).default([]),
  capacity: z.number().int().min(0).max(100000).default(10),
  lesson_number: z.number().int().min(0).nullable().optional(),
  external_link: z.url().max(2048).nullable().optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  time_zone: z.string().min(1).max(64).default('Asia/Taipei'),
  session_type: z.enum(['regular', 'camp']).default('regular'),
  schedule_mode: z.enum(['weekly', 'monthly', 'specific_dates']).default('weekly'),
  schedule_rules: z.array(scheduleRuleSchema).max(366).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.start_date && value.end_date && value.start_date > value.end_date) ctx.addIssue({ code: 'custom', path: ['end_date'], message: 'end_date must not be before start_date' })
  if (value.session_type === 'camp' && value.schedule_mode !== 'specific_dates') ctx.addIssue({ code: 'custom', path: ['schedule_mode'], message: 'Camp sessions require specific_dates' })
  if (value.session_type === 'regular' && value.schedule_mode === 'specific_dates') ctx.addIssue({ code: 'custom', path: ['schedule_mode'], message: 'Regular sessions cannot use specific_dates' })
  if (value.session_type === 'regular' && value.schedule_rules.length === 0) ctx.addIssue({ code: 'custom', path: ['schedule_rules'], message: 'Regular sessions require at least one schedule rule' })
  value.schedule_rules.forEach((rule, index) => {
    if (rule.schedule_kind !== value.schedule_mode) ctx.addIssue({ code: 'custom', path: ['schedule_rules', index, 'schedule_kind'], message: 'Schedule rule kind must match schedule_mode' })
    if (rule.schedule_kind === 'weekly' && rule.day_of_week == null) ctx.addIssue({ code: 'custom', path: ['schedule_rules', index, 'day_of_week'], message: 'Weekly rules require day_of_week' })
    if (rule.schedule_kind === 'monthly' && rule.day_of_month == null) ctx.addIssue({ code: 'custom', path: ['schedule_rules', index, 'day_of_month'], message: 'Monthly rules require day_of_month' })
    if (rule.schedule_kind === 'specific_dates' && !rule.occurrence_date) ctx.addIssue({ code: 'custom', path: ['schedule_rules', index, 'occurrence_date'], message: 'Specific date rules require occurrence_date' })
    if (rule.start_time >= rule.end_time) ctx.addIssue({ code: 'custom', path: ['schedule_rules', index, 'end_time'], message: 'end_time must be after start_time' })
  })
})

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
}

async function authorize(req: Request, action: 'read' | 'create' | 'update' | 'delete', id: string | null) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const result = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: `teaching.class_sessions.${action}`,
    p_classroom_id: null,
    p_class_session_id: id,
  })
  setAuditContext(req, { domain: 'teaching', resource: 'class-sessions', action, resourceId: id, permission: `teaching.class_sessions.${action}`, scopeId: id, scopeType: 'class_session' })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to modify class sessions')
}

export async function authorizeRelatedRead(req: Request, permission: string, sessionId: string) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const result = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: permission,
    p_classroom_id: null,
    p_class_session_id: sessionId,
  })
  if (result.error || result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to read the related session data')
}

async function authorizeSaveScope(req: Request, action: 'create' | 'update', id: string | null, input: z.infer<typeof sessionSchema>) {
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const classroomId = input.classroom_id ?? null
  const teachingIds = new Set<string>()
  let existingTeachingId: string | null = null
  if (id) {
    // Authorize the persisted session before resolving any proposed
    // classroom/course scope. This prevents a same-route idempotency replay
    // from using an allowed replacement scope to target a foreign session.
    await authorize(req, action, id)
    const existing = await req.db.from('class_sessions').select('teaching_id').eq('id', id).maybeSingle()
    if (existing.error) throw mapDatabaseError(existing.error)
    if (!existing.data?.teaching_id) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found')
    existingTeachingId = existing.data.teaching_id
    teachingIds.add(existing.data.teaching_id)
  }
  if (classroomId) {
    const classroom = await req.db.from('classrooms').select('teaching_id').eq('id', classroomId).maybeSingle()
    if (classroom.error) throw mapDatabaseError(classroom.error)
    if (!classroom.data?.teaching_id) throw new ApiError(422, 'INVALID_REFERENCE', 'The classroom is invalid')
    teachingIds.add(classroom.data.teaching_id)
  }
  if (input.course_ids.length) {
    const courses = await req.db.from('courses').select('id,teaching_id').in('id', input.course_ids)
    if (courses.error) throw mapDatabaseError(courses.error)
    if ((courses.data ?? []).length !== input.course_ids.length || (courses.data ?? []).some((course) => !course.teaching_id)) {
      throw new ApiError(422, 'INVALID_REFERENCE', 'A course reference is invalid')
    }
    for (const course of courses.data ?? []) teachingIds.add(course.teaching_id)
  }
  if (teachingIds.size !== 1) throw new ApiError(422, 'TEACHING_SCOPE_REQUIRED', 'A classroom or course teaching scope is required')
  const teachingId = [...teachingIds][0]
  if (existingTeachingId && existingTeachingId !== teachingId) throw new ApiError(422, 'SESSION_TEACHING_MISMATCH', 'The class session teaching scope cannot change')
  const permission = classroomId || id
    ? await req.db.rpc('has_api_permission', {
      p_user_id: req.user.id,
      p_permission_key: `teaching.class_sessions.${action}`,
      p_classroom_id: classroomId,
      p_class_session_id: id,
    })
    : await req.db.rpc('has_teaching_permission', {
      p_user_id: req.user.id,
      p_permission_key: `teaching.class_sessions.${action}`,
      p_teaching_id: teachingId,
      p_classroom_id: null,
      p_class_session_id: null,
    })
  if (permission.error || permission.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to modify class sessions')
}

async function read(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Class session id is required')
  await authorize(req, 'read', id)
  const result = await req.db!.from('class_sessions').select(sessionFields).eq('id', id).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found')
  return res.json({ data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId })
}

const sessionDetailsFields = `${sessionFields},classrooms(id,name,address,external_link)`

export async function readDetails(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id || !z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Class session id is invalid')
  await authorize(req, 'read', id)
  await authorizeRelatedRead(req, 'teaching.enrollments.list', id)

  const [session, enrollments] = await Promise.all([
    req.db!.from('class_sessions').select(sessionDetailsFields).eq('id', id).maybeSingle(),
    req.db!.from('enrollments').select('id', { count: 'exact', head: true }).eq('class_session_id', id).eq('status', 'regular'),
  ])
  if (session.error) throw mapDatabaseError(session.error)
  if (enrollments.error) throw mapDatabaseError(enrollments.error)
  if (!session.data) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found')

  const classroom = Array.isArray(session.data.classrooms) ? session.data.classrooms[0] : session.data.classrooms
  const data = {
    ...session.data,
    classroom_name: classroom?.name ?? 'Unknown',
    classroom_address: classroom?.address ?? '',
    current_enrollments: enrollments.count ?? 0,
  }
  delete (data as Record<string, unknown>).classrooms
  setAuditContext(req, { resource: 'class-sessions', resourceId: id, action: 'read', scopeId: id, scopeType: 'class_session' })
  return sendDetails(req, res, data)
}

async function readEnrollmentPeak(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id || !z.string().uuid().safeParse(id).success) throw new ApiError(400, 'INVALID_ID', 'Class session id is invalid')
  const query = z.object({
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }).strict().parse(req.query)
  if (query.start_date > query.end_date) throw new ApiError(422, 'INVALID_DATE_RANGE', 'end_date must not be before start_date')
  await authorize(req, 'read', id)
  await Promise.all([
    authorizeRelatedRead(req, 'teaching.occurrences.list', id),
    authorizeRelatedRead(req, 'teaching.reports.list', id),
  ])

  const result = await req.db!.rpc('get_class_session_occupancy', {
    p_class_session_id: id,
    p_start_date: query.start_date,
    p_end_date: query.end_date,
  })
  if (result.error) throw mapDatabaseError(result.error)
  const occupancy = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {}
  const maxOccupancy = Number(occupancy.max_occupancy ?? 0)
  return sendDetails(req, res, {
    ...occupancy,
    max_occupancy: maxOccupancy,
    max_enrollment: maxOccupancy,
  })
}

function sendDetails(req: Request, res: Response, data: unknown) {
  return res.json({ data, meta: {}, request_id: req.requestId, trace_id: req.traceId })
}

async function save(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : null
  const input = sessionSchema.parse(req.body)
  await authorizeSaveScope(req, id ? 'update' : 'create', id, input)
  const replay = await idempotency(req, id ? 200 : 201, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.rpc('save_class_session_with_schedule', {
    p_session: {
      name: input.name,
      classroom_id: input.classroom_id ?? null,
      course_ids: input.course_ids,
      capacity: input.capacity,
      lesson_number: input.lesson_number ?? null,
      external_link: input.external_link ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      time_zone: input.time_zone,
      session_type: input.session_type,
      schedule_mode: input.schedule_mode,
    },
    p_rules: input.schedule_rules.map(({ schedule_kind, day_of_week, day_of_month, occurrence_date, start_time, end_time }) => ({
      schedule_kind,
      day_of_week: day_of_week ?? null,
      day_of_month: day_of_month ?? null,
      occurrence_date: occurrence_date ?? null,
      start_time,
      end_time,
    })),
    p_session_id: id,
  })
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(409, 'SESSION_NOT_SAVED', 'The class session could not be saved')
  const saved = await req.db!.from('class_sessions').select(sessionFields).eq('id', String(result.data)).maybeSingle()
  if (saved.error) throw mapDatabaseError(saved.error)
  if (!saved.data) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found after saving')
  const status = id ? 200 : 201
  const envelope = { data: saved.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, status, envelope)
  return res.status(status).json(envelope)
}

async function remove(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : undefined
  if (!id) throw new ApiError(400, 'INVALID_ID', 'Class session id is required')
  await authorize(req, 'delete', id)
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await req.db!.from('class_sessions').delete().eq('id', id).select(sessionFields).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, envelope)
  return res.json(envelope)
}

export function createSessionRouter() {
  const router = Router()
  router.post('/class-sessions', wrap(save))
  router.patch('/class-sessions/:id', wrap(save))
  router.delete('/class-sessions/:id', wrap(remove))
  router.get('/class-sessions/:id/details', wrap(readDetails))
  router.get('/class-sessions/:id/enrollment-peak', wrap(readEnrollmentPeak))
  router.get('/class-sessions/:id', wrap(read))
  return router
}
