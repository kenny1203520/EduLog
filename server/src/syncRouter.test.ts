import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('occurrence reconciliation API contract', () => {
  it('keeps future/all synchronization scoped, idempotent and protective of edited data', () => {
    const source = readFileSync(new URL('./syncRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("'/class-sessions/:id/occurrences/sync'")
    expect(source).toContain("teaching.class_sessions.update")
    expect(source).toContain("scope: z.enum(['future', 'all'])")
    expect(source).toContain('protectedData')
    expect(source).toContain("onConflict: 'class_session_id,occurrence_date'")
    expect(source).toContain('idempotency(req')
  })
})
