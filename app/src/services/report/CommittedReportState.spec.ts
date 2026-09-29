import { describe, expect, it } from 'vitest'
import { shouldApplyCommittedReport } from './CommittedReportState'

const incoming = { id: 'report-1', enrollmentId: 'enrollment-1', classOccurrenceId: 'occurrence-1', version: 4 }

describe('committed report state', () => {
    it('accepts a saved report for the active enrollment and occurrence', () => {
        expect(shouldApplyCommittedReport(incoming, null, 'enrollment-1', 'occurrence-1')).toBe(true)
    })

    it('does not apply a delayed save after the active occurrence changes', () => {
        expect(shouldApplyCommittedReport(incoming, null, 'enrollment-1', 'occurrence-2')).toBe(false)
    })

    it('does not replace a newer committed report with an older response', () => {
        expect(shouldApplyCommittedReport(incoming, { ...incoming, version: 5 }, 'enrollment-1', 'occurrence-1')).toBe(false)
    })

    it('rejects a report returned for another enrollment', () => {
        expect(shouldApplyCommittedReport(incoming, null, 'enrollment-2', 'occurrence-1')).toBe(false)
    })
})
