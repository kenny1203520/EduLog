import { supabase } from '@/lib/supabase'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { OccurrenceService } from '../occurrence/OccurrenceService'
import { HolidayService } from '../holiday/HolidayService'
import { SuspensionService } from '../suspension/SuspensionService'
import { DateUtils } from '@/utils/DateUtils'
import { SessionService } from '../session/SessionService'

export function isFinalCompletedLesson(
    isCompleted: boolean,
    lessonId: string | null | undefined,
    finalLessonId: string | null | undefined
): boolean {
    return isCompleted && Boolean(lessonId) && lessonId === finalLessonId
}

export class ReportLifecyclePolicy {
    static async buildInitialReportPayload(enrollmentId: string, occurrenceId: string): Promise<Partial<OccurrenceReportDTO>> {
        const { data: occurrence } = await supabase
            .from('class_occurrences')
            .select(`
                occurrence_date,
                class_session_id,
                class_sessions (
                    classroom_id
                )
            `)
            .eq('id', occurrenceId)
            .single()

        const classroomId = (occurrence?.class_sessions as any)?.classroom_id
        const sessionId = occurrence?.class_session_id

        const isHoliday = occurrence
            ? await HolidayService.isHoliday(occurrence.occurrence_date, classroomId, sessionId)
            : false

        const isSuspended = occurrence
            ? await SuspensionService.isSuspended(enrollmentId, occurrence.occurrence_date)
            : false

        const payload: Partial<OccurrenceReportDTO> = {
            enrollment_id: enrollmentId,
            class_occurrence_id: occurrenceId,
            content: '',
            version: 1,
            absence_reason: isSuspended ? 'suspension' : (isHoliday ? 'holiday' : undefined),
            is_completed: false
        }

        payload.attendance_status = isHoliday || isSuspended ? 'absent' : 'pending'
        return payload
    }

    static async updateEnrollmentProgressAfterReport(
        enrollmentId: string,
        reportId: string
    ): Promise<void> {
        const { data: enrollment, error: enrollmentError } = await supabase
            .from('enrollments')
            .select('course_id, status')
            .eq('id', enrollmentId)
            .single()

        if (enrollmentError || !enrollment) return

        const { data: finalLesson } = await supabase
            .from('lessons')
            .select('id')
            .eq('course_id', enrollment.course_id)
            .order('sequence', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (finalLesson?.id) {
            const { data: completedReports, error: completionError } = await supabase
                .from('occurrence_reports')
                .select('lesson_id, is_completed')
                .eq('enrollment_id', enrollmentId)
                .eq('is_completed', true)

            const hasCompletedFinalLesson = completedReports?.some(report =>
                isFinalCompletedLesson(report.is_completed, report.lesson_id, finalLesson.id)
            )
            if (!completionError && hasCompletedFinalLesson) {
                if (enrollment.status !== 'completed') {
                    const { error: statusError } = await supabase
                        .from('enrollments')
                        .update({ status: 'completed' })
                        .eq('id', enrollmentId)
                    if (statusError) throw new Error('Failed to complete enrollment: ' + statusError.message)
                }
                return
            }
        }

        if (enrollment.status !== 'regular') return

        const { data: currentReport } = await supabase
            .from('occurrence_reports')
            .select('id, class_occurrence:class_occurrences!class_occurrence_id(id, occurrence_date, class_session_id)')
            .eq('id', reportId)
            .single()

        if (!currentReport?.class_occurrence) return

        const currentOcc = currentReport.class_occurrence as any
        const occurrenceDate = currentOcc.occurrence_date
        const { count } = await supabase
            .from('occurrence_reports')
            .select('id, class_occurrence:class_occurrences!class_occurrence_id(occurrence_date)', { count: 'exact', head: true })
            .eq('enrollment_id', enrollmentId)
            .gt('class_occurrence.occurrence_date', occurrenceDate)

        if (count && count > 0) return

        const nextDateString = await SessionService.getNextScheduledDate(
            currentOcc.class_session_id,
            occurrenceDate
        )
        if (!nextDateString) return

        const nextDate = DateUtils.parseLocalDate(nextDateString) || new Date(nextDateString)
        await OccurrenceService.generateOccurrences(currentOcc.class_session_id, nextDate, nextDate)

        const { data: nextOcc } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', currentOcc.class_session_id)
            .eq('occurrence_date', nextDateString)
            .maybeSingle()

        if (!nextOcc) return

        const nextPayload = await this.buildInitialReportPayload(enrollmentId, nextOcc.id)
        const { error: insertError } = await supabase
            .from('occurrence_reports')
            .upsert(nextPayload, {
                onConflict: 'enrollment_id,class_occurrence_id',
                ignoreDuplicates: true
            })
        if (insertError) throw new Error('Failed to create the next occurrence report: ' + insertError.message)
    }
}
