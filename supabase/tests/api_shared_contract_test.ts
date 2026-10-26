import { assert, assertEquals, assertMatch } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { ApiError, handleError, requestId, response, traceId, traceParent } from '../volumes/functions/_shared/api.ts'

Deno.test('response envelope carries request and W3C trace identifiers', async () => {
  const request = new Request('https://example.test/api-v1/health', { headers: { 'x-request-id': 'request-test', traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01' } })
  const id = requestId(request)
  const trace = traceId(request)
  assertEquals(id, 'request-test')
  assertEquals(traceParent(request), '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01')
  assertEquals(trace, '0123456789abcdef0123456789abcdef')
  const result = response({ data: { ok: true }, request_id: id }, 200, id, { 'X-Trace-Id': trace })
  assertEquals(result.status, 200)
  assertEquals((await result.json()).trace_id, trace)
  assertEquals(result.headers.get('x-request-id'), id)
})

Deno.test('request IDs longer than the accepted header limit are replaced', () => {
  const value = 'x'.repeat(129)
  const request = new Request('https://example.test/api-v1/health', { headers: { 'x-request-id': value } })
  assert(requestId(request) !== value)
})

Deno.test('204 and 304 responses have no body or JSON content type', async () => {
  const headers = {
    'Access-Control-Allow-Origin': 'https://app.example.test',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'X-Trace-Id': 'trace-test',
  }

  for (const status of [204, 304]) {
    const result = response(null, status, 'request-test', headers)
    assertEquals(result.status, status)
    assertEquals(await result.text(), '')
    assertEquals(result.headers.get('content-type'), null)
    assertEquals(result.headers.get('access-control-allow-origin'), 'https://app.example.test')
    assertEquals(result.headers.get('access-control-allow-methods'), 'GET,POST,OPTIONS')
    assertEquals(result.headers.get('x-request-id'), 'request-test')
    assertEquals(result.headers.get('x-trace-id'), 'trace-test')
  }
})

Deno.test('known and unknown errors use the production-safe contract', async () => {
  const known = handleError(new ApiError(422, 'VALIDATION_ERROR', 'Invalid input', { name: ['required'] }), 'r', 't')
  assertEquals(known.status, 422)
  assertEquals((await known.json()).error, { code: 'VALIDATION_ERROR', message: 'Invalid input', fields: { name: ['required'] }, request_id: 'r', trace_id: 't' })

  const unknown = handleError(new Error('database secret should not leak'), 'r2', 't2')
  assertEquals(unknown.status, 500)
  const body = await unknown.json()
  assertEquals(body.error.message, 'An unexpected error occurred')
  assertEquals(body.error.stack, undefined)
  assertMatch(body.error.code, /^[A-Z_]+$/)
  assert('database secret should not leak' !== body.error.message)
})
