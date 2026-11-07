import { OccurrenceReport, ReportVersion } from '@/models/OccurrenceReport'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { PageApiService } from '@/services/api/PageApiService'
import { type OrderedLesson } from '@/utils/courseProgressGaps'

export const REPORT_EDITOR_COLUMNS = 'id, enrollment_id, class_occurrence_id, lesson_id, is_completed, progress_letter, attendance_status, absence_reason, class_participation, classroom_behavior, contact_notes, contact_notes_document, class_notes, class_notes_document, content, content_document, external_link, version, last_edited_by, last_edited_at, created_at, updated_at'

function relationObject<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null
    return value ?? null
}

/** Normalize PostgREST relation names to the shape used by report list consumers. */
export function normalizeEnrollmentReportRelations(report: any): any {
    const occurrence = relationObject(report?.class_occurrence ?? report?.class_occurrences)
    const rawSession = relationObject(occurrence?.class_session ?? occurrence?.class_sessions)
    const session = rawSession
        ? {
            ...rawSession,
            classroom: relationObject(rawSession.classroom ?? rawSession.classrooms)
        }
        : null

    return {
        ...report,
        class_occurrence: occurrence ? { ...occurrence, class_session: session } : null,
        lesson: relationObject(report?.lesson ?? report?.lessons)
    }
}

export class ReportQueryService {
    static async getProgressGapsByEnrollments(
        occurrenceId: string,
        enrollmentIds: string[]
    ): Promise<Map<string, OrderedLesson[]>> {
        const uniqueEnrollmentIds = [...new Set(enrollmentIds.filter(Boolean))]
        const gapsByEnrollment = new Map<string, OrderedLesson[]>()
        if (!uniqueEnrollmentIds.length) return gapsByEnrollment

        for (let offset = 0; offset < uniqueEnrollmentIds.length; offset += 100) {
            const batch = uniqueEnrollmentIds.slice(offset, offset + 100)
            const params = new URLSearchParams({ enrollment_ids: batch.join(',') })
            const response = await apiV1Client.get<Array<{ enrollment_id: string; gaps: OrderedLesson[] }>>(
                `/occurrences/${encodeURIComponent(occurrenceId)}/report-progress-gaps?${params}`
            )
            for (const summary of response.data || []) gapsByEnrollment.set(summary.enrollment_id, summary.gaps || [])
        }
        return gapsByEnrollment
    }

    static async getEnrollmentReportProgressContext(enrollmentId: string, occurrenceId: string, reportId: string): Promise<{
        enrollment_id: string
        occurrence_date: string
        lessons: Array<{ id: string; sequence: number; title: string }>
        reports: Array<{ id: string; lesson_id: string; is_completed: boolean; progress_letter: string | null; attendance_status: string; occurrence_date: string }>
        latest_prior_report: { id: string; lesson_id: string; is_completed: boolean; progress_letter: string | null; attendance_status: string; occurrence_date: string } | null
    }> {
        const params = new URLSearchParams({ occurrence_id: occurrenceId })
        params.set('report_id', reportId)
        const response = await apiV1Client.get<any>(`/enrollments/${encodeURIComponent(enrollmentId)}/report-progress-context?${params}`)
        return response.data
    }

    private static getOccurrenceSortKey(report: any): string {
        const occurrence = Array.isArray(report?.class_occurrences)
            ? report.class_occurrences[0]
            : report?.class_occurrences
        const date = occurrence?.occurrence_date || ''
        const time = occurrence?.actual_start_time || occurrence?.original_start_time || '00:00:00'

        return `${date}T${time}`
    }

    private static sortByOccurrenceDateTime<T extends any[]>(reports: T, sortBy: 'asc' | 'desc'): T {
        const direction = sortBy === 'asc' ? 1 : -1
        return [...reports].sort((a, b) => {
            const aKey = this.getOccurrenceSortKey(a)
            const bKey = this.getOccurrenceSortKey(b)

            if (aKey === bKey) {
                const aUpdated = a?.updated_at || ''
                const bUpdated = b?.updated_at || ''
                return aUpdated.localeCompare(bUpdated) * direction
            }

            return aKey.localeCompare(bKey) * direction
        }) as T
    }

