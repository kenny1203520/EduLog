import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { sendData } from './response.js'
import { isTeacherPresent } from './reportSemantics.js'
import { measureRequestPhase, recordDatabaseCall, setAuditContext } from './context.js'
import { authorizeCollection, authorizeResource } from './authorization.js'
import { resources } from './resources.js'
import { attachTeacherProfile, complete, idempotency } from './resourceRouter.js'

const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
const reportFields = 'id,enrollment_id,class_occurrence_id,lesson_id,content,content_document,is_completed,progress_letter,attendance_status,class_participation,classroom_behavior,contact_notes,contact_notes_document,class_notes,class_notes_document,version,absence_reason,external_link,updated_at'
const dashboardOccurrenceFields = 'id,class_session_id,occurrence_date,status,teacher_ids,teacher_attendance,is_conducted,actual_start_time,actual_end_time,original_start_time,original_end_time,time_zone,class_sessions(id,name,time_zone,classrooms(id,name,color))'

function requireDb(req: Request) { if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required'); return req.db }

async function database<T>(req: Request, work: () => PromiseLike<T>): Promise<T> {
  recordDatabaseCall(req)
  return measureRequestPhase(req, 'database', work)
}

function throwDatabaseError(req: Request, operation: string, error: { code?: string }): never {
  req.log.error({ operation, database_error_code: error.code ?? 'UNKNOWN', request_id: req.requestId, trace_id: req.traceId }, 'database_operation_failed')
  throw mapDatabaseError(error as any)
}

async function requirePagePermission(req: Request, permission: string, resource: string, resourceId: string | null = null, operation = 'page.permission') {
  const db = requireDb(req)
  setAuditContext(req, { domain: permission.startsWith('system.') ? 'system' : 'teaching', resource, resourceId, action: 'read', permission })
  const result = await database(req, () => db.rpc('has_api_permission', {
    p_user_id: req.user!.id,
    p_permission_key: permission,
    p_classroom_id: null,
    p_class_session_id: null,
  }))
  if (result.error) {
    req.log.error({ operation, database_error_code: result.error.code ?? 'UNKNOWN', request_id: req.requestId, trace_id: req.traceId }, 'database_operation_failed')
    throw mapDatabaseError(result.error)
  }
  if (result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to read this page')
}

async function requireEnrollmentReportsPermission(req: Request, enrollmentId: string) {
  const db = requireDb(req)
  setAuditContext(req, { domain: 'teaching', resource: 'enrollment-reports', resourceId: enrollmentId, action: 'read', permission: 'teaching.reports.list', scopeId: enrollmentId, scopeType: 'enrollment' })
  const result = await database(req, () => db.rpc('can_access_enrollment', { p_enrollment_id: enrollmentId, p_permission_key: 'teaching.reports.list' }))
  if (result.error) throw mapDatabaseError(result.error)
  if (result.data !== true) throw new ApiError(404, 'NOT_FOUND', 'The enrollment was not found')
}

async function preferences(req: Request, res: Response) {
  const db = requireDb(req)
  const [preference, visibility] = await Promise.all([
    database(req, () => db.from('user_preferences').select('user_id,time_zone,editor_settings,created_at,updated_at').eq('user_id', req.user!.id).maybeSingle()),
    database(req, () => db.from('user_entity_visibility_preferences').select('entity_id,entity_type').eq('user_id', req.user!.id).eq('is_hidden', true)),
  ])
  if (preference.error) throw mapDatabaseError(preference.error); if (visibility.error) throw mapDatabaseError(visibility.error)
  const grouped: Record<string, string[]> = { classroom: [], class_session: [] }
  for (const row of visibility.data ?? []) (grouped[row.entity_type] ??= []).push(row.entity_id)
  return sendData(req, res, { preferences: preference.data ?? null, visibility: grouped })
}

const personalProfilePatch = z.object({
  display_name: z.string().trim().min(1).max(200).nullable().optional(),
  contact_email: z.string().email().nullable().optional(),
  phone: z.string().max(1000).nullable().optional(),
  address: z.string().max(4000).nullable().optional(),
  mailing_address: z.string().max(4000).nullable().optional(),
  birthday: z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/).nullable().optional(),
  government_id: z.string().max(1000).nullable().optional(),
  bio: z.string().max(10000).nullable().optional(),
  bio_document: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict()

async function myPersonProfile(req: Request, res: Response) {
  const db = requireDb(req)
  const account = await database(req, () => db.from('profiles').select('person_profile_id').eq('id', req.user!.id).maybeSingle())
  if (account.error) throw mapDatabaseError(account.error)
  const personId = typeof account.data?.person_profile_id === 'string' ? account.data.person_profile_id : null
  if (!personId || !req.adminDb) throw new ApiError(503, 'PERSON_PROFILE_MISSING', 'The personal profile is not available')
  setAuditContext(req, { domain: 'system', resource: 'person-profile', resourceId: personId, action: req.method.toLowerCase() })

  if (req.method === 'GET') {
    const result = await database(req, () => req.adminDb!.from('person_profiles')
      .select('id,display_name,contact_email,phone,address,mailing_address,birthday,government_id,bio,bio_document,created_at,updated_at')
      .eq('id', personId).maybeSingle())
    if (result.error) throw mapDatabaseError(result.error)
    return sendData(req, res, result.data)
  }

  const patch = personalProfilePatch.parse(req.body)
  if (!Object.keys(patch).length) throw new ApiError(422, 'EMPTY_MUTATION', 'At least one profile field is required')
  const replay = await idempotency(req, 200, null)
  if (replay) return res.status(replay.status).json(replay.body)
  const result = await database(req, () => req.adminDb!.from('person_profiles').update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', personId)
    .select('id,display_name,contact_email,phone,address,mailing_address,birthday,government_id,bio,bio_document,created_at,updated_at')
    .maybeSingle())
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'The personal profile was not found')
  const envelope = { data: result.data, meta: {}, request_id: req.requestId, trace_id: req.traceId }
  await complete(req, 200, envelope)
  return res.json(envelope)
}

async function studentReportsPage(req: Request, res: Response) {
  const db = requireDb(req)
  const enrollmentId = typeof req.params.enrollmentId === 'string' ? req.params.enrollmentId : null
  if (!enrollmentId || !z.string().uuid().safeParse(enrollmentId).success) throw new ApiError(400, 'INVALID_ID', 'Enrollment id is invalid')
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(1000000).default(0), sort: z.enum(['occurrence_date', '-occurrence_date', 'updated_at', '-updated_at']).default('-occurrence_date') }).strict().parse(req.query)
  await requireEnrollmentReportsPermission(req, enrollmentId)
  const enrollment = await db.from('enrollments').select('id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,time_zone,koding_admission_id,created_at,updated_at,students(id,name),courses(id,subject,stage,display_name),classrooms(id,name)').eq('id', enrollmentId).maybeSingle()
  let reportsQuery = db.from('occurrence_reports').select(`${reportFields},class_occurrences(id,occurrence_date,actual_start_time,actual_end_time,original_start_time,original_end_time,time_zone,class_session_id,class_sessions(id,name,classroom_id,classrooms(id,name))),lessons(id,title,sequence)`, { count: 'exact' }).eq('enrollment_id', enrollmentId)
  const descending = query.sort.startsWith('-')
  const sortField = query.sort.replace(/^-/, '')
  reportsQuery = sortField === 'occurrence_date'
    ? reportsQuery.order('occurrence_date', { foreignTable: 'class_occurrences', ascending: !descending })
    : reportsQuery.order(sortField, { ascending: !descending })
  const reports = await reportsQuery.range(query.offset, query.offset + query.limit - 1)
  if (enrollment.error) throw mapDatabaseError(enrollment.error); if (reports.error) throw mapDatabaseError(reports.error)
  return sendData(req, res, { enrollment: enrollment.data ?? null, reports: reports.data ?? [], count: reports.count ?? 0 }, { limit: query.limit, offset: query.offset, total: reports.count ?? 0, sort: query.sort })
}

