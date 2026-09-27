import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('occurrence report provisioning contract', () => {
  it('uses the regular-enrollment provisionable scope for API counts and reads', () => {
    const source = readFileSync(new URL('./domainRouter.ts', import.meta.url), 'utf8')

    expect(source).toContain("rpc('get_provisionable_occurrence_enrollment_ids'")
    expect(source).toContain("rpc('provision_occurrence_reports'")
    expect(source).not.toContain("rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })")
  })

  it('exposes a report-progress context limited to the authorized enrollment and earlier attended summaries', () => {
    const source = readFileSync(new URL('./domainRouter.ts', import.meta.url), 'utf8')

    expect(source).toContain("router.get('/enrollments/:id/report-progress-context'")
    expect(source).toContain("permission(req, 'teaching.reports.list', occurrence.data.class_session_id)")
    expect(source).toContain(".eq('attendance_status', 'present')")
    expect(source).toContain(".lt('class_occurrences.occurrence_date', occurrence.data.occurrence_date)")
    expect(source).toContain(".neq('id', query.report_id)")
    expect(source).toContain('latest_prior_report: latestPriorReport')
    expect(source).not.toContain("select('id,lesson_id,is_completed,progress_letter,attendance_status,class_occurrences!inner(occurrence_date),content")
  })
})