    static async getReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport | null> {
        const response = await apiV1Client.get<any[]>('/reports?enrollment_id=' + encodeURIComponent(enrollmentId) + '&class_occurrence_id=' + encodeURIComponent(occurrenceId) + '&limit=1&sort=-created_at'); return response.data?.[0] ? new OccurrenceReport(response.data[0]) : null
    }

    static async getReportVersions(reportId: string): Promise<ReportVersion[]> {
        const response = await apiResourceClient.list<any>('report-versions', {
            filters: [{ field: 'occurrence_report_id', operator: 'eq', value: reportId }],
            perPage: 200,
            sort: '-version'
        })
        return (response.data || []).map((dto: any) => new ReportVersion(dto))
    }

    static async getReportsByEnrollment(
        enrollmentId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: OccurrenceReport[], count: number }> {
        const response = await apiV1Client.get<any[]>('/reports?enrollment_id=' + encodeURIComponent(enrollmentId) + '&limit=' + perPage + '&offset=' + ((page - 1) * perPage) + '&sort=-created_at'); return { data: (response.data || []).map((row) => new OccurrenceReport(row)), count: Number((response.meta as any)?.total || 0) }
    }

    static async getAllReportsByEnrollment(enrollmentId: string): Promise<OccurrenceReport[]> {
        const pageSize = 100
        let page = 1
        const allReports: OccurrenceReport[] = []

        while (true) {
            const { data, count } = await this.getReportsByEnrollment(enrollmentId, page, pageSize)
            allReports.push(...data)

            if (data.length < pageSize || allReports.length >= (count || 0)) {
                break
            }

            page += 1
        }

        return allReports
    }

    /**
     * Batched, narrow-column report fetch for progress-summary computation
     * (roster views showing "highest lesson reached" / "latest attended
     * lesson" per student). Replaces what used to be one paginated,
     * full-row `getAllReportsByEnrollment` call per enrollment -- for a
     * 15-student roster that was 15+ requests each carrying the report's
     * three rich-text jsonb columns, none of which progress-summary logic
     * reads. One request, six narrow columns, grouped by enrollment here so
     * callers don't need to know the query shape.
     */
    static async getProgressSummaryReportsByEnrollments(
        enrollmentIds: string[]
    ): Promise<Map<string, OccurrenceReport[]>> {
        const byEnrollment = new Map<string, OccurrenceReport[]>()
        if (enrollmentIds.length === 0) return byEnrollment

        const params = new URLSearchParams({ enrollment_ids: enrollmentIds.join(','), limit: '1000', sort: '-created_at' })
        const response = await apiV1Client.get<any[]>(`/reports/progress-summary?${params}`)
        for (const row of response.data || []) {
            const report = new OccurrenceReport({
                ...row,
                content: '',
                occurrence_date: row.class_occurrences?.occurrence_date
            })
            const list = byEnrollment.get(report.enrollmentId)
            if (list) list.push(report)
            else byEnrollment.set(report.enrollmentId, [report])
        }
        return byEnrollment
    }

    static async getReportsByOccurrence(
        occurrenceId: string
    ): Promise<OccurrenceReport[]> {
        const rows: any[] = []
        const limit = 100
        for (let offset = 0; ; offset += limit) {
            const params = new URLSearchParams({
                class_occurrence_id: occurrenceId,
                limit: String(limit),
                offset: String(offset),
                sort: '-created_at',
            })
            const response = await apiV1Client.get<any[]>(`/reports?${params.toString()}`)
            const page = response.data || []
            rows.push(...page)
            const total = Number(response.meta?.total)
            if (page.length < limit || (Number.isFinite(total) && total > 0 && rows.length >= total)) break
        }
        return rows.map((row) => new OccurrenceReport(row))
    }

    static async getReportById(reportId: string): Promise<OccurrenceReport> {
        const response = await apiV1Client.get<any>('/reports/' + encodeURIComponent(reportId)); return new OccurrenceReport(response.data)
    }

    static async getReportsWithDetails(
        enrollmentId: string
    ): Promise<any[]> {
        const response = await PageApiService.getEnrollmentReports(enrollmentId, { limit: 100, offset: 0, sort: '-occurrence_date' })
        return (response.data?.reports || []).map(normalizeEnrollmentReportRelations)
    }

