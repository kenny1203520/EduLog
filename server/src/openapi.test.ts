import { describe, expect, it } from 'vitest'
import { permissionForResource } from './authorization.js'
import { buildOpenApi } from './openapi.js'
import { resources } from './resources.js'
import { allowedRpcs } from './rpcContract.js'
import { isAllowedRpc as routerAllowsRpc } from './rpcRouter.js'

describe('generated API contract', () => {
  it('does not advertise unsupported system mutations', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { 'x-permission'?: string } | undefined>> }
    expect(spec.paths['/api/permissions'].post).toBeUndefined()
    expect(spec.paths['/api/audit-events'].delete).toBeUndefined()
  })

  it('uses explicit role action permissions and idempotency metadata', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { 'x-permission'?: string; parameters?: unknown[] } | undefined>> }
    expect(spec.paths['/api/roles'].post?.['x-permission']).toContain('system.roles.manage')
    expect(spec.paths['/api/roles/{id}'].patch?.['x-permission']).toContain('teaching.roles.manage')
    expect(spec.paths['/api/roles/{id}'].delete?.parameters).toBeDefined()
    const fullSpec = buildOpenApi() as { components: { schemas: Record<string, any> }; paths: Record<string, Record<string, any> | undefined> }
    expect(fullSpec.components.schemas.RoleCreateMutation.required).toEqual(expect.arrayContaining(['expected_epoch']))
    expect(fullSpec.components.schemas.RoleUpdateMutation.required).toEqual(expect.arrayContaining(['expected_epoch']))
    expect(fullSpec.components.schemas.RoleDeleteMutation.required).toEqual(['expected_epoch'])
    expect(fullSpec.paths['/api/permissions/{permissionId}/policies']?.get?.deprecated).toBe(true)
  })

  it('documents the typed role permission matrix and user display sorting', () => {
    const spec = buildOpenApi() as { components: { schemas: Record<string, any> }; paths: Record<string, Record<string, any> | undefined> }
    expect(spec.components.schemas.RolePermissionMatrixRow.required).toEqual(expect.arrayContaining([
      'permission_id', 'permission_key', 'resource', 'action', 'local_effect', 'inherited_effect', 'effective_effect', 'denied', 'epoch',
    ]))
    expect(spec.paths['/api/roles/{id}/permissions']?.get?.responses?.['200']?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/RolePermissionMatrixEnvelope')
    const userSort = spec.paths['/api/users']?.get?.parameters?.find((parameter: any) => parameter.name === 'sort')
    expect(userSort?.schema?.enum).toEqual(expect.arrayContaining(['display_name', '-display_name']))
  })

  it('documents report creation-time sorting in the generated contract', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined> }
    const reportSort = spec.paths['/api/reports']?.get?.parameters?.find((parameter: any) => parameter.name === 'sort')
    expect(reportSort?.schema?.enum).toEqual(expect.arrayContaining(['created_at', '-created_at']))
  })

  it('documents compatibility-safe role input and status filtering', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined>; components: { parameters: Record<string, any>; schemas: Record<string, any> } }
    const roleSchema = spec.components.schemas.RoleCreateMutation
    expect(roleSchema.properties.is_system).toMatchObject({ type: 'boolean', const: false })
    expect(spec.components.parameters.Status).toBeDefined()
    const enrollmentParameters = spec.paths['/api/enrollments']?.get?.parameters as Array<{ $ref?: string }>
    expect(enrollmentParameters.some((parameter) => parameter.$ref === '#/components/parameters/Status')).toBe(true)
  })

  it('generates mutation schemas from the runtime resource registry', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined> }
    const studentCreate = spec.paths['/api/students']?.post?.requestBody?.content?.['application/json']?.schema
    const studentUpdate = spec.paths['/api/students/{id}']?.patch?.requestBody?.content?.['application/json']?.schema
    expect(studentCreate).toMatchObject({ type: 'object', additionalProperties: false, required: ['name'] })
    expect(studentCreate.properties.email).toEqual(expect.objectContaining({ anyOf: expect.arrayContaining([expect.objectContaining({ type: 'string', format: 'email' })]) }))
    expect(studentCreate.properties.birthday).toEqual(expect.objectContaining({ anyOf: expect.arrayContaining([expect.objectContaining({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })]) }))
    expect(studentUpdate).toMatchObject({ type: 'object', additionalProperties: false })
    expect(studentUpdate.required).toBeUndefined()
    expect(spec.paths['/api/roles']?.post?.['x-request-schema-source']).toBe('resource-registry')
  })

  it('keeps generated generic methods and permissions aligned with the registry', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { 'x-permission'?: string } | undefined>> }
    const specialized = new Map([
      ['enrollments:post', 'teaching.enrollments.create'], ['enrollments:patch', 'teaching.enrollments.update'], ['enrollments:delete', 'teaching.enrollments.delete'],
      ['reports:post', 'teaching.reports.create'], ['reports:patch', 'teaching.reports.update'], ['reports:delete', 'teaching.reports.delete'],
      ['occurrences:patch', 'teaching.occurrences.update'], ['occurrences:delete', 'teaching.occurrences.delete'],
      ['student-suspensions:post', 'teaching.students.update'], ['student-suspensions:patch', 'teaching.students.update'], ['student-suspensions:delete', 'teaching.students.update'],
      ['holidays:post', 'teaching.holidays.create'], ['holidays:patch', 'teaching.holidays.update'], ['holidays:delete', 'teaching.holidays.delete'],
    ])
    for (const def of Object.values(resources)) {
      if (def.route === 'roles') continue
      const methods = new Set(def.genericMethods ?? ['GET', 'POST', 'PATCH', 'DELETE'])
      const collection = spec.paths[`/api/${def.route}`]
      const item = spec.paths[`/api/${def.route}/{id}`]
      if (methods.has('GET')) {
        expect(collection?.get?.['x-permission']).toBe(def.selfAuthorization ? undefined : permissionForResource(def, 'list'))
        expect(item?.get?.['x-permission']).toBe(def.selfAuthorization ? undefined : permissionForResource(def, 'read'))
      } else {
        expect(collection?.get).toBeUndefined()
        expect(item?.get).toBeUndefined()
      }
      if (methods.has('POST')) expect(collection?.post?.['x-permission']).toBe(def.selfAuthorization ? undefined : permissionForResource(def, 'create'))
      else if (def.route !== 'class-sessions') expect(collection?.post?.['x-permission']).toBe(specialized.get(`${def.route}:post`))
      if (methods.has('PATCH')) expect(item?.patch?.['x-permission']).toBe(def.selfAuthorization ? undefined : permissionForResource(def, 'update'))
      else if (def.route !== 'class-sessions') expect(item?.patch?.['x-permission']).toBe(specialized.get(`${def.route}:patch`))
      if (methods.has('DELETE')) expect(item?.delete?.['x-permission']).toBe(def.selfAuthorization ? undefined : permissionForResource(def, 'delete'))
      else if (def.route !== 'class-sessions') expect(item?.delete?.['x-permission']).toBe(specialized.get(`${def.route}:delete`))
    }
  })

  it('documents specialized nested resource scope parameters and permissions', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { 'x-permission'?: string; parameters?: Array<{ name?: string }> } | undefined>> }
    expect(spec.paths['/api/class-sessions/{sessionId}/teachers'].get?.parameters?.some((parameter) => parameter.name === 'sessionId')).toBe(true)
    expect(spec.paths['/api/class-sessions/{sessionId}/teachers/{assignmentId}'].patch?.['x-permission']).toBe('teaching.class_sessions.update')
    expect(spec.paths['/api/class-sessions/{sessionId}/teachers/{assignmentId}'].patch?.parameters?.some((parameter) => parameter.name === 'assignmentId')).toBe(true)
    expect(spec.paths['/api/teachings/{teachingId}/members'].get?.parameters?.some((parameter) => parameter.name === 'teachingId')).toBe(true)
    expect(spec.paths['/api/teachings/{teachingId}/members/{userId}'].get?.['x-permission']).toBe('teaching.members.read')
    expect(spec.paths['/api/class-sessions/{id}'].delete?.parameters?.some((parameter) => parameter.name === 'id')).toBe(true)
  })

  it('documents all permissions needed by derived session reads', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { 'x-permissions'?: string[]; parameters?: Array<{ name?: string }> } | undefined>> }
    expect(spec.paths['/api/class-sessions/{id}/details'].get?.['x-permissions']).toEqual(['teaching.class_sessions.read', 'teaching.enrollments.list'])
    expect(spec.paths['/api/class-sessions/{id}/enrollment-peak'].get?.['x-permissions']).toEqual(['teaching.class_sessions.read', 'teaching.enrollments.list', 'teaching.occurrences.list', 'teaching.reports.list'])
  })

  it('documents the class session collection classroom filter', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { parameters?: Array<{ $ref?: string }> } | undefined>>; components: { parameters: Record<string, unknown> } }
    const parameters = spec.paths['/api/class-sessions']?.get?.parameters ?? []
    expect(parameters.some((parameter) => parameter.$ref === '#/components/parameters/classroom_id')).toBe(true)
  })

  it('defines every shared response reference used by the generated document', () => {
    const spec = buildOpenApi() as {
      paths: Record<string, Record<string, { responses?: Record<string, { $ref?: string }> } | undefined>>
      components: { responses: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> }
    }
    expect(spec.components.responses.Envelope).toBeDefined()
    expect(spec.components.responses.Envelope.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/Envelope')
    for (const path of Object.values(spec.paths)) {
      for (const operation of Object.values(path)) {
        if (!operation?.responses) continue
        for (const response of Object.values(operation.responses)) {
          if (response.$ref?.startsWith('#/components/responses/')) {
            const name = response.$ref.slice('#/components/responses/'.length)
            expect(spec.components.responses[name]).toBeDefined()
          }
        }
      }
    }
  })

  it('does not emit dangling local JSON references', () => {
    const spec = buildOpenApi() as Record<string, unknown>
    const missing: string[] = []
    const visit = (value: unknown, location: string) => {
      if (!value || typeof value !== 'object') return
      if ('$ref' in value && typeof (value as { $ref?: unknown }).$ref === 'string') {
        const reference = (value as { $ref: string }).$ref
        if (reference.startsWith('#/')) {
          const target = reference.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
            .reduce<unknown>((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, spec)
          if (target === undefined) missing.push(`${location} -> ${reference}`)
        }
      }
      for (const [key, child] of Object.entries(value)) visit(child, `${location}/${key}`)
    }
    visit(spec, '#')
    expect(missing).toEqual([])
  })

  it('documents cookie authentication for protected operations', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined> }
    const publicOperations = new Set(['POST /api/auth/login', 'POST /api/auth/refresh', 'POST /api/auth/logout', 'GET /api/auth/csrf', 'GET /api/healthz', 'GET /api/openapi.json'])
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem ?? {})) {
        if (!operation || !operation.operationId || operation['x-websocket']) continue
        if (publicOperations.has(`${method.toUpperCase()} ${path}`)) continue
        expect(operation.security, `${method.toUpperCase()} ${path}`).toEqual([{ cookieAuth: [] }])
      }
    }
  })

  it('documents auth CSRF and user search routes that are mounted outside the registry', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined> }
    expect(spec.paths['/api/auth/csrf']?.get?.operationId).toBe('csrfToken')
    expect(spec.paths['/api/users/search']?.get?.operationId).toBe('users_search')
    expect(spec.paths['/api/users/search']?.get?.['x-permission']).toBe('system.users.list')
  })

  it('documents page read models separately from REST resources', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined> }
    const pagePaths = [
      '/api/pages/dashboard',
      '/api/pages/me/preferences',
      '/api/pages/enrollments/{enrollmentId}/reports',
      '/api/pages/classrooms/overview',
      '/api/pages/holidays/overview',
      '/api/pages/reports/incomplete',
    ]
    for (const path of pagePaths) {
      const operation = spec.paths[path]?.get
      expect(operation, path).toBeDefined()
      expect(operation?.['x-page-api'], path).toBe(true)
      const successResponse = operation?.responses?.['200']
      expect(successResponse?.$ref ?? successResponse?.content?.['application/json']?.schema?.properties?.data?.$ref, path).toBeTruthy()
      expect(operation?.security, path).toEqual([{ cookieAuth: [] }])
    }
    expect(spec.paths['/api/pages/dashboard']?.get?.operationId).toBe('page_dashboard')
    expect(spec.paths['/api/pages/dashboard']?.get?.['x-permission']).toBe('teaching.reports.list')
    expect(spec.paths['/api/aggregates/dashboard']).toBeUndefined()
    expect(spec.paths['/api/dashboard']).toBeUndefined()
  })

  it('documents the expanded page API operations, permissions, and data schemas', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined>; components: { schemas: Record<string, any> } }
    const operations: Record<string, { permission: string; schema: string }> = {
      '/api/pages/courses/overview': { permission: 'teaching.courses.list', schema: 'PageCoursesOverviewData' },
      '/api/pages/classrooms/overview': { permission: 'teaching.classrooms.list', schema: 'PageClassroomsOverviewData' },
      '/api/pages/students/overview': { permission: 'teaching.students.list', schema: 'PageStudentsOverviewData' },
      '/api/pages/students/{studentId}/profile': { permission: 'teaching.students.read', schema: 'PageStudentProfileData' },
      '/api/pages/students/{studentId}/reports': { permission: 'teaching.students.read', schema: 'PageStudentReportsData' },
      '/api/pages/teachers/overview': { permission: 'teaching.teachers.list', schema: 'PageTeachersOverviewData' },
      '/api/pages/class-sessions/{sessionId}/workspace': { permission: 'teaching.class_sessions.read', schema: 'PageClassSessionWorkspaceData' },
    }
    for (const [path, expected] of Object.entries(operations)) {
      const operation = spec.paths[path]?.get
      expect(operation, path).toBeDefined()
      expect(operation.operationId, path).toMatch(/^page_[a-z0-9_]+$/)
      expect(operation['x-page-api'], path).toBe(true)
      expect(operation['x-permission'], path).toBe(expected.permission)
      expect(operation.security, path).toEqual([{ cookieAuth: [] }])
      expect(operation.responses['200'].content['application/json'].schema.properties.data.$ref, path).toBe(`#/components/schemas/${expected.schema}`)
      expect(operation.responses['401'], path).toBeDefined()
      expect(operation.responses['403'], path).toBeDefined()
    }
    expect(spec.paths['/api/pages/students/overview']?.get?.parameters?.find((parameter: any) => parameter.name === 'sort')?.schema).toEqual({
      type: 'string',
      enum: ['name', '-name', 'created_at', '-created_at', 'updated_at', '-updated_at'],
      default: 'name',
    })
    expect(spec.components.schemas.PageStudentProfileData.properties.student_credentials).toBeUndefined()
    expect(spec.components.schemas.StudentSchoolSummary.properties.school_student_id).toBeUndefined()
    expect(spec.components.schemas.PageStudentsOverviewData.items.properties.current_school.anyOf[0].$ref).toBe('#/components/schemas/StudentSchoolSummary')
    expect(spec.components.schemas.PageStudentProfileData.properties.current_school.anyOf[0].$ref).toBe('#/components/schemas/StudentSchoolSummary')
    expect(spec.components.schemas.StudentSchoolSensitiveData.properties.school_student_id).toBeDefined()
    expect(spec.paths['/api/students/{id}/credentials']?.get?.['x-permission']).toBe('teaching.students.read_sensitive')
    expect(spec.paths['/api/students/{id}/credentials']?.get?.['x-sensitive-data']).toBe(true)
    expect(spec.paths['/api/students/{id}/credentials']?.get?.responses?.['200']?.content?.['application/json']?.schema?.allOf?.[1]?.properties?.data?.$ref).toBe('#/components/schemas/StudentCredentialSensitiveData')
  })

  it('documents the canonical incomplete-report page contract', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined>; components: { schemas: Record<string, any> } }
    const operation = spec.paths['/api/pages/reports/incomplete']?.get
    expect(operation?.operationId).toBe('page_incomplete_reports')
    expect(operation?.['x-permission']).toBe('teaching.reports.list')
    expect(operation?.responses?.['200']?.content?.['application/json']?.schema?.properties?.data?.$ref).toBe('#/components/schemas/IncompleteReportsPageData')
    expect(operation?.parameters?.find((parameter: any) => parameter.name === 'search')).toBeDefined()
    expect(operation?.parameters?.find((parameter: any) => parameter.name === 'sort')?.schema).toEqual({
      type: 'string', enum: ['date', '-date', 'updated_at', '-updated_at'], default: '-date',
    })
    expect(spec.components.schemas.IncompleteReportPageItem.additionalProperties).toBe(false)
    expect(spec.components.schemas.IncompleteReportPageItem.properties.isIncomplete.const).toBe(true)
    expect(spec.components.schemas.IncompleteReportPageItem.properties.isMissing.const).toBe(false)
  })

  it('documents domain commands and scoped occurrence query operations', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined> }
    const operations: Array<[string, string, string]> = [
      ['/api/occurrences', 'get', 'occurrences_list_scoped'],
      ['/api/occurrences/{id}/preferred', 'get', 'occurrence_preferred'],
      ['/api/occurrences/{id}/navigation', 'get', 'occurrence_navigation'],
      ['/api/occurrences/{occurrenceId}/reports', 'post', 'occurrence_reports_provision'],
      ['/api/reports/{reportId}/versions/{versionId}/restore', 'post', 'report_version_restore'],
      ['/api/reports/{reportId}/conflicts/resolve', 'post', 'report_conflict_resolve'],
      ['/api/enrollments/{id}/progress', 'get', 'enrollment_progress_get'],
      ['/api/enrollments/{id}/progress/recalculate', 'post', 'enrollment_progress_recalculate'],
      ['/api/enrollments/{id}/transfers/class', 'post', 'enrollment_transfer_class'],
      ['/api/teachers/bulk-delete', 'post', 'teachers_bulk_delete'],
      ['/api/copy-templates/{templateType}/{scopeType}/{scopeEntityId}', 'put', 'copy_template_put_scoped'],
    ]
    for (const [path, method, operationId] of operations) {
      const operation = spec.paths[path]?.[method]
      expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined()
      expect(operation.operationId, `${method.toUpperCase()} ${path}`).toBe(operationId)
      expect(operation.security, `${method.toUpperCase()} ${path}`).toEqual([{ cookieAuth: [] }])
      expect(operation.responses['401'], `${method.toUpperCase()} ${path}`).toBeDefined()
    }
    expect(spec.paths['/api/aggregates/dashboard']).toBeUndefined()
  })

  it('documents roster-preserving occupancy separately from legacy enrollment peak', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined>; components: { schemas: Record<string, any> } }
    const operation = spec.paths['/api/class-sessions/{id}/enrollment-peak']?.get
    expect(operation?.['x-response-fields']).toContain('max_occupancy')
    expect(operation?.['x-response-fields']).toContain('roster_count')
    expect(operation?.responses?.['200']?.content?.['application/json']?.schema?.allOf?.[1]?.properties?.data?.$ref).toBe('#/components/schemas/EnrollmentPeak')
    expect(spec.components.schemas.EnrollmentPeak.properties.max_enrollment.description).toContain('compatibility')
  })

  it('keeps RPC exposure, runtime guard, and OpenAPI metadata in sync', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined> }
    expect(spec.paths['/api/rpc/{name}']?.post?.['x-rpc-allowlist']).toEqual([...allowedRpcs])
    for (const name of allowedRpcs) expect(routerAllowsRpc(name)).toBe(true)
    expect(routerAllowsRpc('arbitrary_postgres_function')).toBe(false)
  })

  it('declares valid cookie and bearer security schemes', () => {
    const spec = buildOpenApi() as { components: { securitySchemes: Record<string, any> } }
    expect(spec.components.securitySchemes.cookieAuth).toEqual({ type: 'apiKey', in: 'cookie', name: 'edulog_access' })
    expect(spec.components.securitySchemes.bearerAuth).toEqual({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
  })

  it('generates globally unique operation ids', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { operationId?: string } | undefined>> }
    const operationLocations = new Map<string, string[]>()
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (!operation?.operationId) continue
        const locations = operationLocations.get(operation.operationId) ?? []
        locations.push(`${method.toUpperCase()} ${path}`)
        operationLocations.set(operation.operationId, locations)
      }
    }
    const duplicates = [...operationLocations.entries()].filter(([, locations]) => locations.length > 1)
    expect(duplicates).toEqual([])
  })

  it('does not advertise unrestricted bodies for formal mutation operations', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined> }
    const unrestricted: string[] = []
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem ?? {})) {
        const schema = operation?.requestBody?.content?.['application/json']?.schema
        if (schema?.additionalProperties === true && path !== '/api/rpc/{name}') unrestricted.push(`${method.toUpperCase()} ${path}`)
      }
    }
    expect(unrestricted).toEqual([])
  })

  it('documents report progress letters with the database-compatible format', () => {
    const spec = buildOpenApi() as { components: { schemas: Record<string, any> } }
    const progressLetter = spec.components.schemas.ReportUpdateMutation.properties.progress_letter
    const progressSchemas = progressLetter.anyOf ?? [progressLetter]
    expect(progressSchemas).toEqual(expect.arrayContaining([expect.objectContaining({ pattern: '^[A-Z](-[A-Z])?$' })]))
    expect(spec.components.schemas.ReportCreateMutation.additionalProperties).toBe(false)
    expect(spec.components.schemas.TeachingMemberUpdateMutation.additionalProperties).toBe(false)
  })

  it('keeps specialized mutation schemas sourced from runtime validators', () => {
    const spec = buildOpenApi() as { components: { schemas: Record<string, any> }; paths: Record<string, Record<string, any> | undefined> }
    const teacherCreate = spec.components.schemas.TeacherAssignmentMutation
    expect(teacherCreate).toMatchObject({ type: 'object', additionalProperties: false, required: ['teachers'] })
    expect(teacherCreate.properties.teachers.items).toMatchObject({ type: 'object', additionalProperties: false })

    const holidayCreate = spec.components.schemas.HolidayCreateMutation
    expect(holidayCreate.required).toEqual(expect.arrayContaining(['start_date', 'end_date', 'classroom_ids', 'class_session_ids', 'teacher_ids']))
    expect(holidayCreate.properties.kind).toMatchObject({ default: 'closure', enum: ['closure', 'teacher_leave'] })
    expect(holidayCreate.properties.name.anyOf).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'string' }), expect.objectContaining({ type: 'null' })]))

    const conflict = spec.components.schemas.TransferConflictMutation
    expect(conflict.required).toEqual(expect.arrayContaining(['source_version', 'field_sources']))
    expect(Object.keys(conflict.properties.field_sources?.properties ?? {})).toEqual(expect.arrayContaining([
      'lesson_id', 'is_completed', 'progress_letter', 'attendance', 'class_participation',
      'classroom_behavior', 'contact_notes', 'class_notes', 'content', 'external_link',
    ]))
    expect(spec.paths['/api/class-sessions/{sessionId}/teachers']?.post?.requestBody?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/TeacherAssignmentMutation')
    const teacherListParameters = spec.paths['/api/class-sessions/{sessionId}/teachers']?.get?.parameters ?? []
    expect(teacherListParameters.some((parameter: any) => parameter.name === 'on_date')).toBe(true)
    const teacherDeleteParameters = spec.paths['/api/class-sessions/{sessionId}/teachers']?.delete?.parameters ?? []
    expect(teacherDeleteParameters.some((parameter: any) => parameter.name === 'teacher_id')).toBe(true)
    expect(teacherDeleteParameters.some((parameter: any) => parameter.name === 'effective_from')).toBe(true)
    expect(spec.paths['/api/enrollment-transfers/single-lesson']?.post?.requestBody?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/SingleLessonTransferMutation')
  })
})
