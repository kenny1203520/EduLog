import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError, mapDatabaseError } from './errors.js'
import { sendData } from './response.js'

const wrap = (handler: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next)
const reportFields = 'id,enrollment_id,class_occurrence_id,lesson_id,content,content_document,is_completed,progress_letter,attendance_status,class_participation,classroom_behavior,contact_notes,contact_notes_document,class_notes,class_notes_document,version,absence_reason,external_link,updated_at'

function requireDb(req: Request) { if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required'); return req.db }
function teacherPresent(teacherId: string, userId: string, ids: string[] = [], attendance: Record<string, boolean> = {}) {
  const keys = [teacherId, userId].filter(Boolean); if (!keys.some((key) => ids.includes(key))) return false
  const values = keys.filter((key) => Object.prototype.hasOwnProperty.call(attendance, key)).map((key) => attendance[key])
  return !values.includes(false) && values.includes(true)
}
function isIncomplete(row: any) {
  return !(Boolean(row.content?.trim()) && Boolean(row.lesson_id) && (row.is_completed || Boolean(row.progress_letter?.trim())) && row.class_participation != null && row.class_participation > 0 && row.classroom_behavior != null && row.classroom_behavior > 0)
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

async function studentReports(req: Request, res: Response) {
  const db = requireDb(req); const query = z.object({ enrollment_id: z.string().uuid(), page: z.coerce.number().int().min(1).max(100000).default(1), perPage: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(req.query)
  const from = (query.page - 1) * query.perPage
  const enrollment = await db.from('enrollments').select('id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,time_zone,koding_admission_id,created_at,updated_at,students(id,name),courses(id,subject,stage,display_name),classrooms(id,name,address)').eq('id', query.enrollment_id).maybeSingle()
  const reports = await db.from('occurrence_reports').select(`${reportFields},class_occurrences(id,occurrence_date,actual_start_time,actual_end_time,original_start_time,original_end_time,time_zone,class_session_id,class_sessions(id,name,classroom_id,classrooms(id,name))),lessons(id,title,sequence)`, { count: 'exact' }).eq('enrollment_id', query.enrollment_id).order('occurrence_date', { foreignTable: 'class_occurrences', ascending: false }).range(from, from + query.perPage - 1)
  if (enrollment.error) throw mapDatabaseError(enrollment.error); if (reports.error) throw mapDatabaseError(reports.error)
  return sendData(req, res, { enrollment: enrollment.data ?? null, reports: reports.data ?? [], count: reports.count ?? 0 }, { limit: query.perPage, offset: from, total: reports.count ?? 0, sort: '-occurrence_date' })
}

async function classroomManager(req: Request, res: Response) {
  const db = requireDb(req); const query = z.object({ page: z.coerce.number().int().min(1).default(1), perPage: z.coerce.number().int().min(1).max(100).default(100), search: z.string().max(200).default(''), visibilityMode: z.enum(['all', 'visible', 'hidden']).default('all') }).strict().parse(req.query)
  const all = await db.from('classrooms').select('id,name,color,address,phone,external_link,teaching_id,user_id,created_at,updated_at,classroom_schedules(id,classroom_id,day_of_week,start_time,end_time,user_id,created_at,updated_at)', { count: 'exact' }).ilike('name', `%${query.search.replace(/[%_,]/g, '')}%`).order('name').range(0, 100000)
  if (all.error) throw mapDatabaseError(all.error)
  const visibility = await db.from('user_entity_visibility_preferences').select('entity_type,entity_id').eq('user_id', req.user!.id).eq('is_hidden', true).in('entity_type', ['classroom', 'class_session'])
  if (visibility.error) throw mapDatabaseError(visibility.error)
  const hiddenClassroomIds = new Set((visibility.data ?? []).filter((row) => row.entity_type === 'classroom').map((row) => row.entity_id)); const hiddenSessionIds = (visibility.data ?? []).filter((row) => row.entity_type === 'class_session').map((row) => row.entity_id)
  const filtered = (all.data ?? []).filter((row) => query.visibilityMode === 'all' || (query.visibilityMode === 'hidden' ? hiddenClassroomIds.has(row.id) : !hiddenClassroomIds.has(row.id)))
  const offset = (query.page - 1) * query.perPage
  return sendData(req, res, { classrooms: filtered.slice(offset, offset + query.perPage), count: filtered.length, hiddenClassroomIds: [...hiddenClassroomIds], hiddenSessionIds }, { limit: query.perPage, offset, total: filtered.length, sort: 'name' })
}

async function holidays(req: Request, res: Response) {
  const db = requireDb(req); const expand = req.query.expand === 'true'
  const result = await db.from('holidays').select('id,start_date,end_date,time_zone,name,kind,classroom_ids,class_session_ids,teacher_ids,created_at,updated_at').order('start_date', { ascending: false })
  if (result.error) throw mapDatabaseError(result.error)
  let data: any[] = result.data ?? []
  if (expand && data.length) {
    const classroomIds = [...new Set(data.flatMap((row) => row.classroom_ids ?? []))]; const sessionIds = [...new Set(data.flatMap((row) => row.class_session_ids ?? []))]; const teacherIds = [...new Set(data.flatMap((row) => row.teacher_ids ?? []))]
    const [classrooms, sessions, teachers] = await Promise.all([db.from('classrooms').select('id,name').in('id', classroomIds), db.from('class_sessions').select('id,name').in('id', sessionIds), db.from('teachers').select('id,name').in('id', teacherIds)])
    if (classrooms.error) throw mapDatabaseError(classrooms.error); if (sessions.error) throw mapDatabaseError(sessions.error); if (teachers.error) throw mapDatabaseError(teachers.error)
    const map = (rows: any[] | null) => Object.fromEntries((rows ?? []).map((row) => [row.id, row.name])); const classroomMap = map(classrooms.data); const sessionMap = map(sessions.data); const teacherMap = map(teachers.data)
    data = data.map((row) => ({ ...row, classroomNames: (row.classroom_ids ?? []).map((id: string) => classroomMap[id]).filter(Boolean), classSessionNames: (row.class_session_ids ?? []).map((id: string) => sessionMap[id]).filter(Boolean), teacherNames: (row.teacher_ids ?? []).map((id: string) => teacherMap[id]).filter(Boolean) }))
  }
  return sendData(req, res, data, { limit: data.length, offset: 0, total: data.length, sort: '-start_date' })
}

async function incomplete(req: Request, res: Response) {
  const db = requireDb(req); const query = z.object({ daysBack: z.coerce.number().int().min(1).max(3650).default(90), scope: z.enum(['all', 'my_present', 'my_notifications']).default('all') }).strict().parse(req.query)
  const from = new Date(Date.now() - query.daysBack * 86400000).toISOString().slice(0, 10); const today = new Date().toISOString().slice(0, 10)
  const teacher = await db.from('teachers').select('id,user_id').eq('user_id', req.user!.id).maybeSingle(); if (teacher.error) throw mapDatabaseError(teacher.error)
  if ((query.scope === 'my_present' || query.scope === 'my_notifications') && !teacher.data) return sendData(req, res, [])
  const result = await db.from('occurrence_reports').select(`${reportFields},enrollments!inner(id,student_id,course_id,students(id,name)),class_occurrences!inner(id,occurrence_date,actual_start_time,actual_end_time,original_start_time,original_end_time,time_zone,is_conducted,teacher_ids,teacher_attendance,class_sessions(id,name,classroom_id,classrooms(id,name))`).eq('attendance_status', 'present').gte('class_occurrences.occurrence_date', from).lte('class_occurrences.occurrence_date', today)
  if (result.error) throw mapDatabaseError(result.error)
  const rows = (result.data ?? []).filter((row: any) => isIncomplete(row) && (query.scope === 'all' || teacherPresent(teacher.data!.id, req.user!.id, row.class_occurrences?.teacher_ids ?? [], row.class_occurrences?.teacher_attendance ?? {}))).map((row: any) => ({ id: row.id, reportId: row.id, enrollmentId: row.enrollment_id, occurrenceId: row.class_occurrence_id, studentName: row.enrollments?.students?.name ?? row.enrollments?.students?.[0]?.name ?? 'Unknown', courseId: row.enrollments?.course_id, className: row.class_occurrences?.class_sessions?.name ?? row.class_occurrences?.class_sessions?.[0]?.name ?? '-', classroomName: row.class_occurrences?.class_sessions?.classrooms?.name ?? row.class_occurrences?.class_sessions?.[0]?.classrooms?.name ?? '-', date: row.class_occurrences?.occurrence_date, content: row.content ?? '', missingContent: !row.content?.trim(), missingLesson: !row.lesson_id, missingProgress: !(row.is_completed || row.progress_letter?.trim()), missingParticipation: !(row.class_participation > 0), missingBehavior: !(row.classroom_behavior > 0), version: row.version, attendanceStatus: row.attendance_status, updatedAt: row.updated_at, isMissing: true }))
  return sendData(req, res, rows)
}

async function dashboard(req: Request, res: Response) {
  const db = requireDb(req); const query = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict().parse(req.query)
  const [students, courses, teacher, pending] = await Promise.all([
    db.from('students').select('id', { count: 'exact', head: true }),
    db.from('courses').select('id', { count: 'exact', head: true }),
    db.from('teachers').select('id,user_id').eq('user_id', req.user!.id).maybeSingle(),
    db.from('occurrence_reports').select('id,content,lesson_id,is_completed,progress_letter,class_participation,classroom_behavior,enrollment_id,class_occurrence_id,updated_at,attendance_status,enrollments!inner(id,student_id,students(id,name)),class_occurrences!inner(id,occurrence_date,class_session_id,teacher_ids,teacher_attendance,class_sessions(id,name,classroom_id,classrooms(id,name)))').eq('attendance_status', 'present').gte('class_occurrences.occurrence_date', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)).lte('class_occurrences.occurrence_date', new Date().toISOString().slice(0, 10)),
  ])
  if (students.error) throw mapDatabaseError(students.error); if (courses.error) throw mapDatabaseError(courses.error); if (teacher.error) throw mapDatabaseError(teacher.error); if (pending.error) throw mapDatabaseError(pending.error)
  const pendingReports = (pending.data ?? []).filter((row: any) => teacher.data && isIncomplete(row) && teacherPresent(teacher.data.id, req.user!.id, row.class_occurrences?.teacher_ids ?? [], row.class_occurrences?.teacher_attendance ?? {})).map((row: any) => ({ id: row.id, studentName: row.enrollments?.students?.name ?? row.enrollments?.students?.[0]?.name ?? 'Unknown', date: row.class_occurrences?.occurrence_date, className: row.class_occurrences?.class_sessions?.name ?? row.class_occurrences?.class_sessions?.[0]?.name ?? '-', classroomName: row.class_occurrences?.class_sessions?.classrooms?.name ?? row.class_occurrences?.class_sessions?.[0]?.classrooms?.name ?? '-', enrollmentId: row.enrollment_id, contentPreview: row.content?.trim()?.slice(0, 300) ?? '', missingContent: !row.content?.trim(), missingLesson: !row.lesson_id, missingProgress: !(row.is_completed || row.progress_letter?.trim()), missingParticipation: !(row.class_participation > 0), missingBehavior: !(row.classroom_behavior > 0), isMissing: true }))
  let occurrences: any[] = []
  if (query.start && query.end) { const result = await db.from('class_occurrences').select('id,class_session_id,occurrence_date,status,teacher_ids,teacher_attendance,is_conducted,actual_start_time,actual_end_time,original_start_time,original_end_time,time_zone,class_sessions(name,time_zone,classrooms(name,color))').gte('occurrence_date', query.start).lte('occurrence_date', query.end).order('occurrence_date', { ascending: true }); if (result.error) throw mapDatabaseError(result.error); occurrences = (result.data ?? []).filter((row: any) => row.is_conducted === true && (!teacher.data || teacherPresent(teacher.data.id, req.user!.id, row.teacher_ids ?? [], row.teacher_attendance ?? {}))) }
  return sendData(req, res, { pendingReportsScope: 'my_present', stats: { totalStudents: students.count ?? 0, activeCourses: courses.count ?? 0, pendingReportsCount: pendingReports.length, pendingReportsScope: 'my_present' }, pendingReports, occurrences })
}
export function createAggregateRouter() { const router = Router(); router.get('/aggregates/user-preferences', wrap(preferences)); router.get('/aggregates/student-reports', wrap(studentReports)); router.get('/aggregates/classroom-session-manager', wrap(classroomManager)); router.get('/aggregates/holidays-manager', wrap(holidays)); router.get('/aggregates/incomplete-reports', wrap(incomplete)); router.get('/aggregates/dashboard', wrap(dashboard)); return router }
