import { readFileSync } from 'node:fs'
import { expect } from 'vitest'

/** Reads a REST router's source for contract assertions. */
export function routeSource(file: string): string {
  return readFileSync(new URL(`../routes/rest/${file}`, import.meta.url), 'utf8')
}

/** Report-progress reads must check report-list access and only use earlier attended reports. */
export function expectPriorAttendedReportScope(source: string) {
  expect(source).toContain("permission(req, 'teaching.reports.list', occurrence.data.class_session_id)")
  expect(source).toContain(".eq('attendance_status', 'present')")
  expect(source).toContain(".lt('class_occurrences.occurrence_date', occurrence.data.occurrence_date)")
}
