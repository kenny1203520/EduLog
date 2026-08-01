import { supabase } from '@/lib/supabase'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import type { TransferReportFieldSelections } from '@/services/report/ReportFieldConflictService'
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
        const { data, error } = await supabase.rpc('resolve_single_lesson_transfer_conflict', {
            p_enrollment_id: conflict.enrollmentId,
            p_source_occurrence_id: conflict.sourceOccurrenceId,
            p_target_occurrence_id: conflict.targetOccurrenceId,
            p_source_report_id: conflict.sourceReport?.id || null,
            p_source_version: conflict.sourceReport?.version || null,
            p_target_report_id: conflict.targetReport.id,
            p_target_version: conflict.targetReport.version,
            p_field_sources: fieldSources
        })

        if (error) throw new Error(error.message)

        await EnrollmentTransferToolService.syncSessionPair(
            conflict.sourceSessionId,
            conflict.targetSessionId
        )

        return { status: 'completed', transferId: data?.transfer_id }
    }
}
