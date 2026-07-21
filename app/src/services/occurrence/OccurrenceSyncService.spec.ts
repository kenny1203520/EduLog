import { describe, expect, it } from 'vitest'
import { occurrenceHasProtectedData, type ExistingOccurrenceRow } from './OccurrenceSyncService'

function occurrence(overrides: Partial<ExistingOccurrenceRow> = {}): ExistingOccurrenceRow {
    return {
        id: 'occurrence-1',
        occurrence_date: '2026-08-03',
        status: 'scheduled',
        is_conducted: true,
        teacher_attendance: { 'teacher-1': true },
        occurrence_reports: [{ id: 'report-1', content: '', is_completed: false, version: 1 }],
        ...overrides
    }
}

describe('occurrence schedule reconciliation protection', () => {
    it('allows untouched generated placeholders to be reconciled', () => {
        expect(occurrenceHasProtectedData(occurrence())).toBe(false)
        expect(occurrenceHasProtectedData(occurrence({
            occurrence_reports: [{ id: 'report-1', content: '', attendance_status: 'pending', version: 1 }]
        }))).toBe(false)
    })

    it('protects manual occurrence and attendance data', () => {
        expect(occurrenceHasProtectedData(occurrence({ notes: 'Bring project' }))).toBe(true)
        expect(occurrenceHasProtectedData(occurrence({ actual_start_time: '09:10' }))).toBe(true)
        expect(occurrenceHasProtectedData(occurrence({ teacher_attendance: { 'teacher-1': false } }))).toBe(true)
    })

    it('protects reports that contain user state', () => {
        expect(occurrenceHasProtectedData(occurrence({
            occurrence_reports: [{ id: 'report-1', content: 'Completed exercise', version: 2 }]
        }))).toBe(true)
        expect(occurrenceHasProtectedData(occurrence({
            occurrence_reports: [{ id: 'report-1', content: '', attendance_status: 'present' }]
        }))).toBe(true)
    })
})
