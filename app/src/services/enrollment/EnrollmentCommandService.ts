import { apiDataClient } from '@/services/api/ApiDataClient'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'
import { OccurrenceService } from '../occurrence/OccurrenceService'
import { OccurrenceReportService } from '../occurrence/OccurrenceReportService'
import { EnrollmentStatusPolicyService } from './EnrollmentStatusPolicyService'
import { EnrollmentTransferService, type ClassTransferResult, type SingleLessonTransferCancelResult } from './EnrollmentTransferService'
import { EnrollmentSupportService } from './EnrollmentSupportService'
import { DateUtils } from '@/utils/DateUtils'
import { SessionService } from '../session/SessionService'
import type { SingleLessonTransferConflict, SingleLessonTransferResult } from './SingleLessonTransferConflictService'
import type { TransferReportFieldSelections } from '@/services/report/ReportFieldConflictService'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

type EnrollmentCreateOptions = {
    targetReportCount?: number
}

type EnrollmentUpdateOptions = {
    targetTotalReports?: number
}

export interface EnrollmentStartDateImpact {
    createdDates: string[]
    removedDates: string[]
    /** Dates of reports with content that would fall before the new start date; they are kept. */
    reportsWithContentBeforeStart: string[]
    missingCount: number
}

export class EnrollmentCommandService {
    private static async alignSessionContext(
        enrollmentData: Partial<EnrollmentDTO>,
        fallback?: Pick<EnrollmentDTO, 'course_id' | 'class_session_id'>
    ): Promise<Partial<EnrollmentDTO>> {
        const sessionId = enrollmentData.class_session_id !== undefined
            ? enrollmentData.class_session_id
            : fallback?.class_session_id
        const courseId = enrollmentData.course_id || fallback?.course_id

        if (!sessionId) {
            return enrollmentData.class_session_id === null
                ? { ...enrollmentData, classroom_id: null }
                : enrollmentData
        }
        if (!courseId) throw new Error('COURSE_REQUIRED_FOR_SESSION')

        const session = await SessionService.getCompatibleClassSession(sessionId, courseId)
        return {
            ...enrollmentData,
            classroom_id: session.classroom_id || null
        }
    }

