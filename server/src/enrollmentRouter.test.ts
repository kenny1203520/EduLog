import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resources } from './resources.js'

describe('enrollment API contract', () => {
  it('keeps enrollment fields explicit and excludes mutation-only options', () => {
    const definition = resources.enrollments
    expect(definition.fields).toContain('time_zone')
    expect(definition.fields).toContain('koding_admission_id')
    expect(definition.fields).not.toContain('target_report_count')
    expect(definition.writable).not.toContain('user_id')
  })

  it('uses the canonical permission RPC and preserves session/course alignment', () => {
    const source = readFileSync(new URL('./enrollmentRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("rpc('has_api_permission'")
    expect(source).toContain('SESSION_COURSE_MISMATCH')
    expect(source).toContain("classroom_id: result.data.classroom_id ?? null")
    expect(source).toContain('idempotency(req')
  })
})

