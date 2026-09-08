import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('report API contract', () => {
  it('uses scoped report RPCs and optimistic version checks', () => {
    const source = readFileSync(new URL('./reportRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("rpc('can_create_occurrence_report'")
    expect(source).toContain("rpc('can_access_report'")
    expect(source).toContain('expected_version')
    expect(source).toContain('VERSION_CONFLICT')
    expect(source).toContain('SYSTEM_MANAGED_REPORT')
  })
})
