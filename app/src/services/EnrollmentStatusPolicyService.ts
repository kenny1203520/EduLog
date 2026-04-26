import { supabase } from '@/lib/supabase'
import { OccurrenceService } from './OccurrenceService'

export class EnrollmentStatusPolicyService {
    static async ensureEnrollmentReportsTarget(
        enrollmentId: string,
        sessionId: string,
        courseId: string,
        startDate: string,
        targetTotalReports?: number
    ): Promise<void> {
        if (!targetTotalReports || targetTotalReports <= 0) {
            return
        }

        const { count: existingReportCount } = await supabase
            .from('occurrence_reports')
            .select('*', { count: 'exact', head: true })
            .eq('enrollment_id', enrollmentId)

        const additionalCount = Math.max((targetTotalReports || 0) - (existingReportCount || 0), 0)
        if (additionalCount <= 0) {
            return
        }

        const normalizedStartDate = this.normalizeDateOnly(startDate)
        const today = this.normalizeDateOnly(new Date())
        const generationStartDate = normalizedStartDate < today ? today : normalizedStartDate

        await this.generateReportsForSession(
            enrollmentId,
            sessionId,
            generationStartDate,
            courseId,
            {
                targetReportCount: additionalCount,
                skipExisting: true
            }
        )
    }

    static async deleteDroppedPendingEmptyReports(enrollmentId: string): Promise<void> {
        const { data: reports, error } = await supabase
            .from('occurrence_reports')
            .select('id, is_completed, attendance_status, content, class_notes, contact_notes, progress_letter, lesson_id')
            .eq('enrollment_id', enrollmentId)
            .eq('is_completed', false)
            .eq('attendance_status', 'pending')

        if (error) {
            throw new Error(`Failed to fetch reports for dropped cleanup: ${error.message}`)
        }

        const deletableIds = (reports || [])
            .filter(report => this.isBlankText(report.content))
            .filter(report => this.isBlankText(report.class_notes))
            .filter(report => this.isBlankText(report.contact_notes))
            .filter(report => this.isBlankText(report.progress_letter))
            .filter(report => report.lesson_id === null || report.lesson_id === undefined)
            .map(report => report.id)

        if (deletableIds.length === 0) {
            return
        }

        const { error: deleteError } = await supabase
            .from('occurrence_reports')
            .delete()
            .in('id', deletableIds)

        if (deleteError) {
            throw new Error(`Failed to clean dropped enrollment reports: ${deleteError.message}`)
        }
    }

    static async generateReportsForSession(
        enrollmentId: string,
        sessionId: string,
        startDate: string,
        courseId: string,
        options: {
            targetReportCount?: number
            skipExisting?: boolean
        } = {}
    ): Promise<void> {
        const { data: lessons } = await supabase
            .from('lessons')
            .select('id')
            .eq('course_id', courseId)

        const fallbackLessonCount = (lessons && lessons.length > 0) ? lessons.length : 15
        const lessonCount = options.targetReportCount !== undefined
            ? Math.max(1, Math.floor(options.targetReportCount))
            : Math.max(1, fallbackLessonCount)

        const start = new Date(startDate)
        const endDate = new Date(start)
        endDate.setDate(endDate.getDate() + (lessonCount * 7))

        await OccurrenceService.generateOccurrences(sessionId, start, endDate).catch(() => {})

        const fetchLimit = options.skipExisting ? lessonCount * 4 : lessonCount
        const { data: occurrences } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', sessionId)
            .gte('occurrence_date', startDate)
            .order('occurrence_date', { ascending: true })
            .limit(fetchLimit)

        if (occurrences && occurrences.length > 0) {
            let targetOccurrences = occurrences.slice(0, lessonCount)

            if (options.skipExisting) {
                const occurrenceIds = occurrences
                    .map(occ => occ.id)
                    .filter((id): id is string => Boolean(id))

                if (occurrenceIds.length > 0) {
                    const { data: existingReports } = await supabase
                        .from('occurrence_reports')
                        .select('class_occurrence_id')
                        .eq('enrollment_id', enrollmentId)
                        .in('class_occurrence_id', occurrenceIds)

                    const existingOccurrenceIds = new Set((existingReports || []).map(r => r.class_occurrence_id))
                    targetOccurrences = occurrences
                        .filter(occ => !existingOccurrenceIds.has(occ.id))
                        .slice(0, lessonCount)
                }
            }

            if (targetOccurrences.length === 0) {
                return
            }

            const reports = targetOccurrences.map(occ => ({
                enrollment_id: enrollmentId,
                class_occurrence_id: occ.id,
                content: '',
                version: 1,
                is_completed: false,
                attendance_status: null
            }))

            await supabase
                .from('occurrence_reports')
                .insert(reports)
        }
    }

    private static isBlankText(value: unknown): boolean {
        if (value === null || value === undefined) return true
        if (typeof value !== 'string') return false
        return value.trim().length === 0
    }

    private static normalizeDateOnly(value: string | Date): string {
        if (value instanceof Date) {
            if (Number.isNaN(value.getTime())) {
                throw new Error('Invalid date format. Please select a valid date.')
            }
            const y = value.getFullYear()
            const m = String(value.getMonth() + 1).padStart(2, '0')
            const d = String(value.getDate()).padStart(2, '0')
            return `${y}-${m}-${d}`
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            return value
        }

        const parsed = new Date(value)
        if (Number.isNaN(parsed.getTime())) {
            throw new Error('Invalid date format. Please select a valid date.')
        }

        const y = parsed.getFullYear()
        const m = String(parsed.getMonth() + 1).padStart(2, '0')
        const d = String(parsed.getDate()).padStart(2, '0')
        return `${y}-${m}-${d}`
    }
}
