import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { sendData } from './response.js'
import { isIncompleteReport, isTeacherPresent, reportMissingFlags } from './reportSemantics.js'
import { setAuditContext } from './context.js'
import { authorizeCollection, authorizeResource } from './authorization.js'
import { resources } from './resources.js'

const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
const reportFields = 'id,enrollment_id,class_occurrence_id,lesson_id,content,content_document,is_completed,progress_letter,attendance_status,class_participation,classroom_behavior,contact_notes,contact_notes_document,class_notes,class_notes_document,version,absence_reason,external_link,updated_at'
const dashboardOccurrenceFields = 'id,class_session_id,occurrence_date,status,teacher_ids,teacher_attendance,is_conducted,actual_start_time,actual_end_time,original_start_time,original_end_time,time_zone,class_sessions(id,name,time_zone,classrooms(id,name,color))'

function requireDb(req: Request) { if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required'); return req.db }

function throwDatabaseError(req: Request, operation: string, error: { code?: string }): never {
  req.log.error({ operation, database_error_code: error.code ?? 'UNKNOWN', request_id: req.requestId, trace_id: req.traceId }, 'database_operation_failed')
  throw mapDatabaseError(error as any)
}

async function requirePagePermission(req: Request, permission: string, resource: string, resourceId: string | null = null, operation = 'page.permission') {
  const db = requireDb(req)
  setAuditContext(req, { domain: permission.startsWith('system.') ? 'system' : 'teaching', resource, resourceId, action: 'read', permission })
  const result = await db.rpc('has_api_permission', {
    p_user_id: req.user!.id,
    p_permission_key: permission,
    p_classroom_id: null,
    p_class_session_id: null,
  })
  if (result.error) {
    req.log.error({ operation, database_error_code: result.error.code ?? 'UNKNOWN', request_id: req.requestId, trace_id: req.traceId }, 'database_operation_failed')
    throw mapDatabaseError(result.error)
  }
  if (result.data !== true) throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to read this page')
}

async function requireEnrollmentReportsPermission(req: Request, enrollmentId: string) {
  const db = requireDb(req)
  setAuditContext(req, { domain: 'teaching', resource: 'enrollment-reports', resourceId: enrollmentId, action: 'read', permission: 'teaching.reports.list', scopeId: enrollmentId, scopeType: 'enrollment' })
  const result = await db.rpc('can_access_enrollment', { p_enrollment_id: enrollmentId, p_permission_key: 'teaching.reports.list' })
  if (result.error) throw mapDatabaseError(result.error)
  if (result.data !== true) throw new ApiError(404, 'NOT_FOUND', 'The enrollment was not found')
}

async function preferences(req: Request, res: Response) {
  const db = requireDb(req)
  const [preference, visibility] = await Promise.all([
    db.from('user_preferences').select('user_id,time_zone,editor_settings,created_at,updated_at').eq('user_id', req.user!.id).maybeSingle(),
    db.from('user_entity_visibility_preferences').select('entity_id,entity_type').eq('user_id', req.user!.id).eq('is_hidden', true),
  ])
  if (preference.error) throw mapDatabaseError(preference.error); if (visibility.error) throw mapDatabaseError(visibility.error)
  const grouped: Record<string, string[]> = { classroom: [], class_session: [] }
  for (const row of visibility.data ?? []) (grouped[row.entity_type] ??= []).push(row.entity_id)
  return sendData(req, res, { preferences: preference.data ?? null, visibility: grouped })
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
  const db = requireDb(req); const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1000000).default(0), search: z.string().max(200).default(''), visibility: z.enum(['all', 'visible', 'hidden']).default('all'), session_limit: z.coerce.number().int().min(1).max(100).default(50), session_offset: z.coerce.number().int().min(0).max(1000000).default(0), classroom_id: z.string().uuid().optional() }).strict().parse(req.query)
  await requirePagePermission(req, 'teaching.classrooms.list', 'classrooms-overview')
  const visibility = await db.from('user_entity_visibility_preferences').select('entity_type,entity_id').eq('user_id', req.user!.id).eq('is_hidden', true).in('entity_type', ['classroom', 'class_session'])
  if (visibility.error) throw mapDatabaseError(visibility.error)
  const hiddenClassroomIds = new Set((visibility.data ?? []).filter((row) => row.entity_type === 'classroom').map((row) => row.entity_id)); const hiddenSessionIds = (visibility.data ?? []).filter((row) => row.entity_type === 'class_session').map((row) => row.entity_id)
  let classroomQuery = db.from('classrooms').select('id,name,color,external_link,teaching_id,user_id,created_at,updated_at,classroom_schedules(id,classroom_id,day_of_week,start_time,end_time,user_id,created_at,updated_at)', { count: 'exact' }).ilike('name', `%${query.search.replace(/[%_,]/g, '')}%`)
  if (query.visibility === 'hidden') {
    if (hiddenClassroomIds.size) classroomQuery = classroomQuery.in('id', [...hiddenClassroomIds])
    else classroomQuery = classroomQuery.eq('id', '00000000-0000-0000-0000-000000000000')
  } else if (query.visibility === 'visible' && hiddenClassroomIds.size) {
    classroomQuery = classroomQuery.not('id', 'in', `(${[...hiddenClassroomIds].join(',')})`)
  }
  const classroomResult = await classroomQuery.order('name').range(query.offset, query.offset + query.limit - 1)
  if (classroomResult.error) throw mapDatabaseError(classroomResult.error)
  let sessionQuery = db.from('class_sessions').select('id,name,classroom_id,course_ids,day_of_week,start_time,end_time,capacity,lesson_number,external_link,start_date,end_date,time_zone,session_type,schedule_mode,teaching_id,user_id,created_at,updated_at,classrooms(id,name,color),schedule_rules:class_session_schedule_rules(id,schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)', { count: 'exact' })
  if (query.search) sessionQuery = sessionQuery.ilike('name', `%${query.search.replace(/[%_,]/g, '')}%`)
  if (query.classroom_id) sessionQuery = sessionQuery.eq('classroom_id', query.classroom_id)
  if (query.visibility === 'hidden') {
    if (hiddenSessionIds.length) sessionQuery = sessionQuery.in('id', hiddenSessionIds)
    else sessionQuery = sessionQuery.eq('id', '00000000-0000-0000-0000-000000000000')
  } else if (query.visibility === 'visible' && hiddenSessionIds.length) {
    sessionQuery = sessionQuery.not('id', 'in', `(${hiddenSessionIds.join(',')})`)
  }
  const sessionResult = await sessionQuery.order('name', { ascending: true }).range(query.session_offset, query.session_offset + query.session_limit - 1)
  if (sessionResult.error) throw mapDatabaseError(sessionResult.error)
  return sendData(req, res, { classrooms: classroomResult.data ?? [], count: classroomResult.count ?? 0, hiddenClassroomIds: [...hiddenClassroomIds], hiddenSessionIds, classSessions: sessionResult.data ?? [], sessionCount: sessionResult.count ?? 0 }, { limit: query.limit, offset: query.offset, total: classroomResult.count ?? 0, sort: 'name' })
}

