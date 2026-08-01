import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnrollmentTransferService } from './EnrollmentTransferService'
import { EnrollmentTransferQueryService } from './EnrollmentTransferQueryService'
import { EnrollmentTransferToolService } from './EnrollmentTransferToolService'
import { OccurrenceService } from '../occurrence/OccurrenceService'
import { SessionService } from '../session/SessionService'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: rpcMock } }))
vi.mock('./EnrollmentTransferQueryService', () => ({
    EnrollmentTransferQueryService: {
        getEnrollmentSessionInfo: vi.fn(),
        isSessionScheduledOn: vi.fn(),
        getTargetOccurrenceId: vi.fn(),
        getExistingReportForOccurrence: vi.fn(),
        getReportTransferInfo: vi.fn()
    }
}))
vi.mock('./EnrollmentTransferToolService', () => ({
    EnrollmentTransferToolService: { syncSessionPair: vi.fn() }
}))
vi.mock('../occurrence/OccurrenceService', () => ({
    OccurrenceService: { generateOccurrences: vi.fn() }
}))
vi.mock('../session/SessionService', () => ({
    SessionService: { getCompatibleClassSession: vi.fn() }
}))

describe('EnrollmentTransferService single-lesson transfers', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(EnrollmentTransferQueryService.getEnrollmentSessionInfo).mockResolvedValue({
            class_session_id: 'source-session',
            course_id: 'course-1'
        })
        vi.mocked(EnrollmentTransferQueryService.isSessionScheduledOn).mockResolvedValue(true)
        vi.mocked(EnrollmentTransferQueryService.getTargetOccurrenceId)
            .mockResolvedValueOnce('target-occurrence')
            .mockResolvedValueOnce('source-occurrence')
        vi.mocked(EnrollmentTransferQueryService.getExistingReportForOccurrence)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
        vi.mocked(SessionService.getCompatibleClassSession).mockResolvedValue({} as any)
        vi.mocked(OccurrenceService.generateOccurrences).mockResolvedValue([])
        vi.mocked(EnrollmentTransferToolService.syncSessionPair).mockResolvedValue()
        rpcMock.mockResolvedValue({ data: 'transfer-1', error: null })
    })

    it('records a transfer without creating a placeholder when the source report is missing', async () => {
        await EnrollmentTransferService.transferSingleLessonFromDate(
            'enrollment-1',
            '2026-08-03',
            'target-session',
            '2026-08-05',
            { createIfMissing: true }
        )

        expect(rpcMock).toHaveBeenCalledWith('transfer_single_lesson', {
            p_enrollment_id: 'enrollment-1',
            p_source_occurrence_id: 'source-occurrence',
            p_target_occurrence_id: 'target-occurrence',
            p_report_id: null
        })
        expect(EnrollmentTransferToolService.syncSessionPair)
            .toHaveBeenCalledWith('source-session', 'target-session')
    })

    it('moves the existing report through the same atomic transfer RPC', async () => {
        vi.mocked(EnrollmentTransferQueryService.getExistingReportForOccurrence)
            .mockReset()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'report-1' })

        await EnrollmentTransferService.transferSingleLessonFromDate(
            'enrollment-1',
            '2026-08-03',
            'target-session',
            '2026-08-05'
        )

        expect(rpcMock).toHaveBeenCalledWith('transfer_single_lesson', expect.objectContaining({
            p_report_id: 'report-1'
        }))
    })

    it('does not synchronize occurrences when the atomic transfer fails', async () => {
        rpcMock.mockResolvedValue({ data: null, error: { message: 'TARGET_REPORT_ALREADY_EXISTS' } })

        await expect(EnrollmentTransferService.transferSingleLessonFromDate(
            'enrollment-1',
            '2026-08-03',
            'target-session',
            '2026-08-05'
        )).rejects.toThrow('TARGET_REPORT_ALREADY_EXISTS')
        expect(EnrollmentTransferToolService.syncSessionPair).not.toHaveBeenCalled()
    })

    it('cancels a transfer through the atomic reverse RPC', async () => {
        await EnrollmentTransferService.cancelSingleLessonTransfer('transfer-1')

        expect(rpcMock).toHaveBeenCalledWith('cancel_single_lesson_transfer', {
            p_transfer_id: 'transfer-1'
        })
    })
})