async function classroomManager(req: Request, res: Response) {
  const db = requireDb(req); const query = z.object({ limit: z.coerce.number().int().min(1).max(100), offset: z.coerce.number().int().min(0).max(1000000), search: z.string().max(200), visibility: z.enum(['all', 'visible', 'hidden']).default('visible'), session_limit: z.coerce.number().int().min(1).max(100), session_offset: z.coerce.number().int().min(0).max(1000000), classroom_id: z.string().uuid().optional() }).strict().parse({ limit: req.query.limit ?? 100, offset: req.query.offset ?? 0, search: req.query.search ?? '', visibility: req.query.visibility, session_limit: req.query.session_limit ?? 50, session_offset: req.query.session_offset ?? 0, classroom_id: req.query.classroom_id })
  await requirePagePermission(req, 'teaching.classrooms.list', 'classrooms-overview')
  const result = await database(req, () => db.rpc('get_classrooms_overview', {
    p_limit: query.limit,
    p_offset: query.offset,
    p_search: query.search,
    p_visibility: query.visibility,
    p_session_limit: query.session_limit,
    p_session_offset: query.session_offset,
    p_classroom_id: query.classroom_id ?? null,
  }))
  if (result.error) throwDatabaseError(req, 'classrooms_overview.read', result.error)
  const page = (result.data ?? {}) as Record<string, unknown>
  const classrooms = Array.isArray(page.classrooms) ? page.classrooms : []
  const classSessions = Array.isArray(page.classSessions) ? page.classSessions : []
  const numberValue = (key: string) => Number(page[key] ?? 0)
  const numericKeys = ['count', 'classroomTotal', 'visibleClassroomCount', 'hiddenClassroomCount', 'sessionCount', 'sessionTotal', 'visibleSessionCount', 'hiddenSessionCount']
  if (numericKeys.some((key) => !Number.isSafeInteger(numberValue(key)) || numberValue(key) < 0)) {
    throw new ApiError(500, 'DATABASE_ERROR', 'The request could not be completed')
  }
  return sendData(req, res, {
    classrooms,
    count: numberValue('count'),
    classroomTotal: numberValue('classroomTotal'),
    visibleClassroomCount: numberValue('visibleClassroomCount'),
    hiddenClassroomCount: numberValue('hiddenClassroomCount'),
    hiddenClassroomIds: Array.isArray(page.hiddenClassroomIds) ? page.hiddenClassroomIds : [],
    hiddenSessionIds: Array.isArray(page.hiddenSessionIds) ? page.hiddenSessionIds : [],
    classSessions,
    sessionCount: numberValue('sessionCount'),
    sessionTotal: numberValue('sessionTotal'),
    visibleSessionCount: numberValue('visibleSessionCount'),
    hiddenSessionCount: numberValue('hiddenSessionCount'),
  }, { limit: query.limit, offset: query.offset, total: numberValue('count'), sort: 'name' })
}