async function holidays(req: Request, res: Response) {
  const db = requireDb(req); const query = z.object({ expand: z.coerce.boolean().default(true), limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1000000).default(0), search: z.string().max(200).default(''), sort: z.enum(['start_date', '-start_date', 'name', '-name']).default('-start_date') }).strict().parse(req.query); const expand = query.expand
  await requirePagePermission(req, 'teaching.holidays.list', 'holidays-overview')
  const descending = query.sort.startsWith('-')
  const sortField = query.sort.replace(/^-/, '')
  let holidayQuery = db.from('holidays').select('id,start_date,end_date,time_zone,name,kind,classroom_ids,class_session_ids,teacher_ids,created_at,updated_at', { count: 'exact' })
  if (query.search) holidayQuery = holidayQuery.ilike('name', `%${query.search.replace(/[%_,]/g, '')}%`)
  const result = await holidayQuery.order(sortField, { ascending: !descending }).range(query.offset, query.offset + query.limit - 1)
  if (result.error) throw mapDatabaseError(result.error)
  let data: any[] = result.data ?? []
  if (expand && data.length) {
    const classroomIds = [...new Set(data.flatMap((row) => row.classroom_ids ?? []))]; const sessionIds = [...new Set(data.flatMap((row) => row.class_session_ids ?? []))]; const teacherIds = [...new Set(data.flatMap((row) => row.teacher_ids ?? []))]
    const [classrooms, sessions, teachers] = await Promise.all([db.from('classrooms').select('id,name').in('id', classroomIds), db.from('class_sessions').select('id,name').in('id', sessionIds), db.from('teachers').select('id,name').in('id', teacherIds)])
    if (classrooms.error) throw mapDatabaseError(classrooms.error); if (sessions.error) throw mapDatabaseError(sessions.error); if (teachers.error) throw mapDatabaseError(teachers.error)
    const map = (rows: any[] | null) => Object.fromEntries((rows ?? []).map((row) => [row.id, row.name])); const classroomMap = map(classrooms.data); const sessionMap = map(sessions.data); const teacherMap = map(teachers.data)
    data = data.map((row) => ({ ...row, classroomNames: (row.classroom_ids ?? []).map((id: string) => classroomMap[id]).filter(Boolean), classSessionNames: (row.class_session_ids ?? []).map((id: string) => sessionMap[id]).filter(Boolean), teacherNames: (row.teacher_ids ?? []).map((id: string) => teacherMap[id]).filter(Boolean) }))
  }
  return sendData(req, res, data, { limit: query.limit, offset: query.offset, total: result.count ?? 0, sort: query.sort })
}