    static async create(
        enrollmentData: Partial<EnrollmentDTO>,
        options: EnrollmentCreateOptions = {}
    ): Promise<Enrollment> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.post<any>('/enrollments', { ...enrollmentData, ...(options.targetReportCount !== undefined ? { target_report_count: options.targetReportCount } : {}) })
            return new Enrollment(response.data)
        }
        const { data: { user } } = await apiDataClient.auth.getUser()
        if (!user) throw new Error('User not authenticated')

        const alignedEnrollmentData = await this.alignSessionContext(enrollmentData)
        const { data: enrollment, error: enrollError } = await apiDataClient
            .from('enrollments')
            .insert({
                ...alignedEnrollmentData,
                time_zone: DateUtils.isValidTimeZone(alignedEnrollmentData.time_zone)
                    ? alignedEnrollmentData.time_zone
                    : DateUtils.getDefaultTimeZone(),
                user_id: user.id,
                status: enrollmentData.status || 'regular'
            })
            .select(`
                *,
                courses (
                    subject,
                    stage,
                    display_name,
                    lessons (*)
                ),
                classrooms (name),
                class_sessions (
                    id,
                    name,
                    day_of_week,
                    start_time,
                    end_time,
                    time_zone,
                    session_type,
                    schedule_mode,
                    class_session_schedule_rules (*)
                )
            `)
            .single()

        if (enrollError) throw new Error(`Failed to create enrollment: ${enrollError.message}`)

        if (enrollment.class_session_id) {
            await EnrollmentStatusPolicyService.generateReportsForSession(
                enrollment.id!,
                enrollment.class_session_id,
                enrollment.start_date || DateUtils.todayString(),
                enrollment.course_id,
                {
                    targetReportCount: options.targetReportCount
                }
            )
        }

        return new Enrollment(enrollment as EnrollmentDTO)
    }

    /** Dry run of a start-date edit: which placeholder dates move, and which reports with content fall before it. */
    static async getStartDateImpact(enrollmentId: string, startDate: string): Promise<EnrollmentStartDateImpact> {
        const response = await apiV1Client.get<any>(
            '/enrollments/' + encodeURIComponent(enrollmentId) + '/start-date-impact?start_date=' + encodeURIComponent(startDate)
        )
        const data = response.data || {}
        return {
            createdDates: data.created_dates ?? [],
            removedDates: data.removed_dates ?? [],
            reportsWithContentBeforeStart: data.fixed_before_start_dates ?? [],
            missingCount: data.missing_count ?? 0
        }
    }

    static async update(
        enrollmentId: string,
        updates: Partial<EnrollmentDTO>,
        options: EnrollmentUpdateOptions = {}
    ): Promise<Enrollment> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.patch<any>('/enrollments/' + encodeURIComponent(enrollmentId), { ...updates, ...(options.targetTotalReports !== undefined ? { target_total_reports: options.targetTotalReports } : {}) })
            return new Enrollment(response.data)
        }
        const { data: existing, error: existingError } = await apiDataClient
            .from('enrollments')
            .select('id, status, class_session_id, course_id, classroom_id, start_date, lesson_number')
            .eq('id', enrollmentId)
            .single()

        if (existingError || !existing) {
            throw new Error(`Failed to fetch enrollment before update: ${existingError?.message || 'not found'}`)
        }

        let updatePayload: Partial<EnrollmentDTO> = {
            ...updates,
            ...(updates.time_zone !== undefined
                ? { time_zone: DateUtils.isValidTimeZone(updates.time_zone) ? updates.time_zone : DateUtils.getDefaultTimeZone() }
                : {})
        }

        if (
            Object.prototype.hasOwnProperty.call(updates, 'class_session_id') ||
            Object.prototype.hasOwnProperty.call(updates, 'course_id')
        ) {
            updatePayload = await this.alignSessionContext(updatePayload, existing)
        }

        const { data: updated, error: updateError } = await apiDataClient
            .from('enrollments')
            .update(updatePayload)
            .eq('id', enrollmentId)
            .select(`
                *,
                courses (subject, stage, display_name),
                classrooms (name),
                class_sessions (id, name, day_of_week, start_time, end_time, time_zone, session_type, schedule_mode, class_session_schedule_rules (*))
            `)
            .single()

        if (updateError) throw new Error(`Failed to update enrollment: ${updateError.message}`)

        const previousStatus = existing.status
        const nextStatus = updated.status

        if (
            previousStatus !== 'regular' &&
            nextStatus === 'regular' &&
            updated.id &&
            updated.class_session_id &&
            updated.course_id
        ) {
            await EnrollmentStatusPolicyService.ensureEnrollmentReportsTarget(
                updated.id,
                updated.class_session_id,
                updated.course_id,
                updated.start_date || DateUtils.todayString(),
                options.targetTotalReports
            )
        }

        if (previousStatus !== 'dropped' && nextStatus === 'dropped' && updated.id) {
            await EnrollmentStatusPolicyService.deleteDroppedPendingEmptyReports(updated.id)
            if (updated.class_session_id) {
                await OccurrenceService.syncSessionOccurrences(updated.class_session_id, 'all').catch((err: any) => {
                    console.error('Failed to sync occurrences after enrollment status change:', err)
                })
            }
        }

        return new Enrollment(updated as EnrollmentDTO)
    }

    static async delete(enrollmentId: string): Promise<void> {
        if (getApiV1Mode() === 'v1') { await apiV1Client.delete('/enrollments/' + encodeURIComponent(enrollmentId)); return }
        const { data: enrollment } = await apiDataClient
            .from('enrollments')
            .select('class_session_id')
            .eq('id', enrollmentId)
            .single()

        const sessionId = enrollment?.class_session_id

        await EnrollmentSupportService.deleteReportsForEnrollment(enrollmentId)
        await EnrollmentSupportService.deleteSuspensionsForEnrollment(enrollmentId)

        const { error: deleteError } = await apiDataClient
            .from('enrollments')
            .delete()
            .eq('id', enrollmentId)

        if (deleteError) throw new Error(`Failed to delete enrollment: ${deleteError.message}`)

        if (sessionId) {
            await OccurrenceService.syncSessionOccurrences(sessionId, 'all').catch((err: any) => {
                console.error('Failed to sync occurrences after enrollment delete:', err)
            })
        }
    }

    static async addEnrollmentToSessionOccurrence(
        enrollmentId: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<void> {
        const normalizedTargetDate = EnrollmentSupportService.normalizeDateOnly(targetDate)

        const { data: enrollment, error: enrollmentError } = await apiDataClient
            .from('enrollments')
            .select('id, status')
            .eq('id', enrollmentId)
            .single()

        if (enrollmentError || !enrollment) {
            throw new Error(`Failed to fetch enrollment: ${enrollmentError?.message || 'not found'}`)
        }

        const todayStr = EnrollmentSupportService.normalizeDateOnly(new Date())
        if (enrollment.status !== 'regular' && normalizedTargetDate >= todayStr) {
            throw new Error('Only regular enrollments can join a future class.')
        }

        if (!await SessionService.isScheduledOn(targetSessionId, normalizedTargetDate)) {
            throw new Error('MAKEUP_DATE_NOT_CLASS_DAY')
        }

        const target = new Date(normalizedTargetDate)
        await OccurrenceService.generateOccurrences(targetSessionId, target, target).catch((err: any) => {
            console.error('Failed to generate occurrence for makeup enrollment:', err)
        })

        const targetOccurrence = await OccurrenceService.getOccurrenceBySessionAndDate(targetSessionId, normalizedTargetDate)
        if (!targetOccurrence?.id) {
            throw new Error('Failed to find target occurrence: not found')
        }

        const existing = await OccurrenceReportService.getReport(enrollmentId, targetOccurrence.id)
        if (existing) {
            throw new Error('DUPLICATE_OCCURRENCE_REPORT')
        }

        try {
            await OccurrenceReportService.createReport(enrollmentId, targetOccurrence.id)
        } catch (error: any) {
            if (error?.message?.includes('duplicate key')) {
                throw new Error('DUPLICATE_OCCURRENCE_REPORT')
            }
            throw error
        }
    }

    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        originalLastDate: string,
        transferDate: string
    ): Promise<ClassTransferResult> {
        return EnrollmentTransferService.transferClass(
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
        return EnrollmentTransferService.transferSingleLesson(
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
        return EnrollmentTransferService.transferSingleLessonReport(
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
        return EnrollmentTransferService.transferSingleLessonFromDate(
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
        return EnrollmentTransferService.resolveSingleLessonTransferConflict(conflict, fieldSources)
    }

    static async cancelSingleLessonTransfer(transferId: string): Promise<SingleLessonTransferCancelResult> {
        return EnrollmentTransferService.cancelSingleLessonTransfer(transferId)
    }


}

