import { assert, assertEquals } from 'https://deno.land/std@0.177.1/testing/asserts.ts'

const functionSource = await Deno.readTextFile(new URL('../volumes/functions/api-v1/index.ts', import.meta.url))
const registrySource = await Deno.readTextFile(new URL('../volumes/functions/api-v1/resourceRegistry.ts', import.meta.url))
const sharedApiSource = await Deno.readTextFile(new URL('../volumes/functions/_shared/api.ts', import.meta.url))
const resourceServiceSource = await Deno.readTextFile(new URL('../volumes/functions/api-v1/resourceService.ts', import.meta.url))

Deno.test('API v1 exposes the versioned resources and aliases', () => {
  for (const route of [
    '/teachings', '/teachings/{id}', '/teachings/{id}/members', '/classrooms',
    '/class-sessions', '/students', '/enrollments', '/occurrences', '/reports',
    '/report-templates', '/holidays', '/roles', '/roles/{id}', '/permissions',
    '/audit-events',
  ]) assert(functionSource.includes(`'${route}'`), `missing OpenAPI route ${route}`)
  assert(registrySource.includes("'class-sessions'"), 'missing class-sessions compatibility alias')
  assert(registrySource.includes("'report-templates'"), 'missing report-templates compatibility alias')
})

Deno.test('API v1 has allowlisted fields and shared request validation', () => {
  assert(resourceServiceSource.includes('validateWritableFields'))
  assert(functionSource.includes('parsePagination'))
  assert(functionSource.includes("select('*')") === false, 'wildcard selects are forbidden')
  assert(functionSource.includes("'Idempotency-Key'"))
  assert(sharedApiSource.includes('assertJsonObject'))
  assert(sharedApiSource.includes('PAYLOAD_TOO_LARGE'))
})

Deno.test('OpenAPI declares common errors, permissions and idempotency', () => {
  for (const status of ['400', '401', '403', '404', '409', '413', '422', '429', '500']) {
    assert(functionSource.includes(`'${status}'`), `missing OpenAPI error ${status}`)
  }
  assert(functionSource.includes("operation['x-permission']"))
  assert(functionSource.includes("operation.parameters = [...(operation.parameters ?? []), { '$ref': '#/components/parameters/IdempotencyKey' }]") )
  assertEquals(functionSource.includes('service_role'), false, 'API handler must not expose service role to clients')
})