async function holidays(req: Request, res: Response) {
  const db = requireDb(req); const query = z.object({ expand: z.coerce.boolean().default(true), limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1000000).default(0), search: z.string().max(200).default(''), sort: z.enum(['start_date', '-start_date', 'name', '-name']).default('-start_date') }).strict().parse(req.query)
  await requirePagePermission(req, 'teaching.holidays.list', 'holidays-overview')
  const result = await database(req, () => db.rpc('get_holidays_overview', {
    p_limit: query.limit,
    p_offset: query.offset,
    p_search: query.search,
    p_sort: query.sort,
    p_expand: query.expand,
  }))
  if (result.error) throwDatabaseError(req, 'holidays_overview.read', result.error)
  const page = (result.data ?? {}) as { items?: unknown; total?: unknown }
  const data = Array.isArray(page.items) ? page.items : []
  const total = Number(page.total ?? 0)
  if (!Number.isSafeInteger(total) || total < 0) throwDatabaseError(req, 'holidays_overview.read', { code: 'INVALID_RESULT' })
  return sendData(req, res, data, { limit: query.limit, offset: query.offset, total, sort: query.sort })
}

const incompleteQuerySchema = z.object({
  days_back: z.coerce.number().int().min(1).max(3650).default(90),
  scope: z.enum(['all', 'my_present', 'my_notifications']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  search: z.string().trim().max(200).default(''),
  sort: z.enum(['date', '-date', 'updated_at', '-updated_at']).default('-date'),
}).strict()
type TeacherScope = { id: string; user_id: string } | null

async function loadCurrentTeacher(req: Request, operation: string): Promise<TeacherScope> {
  const db = requireDb(req)
  const result = await database(req, () => db.from('teachers').select('id,user_id').eq('user_id', req.user!.id).maybeSingle())
  if (result.error) throwDatabaseError(req, operation, result.error)
  return result.data as TeacherScope
}

async function loadIncompleteReports(req: Request, query: z.infer<typeof incompleteQuerySchema>, teacher: TeacherScope, operation: string) {
  const db = requireDb(req)
  void teacher
  const result = await database(req, () => db.rpc('get_incomplete_reports_page', {
    p_days_back: query.days_back,
    p_scope: query.scope,
    p_limit: query.limit,
    p_offset: query.offset,
    p_search: query.search,
    p_sort: query.sort,
  }))
  if (result.error) throwDatabaseError(req, operation, result.error)
  const page = (result.data ?? {}) as { items?: unknown; total?: unknown }
  const rows = Array.isArray(page.items) ? page.items : []
  const total = Number(page.total ?? 0)
  if (!Number.isSafeInteger(total) || total < 0) throwDatabaseError(req, operation, { code: 'INVALID_RESULT' })
  return { rows, total }
}

async function incomplete(req: Request, res: Response) {
  const query = incompleteQuerySchema.parse(req.query)
  await requirePagePermission(req, 'teaching.reports.list', 'incomplete-reports')
  const result = await loadIncompleteReports(req, query, null, 'incomplete_reports.read')
  return sendData(req, res, result.rows, { limit: query.limit, offset: query.offset, total: result.total, sort: query.sort })
}

async function loadDashboardCounts(req: Request) {
  const db = requireDb(req)
  const result = await database(req, () => db.rpc('get_dashboard_counts'))
  if (result.error) throwDatabaseError(req, 'dashboard.counts', result.error)
  return (result.data ?? {}) as { totalStudents?: number; activeCourses?: number }
}

async function loadDashboardOccurrences(req: Request, start: string | undefined, end: string | undefined, teacher: TeacherScope) {
  if (!start || !end) return []
  const db = requireDb(req)
  const result = await database(req, () => db.from('class_occurrences').select(dashboardOccurrenceFields).eq('is_conducted', true).gte('occurrence_date', start).lte('occurrence_date', end).order('occurrence_date', { ascending: true }).order('id', { ascending: true }).range(0, 99))
  if (result.error) throwDatabaseError(req, 'dashboard.occurrences', result.error)
  const rows = result.data ?? []
  if (!teacher) return rows
  return rows.filter((row: any) => isTeacherPresent(teacher.id, req.user!.id, row.teacher_ids ?? [], row.teacher_attendance ?? {}))
}

async function dashboard(req: Request, res: Response) {
  const query = z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict().superRefine((value, context) => {
    if ((value.start == null) !== (value.end == null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['start'], message: 'start and end must be provided together' })
      return
    }
    if (!value.start || !value.end) return
    const start = Date.parse(`${value.start}T00:00:00.000Z`)
    const end = Date.parse(`${value.end}T00:00:00.000Z`)
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['start'], message: 'start and end must be valid calendar dates' })
      return
    }
    if (end < start) context.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'end must not be earlier than start' })
    if (end - start > 31 * 86400000) context.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'date range must not exceed 31 days' })
  }).parse(req.query)
  await requirePagePermission(req, 'teaching.reports.list', 'dashboard', null, 'dashboard.permission')
  const teacher = await loadCurrentTeacher(req, 'dashboard.teacher_scope')
  const pendingQuery = { days_back: 90, scope: 'my_present' as const, limit: 3, offset: 0, search: '', sort: '-date' as const }
  const [counts, pendingReports, occurrences] = await Promise.all([
    loadDashboardCounts(req),
    loadIncompleteReports(req, pendingQuery, teacher, 'dashboard.pending_reports'),
    loadDashboardOccurrences(req, query.start, query.end, teacher),
  ])
  return sendData(req, res, {
    pendingReportsScope: 'my_present',
    stats: {
      totalStudents: counts.totalStudents ?? 0,
      activeCourses: counts.activeCourses ?? 0,
      pendingReportsCount: pendingReports.total,
      pendingReportsScope: 'my_present',
    },
    pendingReports: pendingReports.rows,
    occurrences,
  })
}

const pageListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  search: z.string().trim().max(200).default(''),
  sort: z.string().max(80).optional(),
}).strict()

function pageSort(value: string | undefined, allowed: readonly string[], fallback: string) {
  const sort = value ?? fallback
  const descending = sort.startsWith('-')
  const field = descending ? sort.slice(1) : sort
  if (!allowed.includes(field)) throw new ApiError(400, 'INVALID_SORT', 'Sort field is not supported')
  return { field, ascending: !descending, value: sort }
}

async function coursesOverview(req: Request, res: Response) {
  const db = requireDb(req)
  const query = pageListQuery.parse(req.query)
  const sort = pageSort(query.sort, ['display_name', 'subject', 'stage', 'created_at'], 'display_name')
  await authorizeCollection(req, resources.courses, 'teaching.courses.list', query)
  const result = await database(req, () => db.rpc('get_courses_overview', {
    p_limit: query.limit, p_offset: query.offset, p_search: query.search, p_sort: sort.value,
  }))
  if (result.error) throwDatabaseError(req, 'courses_overview.read', result.error)
  const page = (result.data ?? {}) as { items?: unknown; total?: unknown }
  const items = Array.isArray(page.items) ? page.items : []
  const total = Number(page.total ?? 0)
  if (!Number.isSafeInteger(total) || total < 0) throw new ApiError(500, 'DATABASE_ERROR', 'The request could not be completed')
  return sendData(req, res, items, { limit: query.limit, offset: query.offset, total, sort: sort.value })
}

