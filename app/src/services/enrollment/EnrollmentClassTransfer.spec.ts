import { describe, expect, it, vi } from 'vitest'
import { EnrollmentTransferService } from './EnrollmentTransferService'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))

vi.mock('@/services/api/ApiModeClient', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiModeClient')>(),
    getApiV1Mode: () => 'v1'
}))
vi.mock('@/services/api/ApiV1Client', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiV1Client')>(),
    apiV1Client: { post: postMock, get: vi.fn() }
}))

describe('EnrollmentTransferService.transferClass (v1)', () => {
    it('sends the effective date and returns reports that stayed in the old class', async () => {
        postMock.mockResolvedValue({
            data: { id: 'enrollment-1', class_session_id: 'session-62' },
            meta: { retained_reports: [{ report_id: 'report-1', occurrence_id: 'occurrence-1', occurrence_date: '2026-10-03' }] }
        })

        const result = await EnrollmentTransferService.transferClass('enrollment-1', 'session-62', '2026-10-02', '2026-10-03')

        expect(postMock).toHaveBeenCalledWith('/enrollments/enrollment-1/transfers/class', {
            target_class_session_id: 'session-62',
            original_last_date: '2026-10-02',
            transfer_date: '2026-10-03'
        })
        expect(result.enrollment.id).toBe('enrollment-1')
        expect(result.retainedReports).toEqual([{ reportId: 'report-1', occurrenceId: 'occurrence-1', occurrenceDate: '2026-10-03' }])
    })
})
