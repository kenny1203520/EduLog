import { apiDataClient } from '@/services/api/ApiDataClient'
import { Enrollment } from '@/models/Enrollment'
import { DateUtils } from '@/utils/DateUtils'
import { OccurrenceService } from '../occurrence/OccurrenceService'
import { EnrollmentTransferQueryService } from './EnrollmentTransferQueryService'
import { EnrollmentTransferToolService } from './EnrollmentTransferToolService'
import { SessionService } from '../session/SessionService'
import {
    SingleLessonTransferConflictService,
    type SingleLessonTransferConflict,
    type SingleLessonTransferResult
} from './SingleLessonTransferConflictService'
import type { TransferReportFieldSelections } from '@/services/report/ReportFieldConflictService'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { hasDomainErrorCode } from '@/services/errors/mapDomainError'

export interface SingleLessonTransferCancelResult {
    transferId: string
    restoredReportId: string | null
    /** True when a conflict-tool merge was undone and the target report stayed on the target lesson. */
    targetReportRetained: boolean
}

/** A report with content that stayed in the old class after a class transfer. */
export interface RetainedClassReport {
    reportId: string
    occurrenceId: string
    occurrenceDate: string
}

export interface ClassTransferResult {
    enrollment: Enrollment
    transferId: string | null
    effectiveDate: string
    movedReports: number
    createdReports: number
    removedPlaceholders: number
    /** Reports that could not be placed because the new class has no free lesson left. */
    missingCount: number
    retainedReports: RetainedClassReport[]
}

export class EnrollmentTransferService {
    private static getOccurrenceInfo(row: { class_occurrence?: any; class_occurrences?: any }): any {
        const occurrence = row.class_occurrence ?? row.class_occurrences
        return Array.isArray(occurrence) ? occurrence[0] : occurrence
    }

    private static async assertTargetDateMatchesSession(targetSessionId: string, targetDate: string): Promise<void> {
        const isScheduled = await EnrollmentTransferQueryService.isSessionScheduledOn(targetSessionId, targetDate)
        if (!isScheduled) {
            throw new Error('TARGET_DATE_NOT_CLASS_DAY')
        }
    }

