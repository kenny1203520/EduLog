import { setTimeout } from 'node:timers/promises'
import assert from 'node:assert/strict'

export async function readyGoTrueFixture() {
  const origin = new URL(process.env.AUTH_SMOKE_TEST_URL || 'http://127.0.0.1')
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'Use an isolated loopback GoTrue fixture')
  if (!process.env.AUTH_SMOKE_TEST_URL) {
    const port = Number(process.env.AUTH_SMOKE_TEST_PORT || 9999)
    assert.ok(Number.isInteger(port) && port > 0 && port < 65536, 'A valid GoTrue fixture port is required')
    origin.port = String(port)
  }

  const health = new URL('/health', origin)
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(health, { redirect: 'error', signal: AbortSignal.timeout(2_000) }).catch(() => undefined)
    if (response?.ok) {
      await response.body?.cancel()
      return origin
    }
    await setTimeout(1_000)
  }
  throw new Error('GoTrue fixture did not become ready')
}
