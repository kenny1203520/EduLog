import { apiDataClient } from '@/services/api/ApiDataClient'
import { OccurrenceReport, ReportVersion, type OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { DateUtils } from '@/utils/DateUtils'
import { AggregateService } from '@/services/AggregateService'
import { isTeacherPresentForScope } from '@/services/report/TeacherAttendanceScope'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { PageApiService } from '@/services/api/PageApiService'
import { findCourseProgressGaps, type OrderedLesson } from '@/utils/courseProgressGaps'

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

        if (getApiV1Mode() === 'v1') {
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

        const occurrenceResult = await apiDataClient.from('class_occurrences')
            .select('id,occurrence_date')
            .eq('id', occurrenceId)
            .maybeSingle()
        if (occurrenceResult.error) throw new Error(`Failed to fetch occurrence for progress gaps: ${occurrenceResult.error.message}`)
        if (!occurrenceResult.data) throw new Error('Occurrence was not found while checking progress gaps')

        const rosterResult = await apiDataClient.rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })
        if (rosterResult.error) throw new Error(`Failed to fetch occurrence roster for progress gaps: ${rosterResult.error.message}`)
        const effectiveIds = new Set((rosterResult.data || []).map((row: any) => row.enrollment_id as string))
        const scopedEnrollmentIds = uniqueEnrollmentIds.filter((id) => effectiveIds.has(id))
        if (!scopedEnrollmentIds.length) return gapsByEnrollment

        const enrollmentResult = await apiDataClient.from('enrollments')
            .select('id,course_id')
            .in('id', scopedEnrollmentIds)
        if (enrollmentResult.error) throw new Error(`Failed to fetch enrollments for progress gaps: ${enrollmentResult.error.message}`)
        const courseIds = [...new Set((enrollmentResult.data || []).map((row: any) => row.course_id).filter(Boolean))]
        const [lessonResult, currentReportResult] = await Promise.all([
            courseIds.length
                ? apiDataClient.from('lessons').select('id,course_id,sequence,title').in('course_id', courseIds).order('sequence', { ascending: true })
                : Promise.resolve({ data: [], error: null }),
            apiDataClient.from('occurrence_reports').select('enrollment_id,lesson_id')
                .eq('class_occurrence_id', occurrenceId).in('enrollment_id', scopedEnrollmentIds)
        ])
        if (lessonResult.error) throw new Error(`Failed to fetch lessons for progress gaps: ${lessonResult.error.message}`)
        if (currentReportResult.error) throw new Error(`Failed to fetch current reports for progress gaps: ${currentReportResult.error.message}`)

        const reports: Array<{ enrollment_id: string; lesson_id: string }> = []
        for (let offset = 0; ; offset += 500) {
            const result = await apiDataClient.from('occurrence_reports')
                .select('enrollment_id,lesson_id,class_occurrences!inner(occurrence_date)')
                .in('enrollment_id', scopedEnrollmentIds)
                .eq('attendance_status', 'present')
                .not('lesson_id', 'is', null)
                .lt('class_occurrences.occurrence_date', occurrenceResult.data.occurrence_date)
                .range(offset, offset + 499)
            if (result.error) throw new Error(`Failed to fetch prior reports for progress gaps: ${result.error.message}`)
            const page = result.data || []
            reports.push(...page.filter((row: any): row is { enrollment_id: string; lesson_id: string } => Boolean(row.lesson_id)))
            if (page.length < 500) break
        }

        const lessonsByCourse = new Map<string, OrderedLesson[]>()
        for (const lesson of lessonResult.data || []) {
            const lessons = lessonsByCourse.get(lesson.course_id) || []
            lessons.push({ id: lesson.id, sequence: lesson.sequence, title: lesson.title })
            lessonsByCourse.set(lesson.course_id, lessons)
        }
        const courseByEnrollment = new Map((enrollmentResult.data || []).map((row: any) => [row.id, row.course_id]))
        const recordedByEnrollment = new Map<string, string[]>()
        for (const report of reports) {
            const recorded = recordedByEnrollment.get(report.enrollment_id) || []
            recorded.push(report.lesson_id)
            recordedByEnrollment.set(report.enrollment_id, recorded)
        }
        const selectedByEnrollment = new Map<string, string>()
        for (const report of currentReportResult.data || []) {
            if (report.lesson_id) selectedByEnrollment.set(report.enrollment_id, report.lesson_id)
        }
        for (const enrollmentId of scopedEnrollmentIds) {
            const courseId = courseByEnrollment.get(enrollmentId) as string | undefined
            gapsByEnrollment.set(enrollmentId, findCourseProgressGaps(
                courseId ? lessonsByCourse.get(courseId) || [] : [],
                recordedByEnrollment.get(enrollmentId) || [],
                selectedByEnrollment.get(enrollmentId)
            ))
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
        if (getApiV1Mode() === 'v1') { const response = await apiV1Client.get<any[]>('/reports?enrollment_id=' + encodeURIComponent(enrollmentId) + '&class_occurrence_id=' + encodeURIComponent(occurrenceId) + '&limit=1&sort=-created_at'); return response.data?.[0] ? new OccurrenceReport(response.data[0]) : null }
        const { data: existing, error } = await apiDataClient
            .from('occurrence_reports')
            .select(REPORT_EDITOR_COLUMNS)
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence_id', occurrenceId)
            .maybeSingle()

        if (error) throw new Error(`Failed to fetch report: ${error.message}`)

        return existing ? new OccurrenceReport(existing) : null
    }

    static async getReportVersions(reportId: string): Promise<ReportVersion[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.list<any>('report-versions', {
                filters: [{ field: 'occurrence_report_id', operator: 'eq', value: reportId }],
                perPage: 200,
                sort: '-version',
                mode: 'v1'
            })
            return (response.data || []).map((dto: any) => new ReportVersion(dto))
        }
        // Each row's snapshot is a full to_jsonb(OLD.*) copy of the report at
        // that point, so this has no natural per-row size cap the way a plain
        // list query does. A heavily-edited report could in principle
        // accumulate an unbounded number of versions; cap at the most recent
        // 200 as a safety ceiling rather than leaving the query fully open --
        // real usage is nowhere near this, so it isn't a visible behavior change.
        const { data, error } = await apiDataClient
            .from('report_versions')
            .select('id, occurrence_report_id, version, content, edited_by, snapshot, created_at')
            .eq('occurrence_report_id', reportId)
            .order('version', { ascending: false })
            .limit(200)

        if (error) throw new Error(`Failed to fetch versions: ${error.message}`)

        return (data || []).map((dto: any) => new ReportVersion(dto))
    }

    static async getReportsByEnrollment(
        enrollmentId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: OccurrenceReport[], count: number }> {
        if (getApiV1Mode() === 'v1') { const response = await apiV1Client.get<any[]>('/reports?enrollment_id=' + encodeURIComponent(enrollmentId) + '&limit=' + perPage + '&offset=' + ((page - 1) * perPage) + '&sort=-created_at'); return { data: (response.data || []).map((row) => new OccurrenceReport(row)), count: Number((response.meta as any)?.total || 0) } }
        const from = (page - 1) * perPage
        const to = from + perPage - 1
        // Try aggregated endpoint first to reduce multiple DB roundtrips
        try {
            const agg = await AggregateService.getReportsByEnrollmentAggregate(enrollmentId, page, perPage)
            const reports = (agg.reports || []).map((dto: any) => {
                // Ensure occurrence_date is present for model
                const occ = dto.class_occurrence || dto.class_occurrences
                const occurrenceDate = occ?.occurrence_date
                const mappedDto: OccurrenceReportDTO = {
                    ...dto,
                    occurrence_date: occurrenceDate
                }
                return new OccurrenceReport(mappedDto)
            })

            return { data: reports, count: agg.count || 0 }
        } catch (e) {
            // Fallback to previous direct query if aggregate fails
            const { data, error, count } = await apiDataClient
                .from('occurrence_reports')
                .select(`
                    *,
                    class_occurrences!class_occurrence_id (
                        occurrence_date
                    )
                `, { count: 'exact' })
                .eq('enrollment_id', enrollmentId)
                .order('created_at', { ascending: false })
                .range(from, to)

            if (error) throw new Error(error.message)

            return {
                data: (data || []).map((dto: any) => {
                    const occurrenceDate = dto.class_occurrences?.occurrence_date
                    const mappedDto: OccurrenceReportDTO = {
                        ...dto,
                        occurrence_date: occurrenceDate
                    }
                    return new OccurrenceReport(mappedDto)
                }),
                count: count || 0
            }
        }
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

        if (getApiV1Mode() === 'v1') {
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

        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select(`
                id,
                enrollment_id,
                lesson_id,
                is_completed,
                progress_letter,
                attendance_status,
                created_at,
                updated_at,
                class_occurrence:class_occurrences!class_occurrence_id(occurrence_date)
            `)
            .in('enrollment_id', enrollmentIds)

        if (error) throw new Error(`Failed to fetch progress summary reports: ${error.message}`)

        for (const row of data || []) {
            const occ = Array.isArray((row as any).class_occurrence) ? (row as any).class_occurrence[0] : (row as any).class_occurrence
            const report = new OccurrenceReport({
                ...(row as any),
                content: '',
                occurrence_date: occ?.occurrence_date
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
        if (getApiV1Mode() === 'v1') {
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
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select(REPORT_EDITOR_COLUMNS)
            .eq('class_occurrence_id', occurrenceId)
            .order('created_at', { ascending: false })

        if (error) throw new Error(error.message)

        return (data || []).map((dto: any) => new OccurrenceReport(dto))
    }

    static async getReportById(reportId: string): Promise<OccurrenceReport> {
        if (getApiV1Mode() === 'v1') { const response = await apiV1Client.get<any>('/reports/' + encodeURIComponent(reportId)); return new OccurrenceReport(response.data) }
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select(REPORT_EDITOR_COLUMNS)
            .eq('id', reportId)
            .single()

        if (error) throw new Error(error.message)

        return new OccurrenceReport(data)
    }

    static async getReportsWithDetails(
        enrollmentId: string
    ): Promise<any[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await PageApiService.getEnrollmentReports(enrollmentId, { limit: 100, offset: 0, sort: '-occurrence_date' })
            return (response.data?.reports || []).map(normalizeEnrollmentReportRelations)
        }
        // List/preview consumers (StudentReportsView, TransferModal) only ever
        // read the plain-text content/notes fields, never the *_document rich
        // text jsonb columns -- those are only needed once a single report is
        // opened for editing (a separate getReport()/getReportById() call).
        // Omitting them here is the difference between fetching plain strings
        // and fetching a whole rich-text document per field, per row.
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select(`
                id,
                enrollment_id,
                class_occurrence_id,
                lesson_id,
                is_completed,
                progress_letter,
                attendance_status,
                absence_reason,
                class_participation,
                classroom_behavior,
                contact_notes,
                class_notes,
                content,
                external_link,
                version,
                last_edited_by,
                last_edited_at,
                created_at,
                updated_at,
                class_occurrence:class_occurrences!class_occurrence_id(
                    *,
                    class_session:class_sessions!class_session_id(
                        id,
                        name,
                        day_of_week,
                        start_time,
                        end_time,
                        classroom:classrooms!classroom_id(name)
                    )
                ),
                lesson:lessons!lesson_id(id, title, sequence)
            `)
            .eq('enrollment_id', enrollmentId)
            .order('class_occurrence(occurrence_date)', { ascending: false })

        if (error) throw new Error(error.message)

        return data || []
    }

    static async getPendingReports(scope: 'all' | 'my_present' = 'my_present'): Promise<any[]> {
        if (getApiV1Mode() === 'v1') {
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
        const results = await this.fetchIncompleteReportsInternal(90, scope)
        return results.map((r: any) => ({
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
        if (getApiV1Mode() === 'v1') {
            const response = await PageApiService.getIncompleteReports({ days_back: 90, scope, limit: 25, offset: 0, sort: '-date' })
            return response.data || []
        }
        // Try aggregate endpoint first
        try {
            const agg = await AggregateService.getIncompleteReportsAggregate(90, scope)
            if (Array.isArray(agg)) return agg
        } catch (error) {
            // Notification eligibility is authoritative. Never fall back to the broader
            // attended-teacher scope when the policy-aware endpoint is unavailable.
            if (scope === 'my_notifications') throw error
        }
        if (scope === 'my_notifications') {
            throw new Error('Policy-aware incomplete report query returned an invalid response')
        }


        return this.fetchIncompleteReportsInternal(90, scope)
    }

    static async getGlobalIncompleteReportsPage(
        scope: 'all' | 'my_present' | 'my_notifications' = 'all',
        query: { limit?: number; offset?: number; search?: string; sort?: 'date' | '-date' | 'updated_at' | '-updated_at' } = {},
    ) {
        if (getApiV1Mode() === 'v1') {
            return PageApiService.getIncompleteReports({ days_back: 90, scope, ...query, cache: 'no-store' })
        }
        const data = await this.getGlobalIncompleteReports(scope)
        return { data, meta: { limit: query.limit ?? data.length, offset: query.offset ?? 0, total: data.length, sort: query.sort ?? '-date' }, request_id: '', trace_id: '' }
    }

    private static async getCurrentTeacherIdentity(): Promise<{ id: string, userId: string | null } | null> {
        const { data: { user } } = await apiDataClient.auth.getUser()
        if (!user) return null

        const { data: teacher } = await apiDataClient
            .from('teachers')
            .select('id, user_id')
            .eq('user_id', user.id)
            .maybeSingle()

        return teacher?.id ? { id: teacher.id, userId: teacher.user_id || user.id } : null
    }

    private static async fetchIncompleteReportsInternal(daysBack: number, scope: 'all' | 'my_present'): Promise<any[]> {
        const todayStr = DateUtils.todayString()
        const dateStr = DateUtils.addDaysToDateString(todayStr, -daysBack)
        const teacherIdentity = scope === 'my_present' ? await this.getCurrentTeacherIdentity() : null
        if (scope === 'my_present' && !teacherIdentity) return []

        // Fetch reports with attendance_status = 'present'
        // Join with everything needed to determine incompleteness and show details.
        // Incompleteness is decided client-side below from plain scalar fields --
        // the three rich-text jsonb columns are never read for that, so they're
        // left out here (they can add up over a 90-day, all-present-reports scan).
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select(`
                id,
                enrollment_id,
                class_occurrence_id,
                lesson_id,
                is_completed,
                progress_letter,
                attendance_status,
                absence_reason,
                class_participation,
                classroom_behavior,
                contact_notes,
                class_notes,
                content,
                external_link,
                version,
                updated_at,
                enrollments!inner (
                    id, student_id, course_id, status,
                    students (id, name)
                ),
                class_occurrences!inner (
                    id, occurrence_date, actual_start_time, actual_end_time, original_start_time, original_end_time, time_zone, is_conducted, status, teacher_ids, teacher_attendance,
                    class_sessions (
                        id, name,
                        classrooms (id, name)
                    )
                )
            `)
            .eq('attendance_status', 'present')
            .gte('class_occurrences.occurrence_date', dateStr)
            .lte('class_occurrences.occurrence_date', todayStr)

        if (error) throw new Error(`Failed to fetch incomplete reports: ${error.message}`)
        if (!data) return []

        const results: any[] = []
        for (const report of data as any[]) {
            // Check incompleteness based on user's rules:
            // 課堂秩序、課程參與、課次、進度紀錄(如果完整完成則可以省略)、學習報告 以上任一位完成則為缺失
            const hasContent = !!(report.content && report.content.trim().length > 0)
            const hasLesson = !!report.lesson_id
            const hasProgress = report.is_completed || !!(report.progress_letter && report.progress_letter.trim())
            const hasParticipation = report.class_participation != null && report.class_participation > 0
            const hasBehavior = report.classroom_behavior != null && report.classroom_behavior > 0

            const isIncomplete = !(hasContent && hasLesson && hasProgress && hasParticipation && hasBehavior)
            
            if (isIncomplete) {
                const occ = report.class_occurrences
                if (scope === 'my_present') {
                    if (!isTeacherPresentForScope({
                        teacherId: teacherIdentity?.id,
                        teacherUserId: teacherIdentity?.userId,
                        occurrenceTeacherIds: occ?.teacher_ids,
                        teacherAttendance: occ?.teacher_attendance
                    })) {
                        continue
                    }
                }

                const session = Array.isArray(occ.class_sessions) ? occ.class_sessions[0] : occ.class_sessions
                const classroom = Array.isArray(session?.classrooms) ? session.classrooms[0] : session?.classrooms
                const student = Array.isArray(report.enrollments?.students) ? report.enrollments.students[0] : report.enrollments?.students

                results.push({
                    id: report.id,
                    reportId: report.id,
                    enrollmentId: report.enrollment_id,
                    occurrenceId: report.class_occurrence_id,
                    studentName: student?.name || 'Unknown',
                    courseId: report.enrollments?.course_id,
                    className: session?.name || '-',
                    classroomName: classroom?.name || '-',
                    date: occ.occurrence_date,
                    timeZone: occ.time_zone,
                    startTime: occ.actual_start_time || occ.original_start_time || undefined,
                    endTime: occ.actual_end_time || occ.original_end_time || undefined,
                    content: report.content || '',
                    lessonId: report.lesson_id,
                    missingContent: !hasContent,
                    missingLesson: !hasLesson,
                    missingProgress: !hasProgress,
                    missingParticipation: !hasParticipation,
                    missingBehavior: !hasBehavior,
                    version: report.version,
                    attendanceStatus: report.attendance_status,
                    absenceReason: report.absence_reason,
                    classParticipation: report.class_participation,
                    classroomBehavior: report.classroom_behavior,
                    contactNotes: report.contact_notes,
                    classNotes: report.class_notes,
                    externalLink: report.external_link,
                    updatedAt: report.updated_at,
                    isCompleted: report.is_completed,
                    progressLetter: report.progress_letter,
                    fullStudent: student,
                    isMissing: false
                })
            }
        }

        return results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
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

        if (getApiV1Mode() === 'v1') {
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
                filters,
                mode: 'v1'
            })
            return { data: this.sortByOccurrenceDateTime(response.data || [], sortBy), count: Number(response.meta?.total || 0) }
        }
        const from = (page - 1) * pageSize
        const to = from + pageSize - 1

        let query = apiDataClient
            .from('occurrence_reports')
            .select(`
                id, content, is_completed, updated_at,
                progress_letter,
                contact_notes, class_notes,
                enrollments!inner (
                    students (name)
                ),
                class_occurrences!inner (
                    occurrence_date,
                    actual_start_time,
                    original_start_time,
                    class_session_id,
                    class_sessions!inner (
                        name,
                        classroom_id,
                        classrooms!inner (name)
                    )
                )
            `, { count: 'exact' })
            .eq('lesson_id', lessonId)
            .not('content', 'is', null)
            .neq('content', '')

        if (excludeReportId) {
            query = query.neq('id', excludeReportId)
        }

        if (search) {
            query = query.ilike('content', `%${search}%`)
        }

        if (classroomId) {
            query = query.eq('class_occurrences.class_sessions.classroom_id', classroomId)
        }

        if (sessionId) {
            query = query.eq('class_occurrences.class_session_id', sessionId)
        }

        const { data, error, count } = await query
            .order('class_occurrences(occurrence_date)', { ascending: sortBy === 'asc' })
            .order('class_occurrences(actual_start_time)', { ascending: sortBy === 'asc' })
            .order('class_occurrences(original_start_time)', { ascending: sortBy === 'asc' })
            .range(from, to)

        if (error) throw new Error(error.message)
        return { data: this.sortByOccurrenceDateTime(data || [], sortBy), count: count || 0 }
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

        if (getApiV1Mode() === 'v1') {
            const enrollmentResponse = await apiResourceClient.list<{ id: string }>('enrollments', {
                filters: [{ field: 'student_id', operator: 'eq', value: studentId }],
                perPage: 100,
                mode: 'v1'
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
                filters,
                mode: 'v1'
            })
            return { data: this.sortByOccurrenceDateTime(response.data || [], sortBy), count: Number(response.meta?.total || 0) }
        }
        const from = (page - 1) * pageSize
        const to = from + pageSize - 1

        const { data: enrollments } = await apiDataClient
            .from('enrollments')
            .select('id')
            .eq('student_id', studentId)

        if (!enrollments?.length) return { data: [], count: 0 }

        const enrollmentIds = enrollments.map((e: any) => e.id)

        let query = apiDataClient
            .from('occurrence_reports')
            .select(`
                id, content, is_completed, updated_at,
                progress_letter,
                contact_notes, class_notes,
                lessons (title, sequence),
                enrollments!inner (
                    courses (id, subject, display_name)
                ),
                class_occurrences!inner (
                    occurrence_date,
                    actual_start_time,
                    original_start_time,
                    class_sessions!inner (
                        name
                    )
                )
            `, { count: 'exact' })
            .in('enrollment_id', enrollmentIds)
            .not('content', 'is', null)
            .neq('content', '')

        if (excludeReportId) {
            query = query.neq('id', excludeReportId)
        }

        if (search) {
            query = query.ilike('content', `%${search}%`)
        }

        if (courseId) {
            query = query.eq('enrollments.course_id', courseId)
        }

        const { data, error, count } = await query
            .order('class_occurrences(occurrence_date)', { ascending: sortBy === 'asc' })
            .order('class_occurrences(actual_start_time)', { ascending: sortBy === 'asc' })
            .order('class_occurrences(original_start_time)', { ascending: sortBy === 'asc' })
            .range(from, to)

        if (error) throw new Error(error.message)

        return { data: this.sortByOccurrenceDateTime(data || [], sortBy), count: count || 0 }
    }

}

