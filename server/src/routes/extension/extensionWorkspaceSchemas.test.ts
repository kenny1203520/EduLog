import { describe, expect, it } from 'vitest'
import { reportDecisionConfirm, reportDecisionResolve } from './extensionWorkspaceRouter.js'

const row = {
  source_admission_id: '274452',
  source_report_id: '6558414',
  content_fingerprint: 'a'.repeat(64),
  context_fingerprint: 'b'.repeat(64),
  field_fingerprints: { content: 'c'.repeat(64), is_completed: 'd'.repeat(64) },
}
const base = { target_instance: 'https://edulog.example', source_origin: 'https://corp.orangeapple.co', adapter_version: 'orange-apple-v1' }

describe('report skip decision API schemas', () => {
  it('allows optional known field hashes and bounds batches to 50', () => {
    expect(reportDecisionResolve.safeParse({ ...base, items: [row] }).success).toBe(true)
    expect(reportDecisionResolve.safeParse({ ...base, items: Array(51).fill(row) }).success).toBe(false)
    expect(reportDecisionResolve.safeParse({ ...base, items: [{ ...row, field_fingerprints: { private_field: 'e'.repeat(64) } }] }).success).toBe(false)
  })

  it('requires a revision and explicit skip or clear action', () => {
    expect(reportDecisionConfirm.safeParse({ ...base, items: [{ ...row, action: 'skip', expected_revision: null }] }).success).toBe(true)
    expect(reportDecisionConfirm.safeParse({ ...base, items: [{ ...row, action: 'skip' }] }).success).toBe(false)
    expect(reportDecisionConfirm.safeParse({ ...base, items: [{ ...row, action: 'skip', expected_revision: 'not-a-uuid' }] }).success).toBe(false)
  })
})
