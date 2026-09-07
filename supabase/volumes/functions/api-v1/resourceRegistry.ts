export type ApiResourceDefinition = {
  table: string
  select: string
  fields: readonly string[]
  sortable: readonly string[]
  permissionResource: string
  searchField?: string
  domain?: 'system' | 'teaching'
  methods?: readonly string[]
}

export const resourceDefinitions = {
  classrooms: { table: 'classrooms', select: 'id,name,color,address,phone,external_link,teaching_id,user_id,created_at,updated_at', fields: ['name', 'color', 'address', 'phone', 'external_link', 'teaching_id'], sortable: ['name', 'created_at', 'updated_at'], permissionResource: 'classrooms', searchField: 'name' },
  class_sessions: { table: 'class_sessions', select: 'id,name,classroom_id,course_ids,day_of_week,start_time,end_time,capacity,lesson_number,external_link,start_date,end_date,teaching_id,user_id,created_at,updated_at', fields: ['name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date', 'teaching_id'], sortable: ['name', 'start_date', 'created_at', 'updated_at'], permissionResource: 'class_sessions', searchField: 'name' },
  'class-sessions': { table: 'class_sessions', select: 'id,name,classroom_id,course_ids,day_of_week,start_time,end_time,capacity,lesson_number,external_link,start_date,end_date,teaching_id,user_id,created_at,updated_at', fields: ['name', 'classroom_id', 'course_ids', 'day_of_week', 'start_time', 'end_time', 'capacity', 'lesson_number', 'external_link', 'start_date', 'end_date', 'teaching_id'], sortable: ['name', 'start_date', 'created_at', 'updated_at'], permissionResource: 'class_sessions', searchField: 'name' },
  students: { table: 'students', select: 'id,name,notes,gov_id,email,phone,residence_address,mailing_address,birthday,external_link,user_id,created_at,updated_at', fields: ['name', 'notes', 'gov_id', 'email', 'phone', 'residence_address', 'mailing_address', 'birthday', 'external_link'], sortable: ['name', 'created_at', 'updated_at'], permissionResource: 'students', searchField: 'name' },
  reports: { table: 'occurrence_reports', select: 'id,enrollment_id,class_occurrence_id,lesson_id,content,content_document,attendance_status,is_completed,progress_letter,class_participation,classroom_behavior,contact_notes,class_notes,external_link,version,updated_at', fields: [], sortable: ['updated_at', 'version'], permissionResource: 'reports' },
  teachings: { table: 'teachings', select: 'id,name,owner_user_id,is_quarantine,created_at,updated_at', fields: ['name'], sortable: ['name', 'created_at', 'updated_at'], permissionResource: 'teachings', searchField: 'name' },
  courses: { table: 'courses', select: 'id,subject,stage,description,display_name,teaching_id,user_id,created_at,updated_at', fields: ['subject', 'stage', 'description', 'display_name', 'teaching_id'], sortable: ['subject', 'stage', 'display_name', 'created_at', 'updated_at'], permissionResource: 'courses' },
  lessons: { table: 'lessons', select: 'id,course_id,title,sequence,user_id,created_at,updated_at', fields: ['course_id', 'title', 'sequence'], sortable: ['title', 'sequence', 'created_at', 'updated_at'], permissionResource: 'lessons' },
  enrollments: { table: 'enrollments', select: 'id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number,external_link,user_id,created_at,updated_at', fields: ['student_id', 'course_id', 'classroom_id', 'class_session_id', 'status', 'start_date', 'lesson_number', 'external_link'], sortable: ['status', 'start_date', 'created_at', 'updated_at'], permissionResource: 'enrollments' },
  occurrences: { table: 'class_occurrences', select: 'id,class_session_id,occurrence_date,status,teacher_ids,teacher_attendance,notes,is_conducted,created_at,updated_at', fields: ['class_session_id', 'occurrence_date', 'status', 'teacher_ids', 'teacher_attendance', 'notes', 'is_conducted'], sortable: ['occurrence_date', 'status', 'created_at', 'updated_at'], permissionResource: 'occurrences' },
  report_templates: { table: 'report_templates', select: 'id,name,content,contact_notes,class_notes,instructor_id,teaching_id,created_at,updated_at', fields: ['name', 'content', 'contact_notes', 'class_notes', 'teaching_id'], sortable: ['name', 'created_at', 'updated_at'], permissionResource: 'templates', searchField: 'name' },
  'report-templates': { table: 'report_templates', select: 'id,name,content,contact_notes,class_notes,instructor_id,teaching_id,created_at,updated_at', fields: ['name', 'content', 'contact_notes', 'class_notes', 'teaching_id'], sortable: ['name', 'created_at', 'updated_at'], permissionResource: 'templates', searchField: 'name' },
  holidays: { table: 'holidays', select: 'id,name,start_date,end_date,classroom_ids,class_session_ids,created_at,updated_at', fields: ['name', 'start_date', 'end_date', 'classroom_ids', 'class_session_ids'], sortable: ['name', 'start_date', 'end_date', 'created_at', 'updated_at'], permissionResource: 'holidays', searchField: 'name' },
  roles: { table: 'roles', select: 'id,code,name,description,is_system,sort_order,created_at,updated_at', fields: ['code', 'name', 'description'], sortable: ['code', 'name', 'sort_order', 'created_at', 'updated_at'], permissionResource: 'roles', searchField: 'name', domain: 'system', methods: ['GET', 'POST'] },
  permissions: { table: 'permissions', select: 'id,key,name,description,domain,resource,action,conditions,created_at,updated_at', fields: [], sortable: ['key', 'domain', 'resource', 'action', 'created_at'], permissionResource: 'permissions', searchField: 'key', domain: 'system', methods: ['GET'] },
  'audit-events': { table: 'audit_events', select: 'id,actor_user_id,action,domain,resource,resource_id,scope_id,request_id,outcome,metadata,created_at', fields: [], sortable: ['created_at', 'action', 'domain', 'resource', 'outcome'], permissionResource: 'audit', searchField: 'resource', domain: 'system', methods: ['GET'] },
} satisfies Record<string, ApiResourceDefinition>

export type ApiResource = keyof typeof resourceDefinitions

export function resourceDefinition(resource: string): ApiResourceDefinition | undefined {
  return resourceDefinitions[resource as ApiResource]
}

export function permissionResource(resource: string) {
  return resourceDefinition(resource)?.permissionResource ?? resource.replaceAll('-', '_')
}

export function collectionSort(resource: string, raw: string | null) {
  const [field = 'created_at', direction = 'desc'] = ((raw ?? 'created_at:desc').trim() || 'created_at:desc').split(':')
  const definition = resourceDefinition(resource)
  if (!definition?.sortable.includes(field)) throw new Error('INVALID_SORT')
  if (direction !== 'asc' && direction !== 'desc') throw new Error('INVALID_SORT')
  return { field, ascending: direction === 'asc' }
}
