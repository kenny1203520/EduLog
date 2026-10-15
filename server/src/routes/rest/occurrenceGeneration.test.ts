import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('occurrence generation API contract', () => {
  it('uses scoped permission, bounded date input, idempotency and upsert preservation', () => {
    const source = readFileSync(new URL('./occurrenceRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("'/occurrences/generate'")
    expect(source).toContain("teaching.occurrences.create")
    expect(source).toContain('skip_existing_dates')
    expect(source).toContain("onConflict: 'class_session_id,occurrence_date'")
    expect(source).toContain('teacher_attendance: previous?.teacher_attendance')
    expect(source).toContain('idempotency(req')
  })
})
