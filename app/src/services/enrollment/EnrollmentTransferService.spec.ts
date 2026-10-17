import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnrollmentTransferService } from './EnrollmentTransferService'
import { EnrollmentTransferQueryService } from './EnrollmentTransferQueryService'
import { EnrollmentTransferToolService } from './EnrollmentTransferToolService'
import { OccurrenceService } from '../occurrence/OccurrenceService'
import { SessionService } from '../session/SessionService'

const { rpcMock, postMock } = vi.hoisted(() => ({ rpcMock: vi.fn(), postMock: vi.fn() }))

vi.mock('@/services/api/ApiDataClient', () => ({ apiDataClient: { from: vi.fn(), rpc: rpcMock } }))
vi.mock('@/services/api/ApiV1Client', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiV1Client')>(),
    apiV1Client: { post: postMock, get: vi.fn() }
}))
vi.mock('./EnrollmentTransferQueryService', () => ({
    EnrollmentTransferQueryService: {
        getEnrollmentSessionInfo: vi.fn(),
        isSessionScheduledOn: vi.fn(),
        getTargetOccurrenceId: vi.fn(),
        getExistingReportForOccurrence: vi.fn(),
        getSingleLessonReportCandidates: vi.fn(),
        getReportForOccurrence: vi.fn(),
        getTransferConflictDisplayContext: vi.fn(),
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
            .mockReset()
            .mockResolvedValueOnce('target-occurrence')
            .mockResolvedValueOnce('source-occurrence')
        vi.mocked(EnrollmentTransferQueryService.getExistingReportForOccurrence)
            .mockReset()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
        vi.mocked(EnrollmentTransferQueryService.getSingleLessonReportCandidates).mockResolvedValue([])
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

    it('uses the unique report on a custom source date even after it was previously moved', async () => {
        vi.mocked(EnrollmentTransferQueryService.getSingleLessonReportCandidates).mockResolvedValue([{
            id: 'moved-report', enrollment_id: 'enrollment-1', class_occurrence_id: 'makeup-occurrence',
            class_occurrence: [{ occurrence_date: '2026-08-03', class_session_id: 'makeup-session' }]
        }])
        vi.mocked(EnrollmentTransferQueryService.getReportTransferInfo).mockResolvedValue({
            id: 'moved-report', enrollment_id: 'enrollment-1', class_occurrence_id: 'makeup-occurrence',
            class_occurrence: [{ occurrence_date: '2026-08-03', class_session_id: 'makeup-session' }]
        })

        await EnrollmentTransferService.transferSingleLessonFromDate(
            'enrollment-1', '2026-08-03', 'target-session', '2026-08-05'
        )

        expect(rpcMock).toHaveBeenCalledWith('transfer_single_lesson', expect.objectContaining({
            p_source_occurrence_id: 'makeup-occurrence', p_report_id: 'moved-report'
        }))
    })

    it('uses a previously transferred report occurrence as the next transfer source', async () => {
        vi.mocked(EnrollmentTransferQueryService.getReportTransferInfo).mockResolvedValue({
            id: 'report-2',
            enrollment_id: 'enrollment-1',
            class_occurrence_id: 'makeup-occurrence',
            class_occurrence: [{ occurrence_date: '2026-08-05', class_session_id: 'makeup-session' }]
        })

        await EnrollmentTransferService.transferSingleLessonReport(
            'report-2',
            'next-session',
            '2026-08-12'
        )

        expect(rpcMock).toHaveBeenCalledWith('transfer_single_lesson', {
            p_enrollment_id: 'enrollment-1',
            p_source_occurrence_id: 'makeup-occurrence',
            p_target_occurrence_id: 'target-occurrence',
            p_report_id: 'report-2'
        })
        expect(EnrollmentTransferToolService.syncSessionPair)
            .toHaveBeenCalledWith('makeup-session', 'next-session')
    })

    it('converts a concurrent target-report insert into a manageable conflict', async () => {
        rpcMock.mockResolvedValue({ data: null, error: { message: 'TARGET_REPORT_ALREADY_EXISTS' } })
        vi.mocked(EnrollmentTransferQueryService.getReportForOccurrence)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                id: 'target-report',
                enrollment_id: 'enrollment-1',
                class_occurrence_id: 'target-occurrence',
                content: 'existing target',
                version: 2
            })

        vi.mocked(EnrollmentTransferQueryService.getTransferConflictDisplayContext)
            .mockResolvedValueOnce({
                occurrenceId: 'source-occurrence', occurrenceDate: '2026-08-03', sessionId: 'source-session'
            })
            .mockResolvedValueOnce({
                occurrenceId: 'target-occurrence', occurrenceDate: '2026-08-05', sessionId: 'target-session'
            })

        const result = await EnrollmentTransferService.transferSingleLessonFromDate(
            'enrollment-1',
            '2026-08-03',
            'target-session',
            '2026-08-05'
        )

        expect(result.status).toBe('conflict')
        expect(EnrollmentTransferToolService.syncSessionPair).not.toHaveBeenCalled()
    })

    it('opens the conflict tool for v1 reports that embed class_occurrences (plural)', async () => {
        vi.mocked(EnrollmentTransferQueryService.getReportTransferInfo).mockResolvedValue({
            id: 'source-report',
            enrollment_id: 'enrollment-1',
            class_occurrence_id: 'source-occurrence',
            class_occurrences: { occurrence_date: '2026-10-03', class_session_id: 'source-session' }
        } as any)
        vi.mocked(EnrollmentTransferQueryService.getExistingReportForOccurrence)
            .mockReset()
            .mockResolvedValue({ id: 'target-report' } as any)
        vi.mocked(EnrollmentTransferQueryService.getReportForOccurrence)
            .mockResolvedValueOnce({
                id: 'source-report', enrollment_id: 'enrollment-1', class_occurrence_id: 'source-occurrence', content: 'source', version: 1
            })
            .mockResolvedValueOnce({
                id: 'target-report', enrollment_id: 'enrollment-1', class_occurrence_id: 'target-occurrence', content: 'target', version: 1
            })
        vi.mocked(EnrollmentTransferQueryService.getTransferConflictDisplayContext)
            .mockResolvedValueOnce({ occurrenceId: 'source-occurrence', occurrenceDate: '2026-10-03', sessionId: 'source-session' })
            .mockResolvedValueOnce({ occurrenceId: 'target-occurrence', occurrenceDate: '2026-10-03', sessionId: 'target-session' })

        const result = await EnrollmentTransferService.transferSingleLessonReport('source-report', 'target-session', '2026-10-03')

        expect(result.status).toBe('conflict')
        expect(rpcMock).not.toHaveBeenCalledWith('transfer_single_lesson', expect.anything())
    })

    it('cancels a transfer through the API and reports a retained target report', async () => {
        postMock.mockResolvedValue({ data: { cancelled: true, restored_report_id: 'report-1', target_report_retained: true } })

        const result = await EnrollmentTransferService.cancelSingleLessonTransfer('transfer-1')

        expect(postMock).toHaveBeenCalledWith('/enrollment-transfers/cancel', { transfer_id: 'transfer-1' })
        expect(result).toEqual({ transferId: 'transfer-1', restoredReportId: 'report-1', targetReportRetained: true })
    })
})
