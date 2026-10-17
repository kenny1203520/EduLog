import { type EnrollmentDTO, Enrollment } from '@/models/Enrollment'
import { EnrollmentCommandService } from './EnrollmentCommandService'
import { EnrollmentQueryService } from './EnrollmentQueryService'
import type { SingleLessonTransferConflict, SingleLessonTransferResult } from './SingleLessonTransferConflictService'
import type { TransferReportFieldSelections } from '@/services/report/ReportFieldConflictService'
import { EnrollmentTransferQueryService, type EffectiveSingleLessonTransferTarget, type OccurrenceLessonTransfer, type SingleLessonTransferHistoryItem } from './EnrollmentTransferQueryService'
import type { ClassTransferResult, SingleLessonTransferCancelResult } from './EnrollmentTransferService'
import type { EnrollmentStartDateImpact } from './EnrollmentCommandService'

type EnrollmentCreateOptions = {
    targetReportCount?: number
}

type EnrollmentUpdateOptions = {
    targetTotalReports?: number
}

/**
 * Backward-compatible facade for enrollment operations.
 * Internal responsibilities are split into command/query/status-policy services.
 */
export class EnrollmentService {
    static async getSingleLessonTransferHistory(enrollmentId: string): Promise<SingleLessonTransferHistoryItem[]> {
        return EnrollmentTransferQueryService.getSingleLessonTransferHistory(enrollmentId)
    }

    static async getOccurrenceLessonTransfers(occurrenceId: string): Promise<OccurrenceLessonTransfer[]> {
        return EnrollmentTransferQueryService.getOccurrenceLessonTransfers(occurrenceId)
    }

    static async getEffectiveSingleLessonTransferTargets(enrollmentId: string): Promise<EffectiveSingleLessonTransferTarget[]> {
        return EnrollmentTransferQueryService.getEffectiveSingleLessonTransferTargets(enrollmentId)
    }

    static async repairSingleLessonTransferReport(enrollmentId: string, targetOccurrenceId: string): Promise<string> {
        return EnrollmentTransferQueryService.repairSingleLessonTransferReport(enrollmentId, targetOccurrenceId)
    }

    static async getByStudentId(studentId: string): Promise<Enrollment[]> {
        return EnrollmentQueryService.getByStudentId(studentId)
    }

    static async create(
        enrollmentData: Partial<EnrollmentDTO>,
        options: EnrollmentCreateOptions = {}
    ): Promise<Enrollment> {
        return EnrollmentCommandService.create(enrollmentData, options)
    }

    static async getActiveEnrollmentCandidates(): Promise<Enrollment[]> {
        return EnrollmentQueryService.getActiveEnrollmentCandidates()
    }

    static async addEnrollmentToSessionOccurrence(
        enrollmentId: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<void> {
        return EnrollmentCommandService.addEnrollmentToSessionOccurrence(
            enrollmentId,
            targetSessionId,
            targetDate
        )
    }

    static async getStartDateImpact(enrollmentId: string, startDate: string): Promise<EnrollmentStartDateImpact> {
        return EnrollmentCommandService.getStartDateImpact(enrollmentId, startDate)
    }

    static async update(
        enrollmentId: string,
        updates: Partial<EnrollmentDTO>,
        options: EnrollmentUpdateOptions = {}
    ): Promise<Enrollment> {
        return EnrollmentCommandService.update(enrollmentId, updates, options)
    }

    static async delete(enrollmentId: string): Promise<void> {
        return EnrollmentCommandService.delete(enrollmentId)
    }

    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        originalLastDate: string,
        transferDate: string
    ): Promise<ClassTransferResult> {
        return EnrollmentCommandService.transferClass(
            enrollmentId,
            newSessionId,
            originalLastDate,
            transferDate
        )
    }

    static async transferSingleLesson(
        enrollmentId: string,
        originalDate: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<SingleLessonTransferResult> {
        return EnrollmentCommandService.transferSingleLesson(
            enrollmentId,
            originalDate,
            targetSessionId,
            targetDate
        )
    }

    static async transferSingleLessonReport(
        reportId: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<SingleLessonTransferResult> {
        return EnrollmentCommandService.transferSingleLessonReport(
            reportId,
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
        return EnrollmentCommandService.transferSingleLessonFromDate(
            enrollmentId,
            originalDate,
            targetSessionId,
            targetDate,
            options
        )
    }

    static async resolveSingleLessonTransferConflict(
        conflict: SingleLessonTransferConflict,
        fieldSources: TransferReportFieldSelections
    ): Promise<SingleLessonTransferResult> {
        return EnrollmentCommandService.resolveSingleLessonTransferConflict(conflict, fieldSources)
    }

    static async cancelSingleLessonTransfer(transferId: string): Promise<SingleLessonTransferCancelResult> {
        return EnrollmentCommandService.cancelSingleLessonTransfer(transferId)
    }

}
