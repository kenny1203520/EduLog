import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SingleLessonTransferConflictService, type SingleLessonTransferConflict } from './SingleLessonTransferConflictService'
import { EnrollmentTransferQueryService } from './EnrollmentTransferQueryService'
import { EnrollmentTransferToolService } from './EnrollmentTransferToolService'
import { createDefaultTransferFieldSelections } from '@/services/report/ReportFieldConflictService'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('@/services/api/ApiDataClient', () => ({ apiDataClient: { rpc: rpcMock } }))
vi.mock('./EnrollmentTransferQueryService', () => ({
    EnrollmentTransferQueryService: {
        getReportForOccurrence: vi.fn(),
        getTransferConflictDisplayContext: vi.fn()
    }
}))
vi.mock('./EnrollmentTransferToolService', () => ({
    EnrollmentTransferToolService: { syncSessionPair: vi.fn() }
}))

const sourceReport = {
    id: 'source-report', enrollment_id: 'enrollment-1', class_occurrence_id: 'source-occurrence',
    content: 'source', lesson_id: 'source-lesson', version: 3
}
const targetReport = {
    id: 'target-report', enrollment_id: 'enrollment-1', class_occurrence_id: 'target-occurrence',
    content: 'target', version: 5
}
const sourceContext = {
    occurrenceId: 'source-occurrence', occurrenceDate: '2026-08-03', sessionId: 'source-session',
    sessionName: 'Source class', lessonId: 'source-lesson', lessonSequence: 1, lessonTitle: 'Source lesson'
}
const targetContext = {
    occurrenceId: 'target-occurrence', occurrenceDate: '2026-08-05', sessionId: 'target-session',
    sessionName: 'Target class'
}

const conflict: SingleLessonTransferConflict = {
    enrollmentId: 'enrollment-1',
    sourceOccurrenceId: 'source-occurrence',
    targetOccurrenceId: 'target-occurrence',
    sourceSessionId: 'source-session',
    targetSessionId: 'target-session',
    sourceReport,
    targetReport,
    sourceContext,
    targetContext
}

describe('SingleLessonTransferConflictService', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        rpcMock.mockResolvedValue({ data: { transfer_id: 'transfer-1' }, error: null })
        vi.mocked(EnrollmentTransferToolService.syncSessionPair).mockResolvedValue()
    })

    it('loads both versioned reports into a conflict snapshot', async () => {
        vi.mocked(EnrollmentTransferQueryService.getReportForOccurrence)
            .mockResolvedValueOnce(sourceReport)
            .mockResolvedValueOnce(targetReport)
        vi.mocked(EnrollmentTransferQueryService.getTransferConflictDisplayContext)
            .mockResolvedValueOnce(sourceContext)
            .mockResolvedValueOnce(targetContext)

        const result = await SingleLessonTransferConflictService.createConflict(
            'enrollment-1', 'source-occurrence', 'target-occurrence', 'source-session', 'target-session'
        )

        expect(result).toEqual({ status: 'conflict', conflict })
    })

    it('sends versions and every field choice to the atomic resolution RPC', async () => {
        const selections = createDefaultTransferFieldSelections(sourceReport, targetReport)
        const result = await SingleLessonTransferConflictService.resolve(conflict, selections)

        expect(rpcMock).toHaveBeenCalledWith('resolve_single_lesson_transfer_conflict', {
            p_enrollment_id: 'enrollment-1',
            p_source_occurrence_id: 'source-occurrence',
            p_target_occurrence_id: 'target-occurrence',
            p_source_report_id: 'source-report',
            p_source_version: 3,
            p_target_report_id: 'target-report',
            p_target_version: 5,
            p_field_sources: selections
        })
        expect(EnrollmentTransferToolService.syncSessionPair).toHaveBeenCalledWith('source-session', 'target-session')
        expect(result).toEqual({ status: 'completed', transferId: 'transfer-1' })
    })

    it('does not sync sessions when optimistic locking rejects the merge', async () => {
        rpcMock.mockResolvedValue({ data: null, error: { message: 'TRANSFER_CONFLICT_STALE' } })

        await expect(SingleLessonTransferConflictService.resolve(
            conflict,
            createDefaultTransferFieldSelections(sourceReport, targetReport)
        )).rejects.toThrow('TRANSFER_CONFLICT_STALE')
        expect(EnrollmentTransferToolService.syncSessionPair).not.toHaveBeenCalled()
    })
})
