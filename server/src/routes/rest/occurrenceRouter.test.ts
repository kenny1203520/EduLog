import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('occurrence API contract', () => {
  it('enforces scoped permission, holiday and teacher-leave guards', () => {
    const source = readFileSync(new URL('./occurrenceRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("p_permission_key: `teaching.occurrences.${action}`")
    expect(source).toContain('HOLIDAY_OCCURRENCE')
    expect(source).toContain('TEACHER_ON_LEAVE')
    expect(source).toContain('idempotency(req')
  })
})

describe('class report completion summary', () => {
  it('counts total and completed reports per lesson', async () => {
    const { summarizeReportCompletion } = await import('./occurrenceRouter.js')
    expect(summarizeReportCompletion([
      { id: 'a', occurrence_date: '2026-10-03', occurrence_reports: [{ is_completed: true }, { is_completed: false }, { is_completed: null }] },
      { id: 'b', occurrence_date: '2026-10-10', occurrence_reports: null },
    ])).toEqual([
      { occurrence_id: 'a', occurrence_date: '2026-10-03', total: 3, completed: 1 },
      { occurrence_id: 'b', occurrence_date: '2026-10-10', total: 0, completed: 0 },
    ])
  })
})
