import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { OPENAPI } from '../volumes/functions/api-v1/openapi.ts'

const controller = await Deno.readTextFile(
  new URL('../volumes/functions/api-v1/controllers/systemController.ts', import.meta.url),
)

Deno.test('system endpoints expose the intended methods and canonical permissions', () => {
  for (const permission of [
    'system.permissions.read',
    'system.roles.manage',
    'system.audit.list',
  ]) {
    assertStringIncludes(controller, `requirePermission(ctx, '${permission}')`)
  }

  for (const route of [
    "path === '/permissions' && req.method === 'GET'",
    "path === '/roles' && req.method === 'GET'",
    "path === '/roles' && req.method === 'POST'",
    "path === '/audit-events' && req.method === 'GET'",
    "req.method === 'PATCH'",
    "req.method === 'DELETE'",
  ]) {
    assertStringIncludes(controller, route)
  }

  for (const action of ["action: 'create'", "action: 'update'", "action: 'delete'"]) {
    assertStringIncludes(controller, action)
  }
  assertStringIncludes(controller, 'mutationResponse(ctx, req')
})

Deno.test('OpenAPI publishes system collection and role item operations', () => {
  assert(OPENAPI.paths['/permissions']?.get)
  assert(OPENAPI.paths['/audit-events']?.get)
  assert(OPENAPI.paths['/roles']?.get)
  assert(OPENAPI.paths['/roles']?.post)
  assert(OPENAPI.paths['/roles/{id}']?.get)
  assert(OPENAPI.paths['/roles/{id}']?.patch)
  assert(OPENAPI.paths['/roles/{id}']?.delete)
  assertEquals(OPENAPI.paths['/roles/{id}']?.patch?.['x-permission'], 'system.roles.manage')
  assertEquals(OPENAPI.paths['/roles/{id}']?.delete?.['x-idempotency-required'], true)
  assertEquals(OPENAPI.paths['/permissions']?.get?.['x-permission'], 'system.permissions.read')
  assertEquals(OPENAPI.paths['/audit-events']?.get?.['x-permission'], 'system.audit.list')
})
