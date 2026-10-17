import { assert, assertEquals } from 'https://deno.land/std@0.177.1/testing/asserts.ts'
import { toOtlpPayload } from '../volumes/functions/_shared/telemetry.ts'

Deno.test('OTLP span preserves traceparent and has a real end timestamp', () => {
  const payload = toOtlpPayload({ signal: 'span', name: 'api.request', timestamp: 10, endTimestamp: 12, traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01', attributes: { route: '/teachings' } }) as any
  const span = payload.resourceSpans[0].scopeSpans[0].spans[0]
  assertEquals(span.startTimeUnixNano, '10000000')
  assertEquals(span.endTimeUnixNano, '12000000')
  assert(span.attributes.some((entry: any) => entry.key === 'traceparent'))
})
