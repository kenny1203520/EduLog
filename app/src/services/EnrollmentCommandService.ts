import { supabase } from '@/lib/supabase'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'
import { OccurrenceService } from './OccurrenceService'
import { OccurrenceReportService } from './OccurrenceReportService'
import { EnrollmentStatusPolicyService } from './EnrollmentStatusPolicyService'

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
                status: enrollmentData.status || 'active'
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
            previousStatus !== 'active' &&
            nextStatus === 'active' &&
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

        await this.deleteReportsForEnrollment(enrollmentId)

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
        const normalizedTargetDate = this.normalizeDateOnly(targetDate)

        const { data: enrollment, error: enrollmentError } = await supabase
            .from('enrollments')
            .select('id, status')
            .eq('id', enrollmentId)
            .single()

        if (enrollmentError || !enrollment) {
            throw new Error(`Failed to fetch enrollment: ${enrollmentError?.message || 'not found'}`)
        }

        const todayStr = this.normalizeDateOnly(new Date())
        if (enrollment.status !== 'active' && normalizedTargetDate >= todayStr) {
            throw new Error('Only active enrollments can join a future class.')
        }

        const { data: sessionInfo, error: sessionInfoError } = await supabase
            .from('class_sessions')
            .select('day_of_week')
            .eq('id', targetSessionId)
            .single()

        if (sessionInfoError || !sessionInfo) {
            throw new Error(`Failed to find target occurrence: ${sessionInfoError?.message || 'session not found'}`)
        }

        const selectedDayOfWeek = this.dayOfWeekFromDateOnly(normalizedTargetDate)
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
        const { data: enrollment, error: enrollError } = await supabase
            .from('enrollments')
            .select('class_session_id, course_id')
            .eq('id', enrollmentId)
            .single()

        if (enrollError) throw new Error(`Failed to fetch enrollment: ${enrollError.message}`)
        const oldSessionId = enrollment.class_session_id

        const { data: reportsToMigrate, error: reportsError } = await supabase
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

        if (reportsError) throw new Error(`Failed to fetch reports for migration: ${reportsError.message}`)

        const { data: lessons } = await supabase
            .from('lessons')
            .select('id')
            .eq('course_id', enrollment.course_id)
        const lessonCount = (lessons && lessons.length > 0) ? lessons.length : 12

        const start = new Date(transferDate)
        const endDate = new Date(start)
        endDate.setDate(endDate.getDate() + (lessonCount * 7))

        await OccurrenceService.generateOccurrences(newSessionId, start, endDate).catch(() => {})

        const { data: newOccurrences, error: targetError } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', newSessionId)
            .gte('occurrence_date', transferDate)
            .order('occurrence_date', { ascending: true })

        if (targetError) throw new Error(`Failed to fetch target occurrences: ${targetError.message}`)

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

        const updated = await this.update(enrollmentId, { class_session_id: newSessionId })

        if (oldSessionId) {
            await OccurrenceService.syncSessionOccurrences(oldSessionId).catch(() => {})
        }
        await OccurrenceService.syncSessionOccurrences(newSessionId).catch(() => {})

        return updated
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

        const { data: originalOcc, error: originalOccError } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', enrollment.class_session_id)
            .eq('occurrence_date', originalDate)
            .single()

        if (originalOccError) throw new Error(`Failed to find original occurrence: ${originalOccError.message}`)

        const { data: reports, error: reportError } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence_id', originalOcc.id)
            .maybeSingle()

        if (reportError) throw new Error(`Failed to find original report: ${reportError.message}`)

        if (!reports) {
            console.warn(`No report found for ${originalDate}`)
        }

        const tDate = new Date(targetDate)
        await OccurrenceService.generateOccurrences(targetSessionId, tDate, tDate).catch(() => {})

        const { data: targetOcc, error: targetOccError } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', targetSessionId)
            .eq('occurrence_date', targetDate)
            .single()

        if (targetOccError) throw new Error(`Failed to find target occurrence: ${targetOccError.message}`)

        if (reports) {
            const { error: updateError } = await supabase
                .from('occurrence_reports')
                .update({
                    class_occurrence_id: targetOcc.id,
                    version: (reports.version || 1) + 1
                })
                .eq('id', reports.id)
            if (updateError) throw new Error(`Failed to update target report: ${updateError.message}`)
        } else {
            const { error: insertError } = await supabase
                .from('occurrence_reports')
                .insert({
                    enrollment_id: enrollmentId,
                    class_occurrence_id: targetOcc.id,
                    content: '',
                    version: 1,
                    is_completed: false,
                    attendance_status: null
                })
            if (insertError) throw new Error(`Failed to create replacement report: ${insertError.message}`)
        }

        await OccurrenceService.syncSessionOccurrences(targetSessionId).catch(() => {})
        if (enrollment.class_session_id) {
            await OccurrenceService.syncSessionOccurrences(enrollment.class_session_id).catch(() => {})
        }
    }

    private static async deleteReportsForEnrollment(enrollmentId: string): Promise<void> {
        const { error } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('enrollment_id', enrollmentId)

        if (error) {
            console.error(`Failed to delete reports for enrollment ${enrollmentId}:`, error)
        }
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

    private static dayOfWeekFromDateOnly(dateOnly: string): number {
        const parts = dateOnly.split('-').map(Number)
        const y = parts[0] || 2000
        const m = parts[1] || 1
        const d = parts[2] || 1
        return new Date(y, m - 1, d).getDay()
    }
}
