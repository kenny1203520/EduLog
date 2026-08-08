import { supabase } from '@/lib/supabase'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
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

        payload.attendance_status = isHoliday || isSuspended ? 'absent' : 'pending'
        return payload
    }

    static async ensureNextOccurrenceReportAfterSave(
        enrollmentId: string,
        reportId: string
    ): Promise<void> {
        const { data: enrollment, error: enrollmentError } = await supabase
            .from('enrollments')
            .select('status, class_session_id')
            .eq('id', enrollmentId)
            .single()

        if (enrollmentError || !enrollment) return


        if (enrollment.status !== 'regular' || !enrollment.class_session_id) return

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

        // A single-lesson transfer only changes the current occurrence.  The
        // next prebuilt report must continue on the enrollment's normal class,
        // not on the one-off make-up class that hosted this report.
        const nextDateString = await SessionService.getNextScheduledDate(
            enrollment.class_session_id,
            occurrenceDate
        )
        if (!nextDateString) return

        const nextDate = DateUtils.parseLocalDate(nextDateString) || new Date(nextDateString)
        await OccurrenceService.generateOccurrences(enrollment.class_session_id, nextDate, nextDate)

        const { data: nextOcc } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', enrollment.class_session_id)
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
