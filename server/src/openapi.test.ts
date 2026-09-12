import { describe, expect, it } from 'vitest'
import { permissionForResource } from './authorization.js'
import { buildOpenApi } from './openapi.js'
import { resources } from './resources.js'

describe('generated API contract', () => {
  it('does not advertise unsupported system mutations', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { 'x-permission'?: string } | undefined>> }
    expect(spec.paths['/api/permissions'].post).toBeUndefined()
    expect(spec.paths['/api/audit-events'].delete).toBeUndefined()
  })

  it('uses explicit role action permissions and idempotency metadata', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { 'x-permission'?: string; parameters?: unknown[] } | undefined>> }
    expect(spec.paths['/api/roles'].post?.['x-permission']).toBe('system.roles.manage')
    expect(spec.paths['/api/roles/{id}'].patch?.['x-permission']).toBe('system.roles.manage')
    expect(spec.paths['/api/roles/{id}'].delete?.parameters).toBeDefined()
  })

  it('documents compatibility-safe role input and status filtering', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, any> | undefined>; components: { parameters: Record<string, any> } }
    const roleSchema = spec.paths['/api/roles']?.post?.requestBody?.content?.['application/json']?.schema
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
    expect(spec.paths['/api/class-sessions/{id}/enrollment-peak'].get?.['x-permissions']).toEqual(['teaching.class_sessions.read', 'teaching.occurrences.list', 'teaching.reports.list'])
  })

  it('documents the class session collection classroom filter', () => {
    const spec = buildOpenApi() as { paths: Record<string, Record<string, { parameters?: Array<{ $ref?: string }> } | undefined>>; components: { parameters: Record<string, unknown> } }
    const parameters = spec.paths['/api/class-sessions']?.get?.parameters ?? []
    expect(parameters.some((parameter) => parameter.$ref === '#/components/parameters/classroom_id')).toBe(true)
  })
})