async function studentsOverview(req: Request, res: Response) {
  const db = requireDb(req)
  const query = pageListQuery.parse(req.query)
  const sort = pageSort(query.sort, ['name', 'created_at', 'updated_at'], 'name')
  await authorizeCollection(req, resources.students, 'teaching.students.list', query)
  const result = await db.rpc('get_students_overview', {
    p_limit: query.limit,
    p_offset: query.offset,
    p_search: query.search,
    p_sort: sort.value,
  })
  if (result.error) throwDatabaseError(req, 'students_overview.read', result.error)
  const page = (result.data ?? {}) as { items?: unknown; total?: unknown }
  const items = Array.isArray(page.items) ? page.items : []
  const total = Number(page.total ?? 0)
  if (!Number.isSafeInteger(total) || total < 0) {
    req.log.error({ operation: 'students_overview.read', database_error_code: 'INVALID_RESULT', request_id: req.requestId, trace_id: req.traceId }, 'database_operation_failed')
    throw new ApiError(500, 'DATABASE_ERROR', 'The request could not be completed')
  }
  return sendData(req, res, items, { limit: query.limit, offset: query.offset, total, sort: sort.value })
}

async function studentProfile(req: Request, res: Response) {
  const db = requireDb(req)
  const studentId = typeof req.params.studentId === 'string' ? req.params.studentId : ''
  if (!z.string().uuid().safeParse(studentId).success) throw new ApiError(400, 'INVALID_ID', 'Student id is invalid')
  await authorizeResource(req, resources.students, 'teaching.students.read', studentId)
  const result = await db.rpc('get_student_profile_page', { p_student_id: studentId })
  if (result.error) throwDatabaseError(req, 'student_profile.read', result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Student was not found')
  return sendData(req, res, result.data)
}

async function studentPrivateDetails(req: Request, res: Response) {
  const db = requireDb(req)
  const studentId = typeof req.params.studentId === 'string' ? req.params.studentId : ''
  if (!z.string().uuid().safeParse(studentId).success) throw new ApiError(400, 'INVALID_ID', 'Student id is invalid')
  await authorizeResource(req, resources.students, 'teaching.students.read_sensitive', studentId)
  const result = await db.rpc('get_student_sensitive_details', { p_student_id: studentId })
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Student was not found')
  return sendData(req, res, result.data)
}

async function studentReports(req: Request, res: Response) {
  const db = requireDb(req)
  const studentId = typeof req.params.studentId === 'string' ? req.params.studentId : ''
  if (!z.string().uuid().safeParse(studentId).success) throw new ApiError(400, 'INVALID_ID', 'Student id is invalid')
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(1000000).default(0), sort: z.enum(['start_date', '-start_date', 'created_at', '-created_at']).default('-start_date') }).strict().parse(req.query)
  await authorizeResource(req, resources.students, 'teaching.students.read', studentId)
  const student = await db.from('students').select('id,name').eq('id', studentId).maybeSingle()
  if (student.error) throw mapDatabaseError(student.error)
  if (!student.data) throw new ApiError(404, 'NOT_FOUND', 'Student was not found')
  const descending = query.sort.startsWith('-')
  const field = query.sort.replace(/^-/, '')
  const result = await db.from('enrollments').select('id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,time_zone,created_at,updated_at,courses(subject,stage,display_name),classrooms(name)', { count: 'exact' }).eq('student_id', studentId).order(field, { ascending: !descending }).range(query.offset, query.offset + query.limit - 1)
  if (result.error) throw mapDatabaseError(result.error)
  return sendData(req, res, { student: student.data, enrollments: result.data ?? [] }, { limit: query.limit, offset: query.offset, total: result.count ?? 0, sort: query.sort })
}

