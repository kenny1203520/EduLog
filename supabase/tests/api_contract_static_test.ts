import { assert, assertEquals } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { createOpenApiDocument } from '../volumes/functions/api-v1/openapi.ts'

const functionSource = await Deno.readTextFile(new URL('../volumes/functions/api-v1/index.ts', import.meta.url))
const registrySource = await Deno.readTextFile(new URL('../volumes/functions/api-v1/resourceRegistry.ts', import.meta.url))
const sharedApiSource = await Deno.readTextFile(new URL('../volumes/functions/_shared/api.ts', import.meta.url))
const resourceServiceSource = await Deno.readTextFile(new URL('../volumes/functions/api-v1/resourceService.ts', import.meta.url))
const controllerSources = await Promise.all([
  'controllers/resourceController.ts',
  'controllers/systemController.ts',
  'controllers/teachingMembersController.ts',
].map((path) => Deno.readTextFile(new URL('../volumes/functions/api-v1/' + path, import.meta.url))))
const openapi = createOpenApiDocument() as any

Deno.test('API v1 exposes the versioned resources, aliases and member item route', () => {
  for (const route of [
    '/teachings', '/teachings/{id}', '/teachings/{id}/members', '/teachings/{id}/members/{user_id}',
    '/classrooms', '/class-sessions', '/students', '/teachers', '/enrollments', '/occurrences', '/reports',
    '/report-templates', '/holidays', '/roles', '/roles/{id}', '/permissions', '/audit-events',
  ]) assert(openapi.paths[route], `missing OpenAPI route ${route}`)
  assert(registrySource.includes("'class-sessions'"), 'missing class-sessions compatibility alias')
  assert(registrySource.includes("'report-templates'"), 'missing report-templates compatibility alias')
})

Deno.test('API v1 has allowlisted fields, typed validation and split controllers', () => {
  assert(resourceServiceSource.includes('validateWritableFields'))
  assert(resourceServiceSource.includes('validateResourceBody'))
  assert(registrySource.includes('fieldTypes'))
  assert(registrySource.includes('filterable'))
  assert(functionSource.includes('routeHandlers'))
  for (const source of [functionSource, ...controllerSources]) assert(!source.includes("select('*')"), 'wildcard selects are forbidden')
  assert(sharedApiSource.includes('assertJsonObject'))
  assert(sharedApiSource.includes('PAYLOAD_TOO_LARGE'))
})

Deno.test('OpenAPI declares common errors, correct permissions and idempotency', () => {
  for (const name of ['BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'PayloadTooLarge', 'ValidationError', 'RateLimited', 'InternalError']) {
    assert(openapi.components.responses[name], `missing OpenAPI response ${name}`)
  }
  assertEquals(openapi.paths['/roles/{id}'].patch['x-permission'], 'system.roles.manage')
  assertEquals(openapi.paths['/reports/{id}'].patch['x-permission'], 'teaching.reports.update')
  assertEquals(openapi.paths['/reports/{id}'].delete['x-permission'], 'teaching.reports.delete')
  assertEquals(openapi.paths['/permissions'].get['x-permission'], 'system.permissions.read')
  assertEquals(openapi.paths['/teachings/{id}/members/{user_id}'].patch['x-permission'], 'teaching.members.manage')
  assert(openapi.paths['/reports'].post['x-idempotency-required'])
  assertEquals(JSON.stringify(openapi).includes('Idempotency-Key'), true)
  assertEquals([functionSource, ...controllerSources].join('\n').includes('service_role'), false, 'API handler must not expose service role to clients')
})
