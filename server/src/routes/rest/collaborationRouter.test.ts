import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('report collaboration API contract', () => {
  it('keeps snapshot access on user JWT/RLS and validates bounded writes', () => {
    const source = readFileSync(new URL('./reportRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("'/reports/:id/collaboration'")
    expect(source).toContain("'teaching.reports.read'")
    expect(source).toContain("'teaching.reports.update'")
    expect(source).toContain('max(1400000)')
    expect(source).toContain("rpc('save_report_collab_snapshot'")
    expect(source).toContain('SNAPSHOT_VERSION_CONFLICT')
  })
})
