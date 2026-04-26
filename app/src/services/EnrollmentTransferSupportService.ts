import { supabase } from '@/lib/supabase'

export type TransferMigrationRow = {
    id: string
    class_occurrence_id: string
    version?: number
    class_occurrence: Array<{
        occurrence_date: string
        class_session_id: string
    }>
}

export class EnrollmentTransferSupportService {
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
        originalLastDate: string
    ): Promise<TransferMigrationRow[]> {
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select(`
                id,
                class_occurrence_id,
                version,
                class_occurrence:class_occurrences!inner(occurrence_date, class_session_id)
            `)
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence.class_session_id', oldSessionId)
            .gt('class_occurrence.occurrence_date', originalLastDate)
            .order('occurrence_date', { foreignTable: 'class_occurrences', ascending: true })

        if (error) {
            throw new Error(`Failed to fetch reports for migration: ${error.message}`)
        }

        return (data || []) as TransferMigrationRow[]
    }

    static async getLessonCount(courseId: string, fallbackCount: number): Promise<number> {
        const { data: lessons } = await supabase
            .from('lessons')
            .select('id')
            .eq('course_id', courseId)

        return (lessons && lessons.length > 0) ? lessons.length : fallbackCount
    }

    static buildTransferEndDate(startDate: string, lessonCount: number): Date {
        const start = new Date(startDate)
        const endDate = new Date(start)
        endDate.setDate(endDate.getDate() + (lessonCount * 7))
        return endDate
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

    static async syncSessionPair(oldSessionId: string | null, newSessionId: string): Promise<void> {
        if (oldSessionId) {
            await import('./OccurrenceService').then(({ OccurrenceService }) =>
                OccurrenceService.syncSessionOccurrences(oldSessionId).catch(() => {})
            )
        }

        await import('./OccurrenceService').then(({ OccurrenceService }) =>
            OccurrenceService.syncSessionOccurrences(newSessionId).catch(() => {})
        )
    }
}
