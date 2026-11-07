import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import type { TransferReportFieldSelections } from '@/services/report/ReportFieldConflictService'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { EnrollmentTransferQueryService, type TransferConflictDisplayContext } from './EnrollmentTransferQueryService'
import { EnrollmentTransferToolService } from './EnrollmentTransferToolService'

export interface SingleLessonTransferConflict {
    enrollmentId: string
    sourceOccurrenceId: string
    targetOccurrenceId: string
    sourceSessionId: string
    targetSessionId: string
    sourceReport: OccurrenceReportDTO | null
    targetReport: OccurrenceReportDTO
    sourceContext: TransferConflictDisplayContext
    targetContext: TransferConflictDisplayContext
}

export type SingleLessonTransferResult =
    | { status: 'completed'; transferId?: string }
    | { status: 'conflict'; conflict: SingleLessonTransferConflict }

export class SingleLessonTransferConflictService {
    /** Builds the immutable conflict snapshot displayed to the user. */
    static async createConflict(
        enrollmentId: string,
        sourceOccurrenceId: string,
        targetOccurrenceId: string,
        sourceSessionId: string,
        targetSessionId: string
    ): Promise<SingleLessonTransferResult> {
        const [sourceReport, targetReport] = await Promise.all([
            EnrollmentTransferQueryService.getReportForOccurrence(enrollmentId, sourceOccurrenceId),
            EnrollmentTransferQueryService.getReportForOccurrence(enrollmentId, targetOccurrenceId)
        ])

        if (!targetReport) throw new Error('TRANSFER_CONFLICT_STALE')
        const [sourceContext, targetContext] = await Promise.all([
            EnrollmentTransferQueryService.getTransferConflictDisplayContext(
                sourceOccurrenceId,
                sourceReport?.lesson_id
            ),
            EnrollmentTransferQueryService.getTransferConflictDisplayContext(targetOccurrenceId, targetReport.lesson_id)
        ])

        return {
            status: 'conflict',
            conflict: {
                enrollmentId,
                sourceOccurrenceId,
                targetOccurrenceId,
                sourceSessionId,
                targetSessionId,
                sourceReport,
                targetReport,
                sourceContext,
                targetContext
            }
        }
    }

    /** Atomically applies field choices, records the transfer, and removes the source copy. */
    static async resolve(
        conflict: SingleLessonTransferConflict,
        fieldSources: TransferReportFieldSelections
    ): Promise<SingleLessonTransferResult> {
        const response = await apiV1Client.post<{ status: 'completed'; transfer_id?: string }>('/enrollment-transfers/conflicts/resolve', {
            enrollment_id: conflict.enrollmentId,
            source_occurrence_id: conflict.sourceOccurrenceId,
            target_occurrence_id: conflict.targetOccurrenceId,
            source_report_id: conflict.sourceReport?.id || null,
            source_version: conflict.sourceReport?.version || null,
            target_report_id: conflict.targetReport.id,
            target_version: conflict.targetReport.version,
            field_sources: fieldSources
        })
        await EnrollmentTransferToolService.syncSessionPair(conflict.sourceSessionId, conflict.targetSessionId)
        return { status: 'completed', transferId: response.data.transfer_id }
    }
}
