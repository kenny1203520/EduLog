import { z } from 'zod'

export type ResourceDefinition = {
  route: string
  table: string
  idColumn: string
  fields: readonly string[]
  /** Collection projection. Omit to use fields for backwards compatibility. */
  listFields?: readonly string[]
  /** Item projection. Omit to use fields for backwards compatibility. */
  itemFields?: readonly string[]
  /** Optional input schemas are applied before any database operation. */
  createSchema?: z.ZodType<Record<string, unknown>>
  updateSchema?: z.ZodType<Record<string, unknown>>
  writable: readonly string[]
  /** Input-only compatibility fields which are validated but never persisted. */
  compatibilityFields?: readonly string[]
  sortable: readonly string[]
  searchable: readonly string[]
  permission: string
  /** Explicit action permissions keep the API contract aligned with the RBAC catalogue. */
  permissions?: Partial<Record<'create' | 'read' | 'update' | 'delete' | 'list' | 'manage', string>>
  /** Query fields accepted by the collection endpoint. Defaults to the common registry fields. */
  filterable?: readonly string[]
  scope?: 'system' | 'self' | 'teaching' | 'course' | 'classroom' | 'classroom-child' | 'session' | 'session-child' | 'student' | 'enrollment' | 'occurrence' | 'report' | 'holiday' | 'teacher' | 'teacher-child' | 'student-child' | 'enrollment-child' | 'report-child'
  genericMethods?: readonly ('GET' | 'POST' | 'PATCH' | 'DELETE')[]
  createStatus?: number
  /** Ownership is enforced by the self scope guard rather than a RBAC key. */
  selfAuthorization?: boolean
}

const commonSort = ['created_at', 'updated_at', 'name', 'title'] as const
const id = z.string().uuid()
const optionalUuid = z.string().uuid().optional()
export const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1000000).default(0),
  search: z.string().trim().max(200).optional(),
  // A relation sort is used by report list queries (for example
  // class_occurrences(occurrence_date)).  The relation and column are still
  // restricted to identifier characters; the resource registry is the final
  // allowlist before this reaches Supabase.
  sort: z.string().regex(/^-?[A-Za-z_][A-Za-z0-9_]*(?:\([A-Za-z_][A-Za-z0-9_]*\))?$/).default('-created_at'),
  teaching_id: optionalUuid, status: z.string().optional(), course_id: optionalUuid, classroom_id: optionalUuid,
  student_id: optionalUuid, teacher_id: optionalUuid, user_id: optionalUuid, class_session_id: optionalUuid,
  enrollment_id: optionalUuid, filters: z.string().max(8000).optional(), instructor_id: optionalUuid, template_type: z.string().optional(), scope_type: z.string().optional(), scope_entity_id: optionalUuid, lesson_id: optionalUuid, entity_type: z.string().optional(), entity_id: optionalUuid, entity_ids: z.string().optional(), class_occurrence_id: optionalUuid, occurrence_report_id: optionalUuid,
  or: z.string().trim().max(2000).optional(),
}).strict()
export const idSchema = z.object({ id }).strict()

