import { supabase } from '@/lib/supabase'
import { ClassSessionFactory } from '@/models/ClassSession'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'

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
    class_occurrence: Array<{
        occurrence_date: string
        class_session_id: string
    }>
}

export class EnrollmentTransferQueryService {
    static async getEnrollmentSessionInfo(enrollmentId: string): Promise<{ class_session_id: string | null; course_id: string }> {
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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
        const { data: lessons } = await supabase
            .from('lessons')
            .select('id')
            .eq('course_id', courseId)

        return (lessons && lessons.length > 0) ? lessons.length : fallbackCount
    }

    static async getTargetOccurrences(sessionId: string, targetDate: string): Promise<Array<{ id: string }>> {
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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
        const { data, error } = await supabase
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

    static async getTargetOccurrenceId(sessionId: string, targetDate: string): Promise<string> {
        const { data, error } = await supabase
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
