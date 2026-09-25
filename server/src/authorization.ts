import type { Request } from 'express'
import { ApiError, mapDatabaseError } from './errors.js'
import type { ResourceDefinition } from './resources.js'
import { setAuditContext } from './context.js'

type ScopeKind = NonNullable<ResourceDefinition['scope']>

function permissionFor(def: ResourceDefinition, action: string) {
  return def.permissions?.[action as keyof NonNullable<ResourceDefinition['permissions']>]
    ?? `${def.permission.slice(0, def.permission.lastIndexOf('.') + 1)}${action}`
}

function rpcError(error: unknown): never {
  if (error) throw mapDatabaseError(error as { code?: string; message?: string })
  throw new ApiError(403, 'PERMISSION_DENIED', 'You do not have permission to perform this action')
}

async function teachingPermission(req: Request, permission: string, _legacyTeachingId: string | null) {
  setAuditContext(req, { domain: 'teaching', permission, scopeType: 'system' })
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const { data, error } = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: permission,
    p_classroom_id: null,
    p_class_session_id: null,
  })
  if (error || data !== true) rpcError(error)
}

async function coursePermission(req: Request, permission: string, courseId: string) {
  if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const course = await req.db.from('courses').select('teaching_id').eq('id', courseId).maybeSingle()
  if (course.error) throw mapDatabaseError(course.error)
  if (!course.data || typeof course.data.teaching_id !== 'string') throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  return teachingPermission(req, permission, course.data.teaching_id)
}

async function apiPermission(req: Request, permission: string, classroomId: string | null, sessionId: string | null) {
  setAuditContext(req, {
    domain: permission.startsWith('system.') ? 'system' : 'teaching',
    permission,
    scopeId: classroomId ?? sessionId,
    scopeType: classroomId ? 'classroom' : sessionId ? 'class_session' : null,
  })
  if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const { data, error } = await req.db.rpc('has_api_permission', {
    p_user_id: req.user.id,
    p_permission_key: permission,
    p_classroom_id: classroomId,
    p_class_session_id: sessionId,
  })
  if (error || data !== true) rpcError(error)
}

