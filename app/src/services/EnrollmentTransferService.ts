import { supabase } from '@/lib/supabase'
import { Enrollment } from '@/models/Enrollment'
import { OccurrenceService } from './OccurrenceService'
import { EnrollmentTransferQueryService } from './EnrollmentTransferQueryService'
import { EnrollmentTransferToolService } from './EnrollmentTransferToolService'

export class EnrollmentTransferService {
    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        originalLastDate: string,
        transferDate: string
    ): Promise<Enrollment> {
        const enrollment = await EnrollmentTransferQueryService.getEnrollmentSessionInfo(enrollmentId)
        const oldSessionId = enrollment.class_session_id
        const reportsToMigrate = await EnrollmentTransferQueryService.getReportsToMigrate(
            enrollmentId,
            oldSessionId,
            originalLastDate
        )
        const lessonCount = await EnrollmentTransferQueryService.getLessonCount(enrollment.course_id, 12)
        const start = new Date(transferDate)
        const endDate = EnrollmentTransferToolService.buildTransferEndDate(transferDate, lessonCount)

        await OccurrenceService.generateOccurrences(newSessionId, start, endDate).catch(() => {})

        const newOccurrences = await EnrollmentTransferQueryService.getTargetOccurrences(newSessionId, transferDate)

        const sortedReports = [...reportsToMigrate].sort((a, b) => {
            const dateA = new Date(a.class_occurrence[0]?.occurrence_date).getTime()
            const dateB = new Date(b.class_occurrence[0]?.occurrence_date).getTime()
            return dateA - dateB
        })

        const migrationPromises = []
        const maxPairIndex = Math.min(sortedReports.length, newOccurrences.length)

        for (let i = 0; i < maxPairIndex; i++) {
            const report = sortedReports[i]
            const newOcc = newOccurrences[i]
            if (!report || !newOcc) continue

            migrationPromises.push(
                supabase
                    .from('occurrence_reports')
                    .update({
                        class_occurrence_id: newOcc.id,
                        version: (report.version || 1) + 1
                    })
                    .eq('id', report.id)
            )
        }

        await Promise.all(migrationPromises)

        const { data: updated, error: updateError } = await supabase
            .from('enrollments')
            .update({ class_session_id: newSessionId })
            .eq('id', enrollmentId)
            .select(`
                *,
                courses (subject, stage, display_name),
                classrooms (name),
                class_sessions (id, name, day_of_week, start_time)
            `)
            .single()

        if (updateError) throw new Error(`Failed to update enrollment: ${updateError.message}`)

        await EnrollmentTransferToolService.syncSessionPair(oldSessionId, newSessionId)

        return new Enrollment(updated)
    }

    static async transferSingleLesson(
        enrollmentId: string,
        originalDate: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<void> {
        const { data: enrollment, error: enrollError } = await supabase
            .from('enrollments')
            .select('class_session_id')
            .eq('id', enrollmentId)
            .single()

        if (enrollError) throw new Error(`Failed to fetch enrollment: ${enrollError.message}`)

        const originalOccId = await EnrollmentTransferQueryService.getTargetOccurrenceId(
            enrollment.class_session_id,
            originalDate
        )

        const { data: reports, error: reportError } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence_id', originalOccId)
            .maybeSingle()

        if (reportError) throw new Error(`Failed to find original report: ${reportError.message}`)

        if (!reports) {
            console.warn(`No report found for ${originalDate}`)
        }

        const tDate = new Date(targetDate)
        await OccurrenceService.generateOccurrences(targetSessionId, tDate, tDate).catch(() => {})

        const targetOccId = await EnrollmentTransferQueryService.getTargetOccurrenceId(
            targetSessionId,
            targetDate
        )

        if (reports) {
            const { error: updateError } = await supabase
                .from('occurrence_reports')
                .update({
                    class_occurrence_id: targetOccId,
                    version: (reports.version || 1) + 1
                })
                .eq('id', reports.id)
            if (updateError) throw new Error(`Failed to update target report: ${updateError.message}`)
        } else {
            const { error: insertError } = await supabase
                .from('occurrence_reports')
                .insert({
                    enrollment_id: enrollmentId,
                    class_occurrence_id: targetOccId,
                    content: '',
                    version: 1,
                    is_completed: false,
                    attendance_status: 'pending'
                })
            if (insertError) throw new Error(`Failed to create replacement report: ${insertError.message}`)
        }

        await EnrollmentTransferToolService.syncSessionPair(enrollment.class_session_id, targetSessionId)
    }
}
