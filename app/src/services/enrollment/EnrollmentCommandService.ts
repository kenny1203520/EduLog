import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'
import { EnrollmentTransferService, type ClassTransferResult, type SingleLessonTransferCancelResult } from './EnrollmentTransferService'
import { EnrollmentSupportService } from './EnrollmentSupportService'
import { SessionService } from '../session/SessionService'
import type { SingleLessonTransferConflict, SingleLessonTransferResult } from './SingleLessonTransferConflictService'
import type { TransferReportFieldSelections } from '@/services/report/ReportFieldConflictService'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { OccurrenceCommandService } from '@/services/occurrence/OccurrenceCommandService'
import { OccurrenceQueryService } from '@/services/occurrence/OccurrenceQueryService'
import { ReportQueryService } from '@/services/report/ReportQueryService'
import { ReportCommandService } from '@/services/report/ReportCommandService'

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

    static async create(
        enrollmentData: Partial<EnrollmentDTO>,
        options: EnrollmentCreateOptions = {}
    ): Promise<Enrollment> {
        const response = await apiV1Client.post<any>('/enrollments', { ...enrollmentData, ...(options.targetReportCount !== undefined ? { target_report_count: options.targetReportCount } : {}) })
        return new Enrollment(response.data)
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
        const response = await apiV1Client.patch<any>('/enrollments/' + encodeURIComponent(enrollmentId), { ...updates, ...(options.targetTotalReports !== undefined ? { target_total_reports: options.targetTotalReports } : {}) })
        return new Enrollment(response.data)
    }

    static async delete(enrollmentId: string): Promise<void> {
        await apiV1Client.delete('/enrollments/' + encodeURIComponent(enrollmentId)); return
    }

    static async addEnrollmentToSessionOccurrence(
        enrollmentId: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<void> {
        const normalizedTargetDate = EnrollmentSupportService.normalizeDateOnly(targetDate)

        const enrollment = (await apiV1Client.get<{ id: string; status: string } | null>('/enrollments/' + encodeURIComponent(enrollmentId))).data
        if (!enrollment) throw new Error('Failed to fetch enrollment: not found')

        const todayStr = EnrollmentSupportService.normalizeDateOnly(new Date())
        if (enrollment.status !== 'regular' && normalizedTargetDate >= todayStr) {
            throw new Error('Only regular enrollments can join a future class.')
        }

        if (!await SessionService.isScheduledOn(targetSessionId, normalizedTargetDate)) {
            throw new Error('MAKEUP_DATE_NOT_CLASS_DAY')
        }

        const target = new Date(normalizedTargetDate)
        await OccurrenceCommandService.generateOccurrences(targetSessionId, target, target).catch((err: any) => {
            console.error('Failed to generate occurrence for makeup enrollment:', err)
        })

        const targetOccurrence = await OccurrenceQueryService.getOccurrenceBySessionAndDate(targetSessionId, normalizedTargetDate)
        if (!targetOccurrence?.id) {
            throw new Error('Failed to find target occurrence: not found')
        }

        const existing = await ReportQueryService.getReport(enrollmentId, targetOccurrence.id)
        if (existing) {
            throw new Error('DUPLICATE_OCCURRENCE_REPORT')
        }

        try {
            await ReportCommandService.createReport(enrollmentId, targetOccurrence.id)
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
        transferDate: string,
        note?: string | null
    ): Promise<ClassTransferResult> {
        return EnrollmentTransferService.transferClass(
            enrollmentId,
            newSessionId,
            transferDate,
            note
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

