import { supabase } from '@/lib/supabase'
import { Enrollment } from '@/models/Enrollment'
import { DateUtils } from '@/utils/DateUtils'
import { OccurrenceService } from '../occurrence/OccurrenceService'
import { EnrollmentTransferQueryService, type TransferMigrationRow } from './EnrollmentTransferQueryService'
import { EnrollmentTransferToolService } from './EnrollmentTransferToolService'
import { SessionService } from '../session/SessionService'
import {
    SingleLessonTransferConflictService,
    type SingleLessonTransferConflict,
    type SingleLessonTransferResult
} from './SingleLessonTransferConflictService'
import type { TransferReportFieldSelections } from '@/services/report/ReportFieldConflictService'

export class EnrollmentTransferService {
    private static getOccurrenceInfo<T extends { class_occurrence: any }>(row: T): any {
        return Array.isArray(row.class_occurrence) ? row.class_occurrence[0] : row.class_occurrence
    }

    private static isBlankText(value: unknown): boolean {
        return value === null || value === undefined || (typeof value === 'string' && value.trim().length === 0)
    }

    private static isBlankPlaceholderReport(report: TransferMigrationRow): boolean {
        return this.isBlankText(report.content) &&
            this.isBlankText(report.progress_letter) &&
            this.isBlankText(report.absence_reason) &&
            this.isBlankText(report.contact_notes) &&
            this.isBlankText(report.class_notes) &&
            this.isBlankText(report.external_link) &&
            (report.lesson_id === null || report.lesson_id === undefined) &&
            report.is_completed === false &&
            report.attendance_status === 'pending' &&
            (report.class_participation === null || report.class_participation === undefined) &&
            (report.classroom_behavior === null || report.classroom_behavior === undefined)
    }

    private static async deleteReportVersions(reportId: string): Promise<void> {
        const { error } = await supabase
            .from('report_versions')
            .delete()
            .eq('occurrence_report_id', reportId)

        if (error) {
            throw new Error(`Failed to delete report versions: ${error.message}`)
        }
    }

    private static async deleteReport(reportId: string): Promise<void> {
        await this.deleteReportVersions(reportId)

        const { error } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('id', reportId)

        if (error) {
            throw new Error(`Failed to delete source placeholder report: ${error.message}`)
        }
    }

    private static async assertTargetDateMatchesSession(targetSessionId: string, targetDate: string): Promise<void> {
        const isScheduled = await EnrollmentTransferQueryService.isSessionScheduledOn(targetSessionId, targetDate)
        if (!isScheduled) {
            throw new Error('TARGET_DATE_NOT_CLASS_DAY')
        }
    }

    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        originalLastDate: string,
        transferDate: string
    ): Promise<Enrollment> {
        void originalLastDate

        const enrollment = await EnrollmentTransferQueryService.getEnrollmentSessionInfo(enrollmentId)
        const oldSessionId = enrollment.class_session_id

        if (!oldSessionId) {
            throw new Error('Enrollment has no current session to transfer from')
        }

        if (oldSessionId === newSessionId) {
            throw new Error('TARGET_SESSION_SAME_AS_CURRENT')
        }

        const targetSession = await SessionService.getCompatibleClassSession(newSessionId, enrollment.course_id)

        const futureReports = await EnrollmentTransferQueryService.getReportsToMigrate(
            enrollmentId,
            oldSessionId,
            transferDate
        )
        const reportsToMigrate = futureReports.filter(report => this.isBlankPlaceholderReport(report))
        const lessonCount = await EnrollmentTransferQueryService.getLessonCount(enrollment.course_id, 12)
        const occurrenceCount = Math.max(lessonCount, reportsToMigrate.length)
        const start = DateUtils.parseLocalDate(transferDate) || new Date(transferDate)
        const endDate = await SessionService.getGenerationEndDate(newSessionId, transferDate, occurrenceCount)

        await OccurrenceService.generateOccurrences(newSessionId, start, endDate).catch((err: any) => {
            console.error('Failed to generate occurrences for the new session during class transfer:', err)
        })

        const newOccurrences = await EnrollmentTransferQueryService.getTargetOccurrences(newSessionId, transferDate)

        const sortedReports = [...reportsToMigrate].sort((a, b) => {
            const dateA = new Date(this.getOccurrenceInfo(a)?.occurrence_date).getTime()
            const dateB = new Date(this.getOccurrenceInfo(b)?.occurrence_date).getTime()
            return dateA - dateB
        })

        const maxPairIndex = Math.min(sortedReports.length, newOccurrences.length)

        for (let i = 0; i < maxPairIndex; i++) {
            const report = sortedReports[i]
            const newOcc = newOccurrences[i]
            if (!report || !newOcc) continue

            const existingTargetReport = await EnrollmentTransferQueryService.getExistingReportForOccurrence(
                enrollmentId,
                newOcc.id
            )

            if (existingTargetReport) {
                await this.deleteReport(report.id)
                continue
            }

            const { error: updateReportError } = await supabase
                .from('occurrence_reports')
                .update({
                    class_occurrence_id: newOcc.id,
                    version: (report.version || 1) + 1
                })
                .eq('id', report.id)

            if (updateReportError) {
                throw new Error(`Failed to move placeholder report: ${updateReportError.message}`)
            }
        }

        const { data: updated, error: updateError } = await supabase
            .from('enrollments')
            .update({
                class_session_id: newSessionId,
                classroom_id: targetSession.classroom_id || null
            })
            .eq('id', enrollmentId)
            .select(`
                *,
                courses (subject, stage, display_name),
                classrooms (name),
                class_sessions (id, name, day_of_week, start_time, end_time, time_zone, session_type, schedule_mode, class_session_schedule_rules (*))
            `)
            .single()

        if (updateError) throw new Error(`Failed to update enrollment: ${updateError.message}`)

        await EnrollmentTransferToolService.syncSessionPair(oldSessionId, newSessionId)

        return new Enrollment(updated)
    }

    private static async commitSingleLessonTransfer(
        enrollmentId: string,
        sourceOccurrenceId: string,
        targetOccurrenceId: string,
        reportId: string | null
    ): Promise<string> {
        const { data, error } = await supabase.rpc('transfer_single_lesson', {
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
            if (error?.message?.includes('TARGET_REPORT_ALREADY_EXISTS')) {
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
            if (error?.message?.includes('TARGET_REPORT_ALREADY_EXISTS')) {
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

    /** Cancels one active single-lesson transfer and moves its report back atomically. */
    static async cancelSingleLessonTransfer(transferId: string): Promise<void> {
        const { error } = await supabase.rpc('cancel_single_lesson_transfer', {
            p_transfer_id: transferId
        })

        if (error) throw new Error(error.message)
    }
}