    static async getPendingReports(scope: 'all' | 'my_present' = 'my_present'): Promise<any[]> {
        const response = await PageApiService.getIncompleteReports({ days_back: 90, scope, limit: 100, offset: 0 })
        return (response.data || []).map((r: any) => ({
            id: r.id,
            studentName: r.studentName,
            date: r.date,
            className: r.className,
            classroom: r.classroomName,
            occurrenceId: r.occurrenceId,
            enrollmentId: r.enrollmentId,
            isMissing: false,
            reportId: r.id
        }))
    }

    static async getGlobalIncompleteReports(scope: 'all' | 'my_present' | 'my_notifications' = 'all'): Promise<any[]> {
        const response = await PageApiService.getIncompleteReports({ days_back: 90, scope, limit: 25, offset: 0, sort: '-date' })
        return response.data || []
    }

    static async getGlobalIncompleteReportsPage(
        scope: 'all' | 'my_present' | 'my_notifications' = 'all',
        query: { limit?: number; offset?: number; search?: string; sort?: 'date' | '-date' | 'updated_at' | '-updated_at' } = {},
    ) {
        return PageApiService.getIncompleteReports({ days_back: 90, scope, ...query, cache: 'no-store' })
    }

    static async getReportsByLesson(
        lessonId: string,
        params: {
            excludeReportId?: string,
            page?: number,
            pageSize?: number,
            classroomId?: string,
            sessionId?: string,
            sortBy?: 'asc' | 'desc',
            search?: string
        } = {}
    ): Promise<{ data: any[], count: number }> {
        const { page = 1, pageSize = 10, excludeReportId, classroomId, sessionId, sortBy = 'desc', search } = params

        const filters: Array<{ field: string; operator: 'eq' | 'neq' | 'ilike'; value: unknown }> = [
            { field: 'lesson_id', operator: 'eq', value: lessonId },
            { field: 'content', operator: 'neq', value: '' },
        ]
        if (excludeReportId) filters.push({ field: 'id', operator: 'neq', value: excludeReportId })
        if (classroomId) filters.push({ field: 'class_occurrences.class_sessions.classroom_id', operator: 'eq', value: classroomId })
        if (sessionId) filters.push({ field: 'class_occurrences.class_session_id', operator: 'eq', value: sessionId })
        if (search) filters.push({ field: 'content', operator: 'ilike', value: `%${search}%` })
        const response = await apiResourceClient.list<any>('reports', {
            page,
            perPage: pageSize,
            sort: `${sortBy === 'asc' ? '' : '-'}class_occurrences(occurrence_date)`,
            filters
        })
        return { data: this.sortByOccurrenceDateTime(response.data || [], sortBy), count: Number(response.meta?.total || 0) }
    }

    static async getReportsByStudent(
        studentId: string,
        params: {
            excludeReportId?: string,
            page?: number,
            pageSize?: number,
            courseId?: string,
            sortBy?: 'asc' | 'desc',
            search?: string
        } = {}
    ): Promise<{ data: any[], count: number }> {
        const { page = 1, pageSize = 10, excludeReportId, courseId, sortBy = 'desc', search } = params

        const enrollmentResponse = await apiResourceClient.list<{ id: string }>('enrollments', {
            filters: [{ field: 'student_id', operator: 'eq', value: studentId }],
            perPage: 100
        })
        const enrollmentIds = (enrollmentResponse.data || []).map((row) => row.id)
        if (!enrollmentIds.length) return { data: [], count: 0 }
        const filters: Array<{ field: string; operator: 'eq' | 'neq' | 'in' | 'ilike'; value: unknown }> = [
            { field: 'enrollment_id', operator: 'in', value: enrollmentIds },
            { field: 'content', operator: 'neq', value: '' },
        ]
        if (excludeReportId) filters.push({ field: 'id', operator: 'neq', value: excludeReportId })
        if (courseId) filters.push({ field: 'enrollments.course_id', operator: 'eq', value: courseId })
        if (search) filters.push({ field: 'content', operator: 'ilike', value: `%${search}%` })
        const response = await apiResourceClient.list<any>('reports', {
            page,
            perPage: pageSize,
            sort: `${sortBy === 'asc' ? '' : '-'}class_occurrences(occurrence_date)`,
            filters
        })
        return { data: this.sortByOccurrenceDateTime(response.data || [], sortBy), count: Number(response.meta?.total || 0) }
    }

}

