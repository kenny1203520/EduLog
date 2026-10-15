import { describe, expect, it } from 'vitest'
import { buildOpenApi } from '../../openapi/openapi.js'

describe('RBAC API contract', () => {
  it('publishes capability and scoped policy operations in OpenAPI', () => {
    const document = buildOpenApi() as { paths: Record<string, Record<string, unknown>> }
    expect(document.paths['/api/rbac/capability'].get).toBeTruthy()
    expect(document.paths['/api/permissions/{permissionId}/policies'].get).toBeTruthy()
    expect(document.paths['/api/permissions/{permissionId}/policies'].patch).toBeTruthy()
  })

  it('publishes classroom-scoped teaching role assignment operations', () => {
    const document = buildOpenApi() as {
      paths: Record<string, Record<string, any>>
      components: { schemas: Record<string, any> }
    }
    expect(document.paths['/api/classrooms/{classroomId}/role-assignments'].get?.['x-permission']).toContain('teaching.roles.read')
    expect(document.paths['/api/classrooms/{classroomId}/role-assignments'].post?.['x-permission']).toBe('teaching.roles.manage')
    expect(document.paths['/api/classrooms/{classroomId}/role-assignments/{assignmentId}'].patch).toBeTruthy()
    expect(document.paths['/api/classrooms/{classroomId}/role-assignments/{assignmentId}'].delete).toBeTruthy()
    expect(document.paths['/api/teaching-role-assignments/effective'].get?.['x-permission']).toContain('teaching.roles.read')
    expect(document.paths['/api/class-sessions/{sessionId}/teachers'].put?.['x-permission']).toContain('teaching.roles.manage')
    expect(document.components.schemas.ClassroomRoleAssignmentMutation.required).toContain('effective_from')
  })
})