    /**
     * Moves an enrollment to another class from an effective date (inclusive).
     * The API rewrites the class history, keeps reports with content where they
     * are, moves blank placeholders, keeps the report count and logs the
     * transfer; there is no client-side fallback.
     */
    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        transferDate: string,
        note?: string | null
    ): Promise<ClassTransferResult> {
        const response = await apiV1Client.post<any>(`/enrollments/${encodeURIComponent(enrollmentId)}/transfers/class`, {
            target_class_session_id: newSessionId,
            transfer_date: transferDate,
            note: note?.trim() || null,
        })
        const meta = response.meta ?? {}
        const retained = Array.isArray(meta.retained_reports) ? meta.retained_reports as any[] : []
        return {
            enrollment: new Enrollment(response.data),
            transferId: meta.transfer_id ? String(meta.transfer_id) : null,
            effectiveDate: String(meta.transfer_date ?? transferDate),
            movedReports: Number(meta.moved_reports ?? 0),
            createdReports: Number(meta.created_reports ?? 0),
            removedPlaceholders: Number(meta.removed_placeholders ?? 0),
            missingCount: Number(meta.missing_count ?? 0),
            retainedReports: retained.map(row => ({
                reportId: String(row.report_id),
                occurrenceId: String(row.occurrence_id),
                occurrenceDate: String(row.occurrence_date)
            }))
        }
    }

    private static async commitSingleLessonTransfer(
        enrollmentId: string,
        sourceOccurrenceId: string,
        targetOccurrenceId: string,
        reportId: string | null
    ): Promise<string> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.post<{ status: string; transfer_id: string }>('/enrollment-transfers/single-lesson', { enrollment_id: enrollmentId, source_occurrence_id: sourceOccurrenceId, target_occurrence_id: targetOccurrenceId, report_id: reportId })
            return response.data.transfer_id
        }
        const { data, error } = await apiDataClient.rpc('transfer_single_lesson', {
            p_enrollment_id: enrollmentId,
            p_source_occurrence_id: sourceOccurrenceId,
            p_target_occurrence_id: targetOccurrenceId,
            p_report_id: reportId
        })

        if (error) throw new Error(error.message)
        return data as string
    }

    static async transferSingleLesson(
        enrollmentId: string,
        originalDate: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<SingleLessonTransferResult> {
        return this.transferSingleLessonFromDate(
            enrollmentId,
            originalDate,
            targetSessionId,
            targetDate
        )
    }

    static async transferSingleLessonFromDate(
        enrollmentId: string,
        originalDate: string,
        targetSessionId: string,
        targetDate: string,
        options: { createIfMissing?: boolean } = {}
    ): Promise<SingleLessonTransferResult> {
        void options
        const enrollment = await EnrollmentTransferQueryService.getEnrollmentSessionInfo(enrollmentId)
        const originalSessionId = enrollment.class_session_id

        if (!originalSessionId) {
            throw new Error('Enrollment has no current session to transfer from')
        }

        // A report may now live in a make-up session after a previous transfer.
        // Date mode should still find and move that report rather than assuming
        // the enrollment's normal class is the current source.
        const matchingReports = await EnrollmentTransferQueryService.getSingleLessonReportCandidates(
            enrollmentId,
            originalDate
        )
        if (matchingReports.length > 1) {
            throw new Error('ORIGINAL_REPORT_AMBIGUOUS')
        }
        if (matchingReports.length === 1) {
            return this.transferSingleLessonReport(
                matchingReports[0].id,
                targetSessionId,
                targetDate
            )
        }


        await SessionService.getCompatibleClassSession(targetSessionId, enrollment.course_id)

        const isOriginalDateScheduled = await EnrollmentTransferQueryService.isSessionScheduledOn(originalSessionId, originalDate)
        if (!isOriginalDateScheduled) {
            throw new Error('ORIGINAL_DATE_NOT_CLASS_DAY')
        }

        await this.assertTargetDateMatchesSession(targetSessionId, targetDate)

        const target = DateUtils.parseLocalDate(targetDate) || new Date(targetDate)
        await OccurrenceService.generateOccurrences(targetSessionId, target, target).catch((err: any) => {
            console.error('Failed to generate the target occurrence for single-lesson transfer:', err)
        })

        const targetOccId = await EnrollmentTransferQueryService.getTargetOccurrenceId(
            targetSessionId,
            targetDate
        )
        const existingTargetReport = await EnrollmentTransferQueryService.getExistingReportForOccurrence(
            enrollmentId,
            targetOccId
        )

        const original = DateUtils.parseLocalDate(originalDate) || new Date(originalDate)
        await OccurrenceService.generateOccurrences(originalSessionId, original, original).catch((err: any) => {
            console.error('Failed to generate the original occurrence for single-lesson transfer:', err)
        })

        const originalOccId = await EnrollmentTransferQueryService.getTargetOccurrenceId(
            originalSessionId,
            originalDate
        )
        const existingOriginalReport = await EnrollmentTransferQueryService.getExistingReportForOccurrence(
            enrollmentId,
            originalOccId
        )

        if (existingTargetReport) {
            return SingleLessonTransferConflictService.createConflict(
                enrollmentId,
                originalOccId,
                targetOccId,
                originalSessionId,
                targetSessionId
            )
        }

        let transferId: string
        try {
            transferId = await this.commitSingleLessonTransfer(
                enrollmentId,
                originalOccId,
                targetOccId,
                existingOriginalReport?.id || null
            )
        } catch (error: any) {
            if (hasDomainErrorCode(error, 'TARGET_REPORT_ALREADY_EXISTS')) {
                return SingleLessonTransferConflictService.createConflict(
                    enrollmentId,
                    originalOccId,
                    targetOccId,
                    originalSessionId,
                    targetSessionId
                )
            }
            throw error
        }
        await EnrollmentTransferToolService.syncSessionPair(originalSessionId, targetSessionId)
        return { status: 'completed', transferId }
    }

    static async transferSingleLessonReport(
        reportId: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<SingleLessonTransferResult> {
        await this.assertTargetDateMatchesSession(targetSessionId, targetDate)

        const report = await EnrollmentTransferQueryService.getReportTransferInfo(reportId)
        const enrollment = await EnrollmentTransferQueryService.getEnrollmentSessionInfo(report.enrollment_id)
        await SessionService.getCompatibleClassSession(targetSessionId, enrollment.course_id)
        const originalOccurrence = this.getOccurrenceInfo(report)
        const originalSessionId = originalOccurrence?.class_session_id || null

        const target = DateUtils.parseLocalDate(targetDate) || new Date(targetDate)
        await OccurrenceService.generateOccurrences(targetSessionId, target, target).catch((err: any) => {
            console.error('Failed to generate the target occurrence for single-lesson report transfer:', err)
        })

        const targetOccId = await EnrollmentTransferQueryService.getTargetOccurrenceId(
            targetSessionId,
            targetDate
        )

        if (targetOccId === report.class_occurrence_id) {
            return { status: 'completed' }
        }

        const existingTargetReport = await EnrollmentTransferQueryService.getExistingReportForOccurrence(
            report.enrollment_id,
            targetOccId
        )

        if (existingTargetReport) {
            if (!originalSessionId) throw new Error('ORIGINAL_OCCURRENCE_NOT_IN_ENROLLMENT_SESSION')
            return SingleLessonTransferConflictService.createConflict(
                report.enrollment_id,
                report.class_occurrence_id,
                targetOccId,
                originalSessionId,
                targetSessionId
            )
        }

        let transferId: string
        try {
            transferId = await this.commitSingleLessonTransfer(
                report.enrollment_id,
                report.class_occurrence_id,
                targetOccId,
                report.id
            )
        } catch (error: any) {
            if (hasDomainErrorCode(error, 'TARGET_REPORT_ALREADY_EXISTS')) {
                if (!originalSessionId) throw new Error('ORIGINAL_OCCURRENCE_NOT_IN_ENROLLMENT_SESSION')
                return SingleLessonTransferConflictService.createConflict(
                    report.enrollment_id,
                    report.class_occurrence_id,
                    targetOccId,
                    originalSessionId,
                    targetSessionId
                )
            }
            throw error
        }

        await EnrollmentTransferToolService.syncSessionPair(originalSessionId, targetSessionId)
        return { status: 'completed', transferId }
    }

    /** Resolves a target-report conflict using the user's per-field choices. */
    static async resolveSingleLessonTransferConflict(
        conflict: SingleLessonTransferConflict,
        fieldSources: TransferReportFieldSelections
    ): Promise<SingleLessonTransferResult> {
        return SingleLessonTransferConflictService.resolve(conflict, fieldSources)
    }

    /**
     * Cancels an active single-lesson transfer (and any onward transfers of the
     * same lesson) and moves the report back to the original occurrence.
     */
    static async cancelSingleLessonTransfer(transferId: string): Promise<SingleLessonTransferCancelResult> {
        const response = await apiV1Client.post<{ restored_report_id?: string | null; target_report_retained?: boolean }>(
            '/enrollment-transfers/cancel',
            { transfer_id: transferId }
        )
        return {
            transferId,
            restoredReportId: response.data?.restored_report_id ?? null,
            targetReportRetained: response.data?.target_report_retained === true
        }
    }
}
