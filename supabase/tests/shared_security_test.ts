import { assert, assertEquals } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { toOtlpPayload } from '../volumes/functions/_shared/telemetry.ts'
import { assertJsonObject, parsePagination, ValidationError } from '../volumes/functions/_shared/validation.ts'

Deno.test('pagination rejects malformed and unsafe values', () => {
  assertEquals(parsePagination(new URLSearchParams('limit=10&offset=20')), { limit: 10, offset: 20 })
  for (const query of ['limit=0', 'limit=101', 'limit=abc', 'offset=-1', 'offset=abc']) {
    let thrown = false
    try { parsePagination(new URLSearchParams(query)) } catch (error) { thrown = error instanceof ValidationError }
    assert(thrown, `expected validation failure for ${query}`)
  }
})

Deno.test('JSON body must be an object', () => {
  let thrown = false
  try { assertJsonObject([]) } catch (error) { thrown = error instanceof ValidationError }
  assert(thrown)
  assertEquals(assertJsonObject({ name: 'ok' }), { name: 'ok' })
})

Deno.test('telemetry adapter emits signal-specific OTLP envelopes', () => {
  const attributes = { request_id: 'r', trace_id: 't', outcome: 'failure' as const }
  assert('resourceSpans' in toOtlpPayload({ signal: 'span', name: 'api.request', attributes, timestamp: 1 }))
  assert('resourceMetrics' in toOtlpPayload({ signal: 'metric', name: 'api.request.count', attributes, timestamp: 1 }))
  assert('resourceLogs' in toOtlpPayload({ signal: 'log', name: 'api.request', attributes, timestamp: 1 }))
})
