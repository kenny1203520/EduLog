import { supabase } from '@/lib/supabase'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { EnrollmentProgressService } from '../enrollment/EnrollmentProgressService'
import { OccurrenceService } from '../occurrence/OccurrenceService'
import { HolidayService } from '../holiday/HolidayService'
import { SuspensionService } from '../suspension/SuspensionService'
import { DateUtils } from '@/utils/DateUtils'
import { SessionService } from '../session/SessionService'

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

        if (isHoliday || isSuspended) {
            payload.attendance_status = 'absent'
        } else {
            payload.attendance_status = 'pending'
        }

        return payload
    }

    static async updateEnrollmentProgressAfterReport(
        enrollmentId: string,
        reportId: string,
        lessonId: string,
        isCompleted: boolean
    ): Promise<void> {
        const { data: lesson, error: lessonError } = await supabase
            .from('lessons')
            .select('id, sequence, course_id')
            .eq('id', lessonId)
            .single()

        if (lessonError || !lesson) return

        const { data: allLessonsData } = await supabase
            .from('lessons')
            .select('id, sequence')
            .eq('course_id', lesson.course_id)
            .order('sequence', { ascending: true })

        if (!allLessonsData || allLessonsData.length === 0) return

        const lastLesson = allLessonsData[allLessonsData.length - 1]
        const isActuallyLastLesson = lastLesson?.id === lessonId

        if (isCompleted && isActuallyLastLesson) {
            await supabase
                .from('enrollments')
                .update({ status: 'completed' })
                .eq('id', enrollmentId)
            return
        }

        const allLessons = allLessonsData.map(l => ({ id: l.id, sequence: l.sequence })) as any

        await EnrollmentProgressService.calculateNewProgress(
            enrollmentId,
            lesson.sequence,
            isCompleted,
            allLessons
        )

        const { data: currentReport } = await supabase
            .from('occurrence_reports')
            .select('id, class_occurrence:class_occurrences!class_occurrence_id(id, occurrence_date, class_session_id)')
            .eq('id', reportId)
            .single()

        if (!currentReport || !currentReport.class_occurrence) return

        const currentOcc = currentReport.class_occurrence as any
        const todayStr = currentOcc.occurrence_date

        const { count } = await supabase
            .from('occurrence_reports')
            .select('id, class_occurrence:class_occurrences!class_occurrence_id(occurrence_date)', { count: 'exact', head: true })
            .eq('enrollment_id', enrollmentId)
            .gt('class_occurrence.occurrence_date', todayStr)

        if (!count || count === 0) {
            if (!isCompleted || !isActuallyLastLesson) {
                const nextDateString = await SessionService.getNextScheduledDate(
                    currentOcc.class_session_id,
                    todayStr
                )
                if (!nextDateString) return
                const nextDate = DateUtils.parseLocalDate(nextDateString) || new Date(nextDateString)

                await OccurrenceService.generateOccurrences(
                    currentOcc.class_session_id,
                    nextDate,
                    nextDate
                )

                const { data: nextOcc } = await supabase
                    .from('class_occurrences')
                    .select('id')
                    .eq('class_session_id', currentOcc.class_session_id)
                    .eq('occurrence_date', nextDateString)
                    .single()

                if (nextOcc) {
                    await supabase.from('occurrence_reports').insert({
                        enrollment_id: enrollmentId,
                        class_occurrence_id: nextOcc.id,
                        content: '',
                        version: 1,
                        is_completed: false,
                        attendance_status: 'pending'
                    })
                }
            }
        }
    }
}
