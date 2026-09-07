import { z } from 'zod'

export type ResourceDefinition = {
  route: string
  table: string
  idColumn: string
  fields: readonly string[]
  writable: readonly string[]
  sortable: readonly string[]
  searchable: readonly string[]
  permission: string
  createStatus?: number
}

const commonSort = ['created_at', 'updated_at', 'name', 'title'] as const
const id = z.string().uuid()
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  search: z.string().trim().max(200).optional(),
  sort: z.string().regex(/^-?[A-Za-z_][A-Za-z0-9_]*$/).default('-created_at'),
}).strict()
export const idSchema = z.object({ id }).strict()

export const resources: Record<string, ResourceDefinition> = {
  users: { route: 'users', table: 'profiles', idColumn: 'id', fields: ['id', 'email', 'display_name', 'avatar_url', 'created_at', 'updated_at'], writable: ['display_name', 'avatar_url'], sortable: commonSort, searchable: ['display_name', 'email'], permission: 'system.users.list' },
  roles: { route: 'roles', table: 'roles', idColumn: 'id', fields: ['id', 'code', 'name', 'description', 'is_system', 'sort_order', 'created_at', 'updated_at'], writable: ['code', 'name', 'description'], sortable: ['code', 'name', 'sort_order', 'created_at', 'updated_at'], searchable: ['code', 'name'], permission: 'system.roles.list' },
  permissions: { route: 'permissions', table: 'permissions', idColumn: 'id', fields: ['id', 'key', 'name', 'description', 'domain', 'resource', 'action', 'conditions', 'created_at', 'updated_at'], writable: [], sortable: ['key', 'domain', 'resource', 'action', 'created_at'], searchable: ['key', 'name'], permission: 'system.permissions.read' },
  'audit-events': { route: 'audit-events', table: 'audit_events', idColumn: 'id', fields: ['id', 'actor_user_id', 'action', 'domain', 'resource', 'resource_id', 'scope_id', 'request_id', 'outcome', 'metadata', 'created_at'], writable: [], sortable: ['created_at', 'action', 'domain', 'resource', 'outcome'], searchable: ['resource', 'action', 'outcome'], permission: 'system.audit.list' },
  teachings: { route: 'teachings', table: 'teachings', idColumn: 'id', fields: ['id', 'name', 'owner_user_id', 'is_quarantine', 'created_at', 'updated_at'], writable: ['name'], sortable: commonSort, searchable: ['name'], permission: 'teaching.teachings.list' },
  courses: { route: 'courses', table: 'courses', idColumn: 'id', fields: ['id', 'subject', 'stage', 'description', 'display_name', 'teaching_id', 'user_id', 'created_at', 'updated_at'], writable: ['subject', 'stage', 'description', 'display_name', 'teaching_id'], sortable: ['subject', 'stage', 'display_name', 'created_at', 'updated_at'], searchable: ['display_name', 'subject'], permission: 'teaching.courses.list' },
  lessons: { route: 'lessons', table: 'lessons', idColumn: 'id', fields: ['id', 'course_id', 'title', 'sequence', 'user_id', 'created_at', 'updated_at'], writable: ['course_id', 'title', 'sequence'], sortable: ['title', 'sequence', 'created_at', 'updated_at'], searchable: ['title'], permission: 'teaching.lessons.list' },
  classrooms: { route: 'classrooms', table: 'classrooms', idColumn: 'id', fields: ['id', 'name', 'color', 'address', 'phone', 'external_link', 'teaching_id', 'user_id', 'created_at', 'updated_at'], writable: ['name', 'color', 'address', 'phone', 'external_link', 'teaching_id'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.classrooms.list' },
  'class-sessions': { route: 'class-sessions', table: 'class_sessions', idColumn: 'id', fields: ['id', 'name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date', 'teaching_id', 'user_id', 'created_at', 'updated_at'], writable: ['name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date', 'teaching_id'], sortable: ['name', 'start_date', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.sessions.list' },
  students: { route: 'students', table: 'students', idColumn: 'id', fields: ['id', 'name', 'external_link', 'user_id', 'created_at', 'updated_at'], writable: ['name', 'notes', 'gov_id', 'email', 'phone', 'residence_address', 'mailing_address', 'birthday', 'external_link'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.students.list' },
  teachers: { route: 'teachers', table: 'teachers', idColumn: 'id', fields: ['id', 'name', 'bio', 'user_id', 'created_at', 'updated_at'], writable: ['name', 'email', 'phone', 'address', 'birthday', 'bio'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name', 'email'], permission: 'teaching.teachers.list' },
  enrollments: { route: 'enrollments', table: 'enrollments', idColumn: 'id', fields: ['id', 'student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'start_date', 'lesson_number', 'external_link', 'user_id', 'created_at', 'updated_at'], writable: ['student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'start_date', 'lesson_number', 'external_link'], sortable: ['status', 'start_date', 'created_at', 'updated_at'], searchable: ['status'], permission: 'teaching.enrollments.list' },
  occurrences: { route: 'occurrences', table: 'class_occurrences', idColumn: 'id', fields: ['id', 'class_session_id', 'occurrence_date', 'status', 'teacher_ids', 'teacher_attendance', 'notes', 'is_conducted', 'created_at', 'updated_at'], writable: ['class_session_id', 'occurrence_date', 'status', 'teacher_ids', 'teacher_attendance', 'notes', 'is_conducted'], sortable: ['occurrence_date', 'status', 'created_at', 'updated_at'], searchable: ['status'], permission: 'teaching.occurrences.list' },
  reports: { route: 'reports', table: 'occurrence_reports', idColumn: 'id', fields: ['id', 'enrollment_id', 'class_occurrence_id', 'lesson_id', 'content', 'content_document', 'attendance_status', 'is_completed', 'progress_letter', 'class_participation', 'classroom_behavior', 'contact_notes', 'class_notes', 'external_link', 'version', 'updated_at'], writable: ['enrollment_id', 'class_occurrence_id', 'lesson_id', 'content', 'content_document', 'attendance_status', 'is_completed', 'progress_letter', 'class_participation', 'classroom_behavior', 'contact_notes', 'class_notes', 'external_link'], sortable: ['updated_at', 'version'], searchable: ['attendance_status', 'progress_letter'], permission: 'teaching.reports.list' },
  'report-templates': { route: 'report-templates', table: 'report_templates', idColumn: 'id', fields: ['id', 'name', 'content', 'contact_notes', 'class_notes', 'instructor_id', 'teaching_id', 'created_at', 'updated_at'], writable: ['name', 'content', 'contact_notes', 'class_notes', 'teaching_id'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.templates.list' },
  holidays: { route: 'holidays', table: 'holidays', idColumn: 'id', fields: ['id', 'name', 'start_date', 'end_date', 'classroom_ids', 'class_session_ids', 'created_at', 'updated_at'], writable: ['name', 'start_date', 'end_date', 'classroom_ids', 'class_session_ids'], sortable: ['name', 'start_date', 'end_date', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.holidays.list' },
}
export const resourceKeys = Object.keys(resources)

