import { describe, expect, it } from 'vitest'
import { buildOpenApi } from './openapi.js'

describe('RBAC API contract', () => {
  it('publishes capability and scoped policy operations in OpenAPI', () => {
    const document = buildOpenApi() as { paths: Record<string, Record<string, unknown>> }
    expect(document.paths['/api/rbac/capability'].get).toBeTruthy()
    expect(document.paths['/api/permissions/{permissionId}/policies'].get).toBeTruthy()
    expect(document.paths['/api/permissions/{permissionId}/policies'].patch).toBeTruthy()
  })
})
