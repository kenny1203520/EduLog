import { apiDataClient } from '@/services/api/ApiDataClient'
import { ClassSessionFactory } from '@/models/ClassSession'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { normalizeEnrollmentReportRelations } from '@/services/report/ReportQueryService'

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

export type TransferMigrationRow = {
    id: string
    enrollment_id: string
    class_occurrence_id: string
    version?: number
    content?: string | null
    lesson_id?: string | null
    is_completed?: boolean | null
    progress_letter?: string | null
    attendance_status?: string | null
    absence_reason?: string | null
    class_participation?: number | null
    classroom_behavior?: number | null
    contact_notes?: string | null
    class_notes?: string | null
    external_link?: string | null
    class_occurrence: Array<{
        id?: string
        occurrence_date: string
        class_session_id: string
    }>
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

export interface EffectiveSingleLessonTransferTarget {
    transfer_id: string
    source_occurrence_id: string
    target_occurrence_id: string
    is_effective_target: boolean
    target_report_id: string | null
}

export class EnrollmentTransferQueryService {
    static async getSingleLessonTransferHistory(enrollmentId: string): Promise<SingleLessonTransferHistoryItem[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<SingleLessonTransferHistoryItem[]>('/enrollments/' + enrollmentId + '/transfer-history')
            return response.data || []
        }
        const { data, error } = await apiDataClient.rpc('get_single_lesson_transfer_history', {
            p_enrollment_id: enrollmentId
        })
        if (error) throw new Error(error.message)
        return (data || []) as SingleLessonTransferHistoryItem[]
    }

    static async getEffectiveSingleLessonTransferTargets(enrollmentId: string): Promise<EffectiveSingleLessonTransferTarget[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<EffectiveSingleLessonTransferTarget[]>('/enrollments/' + enrollmentId + '/effective-transfer-targets')
            return response.data || []
        }
        const { data, error } = await apiDataClient.rpc('get_effective_single_lesson_transfer_targets', {
            p_enrollment_id: enrollmentId
        })
        if (error) throw new Error(error.message)
        return (data || []) as EffectiveSingleLessonTransferTarget[]
    }

    static async repairSingleLessonTransferReport(enrollmentId: string, targetOccurrenceId: string): Promise<string> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.post<{ report_id: string }>('/enrollments/' + enrollmentId + '/repair-transfer-report', { target_occurrence_id: targetOccurrenceId })
            return response.data.report_id
        }
        const { data, error } = await apiDataClient.rpc('repair_single_lesson_transfer_report', {
            p_enrollment_id: enrollmentId,
            p_target_occurrence_id: targetOccurrenceId
        })
        if (error) throw new Error(error.message)
        return data as string
    }

    static async getEnrollmentSessionInfo(enrollmentId: string): Promise<{ class_session_id: string | null; course_id: string }> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.get<{ class_session_id: string | null; course_id: string }>('enrollments', enrollmentId, 'v1')
            return { class_session_id: response.data.class_session_id ?? null, course_id: response.data.course_id }
        }
        const { data, error } = await apiDataClient
            .from('enrollments')
            .select('class_session_id, course_id')
            .eq('id', enrollmentId)
            .single()

        if (error || !data) {
            throw new Error(`Failed to fetch enrollment: ${error?.message || 'not found'}`)
        }

        return data
    }

    static async getReportsToMigrate(
        enrollmentId: string,
        oldSessionId: string | null,
        transferDate: string
    ): Promise<TransferMigrationRow[]> {
        if (getApiV1Mode() === 'v1') {
            const filters: Array<{ field: string; operator: 'eq' | 'gte'; value: unknown }> = [
                { field: 'enrollment_id', operator: 'eq', value: enrollmentId },
                { field: 'class_occurrences.occurrence_date', operator: 'gte', value: transferDate },
            ]
            if (oldSessionId) filters.push({ field: 'class_occurrences.class_session_id', operator: 'eq', value: oldSessionId })
            const response = await apiResourceClient.list<TransferMigrationRow>('reports', { filters, perPage: 100, sort: 'class_occurrences(occurrence_date)', mode: 'v1' })
            return response.data || []
        }
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select(`
                id,
                enrollment_id,
                class_occurrence_id,
                version,
                content,
                lesson_id,
                is_completed,
                progress_letter,
                attendance_status,
                absence_reason,
                class_participation,
                classroom_behavior,
                contact_notes,
                class_notes,
                external_link,
                class_occurrence:class_occurrences!inner(id, occurrence_date, class_session_id)
            `)
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence.class_session_id', oldSessionId)
            .gte('class_occurrence.occurrence_date', transferDate)
            .order('occurrence_date', { foreignTable: 'class_occurrences', ascending: true })

        if (error) {
            throw new Error(`Failed to fetch reports for migration: ${error.message}`)
        }

        return (data || []) as TransferMigrationRow[]
    }

    static async getSingleLessonReportCandidates(
        enrollmentId: string,
        originalDate: string
    ): Promise<SingleLessonTransferReportRow[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.list<SingleLessonTransferReportRow>('reports', {
                filters: [
                    { field: 'enrollment_id', operator: 'eq', value: enrollmentId },
                    { field: 'class_occurrences.occurrence_date', operator: 'eq', value: originalDate },
                ],
                perPage: 100,
                sort: 'created_at',
                mode: 'v1'
            })
            // The relation filter only narrows the embedded occurrence, not the
            // report rows, so keep only reports whose occurrence is on that date.
            return (response.data || [])
                .map((row) => normalizeEnrollmentReportRelations(row) as SingleLessonTransferReportRow)
                .filter((row) => !Array.isArray(row.class_occurrence) && row.class_occurrence?.occurrence_date === originalDate)
        }
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select(`
                id,
                enrollment_id,
                class_occurrence_id,
                version,
                class_occurrence:class_occurrences!inner(occurrence_date, class_session_id)
            `)
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence.occurrence_date', originalDate)

        if (error) {
            throw new Error(`Failed to find original report: ${error.message}`)
        }

        return (data || []) as SingleLessonTransferReportRow[]
    }

    static async getReportTransferInfo(reportId: string): Promise<SingleLessonTransferReportRow> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.list<SingleLessonTransferReportRow>('reports', {
                filters: [{ field: 'id', operator: 'eq', value: reportId }],
                perPage: 1,
                mode: 'v1'
            })
            const report = response.data?.[0]
            if (!report) throw new Error('Failed to fetch report for transfer: not found')
            return normalizeEnrollmentReportRelations(report) as SingleLessonTransferReportRow
        }
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select(`
                id,
                enrollment_id,
                class_occurrence_id,
                version,
                class_occurrence:class_occurrences!inner(occurrence_date, class_session_id)
            `)
            .eq('id', reportId)
            .single()

        if (error || !data) {
            throw new Error(`Failed to fetch report for transfer: ${error?.message || 'not found'}`)
        }

        return data as SingleLessonTransferReportRow
    }

    static async isSessionScheduledOn(sessionId: string, date: string): Promise<boolean> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.get<any>('class-sessions', sessionId, 'v1')
            return ClassSessionFactory.create({
                ...response.data,
                schedule_rules: response.data?.schedule_rules || response.data?.class_session_schedule_rules || []
            }).isScheduledOn(date)
        }
        const { data, error } = await apiDataClient
            .from('class_sessions')
            .select('*, class_session_schedule_rules(*)')
            .eq('id', sessionId)
            .single()

        if (error || !data) {
            throw new Error(`Failed to fetch target session: ${error?.message || 'not found'}`)
        }

        return ClassSessionFactory.create({
            ...(data as any),
            schedule_rules: (data as any).class_session_schedule_rules || []
        }).isScheduledOn(date)
    }

    static async getLessonCount(courseId: string, fallbackCount: number): Promise<number> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.list<{ id: string }>('lessons', { filters: [{ field: 'course_id', operator: 'eq', value: courseId }], perPage: 100, mode: 'v1' })
            return response.data?.length || fallbackCount
        }
        const { data: lessons } = await apiDataClient
            .from('lessons')
            .select('id')
            .eq('course_id', courseId)

        return (lessons && lessons.length > 0) ? lessons.length : fallbackCount
    }

    static async getTargetOccurrences(sessionId: string, targetDate: string): Promise<Array<{ id: string }>> {
        if (getApiV1Mode() === 'v1') {
            const params = new URLSearchParams({ class_session_id: sessionId, start: targetDate, limit: '100', sort: 'occurrence_date' })
            const response = await apiV1Client.get<Array<{ id: string }>>(`/occurrences?${params}`)
            return response.data || []
        }
        const { data, error } = await apiDataClient
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', sessionId)
            .gte('occurrence_date', targetDate)
            .order('occurrence_date', { ascending: true })

        if (error) {
            throw new Error(`Failed to fetch target occurrences: ${error.message}`)
        }

        return (data || []) as Array<{ id: string }>
    }

    static async getExistingReportForOccurrence(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<{ id: string } | null> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.list<{ id: string }>('reports', {
                filters: [
                    { field: 'enrollment_id', operator: 'eq', value: enrollmentId },
                    { field: 'class_occurrence_id', operator: 'eq', value: occurrenceId },
                ],
                perPage: 1,
                mode: 'v1'
            })
            return response.data?.[0] || null
        }
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select('id')
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence_id', occurrenceId)
            .maybeSingle()

        if (error) {
            throw new Error(`Failed to check target report: ${error.message}`)
        }

        return data || null
    }

    /** Loads the complete report state required by field-level transfer conflict management. */
    static async getReportForOccurrence(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReportDTO | null> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiResourceClient.list<OccurrenceReportDTO>('reports', {
                filters: [
                    { field: 'enrollment_id', operator: 'eq', value: enrollmentId },
                    { field: 'class_occurrence_id', operator: 'eq', value: occurrenceId },
                ],
                perPage: 1,
                mode: 'v1'
            })
            return response.data?.[0] || null
        }
        const { data, error } = await apiDataClient
            .from('occurrence_reports')
            .select('*')
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence_id', occurrenceId)
            .maybeSingle()

        if (error) {
            throw new Error(`Failed to fetch report conflict data: ${error.message}`)
        }

        return (data as OccurrenceReportDTO | null) || null
    }

    /** Loads readable occurrence, session, classroom, and lesson metadata for conflict UI. */
    static async getTransferConflictDisplayContext(
        occurrenceId: string,
        lessonId?: string | null
    ): Promise<TransferConflictDisplayContext> {
        if (getApiV1Mode() === 'v1') {
            const occurrenceResponse = await apiV1Client.get<any>('/occurrences/' + encodeURIComponent(occurrenceId))
            const occurrence = occurrenceResponse.data
            const lesson = lessonId ? (await apiResourceClient.get<any>('lessons', lessonId, 'v1')).data : null
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
        const occurrenceQuery = apiDataClient
            .from('class_occurrences')
            .select(`
                id,
                occurrence_date,
                class_session_id,
                original_start_time,
                original_end_time,
                actual_start_time,
                actual_end_time,
                class_session:class_sessions!class_session_id(
                    id,
                    name,
                    start_time,
                    end_time,
                    time_zone,
                    classroom_id,
                    classroom:classrooms!classroom_id(id, name)
                )
            `)
            .eq('id', occurrenceId)
            .single()
        const lessonQuery = lessonId
            ? apiDataClient.from('lessons').select('id, title, sequence').eq('id', lessonId).maybeSingle()
            : Promise.resolve({ data: null, error: null })
        const [{ data: occurrence, error: occurrenceError }, { data: lesson, error: lessonError }] =
            await Promise.all([occurrenceQuery, lessonQuery])

        if (occurrenceError || !occurrence) {
            throw new Error(`Failed to fetch occurrence conflict context: ${occurrenceError?.message || 'not found'}`)
        }
        if (lessonError) {
            throw new Error(`Failed to fetch lesson conflict context: ${lessonError.message}`)
        }

        const session = Array.isArray((occurrence as any).class_session)
            ? (occurrence as any).class_session[0]
            : (occurrence as any).class_session
        const classroom = Array.isArray(session?.classroom)
            ? session.classroom[0]
            : session?.classroom

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
        if (getApiV1Mode() === 'v1') {
            const params = new URLSearchParams({ class_session_id: sessionId, date: targetDate, limit: '1', sort: 'occurrence_date' })
            const response = await apiV1Client.get<Array<{ id: string }>>(`/occurrences?${params}`)
            const occurrence = response.data?.[0]
            if (!occurrence?.id) throw new Error('Failed to find target occurrence: not found')
            return occurrence.id
        }
        const { data, error } = await apiDataClient
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', sessionId)
            .eq('occurrence_date', targetDate)
            .single()

        if (error || !data?.id) {
            throw new Error(`Failed to find target occurrence: ${error?.message || 'not found'}`)
        }

        return data.id
    }
}
