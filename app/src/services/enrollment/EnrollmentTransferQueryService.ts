import { ClassSessionFactory } from '@/models/ClassSession'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { normalizeEnrollmentReportRelations } from '@/services/report/ReportQueryService'
import type { ClassTimelineData, RosterFlag } from '@/models/ClassTimeline'

export interface TransferConflictDisplayContext {
    occurrenceId: string
    occurrenceDate: string
    startTime?: string | null
    endTime?: string | null
    sessionId: string
    sessionName?: string | null
    sessionTimeZone?: string | null
    classroomId?: string | null
    classroomName?: string | null
    lessonId?: string | null
    lessonSequence?: number | null
    lessonTitle?: string | null
}

export type SingleLessonTransferReportRow = {
    id: string
    enrollment_id: string
    class_occurrence_id: string
    version?: number
    class_occurrence: TransferReportOccurrence | TransferReportOccurrence[] | null
}

type TransferReportOccurrence = {
    occurrence_date: string
    class_session_id: string
}

export interface SingleLessonTransferHistoryItem {
    id: string
    created_at: string
    cancelled_at: string | null
    course_display_name: string | null
    source_occurrence_date: string
    source_start_time: string | null
    source_end_time: string | null
    source_session_name: string | null
    source_classroom_name: string | null
    target_occurrence_date: string
    target_start_time: string | null
    target_end_time: string | null
    target_session_name: string | null
    target_classroom_name: string | null
}

/** One active single-lesson transfer into ('in') or out of ('out') an occurrence. */
export interface OccurrenceLessonTransfer {
    direction: 'in' | 'out'
    transfer_id: string
    enrollment_id: string
    student_name: string
    other_occurrence_id: string
    other_occurrence_date: string
    other_start_time: string | null
    other_end_time: string | null
    other_session_id: string
    other_session_name: string | null
    other_classroom_name: string | null
    can_cancel: boolean
}

export interface EffectiveSingleLessonTransferTarget {
    transfer_id: string
    source_occurrence_id: string
    target_occurrence_id: string
    is_effective_target: boolean
    target_report_id: string | null
}

export class EnrollmentTransferQueryService {
    static async getSingleLessonTransferHistory(enrollmentId: string): Promise<SingleLessonTransferHistoryItem[]> {
        const response = await apiV1Client.get<SingleLessonTransferHistoryItem[]>('/enrollments/' + enrollmentId + '/transfer-history')
        return response.data || []
    }

    /** Lists the active transfers into and out of one class occurrence. */
    /** Class history, transfer log, make-ups and report placements for one enrollment. */
    static async getClassTimeline(enrollmentId: string): Promise<ClassTimelineData> {
        const response = await apiV1Client.get<ClassTimelineData>('/enrollments/' + encodeURIComponent(enrollmentId) + '/class-timeline')
        return response.data
    }

    /** Students who joined or left a class by transfer on each date of a range (at most 120 days). */
    static async getClassRosterFlags(sessionId: string, start: string, end: string): Promise<RosterFlag[]> {
        const params = new URLSearchParams({ start, end })
        const response = await apiV1Client.get<RosterFlag[]>('/class-sessions/' + encodeURIComponent(sessionId) + '/roster-flags?' + params)
        return response.data || []
    }

    static async getOccurrenceLessonTransfers(occurrenceId: string): Promise<OccurrenceLessonTransfer[]> {
        const response = await apiV1Client.get<OccurrenceLessonTransfer[]>('/occurrences/' + encodeURIComponent(occurrenceId) + '/lesson-transfers')
        return response.data || []
    }

    static async getEffectiveSingleLessonTransferTargets(enrollmentId: string): Promise<EffectiveSingleLessonTransferTarget[]> {
        const response = await apiV1Client.get<EffectiveSingleLessonTransferTarget[]>('/enrollments/' + enrollmentId + '/effective-transfer-targets')
        return response.data || []
    }

    static async repairSingleLessonTransferReport(enrollmentId: string, targetOccurrenceId: string): Promise<string> {
        const response = await apiV1Client.post<{ report_id: string }>('/enrollments/' + enrollmentId + '/repair-transfer-report', { target_occurrence_id: targetOccurrenceId })
        return response.data.report_id
    }

    static async getEnrollmentSessionInfo(enrollmentId: string): Promise<{ class_session_id: string | null; course_id: string }> {
        const response = await apiResourceClient.get<{ class_session_id: string | null; course_id: string }>('enrollments', enrollmentId)
        return { class_session_id: response.data.class_session_id ?? null, course_id: response.data.course_id }
    }

