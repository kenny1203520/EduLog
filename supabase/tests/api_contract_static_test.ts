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
  assert(openapi.components.responses.Envelope, 'missing shared Envelope response')
  assertEquals(openapi.components.responses.Envelope.content['application/json'].schema['$ref'], '#/components/schemas/ApiEnvelope')
  for (const name of ['BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'PayloadTooLarge', 'ValidationError', 'RateLimited', 'InternalError']) {
    assert(openapi.components.responses[name], `missing OpenAPI response ${name}`)
  }
  assertEquals(openapi.paths['/roles/{id}'].patch['x-permission'], 'system.roles.manage')
  assertEquals(openapi.paths['/reports/{id}'].patch['x-permission'], 'teaching.reports.update')
  assertEquals(openapi.paths['/reports/{id}'].delete['x-permission'], 'teaching.reports.delete')
  assertEquals(openapi.paths['/permissions'].get['x-permission'], 'system.permissions.read')
  assertEquals(openapi.paths['/teachings/{id}/members/{user_id}'].patch['x-permission'], 'teaching.members.manage')
  assertEquals(openapi.paths['/teachings/{id}/members/{user_id}'].get['x-permission'], 'teaching.members.read')
  assert(openapi.paths['/teachings/{id}/members/{user_id}'].get.parameters.some((parameter: any) => parameter['$ref'] === '#/components/parameters/UserId'))
  assert(openapi.paths['/reports'].post['x-idempotency-required'])
  assertEquals(JSON.stringify(openapi).includes('Idempotency-Key'), true)
  assertEquals([functionSource, ...controllerSources].join('\n').includes('service_role'), false, 'API handler must not expose service role to clients')
})

Deno.test('OpenAPI operation ids are present and unique', () => {
  const seen = new Map<string, string>()
  for (const [path, pathItem] of Object.entries(openapi.paths) as [string, Record<string, any>][]) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'patch', 'delete', 'put', 'options', 'head', 'trace'].includes(method)) continue
      assert(typeof operation.operationId === 'string' && operation.operationId.length > 0, `missing operationId for ${method.toUpperCase()} ${path}`)
      const previous = seen.get(operation.operationId)
      assert(!previous, `duplicate operationId ${operation.operationId}: ${previous} and ${method.toUpperCase()} ${path}`)
      seen.set(operation.operationId, `${method.toUpperCase()} ${path}`)
    }
  }
  assert(openapi.paths['/class_sessions'].get.operationId !== openapi.paths['/class-sessions'].get.operationId, 'compatibility aliases must have distinct operation ids')
})

Deno.test('OpenAPI local references and path parameters resolve', () => {
  const missingReferences: string[] = []
  const resolve = (reference: string) => reference.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, openapi)
  const visit = (value: unknown, location: string) => {
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.$ref === 'string' && record.$ref.startsWith('#/') && resolve(record.$ref) === undefined) {
      missingReferences.push(`${location} -> ${record.$ref}`)
    }
    for (const [key, child] of Object.entries(record)) visit(child, `${location}/${key}`)
  }
  visit(openapi, '#')
  assertEquals(missingReferences, [])

  for (const [path, pathItem] of Object.entries(openapi.paths) as [string, Record<string, any>][]) {
    const pathParameters = new Set<string>()
    for (const segment of path.split('{').slice(1)) {
      const end = segment.indexOf('}')
      if (end > 0) pathParameters.add(segment.slice(0, end))
    }
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'patch', 'delete', 'put', 'options', 'head', 'trace'].includes(method)) continue
      const declared = new Set((operation.parameters ?? []).map((parameter: any) => parameter.$ref ? resolve(parameter.$ref) : parameter).filter((parameter: any) => parameter?.in === 'path').map((parameter: any) => parameter.name))
      for (const parameter of pathParameters) assert(declared.has(parameter), `missing path parameter ${parameter} for ${method.toUpperCase()} ${path}`)
    }
  }
})
