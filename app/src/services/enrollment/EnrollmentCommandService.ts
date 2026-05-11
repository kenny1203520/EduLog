import { supabase } from '@/lib/supabase'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'
import { OccurrenceService } from '../occurrence/OccurrenceService'
import { OccurrenceReportService } from '../occurrence/OccurrenceReportService'
import { EnrollmentStatusPolicyService } from './EnrollmentStatusPolicyService'
import { EnrollmentTransferService } from './EnrollmentTransferService'
import { EnrollmentSupportService } from './EnrollmentSupportService'

type EnrollmentCreateOptions = {
    targetReportCount?: number
}

type EnrollmentUpdateOptions = {
    targetTotalReports?: number
}

export class EnrollmentCommandService {
    static async create(
        enrollmentData: Partial<EnrollmentDTO>,
        options: EnrollmentCreateOptions = {}
    ): Promise<Enrollment> {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')

        const { data: enrollment, error: enrollError } = await supabase
            .from('enrollments')
            .insert({
                ...enrollmentData,
                user_id: user.id,
                status: enrollmentData.status || 'regular'
            })
            .select(`
                *,
                courses (
                    subject,
                    stage,
                    display_name,
                    lessons (*)
                ),
                classrooms (name),
                class_sessions (
                    id,
                    name,
                    day_of_week,
                    start_time,
                    end_time
                )
            `)
            .single()

        if (enrollError) throw new Error(`Failed to create enrollment: ${enrollError.message}`)

        if (enrollment.class_session_id) {
            await EnrollmentStatusPolicyService.generateReportsForSession(
                enrollment.id!,
                enrollment.class_session_id,
                enrollment.start_date || new Date().toISOString().split('T')[0],
                enrollment.course_id,
                {
                    targetReportCount: options.targetReportCount
                }
            )
        }

        return new Enrollment(enrollment as EnrollmentDTO)
    }

    static async update(
        enrollmentId: string,
        updates: Partial<EnrollmentDTO>,
        options: EnrollmentUpdateOptions = {}
    ): Promise<Enrollment> {
        const { data: existing, error: existingError } = await supabase
            .from('enrollments')
            .select('id, status, class_session_id, course_id, start_date, lesson_number')
            .eq('id', enrollmentId)
            .single()

        if (existingError || !existing) {
            throw new Error(`Failed to fetch enrollment before update: ${existingError?.message || 'not found'}`)
        }

        const { data: updated, error: updateError } = await supabase
            .from('enrollments')
            .update(updates)
            .eq('id', enrollmentId)
            .select(`
                *,
                courses (subject, stage, display_name),
                classrooms (name),
                class_sessions (id, name, day_of_week, start_time)
            `)
            .single()

        if (updateError) throw new Error(`Failed to update enrollment: ${updateError.message}`)

        const previousStatus = existing.status
        const nextStatus = updated.status

        if (
            previousStatus !== 'regular' &&
            nextStatus === 'regular' &&
            updated.id &&
            updated.class_session_id &&
            updated.course_id
        ) {
            await EnrollmentStatusPolicyService.ensureEnrollmentReportsTarget(
                updated.id,
                updated.class_session_id,
                updated.course_id,
                updated.start_date || new Date().toISOString().split('T')[0],
                options.targetTotalReports
            )
        }

        if (previousStatus !== 'dropped' && nextStatus === 'dropped' && updated.id) {
            await EnrollmentStatusPolicyService.deleteDroppedPendingEmptyReports(updated.id)
            if (updated.class_session_id) {
                await OccurrenceService.syncSessionOccurrences(updated.class_session_id, 'all').catch(() => {})
            }
        }

        return new Enrollment(updated as EnrollmentDTO)
    }

    static async delete(enrollmentId: string): Promise<void> {
        const { data: enrollment } = await supabase
            .from('enrollments')
            .select('class_session_id')
            .eq('id', enrollmentId)
            .single()

        const sessionId = enrollment?.class_session_id

        await EnrollmentSupportService.deleteReportsForEnrollment(enrollmentId)
        await EnrollmentSupportService.deleteSuspensionsForEnrollment(enrollmentId)

        const { error: deleteError } = await supabase
            .from('enrollments')
            .delete()
            .eq('id', enrollmentId)

        if (deleteError) throw new Error(`Failed to delete enrollment: ${deleteError.message}`)

        if (sessionId) {
            await OccurrenceService.syncSessionOccurrences(sessionId, 'all').catch((err: any) => {
                console.error('Failed to sync occurrences after enrollment delete:', err)
            })
        }
    }

    static async addEnrollmentToSessionOccurrence(
        enrollmentId: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<void> {
        const normalizedTargetDate = EnrollmentSupportService.normalizeDateOnly(targetDate)

        const { data: enrollment, error: enrollmentError } = await supabase
            .from('enrollments')
            .select('id, status')
            .eq('id', enrollmentId)
            .single()

        if (enrollmentError || !enrollment) {
            throw new Error(`Failed to fetch enrollment: ${enrollmentError?.message || 'not found'}`)
        }

        const todayStr = EnrollmentSupportService.normalizeDateOnly(new Date())
        if (enrollment.status !== 'regular' && normalizedTargetDate >= todayStr) {
            throw new Error('Only regular enrollments can join a future class.')
        }

        const { data: sessionInfo, error: sessionInfoError } = await supabase
            .from('class_sessions')
            .select('day_of_week')
            .eq('id', targetSessionId)
            .single()

        if (sessionInfoError || !sessionInfo) {
            throw new Error(`Failed to find target occurrence: ${sessionInfoError?.message || 'session not found'}`)
        }

        const selectedDayOfWeek = EnrollmentSupportService.dayOfWeekFromDateOnly(normalizedTargetDate)
        if (selectedDayOfWeek !== sessionInfo.day_of_week) {
            throw new Error('MAKEUP_DATE_NOT_CLASS_DAY')
        }

        const target = new Date(normalizedTargetDate)
        await OccurrenceService.generateOccurrences(targetSessionId, target, target).catch(() => {})

        let { data: targetOccurrences, error: targetOccurrenceError } = await supabase
            .from('class_occurrences')
            .select('id, created_at')
            .eq('class_session_id', targetSessionId)
            .eq('occurrence_date', normalizedTargetDate)
            .order('created_at', { ascending: false })

        if (targetOccurrenceError) {
            throw new Error(`Failed to find target occurrence: ${targetOccurrenceError.message}`)
        }

        const targetOccurrence = targetOccurrences?.[0]
        if (!targetOccurrence?.id) {
            throw new Error('Failed to find target occurrence: not found')
        }

        const existing = await OccurrenceReportService.getReport(enrollmentId, targetOccurrence.id)
        if (existing) {
            throw new Error('DUPLICATE_OCCURRENCE_REPORT')
        }

        try {
            await OccurrenceReportService.createReport(enrollmentId, targetOccurrence.id)
        } catch (error: any) {
            if (error?.message?.includes('duplicate key')) {
                throw new Error('DUPLICATE_OCCURRENCE_REPORT')
            }
            throw error
        }
    }

    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        originalLastDate: string,
        transferDate: string
    ): Promise<Enrollment> {
        return EnrollmentTransferService.transferClass(
            enrollmentId,
            newSessionId,
            originalLastDate,
            transferDate
        )
    }

    static async transferSingleLesson(
        enrollmentId: string,
        originalDate: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<void> {
        return EnrollmentTransferService.transferSingleLesson(
            enrollmentId,
            originalDate,
            targetSessionId,
            targetDate
        )
    }

}