async function teachersOverview(req: Request, res: Response) {
  const db = requireDb(req)
  const query = pageListQuery.parse(req.query)
  const sort = pageSort(query.sort, ['name', 'created_at'], 'name')
  await authorizeCollection(req, resources.teachers, 'teaching.teachers.list', query)
  const result = await database(req, () => db.rpc('get_teachers_overview', {
    p_limit: query.limit, p_offset: query.offset, p_search: query.search, p_sort: sort.value,
  }))
  if (result.error) throwDatabaseError(req, 'teachers_overview.read', result.error)
  const page = (result.data ?? {}) as { items?: unknown; total?: unknown; statistics?: unknown }
  const teachers = Array.isArray(page.items) ? await attachTeacherProfile(req, page.items) as unknown[] : []
  const total = Number(page.total ?? 0)
  if (!Number.isSafeInteger(total) || total < 0 || !page.statistics || typeof page.statistics !== 'object') {
    throw new ApiError(500, 'DATABASE_ERROR', 'The request could not be completed')
  }
  return sendData(req, res, { teachers, statistics: page.statistics }, { limit: query.limit, offset: query.offset, total, sort: sort.value })
}

async function teacherPrivateDetails(req: Request, res: Response) {
  const db = requireDb(req)
  const teacherId = typeof req.params.teacherId === 'string' ? req.params.teacherId : ''
  if (!z.string().uuid().safeParse(teacherId).success) throw new ApiError(400, 'INVALID_ID', 'Teacher id is invalid')
  await authorizeResource(req, resources.teachers, 'teaching.teachers.read_sensitive', teacherId)
  const result = await db.rpc('get_teacher_sensitive_details', { p_teacher_id: teacherId })
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Teacher was not found')
  return sendData(req, res, result.data)
}

async function classSessionWorkspace(req: Request, res: Response) {
  const db = requireDb(req)
  const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : ''
  if (!z.string().uuid().safeParse(sessionId).success) throw new ApiError(400, 'INVALID_ID', 'Class session id is invalid')
  const query = z.object({
    occurrence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict().superRefine((value, context) => {
    if (!value.occurrence_date) return
    const parsed = Date.parse(`${value.occurrence_date}T00:00:00.000Z`)
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value.occurrence_date) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['occurrence_date'], message: 'occurrence_date must be a valid calendar date' })
    }
  }).parse(req.query)
  await authorizeResource(req, resources['class-sessions'], 'teaching.class_sessions.read', sessionId)
  const result = await database(req, () => db.rpc('get_class_session_workspace', {
    p_session_id: sessionId,
    p_occurrence_date: query.occurrence_date ?? null,
  }))
  if (result.error) throwDatabaseError(req, 'class_session_workspace.read', result.error)
  const page = (result.data ?? {}) as { session?: Record<string, unknown> | null; enrollments?: unknown; teachers?: unknown }
  if (!page.session) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found')
  const enrollments = Array.isArray(page.enrollments) ? page.enrollments as Array<Record<string, unknown>> : []
  const teachers = Array.isArray(page.teachers) ? await attachTeacherProfile(req, page.teachers) as unknown[] : []
  const rosterDate = typeof page.session.roster_date === 'string' ? page.session.roster_date : (query.occurrence_date ?? null)
  return sendData(req, res, { session: { ...page.session, current_enrollments: enrollments.filter((enrollment) => enrollment.status === 'regular').length }, enrollments, teachers }, { total: enrollments.length, roster_date: rosterDate })
}

export function createAggregateRouter() {
  const router = Router()
  router.get('/pages/me/preferences', wrap(preferences))
  router.get('/pages/me/person-profile', wrap(myPersonProfile))
  router.patch('/pages/me/person-profile', wrap(myPersonProfile))
  router.get('/pages/enrollments/:enrollmentId/reports', wrap(studentReports))
  router.get('/pages/classrooms/overview', wrap(classroomManager))
  router.get('/pages/holidays/overview', wrap(holidays))
  router.get('/pages/reports/incomplete', wrap(incomplete))
  router.get('/pages/dashboard', wrap(dashboard))
  router.get('/pages/courses/overview', wrap(coursesOverview))
  router.get('/pages/students/overview', wrap(studentsOverview))
  router.get('/pages/students/:studentId/profile', wrap(studentProfile))
  router.get('/pages/students/:studentId/private-details', wrap(studentPrivateDetails))
  router.get('/pages/students/:studentId/reports', wrap(studentReportsPage))
  router.get('/pages/teachers/overview', wrap(teachersOverview))
  router.get('/pages/teachers/:teacherId/private-details', wrap(teacherPrivateDetails))
  router.get('/pages/class-sessions/:sessionId/workspace', wrap(classSessionWorkspace))
  return router
}