export const resources: Record<string, ResourceDefinition> = {
  'user-preferences': { route: 'user-preferences', table: 'user_preferences', idColumn: 'user_id', fields: ['user_id', 'time_zone', 'editor_settings', 'created_at', 'updated_at'], writable: ['time_zone', 'editor_settings'], sortable: ['updated_at', 'created_at'], searchable: [], permission: 'system.users.read', scope: 'self', selfAuthorization: true },
  'visibility-preferences': { route: 'visibility-preferences', table: 'user_entity_visibility_preferences', idColumn: 'id', fields: ['id', 'user_id', 'entity_type', 'entity_id', 'is_hidden', 'created_at', 'updated_at'], writable: ['entity_type', 'entity_id', 'is_hidden'], sortable: ['created_at', 'updated_at'], searchable: ['entity_type', 'entity_id'], permission: 'system.users.read', scope: 'self', selfAuthorization: true },
  users: { route: 'users', table: 'profiles', idColumn: 'id', fields: ['id', 'email', 'display_name', 'avatar_url', 'account_status', 'disabled_at', 'disabled_by', 'disabled_reason', 'created_at', 'updated_at'], writable: [], sortable: [...commonSort, 'display_name', 'email', 'account_status'], searchable: ['display_name', 'email'], permission: 'system.users.list', permissions: { list: 'system.users.list', read: 'system.users.read' }, scope: 'system', genericMethods: ['GET'] },
  roles: { route: 'roles', table: 'roles', idColumn: 'id', fields: ['id', 'code', 'name', 'description', 'domain', 'teaching_id', 'is_builtin', 'is_protected', 'is_system', 'sort_order', 'created_at', 'updated_at'], writable: ['code', 'name', 'description', 'domain', 'teaching_id'], compatibilityFields: ['is_system'], sortable: ['code', 'name', 'sort_order', 'created_at', 'updated_at'], searchable: ['code', 'name'], permission: 'system.roles.manage', permissions: { list: 'system.roles.read', read: 'system.roles.read', create: 'system.roles.manage', update: 'system.roles.manage', delete: 'system.roles.manage', manage: 'system.roles.manage' }, scope: 'system' },
  permissions: { route: 'permissions', table: 'permissions', idColumn: 'id', fields: ['id', 'key', 'name', 'description', 'domain', 'resource', 'action', 'conditions', 'created_at', 'updated_at'], writable: [], sortable: ['key', 'domain', 'resource', 'action', 'created_at'], searchable: ['key', 'name'], permission: 'system.permissions.read', permissions: { list: 'system.permissions.read', read: 'system.permissions.read' }, scope: 'system', genericMethods: ['GET'] },
  'audit-events': { route: 'audit-events', table: 'audit_events', idColumn: 'id', fields: ['id', 'actor_user_id', 'action', 'domain', 'resource', 'resource_id', 'scope_id', 'request_id', 'outcome', 'metadata', 'created_at'], writable: [], sortable: ['created_at', 'action', 'domain', 'resource', 'outcome'], searchable: ['resource', 'action', 'outcome'], permission: 'system.audit.list', permissions: { list: 'system.audit.list', read: 'system.audit.list' }, scope: 'system', genericMethods: ['GET'] },
  teachings: { route: 'teachings', table: 'teachings', idColumn: 'id', fields: ['id', 'name', 'owner_user_id', 'is_quarantine', 'created_at', 'updated_at'], writable: ['name'], sortable: commonSort, searchable: ['name'], permission: 'teaching.teachings.list', scope: 'teaching' },
  courses: { route: 'courses', table: 'courses', idColumn: 'id', fields: ['id', 'subject', 'stage', 'description', 'description_document', 'display_name', 'teaching_id', 'user_id', 'created_at', 'updated_at', 'lessons(id,course_id,title,sequence,user_id,created_at,updated_at)'], writable: ['subject', 'stage', 'description', 'display_name', 'teaching_id'], sortable: ['subject', 'stage', 'display_name', 'created_at', 'updated_at'], searchable: ['display_name', 'subject'], permission: 'teaching.courses.list', scope: 'teaching' },
  lessons: { route: 'lessons', table: 'lessons', idColumn: 'id', fields: ['id', 'course_id', 'title', 'sequence', 'user_id', 'created_at', 'updated_at'], writable: ['course_id', 'title', 'sequence'], sortable: ['title', 'sequence', 'created_at', 'updated_at'], searchable: ['title'], permission: 'teaching.lessons.list', scope: 'course' },
  'classroom-schedules': { route: 'classroom-schedules', table: 'classroom_schedules', idColumn: 'id', fields: ['id', 'classroom_id', 'day_of_week', 'start_time', 'end_time', 'user_id', 'created_at', 'updated_at'], writable: ['classroom_id', 'day_of_week', 'start_time', 'end_time'], sortable: ['day_of_week', 'start_time', 'created_at', 'updated_at'], searchable: [], permission: 'teaching.classrooms.list', scope: 'classroom-child' },
  'class-session-schedule-rules': { route: 'class-session-schedule-rules', table: 'class_session_schedule_rules', idColumn: 'id', fields: ['id', 'class_session_id', 'schedule_kind', 'day_of_week', 'day_of_month', 'occurrence_date', 'start_time', 'end_time', 'created_at', 'updated_at'], writable: ['class_session_id', 'schedule_kind', 'day_of_week', 'day_of_month', 'occurrence_date', 'start_time', 'end_time'], sortable: ['occurrence_date', 'day_of_week', 'day_of_month', 'start_time', 'created_at', 'updated_at'], searchable: ['schedule_kind'], permission: 'teaching.class_sessions.list', scope: 'session-child' },
  classrooms: { route: 'classrooms', table: 'classrooms', idColumn: 'id', fields: ['id', 'name', 'color', 'address', 'phone', 'external_link', 'teaching_id', 'user_id', 'created_at', 'updated_at', 'classroom_schedules(id,classroom_id,day_of_week,start_time,end_time,user_id,created_at,updated_at)'], writable: ['name', 'color', 'address', 'phone', 'external_link', 'teaching_id'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.classrooms.list', scope: 'classroom' },
  'class-sessions': { route: 'class-sessions', table: 'class_sessions', idColumn: 'id', fields: ['id', 'name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date', 'time_zone', 'session_type', 'schedule_mode', 'teaching_id', 'user_id', 'created_at', 'updated_at', 'class_session_schedule_rules(id,schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time)'], writable: ['name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date', 'time_zone', 'session_type', 'schedule_mode', 'teaching_id'], sortable: ['name', 'start_date', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.class_sessions.list', scope: 'session', genericMethods: ['GET'] },
  'class-session-teachers': { route: 'class-session-teachers', table: 'class_session_teachers', idColumn: 'id', fields: ['id', 'class_session_id', 'teacher_id', 'role_id', 'effective_from', 'effective_to', 'created_at', 'updated_at'], writable: ['class_session_id', 'teacher_id', 'role_id', 'effective_from', 'effective_to'], sortable: ['effective_from', 'created_at', 'updated_at'], searchable: [], permission: 'teaching.teachers.list', scope: 'session-child', genericMethods: ['GET'] },
  students: { route: 'students', table: 'students', idColumn: 'id', fields: ['id', 'name', 'notes', 'notes_document', 'external_link', 'user_id', 'created_at', 'updated_at'], listFields: ['id', 'name', 'notes', 'notes_document', 'external_link', 'user_id', 'created_at', 'updated_at'], itemFields: ['id', 'name', 'notes', 'notes_document', 'external_link', 'user_id', 'created_at', 'updated_at'], writable: ['name', 'notes', 'notes_document', 'gov_id', 'email', 'phone', 'residence_address', 'mailing_address', 'birthday', 'external_link'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.students.list', scope: 'student' },
  'student-contacts': { route: 'student-contacts', table: 'student_contacts', idColumn: 'id', fields: ['id', 'student_id', 'name', 'relation', 'phone', 'email', 'created_at', 'updated_at'], writable: ['student_id', 'name', 'relation', 'phone', 'email'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name', 'relation', 'email'], permission: 'teaching.students.read_sensitive', permissions: { list: 'teaching.students.read_sensitive', read: 'teaching.students.read_sensitive', create: 'teaching.students.update_sensitive', update: 'teaching.students.update_sensitive', delete: 'teaching.students.update_sensitive' }, scope: 'student-child' },
  'student-schools': { route: 'student-schools', table: 'student_schools', idColumn: 'id', fields: ['id', 'student_id', 'name', 'status', 'grade', 'school_student_id', 'start_date', 'end_date', 'time_zone', 'class', 'created_at', 'updated_at'], writable: ['student_id', 'name', 'status', 'grade', 'school_student_id', 'start_date', 'end_date', 'time_zone', 'class'], sortable: ['name', 'status', 'start_date', 'end_date', 'created_at', 'updated_at'], searchable: ['name', 'status', 'grade', 'class'], permission: 'teaching.students.read_sensitive', permissions: { list: 'teaching.students.read_sensitive', read: 'teaching.students.read_sensitive', create: 'teaching.students.update_sensitive', update: 'teaching.students.update_sensitive', delete: 'teaching.students.update_sensitive' }, scope: 'student-child' },
  'student-credentials': { route: 'student-credentials', table: 'student_credentials', idColumn: 'id', fields: ['id', 'student_id', 'platform', 'username', 'url', 'created_at', 'updated_at'], writable: ['student_id', 'platform', 'username', 'password', 'url'], sortable: ['platform', 'username', 'created_at', 'updated_at'], searchable: ['platform', 'username'], permission: 'teaching.students.read_sensitive', permissions: { list: 'teaching.students.read_sensitive', read: 'teaching.students.read_sensitive', create: 'teaching.students.update_sensitive', update: 'teaching.students.update_sensitive', delete: 'teaching.students.update_sensitive' }, scope: 'student-child' },
  teachers: { route: 'teachers', table: 'teachers', idColumn: 'id', fields: ['id', 'name', 'bio', 'bio_document', 'user_id', 'created_at', 'updated_at'], listFields: ['id', 'name', 'bio', 'bio_document', 'user_id', 'created_at', 'updated_at'], itemFields: ['id', 'name', 'bio', 'bio_document', 'user_id', 'created_at', 'updated_at'], writable: ['name', 'email', 'phone', 'address', 'birthday', 'bio', 'bio_document', 'gov_id', 'user_id'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.teachers.list', scope: 'teacher' },
  'teacher-credentials': { route: 'teacher-credentials', table: 'teacher_credentials', idColumn: 'id', fields: ['id', 'teacher_id', 'platform', 'username', 'url', 'created_at', 'updated_at'], writable: ['teacher_id', 'platform', 'username', 'password', 'url'], sortable: ['platform', 'username', 'created_at', 'updated_at'], searchable: ['platform', 'username'], permission: 'teaching.teachers.read_sensitive', permissions: { list: 'teaching.teachers.read_sensitive', read: 'teaching.teachers.read_sensitive', create: 'teaching.teachers.update_sensitive', update: 'teaching.teachers.update_sensitive', delete: 'teaching.teachers.update_sensitive' }, scope: 'teacher-child' },
  enrollments: { route: 'enrollments', table: 'enrollments', idColumn: 'id', fields: ['id', 'student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'start_date', 'lesson_number', 'external_link', 'time_zone', 'koding_admission_id', 'user_id', 'created_at', 'updated_at', 'courses(subject,stage,display_name)', 'classrooms(name,address)', 'class_sessions(id,name,day_of_week,start_time,end_time,capacity,time_zone,session_type,schedule_mode,class_session_schedule_rules(id,schedule_kind,day_of_week,day_of_month,occurrence_date,start_time,end_time))', 'students(name)'], writable: ['student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'start_date', 'lesson_number', 'external_link', 'time_zone', 'koding_admission_id'], sortable: ['status', 'start_date', 'created_at', 'updated_at'], searchable: ['status'], permission: 'teaching.enrollments.list', scope: 'enrollment', genericMethods: ['GET'] },
  occurrences: { route: 'occurrences', table: 'class_occurrences', idColumn: 'id', fields: ['id', 'class_session_id', 'occurrence_date', 'status', 'teacher_ids', 'teacher_attendance', 'notes', 'is_conducted', 'original_start_time', 'original_end_time', 'actual_start_time', 'actual_end_time', 'time_zone', 'created_at', 'updated_at'], writable: ['class_session_id', 'occurrence_date', 'status', 'teacher_ids', 'teacher_attendance', 'notes', 'is_conducted', 'original_start_time', 'original_end_time', 'actual_start_time', 'actual_end_time', 'time_zone'], sortable: ['occurrence_date', 'status', 'created_at', 'updated_at'], searchable: ['status'], permission: 'teaching.occurrences.list', scope: 'occurrence', genericMethods: ['GET'] },
  reports: { route: 'reports', table: 'occurrence_reports', idColumn: 'id', fields: ['id', 'enrollment_id', 'class_occurrence_id', 'lesson_id', 'content', 'content_document', 'attendance_status', 'is_completed', 'progress_letter', 'class_participation', 'classroom_behavior', 'contact_notes', 'contact_notes_document', 'class_notes', 'class_notes_document', 'external_link', 'version', 'absence_reason', 'last_edited_by', 'last_edited_at', 'created_at', 'updated_at'], listFields: ['id', 'enrollment_id', 'class_occurrence_id', 'lesson_id', 'content', 'is_completed', 'progress_letter', 'attendance_status', 'contact_notes', 'class_notes', 'version', 'last_edited_by', 'last_edited_at', 'created_at', 'updated_at', 'enrollments(id,student_id,course_id,students(id,name),courses(id,subject,display_name))', 'class_occurrences(id,occurrence_date,actual_start_time,original_start_time,class_session_id,class_sessions(id,name,classroom_id,classrooms(id,name)))', 'lessons(id,title,sequence)'], writable: ['enrollment_id', 'class_occurrence_id', 'lesson_id', 'content', 'content_document', 'attendance_status', 'is_completed', 'progress_letter', 'class_participation', 'classroom_behavior', 'contact_notes', 'contact_notes_document', 'class_notes', 'class_notes_document', 'content_document', 'external_link'], sortable: ['created_at', 'updated_at', 'version', 'class_occurrences(occurrence_date)', 'class_occurrences(actual_start_time)', 'class_occurrences(original_start_time)'], searchable: ['attendance_status', 'progress_letter'], filterable: ['id', 'enrollment_id', 'class_occurrence_id', 'lesson_id', 'attendance_status', 'absence_reason', 'version', 'last_edited_by', 'content', 'class_occurrences.occurrence_date', 'class_occurrences.class_session_id', 'class_occurrences.class_sessions.classroom_id', 'enrollments.course_id'], permission: 'teaching.reports.list', scope: 'report', genericMethods: ['GET'] },
  'report-templates': { route: 'report-templates', table: 'report_templates', idColumn: 'id', fields: ['id', 'name', 'content', 'contact_notes', 'class_notes', 'content_document', 'contact_notes_document', 'class_notes_document', 'instructor_id', 'teaching_id', 'created_at', 'updated_at'], writable: ['name', 'content', 'contact_notes', 'class_notes', 'content_document', 'contact_notes_document', 'class_notes_document', 'instructor_id', 'teaching_id'], sortable: ['name', 'created_at', 'updated_at'], searchable: ['name'], permission: 'teaching.templates.list', scope: 'teaching' },
  'copy-templates': { route: 'copy-templates', table: 'copy_templates', idColumn: 'id', fields: ['id', 'user_id', 'template_type', 'scope_type', 'scope_entity_id', 'template_text', 'template_document', 'created_at', 'updated_at'], writable: ['template_type', 'scope_type', 'scope_entity_id', 'template_text', 'template_document'], sortable: ['updated_at', 'created_at', 'template_type', 'scope_type'], searchable: ['template_type', 'scope_type', 'scope_entity_id'], permission: 'system.users.read', scope: 'self', selfAuthorization: true },
  'student-suspensions': { route: 'student-suspensions', table: 'student_suspensions', idColumn: 'id', fields: ['id', 'enrollment_id', 'start_date', 'end_date', 'time_zone', 'reason', 'created_at', 'updated_at'], writable: ['enrollment_id', 'start_date', 'end_date', 'time_zone', 'reason'], sortable: ['start_date', 'end_date', 'created_at', 'updated_at'], searchable: ['reason'], permission: 'teaching.enrollments.list', scope: 'enrollment-child', genericMethods: ['GET'] },
  // Version rows are immutable through the public API.  DELETE is intentionally
  // the only mutation exposed: enrollment/transfer cleanup removes history
  // after the parent report has been archived by the domain service.  The item
  // route resolves the parent report scope before the user-JWT RLS delete.
  'report-versions': { route: 'report-versions', table: 'report_versions', idColumn: 'id', fields: ['id', 'occurrence_report_id', 'version', 'content', 'edited_by', 'snapshot', 'created_at'], writable: [], sortable: ['version', 'created_at'], searchable: [], permission: 'teaching.reports.list', permissions: { list: 'teaching.reports.list', read: 'teaching.reports.read', delete: 'teaching.reports.delete' }, scope: 'report-child', genericMethods: ['GET', 'DELETE'] },
  holidays: { route: 'holidays', table: 'holidays', idColumn: 'id', fields: ['id', 'name', 'kind', 'start_date', 'end_date', 'classroom_ids', 'class_session_ids', 'teacher_ids', 'time_zone', 'created_at', 'updated_at'], writable: ['name', 'kind', 'start_date', 'end_date', 'classroom_ids', 'class_session_ids', 'teacher_ids', 'time_zone'], sortable: ['name', 'start_date', 'end_date', 'created_at', 'updated_at'], searchable: ['name', 'kind'], permission: 'teaching.holidays.list', scope: 'holiday', genericMethods: ['GET'] },
}
export const resourceKeys = Object.keys(resources)

// Query filters are opt-in.  The compatibility client serializes Supabase
// query-builder predicates into `filters`, so leaving this registry empty
// makes otherwise valid list/search/date-range operations fail closed with
// INVALID_FILTER.  Keep sensitive columns out of this map: collection
// filtering must not become an existence oracle for credentials or identity
// fields.  Relation paths are explicit because the user-JWT repository may
// filter through an allowlisted PostgREST relation.
const filterableFieldsByResource: Record<string, readonly string[]> = {
  'user-preferences': ['user_id'],
  'visibility-preferences': ['id', 'user_id', 'entity_type', 'entity_id', 'is_hidden'],
  users: ['id', 'display_name', 'email', 'account_status'],
  roles: ['id', 'code', 'name', 'domain', 'teaching_id', 'is_builtin', 'is_protected', 'is_system'],
  permissions: ['id', 'key', 'domain', 'resource', 'action'],
  'audit-events': ['id', 'actor_user_id', 'action', 'domain', 'resource', 'resource_id', 'scope_id', 'outcome', 'created_at'],
  teachings: ['id', 'owner_user_id', 'is_quarantine'],
  courses: ['id', 'teaching_id', 'user_id', 'subject', 'stage', 'display_name'],
  lessons: ['id', 'course_id', 'user_id', 'sequence', 'title'],
  'classroom-schedules': ['id', 'classroom_id', 'user_id', 'day_of_week'],
  'class-session-schedule-rules': ['id', 'class_session_id', 'schedule_kind', 'occurrence_date', 'day_of_week'],
  classrooms: ['id', 'teaching_id', 'user_id', 'name'],
  'class-sessions': ['id', 'teaching_id', 'classroom_id', 'user_id', 'name', 'start_date', 'end_date'],
  'class-session-teachers': ['id', 'class_session_id', 'teacher_id', 'role_id', 'effective_from'],
  students: ['id', 'user_id', 'name'],
  'student-contacts': ['id', 'student_id', 'name', 'relation'],
  'student-schools': ['id', 'student_id', 'name', 'status', 'grade', 'class'],
  'student-credentials': ['id', 'student_id', 'platform', 'username'],
  teachers: ['id', 'user_id', 'name'],
  'teacher-credentials': ['id', 'teacher_id', 'platform', 'username'],
  enrollments: ['id', 'student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'user_id'],
  occurrences: ['id', 'class_session_id', 'occurrence_date', 'status', 'teacher_ids', 'notes', 'is_conducted'],
  reports: [
    'id', 'enrollment_id', 'class_occurrence_id', 'lesson_id', 'attendance_status',
    'absence_reason', 'version', 'last_edited_by', 'content', 'class_occurrences.occurrence_date',
    'class_occurrences.class_session_id', 'class_occurrences.class_sessions.classroom_id',
    'enrollments.course_id',
  ],
  'report-templates': ['id', 'teaching_id', 'instructor_id', 'name'],
  'copy-templates': ['id', 'user_id', 'template_type', 'scope_type', 'scope_entity_id'],
  'student-suspensions': ['id', 'enrollment_id', 'start_date', 'end_date'],
  'report-versions': ['id', 'occurrence_report_id', 'version', 'edited_by'],
  holidays: ['id', 'name', 'kind', 'start_date', 'end_date', 'classroom_ids', 'class_session_ids', 'teacher_ids'],
}

for (const [route, fields] of Object.entries(filterableFieldsByResource)) {
  const definition = resources[route]
  if (!definition) throw new Error(`Filter registry references unknown resource ${route}`)
  definition.filterable = fields
}

const optionalText = z.string().max(10000).nullable().optional()
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
const optionalUrl = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.url().max(2048).nullable().optional(),
)
const optionalTime = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional()
const optionalDocument = z.record(z.string(), z.unknown()).nullable().optional()
/**
 * Runtime request schemas are exported so the OpenAPI document can be built
 * from the same contract that runs before a database call.  Keeping these in
 * one registry prevents a request from being accepted by the API while its
 * documented shape says something else.
 */
export const resourceSchemas: Record<string, { createSchema?: z.ZodType<Record<string, unknown>>; updateSchema?: z.ZodType<Record<string, unknown>> }> = {
  classrooms: {
    createSchema: z.object({ name: z.string().trim().min(1).max(200), color: optionalText, address: optionalText, phone: optionalText, external_link: optionalUrl, teaching_id: z.string().uuid().optional() }).strict(),
    updateSchema: z.object({ name: z.string().trim().min(1).max(200).optional(), color: optionalText, address: optionalText, phone: optionalText, external_link: optionalUrl, teaching_id: z.string().uuid().nullable().optional() }).strict(),
  },
  courses: {
    createSchema: z.object({ subject: optionalText, stage: optionalText, description: optionalText, display_name: optionalText, teaching_id: z.string().uuid().optional() }).strict(),
    updateSchema: z.object({ subject: optionalText, stage: optionalText, description: optionalText, display_name: optionalText, teaching_id: z.string().uuid().nullable().optional() }).strict(),
  },
  lessons: {
    createSchema: z.object({ course_id: z.string().uuid(), title: z.string().trim().min(1).max(200), sequence: z.number().int().min(0) }).strict(),
    updateSchema: z.object({ course_id: z.string().uuid().optional(), title: z.string().trim().min(1).max(200).optional(), sequence: z.number().int().min(0).optional() }).strict(),
  },
  students: {
    createSchema: z.object({ name: z.string().trim().min(1).max(200), notes: optionalText, notes_document: z.record(z.string(), z.unknown()).nullable().optional(), gov_id: optionalText, email: z.string().email().nullable().optional(), phone: optionalText, residence_address: optionalText, mailing_address: optionalText, birthday: optionalDate, external_link: optionalUrl }).strict(),
    updateSchema: z.object({ name: z.string().trim().min(1).max(200).optional(), notes: optionalText, notes_document: z.record(z.string(), z.unknown()).nullable().optional(), gov_id: optionalText, email: z.string().email().nullable().optional(), phone: optionalText, residence_address: optionalText, mailing_address: optionalText, birthday: optionalDate, external_link: optionalUrl }).strict(),
  },
  teachers: {
    createSchema: z.object({ name: z.string().trim().min(1).max(200), email: z.string().email(), phone: optionalText, address: optionalText, birthday: optionalDate, bio: optionalText, bio_document: z.record(z.string(), z.unknown()).nullable().optional(), gov_id: optionalText, user_id: z.string().uuid().nullable().optional() }).strict(),
    updateSchema: z.object({ name: z.string().trim().min(1).max(200).optional(), email: z.string().email().optional(), phone: optionalText, address: optionalText, birthday: optionalDate, bio: optionalText, bio_document: z.record(z.string(), z.unknown()).nullable().optional(), gov_id: optionalText, user_id: z.string().uuid().nullable().optional() }).strict(),
  },
  roles: {
    // The generic registry remains a read/compatibility description. The
    // canonical role mutation is validated by rbacRouter and its RPCs.
    createSchema: z.object({ domain: z.enum(['system', 'teaching']).optional(), teaching_id: z.string().uuid().nullable().optional(), code: z.string().trim().min(1).max(80).optional(), name: z.string().trim().min(1).max(120), description: optionalText, is_system: z.literal(false).optional() }).strict(),
    updateSchema: z.object({ code: z.string().trim().min(1).max(80).optional(), name: z.string().trim().min(1).max(120).optional(), description: optionalText }).strict(),
  },
  'report-templates': {
    createSchema: z.object({ name: z.string().trim().min(1).max(200), content: optionalText, contact_notes: optionalText, class_notes: optionalText, content_document: z.record(z.string(), z.unknown()).nullable().optional(), contact_notes_document: z.record(z.string(), z.unknown()).nullable().optional(), class_notes_document: z.record(z.string(), z.unknown()).nullable().optional(), instructor_id: z.string().uuid().nullable().optional(), teaching_id: z.string().uuid().optional() }).strict(),
    updateSchema: z.object({ name: z.string().trim().min(1).max(200).optional(), content: optionalText, contact_notes: optionalText, class_notes: optionalText, content_document: z.record(z.string(), z.unknown()).nullable().optional(), contact_notes_document: z.record(z.string(), z.unknown()).nullable().optional(), class_notes_document: z.record(z.string(), z.unknown()).nullable().optional(), instructor_id: z.string().uuid().nullable().optional(), teaching_id: z.string().uuid().nullable().optional() }).strict(),
  },
  'user-preferences': {
    createSchema: z.object({ time_zone: z.string().min(1).max(100), editor_settings: z.record(z.string(), z.unknown()).optional() }).strict(),
    updateSchema: z.object({ time_zone: z.string().min(1).max(100).optional(), editor_settings: z.record(z.string(), z.unknown()).optional() }).strict(),
  },
  'visibility-preferences': {
    createSchema: z.object({ entity_type: z.string().trim().min(1).max(100), entity_id: z.string().uuid(), is_hidden: z.boolean() }).strict(),
    updateSchema: z.object({ entity_type: z.string().trim().min(1).max(100).optional(), entity_id: z.string().uuid().optional(), is_hidden: z.boolean().optional() }).strict(),
  },
  'student-contacts': {
    createSchema: z.object({ student_id: z.string().uuid(), name: z.string().trim().min(1).max(200), relation: optionalText, phone: optionalText, email: z.string().email().nullable().optional() }).strict(),
    updateSchema: z.object({ student_id: z.string().uuid().optional(), name: z.string().trim().min(1).max(200).optional(), relation: optionalText, phone: optionalText, email: z.string().email().nullable().optional() }).strict(),
  },
  'student-schools': {
    createSchema: z.object({ student_id: z.string().uuid(), name: z.string().trim().min(1).max(200), status: optionalText, grade: optionalText, school_student_id: optionalText, start_date: optionalDate, end_date: optionalDate, time_zone: z.string().max(100).nullable().optional(), class: optionalText }).strict(),
    updateSchema: z.object({ student_id: z.string().uuid().optional(), name: z.string().trim().min(1).max(200).optional(), status: optionalText, grade: optionalText, school_student_id: optionalText, start_date: optionalDate, end_date: optionalDate, time_zone: z.string().max(100).nullable().optional(), class: optionalText }).strict(),
  },
  'student-credentials': {
    createSchema: z.object({ student_id: z.string().uuid(), platform: z.string().trim().min(1).max(120), username: optionalText, password: optionalText, url: optionalUrl }).strict(),
    updateSchema: z.object({ student_id: z.string().uuid().optional(), platform: z.string().trim().min(1).max(120).optional(), username: optionalText, password: optionalText, url: optionalUrl }).strict(),
  },
  'teacher-credentials': {
    createSchema: z.object({ teacher_id: z.string().uuid(), platform: z.string().trim().min(1).max(120), username: optionalText, password: optionalText, url: optionalUrl }).strict(),
    updateSchema: z.object({ teacher_id: z.string().uuid().optional(), platform: z.string().trim().min(1).max(120).optional(), username: optionalText, password: optionalText, url: optionalUrl }).strict(),
  },
  'classroom-schedules': {
    createSchema: z.object({ classroom_id: z.string().uuid(), day_of_week: z.number().int().min(0).max(6), start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/), end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/) }).strict(),
    updateSchema: z.object({ classroom_id: z.string().uuid().optional(), day_of_week: z.number().int().min(0).max(6).optional(), start_time: optionalTime, end_time: optionalTime }).strict(),
  },
  'class-session-schedule-rules': {
    createSchema: z.object({ class_session_id: z.string().uuid(), schedule_kind: z.string().trim().min(1).max(40), day_of_week: z.number().int().min(0).max(6).nullable().optional(), day_of_month: z.number().int().min(1).max(31).nullable().optional(), occurrence_date: optionalDate, start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional(), end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable().optional() }).strict(),
    updateSchema: z.object({ class_session_id: z.string().uuid().optional(), schedule_kind: z.string().trim().min(1).max(40).optional(), day_of_week: z.number().int().min(0).max(6).nullable().optional(), day_of_month: z.number().int().min(1).max(31).nullable().optional(), occurrence_date: optionalDate, start_time: optionalTime, end_time: optionalTime }).strict(),
  },
  'class-session-teachers': {
    createSchema: z.object({ class_session_id: z.string().uuid(), teacher_id: z.string().uuid(), role_id: z.string().uuid().nullable().optional(), effective_from: optionalDate, effective_to: optionalDate }).strict(),
    updateSchema: z.object({ class_session_id: z.string().uuid().optional(), teacher_id: z.string().uuid().optional(), role_id: z.string().uuid().nullable().optional(), effective_from: optionalDate, effective_to: optionalDate }).strict(),
  },
  'copy-templates': {
    createSchema: z.object({ template_type: z.string().trim().min(1).max(100), scope_type: z.string().trim().min(1).max(100), scope_entity_id: z.string().uuid().nullable().optional(), template_text: optionalText, template_document: optionalDocument }).strict(),
    updateSchema: z.object({ template_type: z.string().trim().min(1).max(100).optional(), scope_type: z.string().trim().min(1).max(100).optional(), scope_entity_id: z.string().uuid().nullable().optional(), template_text: optionalText, template_document: optionalDocument }).strict(),
  },
  teachings: {
    createSchema: z.object({ name: z.string().trim().min(1).max(200) }).strict(),
    updateSchema: z.object({ name: z.string().trim().min(1).max(200).optional() }).strict(),
  },
}
export const teachingMemberCreateSchema = z.object({ user_id: z.string().uuid(), role_id: z.string().uuid(), status: z.enum(['active', 'suspended', 'removed']).optional(), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict()
export const teachingMemberUpdateSchema = z.object({ role_id: z.string().uuid().optional(), status: z.enum(['active', 'suspended', 'removed']).optional(), effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict()
for (const [route, schema] of Object.entries(resourceSchemas)) Object.assign(resources[route], schema)

// Keep query fields explicit even for resources that use the default registry
// definition. Prefer the collection projection so item-only sensitive fields
// cannot become existence oracles through filters. Nested projections are
// never valid filter keys.
for (const definition of Object.values(resources)) {
  definition.filterable ??= (definition.listFields ?? definition.fields).filter((field) => !field.includes('('))
}

// Generic routes must never silently accept an unvalidated write.  A missing
// schema is a security regression because it moves the first validation point
// after authorization/idempotency and makes the REST contract unknowable.
for (const definition of Object.values(resources)) {
  const methods = new Set(definition.genericMethods ?? ['GET', 'POST', 'PATCH', 'DELETE'])
  if (methods.has('POST') && !definition.createSchema) throw new Error(`Resource ${definition.route} is missing createSchema`)
  if (methods.has('PATCH') && !definition.updateSchema) throw new Error(`Resource ${definition.route} is missing updateSchema`)
}