const incompleteQuerySchema = z.object({ days_back: z.coerce.number().int().min(1).max(3650).default(90), scope: z.enum(['all', 'my_present', 'my_notifications']).default('all'), limit: z.coerce.number().int().min(1).max(100).default(100), offset: z.coerce.number().int().min(0).max(1000000).default(0) }).strict()
type TeacherScope = { id: string; user_id: string } | null

async function loadCurrentTeacher(req: Request, operation: string): Promise<TeacherScope> {
  const db = requireDb(req)
  const result = await db.from('teachers').select('id,user_id').eq('user_id', req.user!.id).maybeSingle()
  if (result.error) throwDatabaseError(req, operation, result.error)
  return result.data as TeacherScope
}

async function loadIncompleteReports(req: Request, query: z.infer<typeof incompleteQuerySchema>, teacher: TeacherScope, operation: string) {
  const db = requireDb(req)
  const from = new Date(Date.now() - query.days_back * 86400000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  if ((query.scope === 'my_present' || query.scope === 'my_notifications') && !teacher) return { rows: [], total: 0 }
  const result = await db.from('occurrence_reports').select(`${reportFields},enrollments!inner(id,student_id,course_id,students(id,name)),class_occurrences!inner(id,occurrence_date,actual_start_time,actual_end_time,original_start_time,original_end_time,time_zone,is_conducted,teacher_ids,teacher_attendance,class_sessions(id,name,classroom_id,classrooms(id,name)))`).eq('attendance_status', 'present').gte('class_occurrences.occurrence_date', from).lte('class_occurrences.occurrence_date', today)
  if (result.error) throwDatabaseError(req, operation, result.error)
  const rows = (result.data ?? []).filter((row: any) => isIncompleteReport(row) && (query.scope === 'all' || isTeacherPresent(teacher!.id, req.user!.id, row.class_occurrences?.teacher_ids ?? [], row.class_occurrences?.teacher_attendance ?? {}))).map((row: any) => ({ id: row.id, reportId: row.id, enrollmentId: row.enrollment_id, occurrenceId: row.class_occurrence_id, studentName: row.enrollments?.students?.name ?? row.enrollments?.students?.[0]?.name ?? 'Unknown', courseId: row.enrollments?.course_id, className: row.class_occurrences?.class_sessions?.name ?? row.class_occurrences?.class_sessions?.[0]?.name ?? '-', classroomName: row.class_occurrences?.class_sessions?.classrooms?.name ?? row.class_occurrences?.class_sessions?.classrooms?.[0]?.name ?? '-', date: row.class_occurrences?.occurrence_date, content: row.content ?? '', ...reportMissingFlags(row), version: row.version, attendanceStatus: row.attendance_status, updatedAt: row.updated_at }))
  return { rows: rows.slice(query.offset, query.offset + query.limit), total: rows.length }
}

async function incomplete(req: Request, res: Response) {
  const query = incompleteQuerySchema.parse(req.query)
  await requirePagePermission(req, 'teaching.reports.list', 'incomplete-reports')
  const teacher = await loadCurrentTeacher(req, 'incomplete_reports.teacher_scope')
  const result = await loadIncompleteReports(req, query, teacher, 'incomplete_reports.read')
  return sendData(req, res, result.rows, { limit: query.limit, offset: query.offset, total: result.total, sort: '-updated_at' })
}

async function loadDashboardCounts(req: Request) {
  const db = requireDb(req)
  const result = await db.rpc('get_dashboard_counts')
  if (result.error) throwDatabaseError(req, 'dashboard.counts', result.error)
  return (result.data ?? {}) as { totalStudents?: number; activeCourses?: number }
}

async function loadDashboardOccurrences(req: Request, start: string | undefined, end: string | undefined, teacher: TeacherScope) {
  if (!start || !end) return []
  const db = requireDb(req)
  const result = await db.from('class_occurrences').select(dashboardOccurrenceFields).eq('is_conducted', true).gte('occurrence_date', start).lte('occurrence_date', end).order('occurrence_date', { ascending: true }).order('id', { ascending: true }).range(0, 99)
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
  const pendingQuery = { days_back: 90, scope: 'my_present' as const, limit: 100, offset: 0 }
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
  let list = db.from('courses').select('id,subject,stage,display_name,description,description_document,created_at,updated_at,lessons(id,course_id,title,sequence,created_at,updated_at)', { count: 'exact' })
  if (query.search) list = list.or(`subject.ilike.%${query.search.replace(/[%_,()]/g, '')}%,stage.ilike.%${query.search.replace(/[%_,()]/g, '')}%,display_name.ilike.%${query.search.replace(/[%_,()]/g, '')}%`)
  const result = await list.order(sort.field, { ascending: sort.ascending }).range(query.offset, query.offset + query.limit - 1)
  if (result.error) throw mapDatabaseError(result.error)
  return sendData(req, res, result.data ?? [], { limit: query.limit, offset: query.offset, total: result.count ?? 0, sort: sort.value })
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
  const result = await db.from('students').select('id,name,notes,notes_document,external_link,created_at,updated_at,enrollments(id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,time_zone,koding_admission_id,created_at,updated_at,courses(subject,stage,display_name),classrooms(name),class_sessions(name,day_of_week,start_time,end_time,time_zone,session_type,schedule_mode,class_session_schedule_rules(id,schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)))').eq('id', studentId).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  if (!result.data) throw new ApiError(404, 'NOT_FOUND', 'Student was not found')
  const [readSensitive, updateSensitive] = await Promise.all([
    db.rpc('can_access_sensitive_student', { p_student_id: studentId, p_permission_key: 'teaching.students.read_sensitive' }),
    db.rpc('can_access_sensitive_student', { p_student_id: studentId, p_permission_key: 'teaching.students.update_sensitive' }),
  ])
  if (readSensitive.error) throw mapDatabaseError(readSensitive.error)
  if (updateSensitive.error) throw mapDatabaseError(updateSensitive.error)
  return sendData(req, res, { ...result.data, capabilities: { read_sensitive: readSensitive.data === true, update_sensitive: updateSensitive.data === true } })
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
  let list = db.from('teachers').select('id,user_id,name,bio,bio_document,created_at,updated_at', { count: 'exact' })
  if (query.search) list = list.ilike('name', `%${query.search.replace(/[%_,()]/g, '')}%`)
  const result = await list.order(sort.field, { ascending: sort.ascending }).range(query.offset, query.offset + query.limit - 1)
  if (result.error) throw mapDatabaseError(result.error)
  const [allTeachers, linked, complete] = await Promise.all([
    db.from('teachers').select('id', { count: 'exact', head: true }),
    db.from('teachers').select('id', { count: 'exact', head: true }).not('user_id', 'is', null),
    db.from('teachers').select('id', { count: 'exact', head: true }).not('name', 'is', null).not('bio', 'is', null),
  ])
  for (const queryResult of [allTeachers, linked, complete]) if (queryResult.error) throw mapDatabaseError(queryResult.error)
  const total = result.count ?? 0
  const allTotal = allTeachers.count ?? 0
  return sendData(req, res, {
    teachers: result.data ?? [],
    statistics: { totalTeachers: allTotal, linkedAccounts: linked.count ?? 0, unlinkedAccounts: Math.max(0, allTotal - (linked.count ?? 0)), completeProfiles: complete.count ?? 0 },
  }, { limit: query.limit, offset: query.offset, total, sort: sort.value })
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
  await authorizeResource(req, resources['class-sessions'], 'teaching.class_sessions.read', sessionId)
  const session = await db.from('class_sessions').select('id,name,classroom_id,course_ids,day_of_week,start_time,end_time,capacity,lesson_number,external_link,start_date,end_date,time_zone,session_type,schedule_mode,created_at,updated_at,classrooms(id,name,color,external_link),schedule_rules:class_session_schedule_rules(id,schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time),class_session_teachers(teacher_id,role_id,effective_from,effective_to,roles(id,name,code),teachers(id,user_id,name))').eq('id', sessionId).maybeSingle()
  if (session.error) throw mapDatabaseError(session.error)
  if (!session.data) throw new ApiError(404, 'NOT_FOUND', 'Class session was not found')
  const enrollments = await db.from('enrollments').select('id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,time_zone,koding_admission_id,created_at,updated_at,courses(subject,stage,display_name),classrooms(name),students(name)', { count: 'exact' }).eq('class_session_id', sessionId).order('created_at', { ascending: true })
  if (enrollments.error) throw mapDatabaseError(enrollments.error)
  const teachers = await db.from('teachers').select('id,user_id,name').order('name', { ascending: true }).range(0, 99)
  if (teachers.error) throw mapDatabaseError(teachers.error)
  return sendData(req, res, { session: { ...session.data, current_enrollments: (enrollments.data ?? []).filter((enrollment: any) => enrollment.status === 'regular').length }, enrollments: enrollments.data ?? [], teachers: teachers.data ?? [] }, { total: enrollments.count ?? 0 })
}

export function createAggregateRouter() {
  const router = Router()
  router.get('/pages/me/preferences', wrap(preferences))
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