    static async getSingleLessonReportCandidates(
        enrollmentId: string,
        originalDate: string
    ): Promise<SingleLessonTransferReportRow[]> {
        const response = await apiResourceClient.list<SingleLessonTransferReportRow>('reports', {
            filters: [
                { field: 'enrollment_id', operator: 'eq', value: enrollmentId },
                { field: 'class_occurrences.occurrence_date', operator: 'eq', value: originalDate },
            ],
            perPage: 100,
            sort: 'created_at'
        })
        // The relation filter only narrows the embedded occurrence, not the
        // report rows, so keep only reports whose occurrence is on that date.
        return (response.data || [])
            .map((row) => normalizeEnrollmentReportRelations(row) as SingleLessonTransferReportRow)
            .filter((row) => !Array.isArray(row.class_occurrence) && row.class_occurrence?.occurrence_date === originalDate)
    }

    static async getReportTransferInfo(reportId: string): Promise<SingleLessonTransferReportRow> {
        const response = await apiResourceClient.list<SingleLessonTransferReportRow>('reports', {
            filters: [{ field: 'id', operator: 'eq', value: reportId }],
            perPage: 1
        })
        const report = response.data?.[0]
        if (!report) throw new Error('Failed to fetch report for transfer: not found')
        return normalizeEnrollmentReportRelations(report) as SingleLessonTransferReportRow
    }

    static async isSessionScheduledOn(sessionId: string, date: string): Promise<boolean> {
        const response = await apiResourceClient.get<any>('class-sessions', sessionId)
        return ClassSessionFactory.create({
            ...response.data,
            schedule_rules: response.data?.schedule_rules || response.data?.class_session_schedule_rules || []
        }).isScheduledOn(date)
    }

    static async getExistingReportForOccurrence(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<{ id: string } | null> {
        const response = await apiResourceClient.list<{ id: string }>('reports', {
            filters: [
                { field: 'enrollment_id', operator: 'eq', value: enrollmentId },
                { field: 'class_occurrence_id', operator: 'eq', value: occurrenceId },
            ],
            perPage: 1
        })
        return response.data?.[0] || null
    }

    /** Loads the complete report state required by field-level transfer conflict management. */
    static async getReportForOccurrence(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReportDTO | null> {
        const response = await apiResourceClient.list<OccurrenceReportDTO>('reports', {
            filters: [
                { field: 'enrollment_id', operator: 'eq', value: enrollmentId },
                { field: 'class_occurrence_id', operator: 'eq', value: occurrenceId },
            ],
            perPage: 1
        })
        return response.data?.[0] || null
    }

    /** Loads readable occurrence, session, classroom, and lesson metadata for conflict UI. */
    static async getTransferConflictDisplayContext(
        occurrenceId: string,
        lessonId?: string | null
    ): Promise<TransferConflictDisplayContext> {
        const occurrenceResponse = await apiV1Client.get<any>('/occurrences/' + encodeURIComponent(occurrenceId))
        const occurrence = occurrenceResponse.data
        const lesson = lessonId ? (await apiResourceClient.get<any>('lessons', lessonId)).data : null
        if (!occurrence?.id) throw new Error('Failed to fetch occurrence conflict context: not found')
        const session = Array.isArray(occurrence.class_sessions) ? occurrence.class_sessions[0] : occurrence.class_sessions
        const classroom = Array.isArray(session?.classrooms) ? session.classrooms[0] : session?.classrooms
        return {
            occurrenceId: occurrence.id,
            occurrenceDate: occurrence.occurrence_date,
            startTime: occurrence.actual_start_time || occurrence.original_start_time || session?.start_time || null,
            endTime: occurrence.actual_end_time || occurrence.original_end_time || session?.end_time || null,
            sessionId: occurrence.class_session_id,
            sessionName: session?.name || null,
            sessionTimeZone: session?.time_zone || null,
            classroomId: session?.classroom_id || null,
            classroomName: classroom?.name || null,
            lessonId: lesson?.id || lessonId || null,
            lessonSequence: lesson?.sequence ?? null,
            lessonTitle: lesson?.title || null
        }
    }

    static async getTargetOccurrenceId(sessionId: string, targetDate: string): Promise<string> {
        const params = new URLSearchParams({ class_session_id: sessionId, date: targetDate, limit: '1', sort: 'occurrence_date' })
        const response = await apiV1Client.get<Array<{ id: string }>>(`/occurrences?${params}`)
        const occurrence = response.data?.[0]
        if (!occurrence?.id) throw new Error('Failed to find target occurrence: not found')
        return occurrence.id
    }
}