function uuidList(row: Record<string, unknown> | undefined, key: string) {
  const value = row?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function selfPermission(req: Request, row?: Record<string, unknown>) {
  if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  if (row && row.user_id !== req.user.id) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
}

async function globalTeachingPermission(req: Request, permission: string) {
  return teachingPermission(req, permission, null)
}

async function isAccountPersonProfile(req: Request, profileId: string | null) {
  if (!req.adminDb || !req.user || !profileId) return false
  const result = await req.adminDb.from('profiles').select('id').eq('auth_user_id', req.user.id).eq('id', profileId).maybeSingle()
  if (result.error) throw mapDatabaseError(result.error)
  return Boolean(result.data)
}

async function holidayPermission(req: Request, permission: string, row?: Record<string, unknown>) {
  const classroomIds = uuidList(row, 'classroom_ids')
  const sessionIds = uuidList(row, 'class_session_ids')
  if (!classroomIds.length && !sessionIds.length) {
    return apiPermission(req, permission, null, null)
  }
  for (const classroomId of classroomIds) await apiPermission(req, permission, classroomId, null)
  for (const sessionId of sessionIds) await apiPermission(req, permission, null, sessionId)
}

async function entityPermission(req: Request, kind: 'student' | 'enrollment' | 'report', permission: string, id: string) {
  setAuditContext(req, {
    domain: 'teaching',
    resource: kind === 'report' ? 'reports' : `${kind}s`,
    resourceId: id,
    permission,
    scopeId: id,
    scopeType: kind === 'student' ? 'student' : kind === 'enrollment' ? 'enrollment' : 'occurrence_report',
  })
  if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
  const functionName = kind === 'student'
    ? (permission.endsWith('_sensitive') ? 'can_access_sensitive_student' : 'can_access_student')
    : kind === 'enrollment' ? 'can_access_enrollment' : 'can_access_report'
  const { data, error } = await req.db.rpc(functionName, { [`p_${kind}_id`]: id, p_permission_key: permission })
  if (error || data !== true) rpcError(error)
}

function rowTeachingId(row: Record<string, unknown> | undefined) {
  const value = row?.teaching_id
  return typeof value === 'string' ? value : null
}

function rowId(row: Record<string, unknown> | undefined, key: string) {
  const value = row?.[key]
  return typeof value === 'string' ? value : null
}

/**
 * Authorize a resource using its real ownership graph. In particular, an item
 * UUID is never treated as a classroom UUID unless the resource definition
 * explicitly says it is a classroom-scoped resource.
 */
export async function authorizeResource(
  req: Request,
  def: ResourceDefinition,
  permission: string,
  id: string | null,
  row?: Record<string, unknown>,
) {
  setAuditContext(req, { resource: def.route, resourceId: id, permission, scopeType: def.scope ?? null })
  const scope: ScopeKind = def.scope ?? 'system'
  if (scope === 'system') return apiPermission(req, permission, null, null)
  if (scope === 'self') return selfPermission(req, row)
  if (scope === 'platform') return apiPermission(req, permission, null, null)
  if (scope === 'course') {
    if (!req.db) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const courseId = rowId(row, 'course_id') ?? id
    if (!courseId) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    const course = await req.db.from('courses').select('teaching_id').eq('id', courseId).maybeSingle()
    if (course.error) throw mapDatabaseError(course.error)
    return teachingPermission(req, permission, rowTeachingId(course.data as Record<string, unknown> | undefined))
  }
  if (scope === 'classroom') return apiPermission(req, permission, id, null)
  if (scope === 'session') return apiPermission(req, permission, null, id)
  if (scope === 'session-child') return apiPermission(req, permission, null, rowId(row, 'class_session_id'))
  if (scope === 'holiday') return holidayPermission(req, permission, row)
  if (scope === 'student' || scope === 'enrollment' || scope === 'report') {
    if (!id) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    return entityPermission(req, scope, permission, id)
  }
  if (scope === 'occurrence') return apiPermission(req, permission, null, rowId(row, 'class_session_id'))
  if (scope === 'classroom-child') return apiPermission(req, permission, rowId(row, 'classroom_id'), null)
  if (scope === 'teacher') {
    if (!req.db || !req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    // The teacher may manage their own canonical person profile, including
    // sensitive fields. Other callers continue through scoped RBAC checks.
    if (['teaching.teachers.read', 'teaching.teachers.read_sensitive', 'teaching.teachers.create', 'teaching.teachers.update', 'teaching.teachers.update_sensitive'].includes(permission)
      && await isAccountPersonProfile(req, rowId(row, 'profile_id'))) return
    const teacherId = id ?? rowId(row, 'id')
    if (!teacherId) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    try {
      await apiPermission(req, permission, null, null)
      return
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 403) throw error
    }
    const assignments = await req.db.from('class_session_teachers').select('class_session_id').eq('teacher_id', teacherId)
    if (assignments.error) throw mapDatabaseError(assignments.error)
    for (const assignment of assignments.data ?? []) {
      try {
        await apiPermission(req, permission, null, rowId(assignment as Record<string, unknown>, 'class_session_id'))
        return
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 403) throw error
      }
    }
    throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
  }
  if (scope === 'teacher-child') {
    if (!req.db || !req.adminDb) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const teacherId = rowId(row, 'teacher_id')
    if (!teacherId) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    const teacher = await req.adminDb!.from('teacher_records').select('id,profile_id').eq('id', teacherId).maybeSingle()
    if (teacher.error) throw mapDatabaseError(teacher.error)
    if (!teacher.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    return authorizeResource(req, { ...def, scope: 'teacher' }, permission, teacherId, teacher.data as Record<string, unknown>)
  }
  if (scope === 'student-child') {
    const studentId = rowId(row, 'student_id')
    if (!studentId) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    return entityPermission(req, 'student', permission, studentId)
  }
  if (scope === 'enrollment-child') {
    const enrollmentId = rowId(row, 'enrollment_id')
    if (!enrollmentId) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    return entityPermission(req, 'enrollment', permission, enrollmentId)
  }
  if (scope === 'report-child') {
    const reportId = rowId(row, 'occurrence_report_id')
    if (!reportId) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    return entityPermission(req, 'report', permission, reportId)
  }
  return apiPermission(req, permission, null, null)
}

export function permissionForResource(def: ResourceDefinition, action: string) {
  return permissionFor(def, action)
}

export async function authorizeCollection(req: Request, def: ResourceDefinition, permission: string, query: Record<string, unknown> = {}, body?: Record<string, unknown>) {
  setAuditContext(req, { resource: def.route, permission, scopeType: def.scope ?? null })
  const value = (key: string) => {
    const candidate = body?.[key] ?? query[key]
    return typeof candidate === 'string' ? candidate : null
  }
  if (def.scope === 'course') {
    const courseId = value('course_id')
    if (courseId) return coursePermission(req, permission, courseId)
    const teachingId = value('teaching_id')
    return teachingId ? teachingPermission(req, permission, teachingId) : globalTeachingPermission(req, permission)
  }
  if (def.scope === 'platform') {
    return globalTeachingPermission(req, permission)
  }
  if (def.scope === 'self') {
    if (!req.user) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const userId = value('user_id')
    if (userId && userId !== req.user.id) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    return
  }
  if (def.scope === 'classroom' || def.scope === 'classroom-child') {
    const classroomId = value('classroom_id')
    return classroomId ? apiPermission(req, permission, classroomId, null) : globalTeachingPermission(req, permission)
  }
  if (def.scope === 'session' || def.scope === 'occurrence') {
    const classSessionId = value('class_session_id')
    return classSessionId ? apiPermission(req, permission, null, classSessionId) : globalTeachingPermission(req, permission)
  }
  if (def.scope === 'holiday') {
    const classroomIds = body?.classroom_ids ?? query.classroom_ids
    const sessionIds = body?.class_session_ids ?? query.class_session_ids
    if (classroomIds === undefined && sessionIds === undefined) return apiPermission(req, permission, null, null)
    return holidayPermission(req, permission, { classroom_ids: classroomIds, class_session_ids: sessionIds })
  }
  if (def.scope === 'student-child' || def.scope === 'student') {
    const studentId = value('student_id')
    return studentId ? entityPermission(req, 'student', permission, studentId) : globalTeachingPermission(req, permission)
  }
  if (def.scope === 'enrollment-child' || def.scope === 'enrollment') {
    const enrollmentId = value('enrollment_id')
    return enrollmentId ? entityPermission(req, 'enrollment', permission, enrollmentId) : apiPermission(req, permission, null, null)
  }
  if (def.scope === 'report-child' || def.scope === 'report') {
    const reportId = value('occurrence_report_id')
    return reportId ? entityPermission(req, 'report', permission, reportId) : apiPermission(req, permission, null, null)
  }
  if (def.scope === 'teacher-child') {
    const teacherId = value('teacher_id')
    if (!teacherId) return globalTeachingPermission(req, permission)
    if (!req.db || !req.adminDb) throw new ApiError(401, 'AUTH_REQUIRED', 'Authentication is required')
    const teacher = await req.adminDb!.from('teacher_records').select('id,profile_id').eq('id', teacherId).maybeSingle()
    if (teacher.error) throw mapDatabaseError(teacher.error)
    if (!teacher.data) throw new ApiError(404, 'NOT_FOUND', 'Resource was not found')
    return authorizeResource(req, { ...def, scope: 'teacher' }, permission, teacherId, teacher.data as Record<string, unknown>)
  }
  if (def.scope === 'teacher') return globalTeachingPermission(req, permission)
  return apiPermission(req, permission, null, null)
}
