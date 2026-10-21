import { describe, expect, it, vi } from 'vitest'
import { EnrollmentTransferService } from './EnrollmentTransferService'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))

vi.mock('@/services/api/ApiV1Client', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiV1Client')>(),
    apiV1Client: { post: postMock, get: vi.fn() }
}))

describe('EnrollmentTransferService.transferClass', () => {
    it('sends the effective date and note and returns the transfer summary', async () => {
        postMock.mockResolvedValue({
            data: { id: 'enrollment-1', class_session_id: 'session-62' },
            meta: {
                transfer_id: 'transfer-1',
                transfer_date: '2026-10-03',
                moved_reports: 2,
                created_reports: 1,
                removed_placeholders: 0,
                missing_count: 0,
                retained_reports: [{ report_id: 'report-1', occurrence_id: 'occurrence-1', occurrence_date: '2026-10-03' }]
            }
        })

        const result = await EnrollmentTransferService.transferClass('enrollment-1', 'session-62', '2026-10-03', '  Schedule change ')

        expect(postMock).toHaveBeenCalledWith('/enrollments/enrollment-1/transfers/class', {
            target_class_session_id: 'session-62',
            transfer_date: '2026-10-03',
            note: 'Schedule change'
        })
        expect(result.enrollment.id).toBe('enrollment-1')
        expect(result).toMatchObject({ transferId: 'transfer-1', effectiveDate: '2026-10-03', movedReports: 2, createdReports: 1, missingCount: 0 })
        expect(result.retainedReports).toEqual([{ reportId: 'report-1', occurrenceId: 'occurrence-1', occurrenceDate: '2026-10-03' }])
    })

    it('sends a blank note as null', async () => {
        postMock.mockResolvedValue({ data: { id: 'enrollment-1' }, meta: {} })
        await EnrollmentTransferService.transferClass('enrollment-1', 'session-62', '2026-10-03', '   ')
        expect(postMock).toHaveBeenLastCalledWith('/enrollments/enrollment-1/transfers/class', expect.objectContaining({ note: null }))
    })
})
