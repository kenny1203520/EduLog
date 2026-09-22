import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('occurrence report provisioning contract', () => {
  it('uses the regular-enrollment provisionable scope for API counts and reads', () => {
    const source = readFileSync(new URL('./domainRouter.ts', import.meta.url), 'utf8')

    expect(source).toContain("rpc('get_provisionable_occurrence_enrollment_ids'")
    expect(source).toContain("rpc('provision_occurrence_reports'")
    expect(source).not.toContain("rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })")
  })
})
