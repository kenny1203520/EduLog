import { supabase } from '@/lib/supabase'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'
import { OccurrenceService } from './OccurrenceService'

/**
 * EnrollmentService handles student course enrollments with automatic report generation.
 * 
 * KEY FEATURES:
 * - Automatic report creation for all class sessions when student enrolls
 * - Cascade delete of reports when enrollment is removed
 * - Sync updates when enrollment details change
 */
export class EnrollmentService {
    /**
     * Get all enrollments for a student with expanded relations
     */
    static async getByStudentId(studentId: string): Promise<Enrollment[]> {
        const { data, error } = await supabase
            .from('enrollments')
            .select(`
                *,
                courses (
                    subject,
                    stage,
                    display_name,
                    lessons (*)
                ),
                classrooms (
                    name,
                    address
                ),
                class_sessions (
                    id,
                    name,
                    day_of_week,
                    start_time,
                    end_time,
                    capacity
                )
            `)
            .eq('student_id', studentId)
            .order('created_at', { ascending: false })

        if (error) throw new Error(`Failed to fetch enrollments: ${error.message}`)
        
        return (data as any[]).map(dto => new Enrollment(dto))
    }

    /**
     * Create a new enrollment and automatically generate reports for all upcoming class sessions
     */
    static async create(enrollmentData: Partial<EnrollmentDTO>): Promise<Enrollment> {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')

        // 1. Create the enrollment
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

        // 2. If enrolled in a specific class session, generate reports based on course lesson count
        if (enrollment.class_session_id) {
            await this.generateReportsForSession(
                enrollment.id!, 
                enrollment.class_session_id,
                enrollment.start_date || new Date().toISOString().split('T')[0],
                enrollment.course_id
            )
        }

        return new Enrollment(enrollment as EnrollmentDTO)
    }

    /**
     * Update an existing enrollment
     * Handles class transfers and classroom updates
     */
    static async update(enrollmentId: string, updates: Partial<EnrollmentDTO>): Promise<Enrollment> {
        // Note: Class transfer is handled by transferClass() method for better control
        // over historical data preservation.
        
        // Update the enrollment
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

        return new Enrollment(updated as EnrollmentDTO)
    }

    /**
     * Delete an enrollment and cascade delete all related reports
     */
    static async delete(enrollmentId: string): Promise<void> {
        // 0. Get session ID first to sync later
        const { data: enrollment } = await supabase
            .from('enrollments')
            .select('class_session_id')
            .eq('id', enrollmentId)
            .single()

        const sessionId = enrollment?.class_session_id

        // 1. Delete all occurrence reports
        await this.deleteReportsForEnrollment(enrollmentId)

        // 3. Delete the enrollment itself
        const { error: deleteError } = await supabase
            .from('enrollments')
            .delete()
            .eq('id', enrollmentId)

        if (deleteError) throw new Error(`Failed to delete enrollment: ${deleteError.message}`)

        // 4. Clean up orphaned occurrences if this was the last student
        if (sessionId) {
            await OccurrenceService.syncSessionOccurrences(sessionId, 'all').catch((err: any) => {
                console.error('Failed to sync occurrences after enrollment delete:', err)
            })
        }
    }

    /**
     * Generate occurrence reports for all future class occurrences in a session
     * @private
     */
    private static async generateReportsForSession(
        enrollmentId: string, 
        sessionId: string,
        startDate: string,
        courseId: string
    ): Promise<void> {
        // 1. Get lesson count for this course
        const { data: lessons } = await supabase
            .from('lessons')
            .select('id')
            .eq('course_id', courseId)
        
        const lessonCount = (lessons && lessons.length > 0) ? lessons.length : 12
        
        // 2. Ensure occurrences exist
        const start = new Date(startDate)
        const endDate = new Date(start)
        endDate.setDate(endDate.getDate() + (lessonCount * 7))
        
        await OccurrenceService.generateOccurrences(sessionId, start, endDate).catch(() => {})
        
        // 3. Fetch exactly N future occurrences starting from startDate
        const { data: occurrences } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', sessionId)
            .gte('occurrence_date', startDate)
            .order('occurrence_date', { ascending: true })
            .limit(lessonCount)

        if (occurrences && occurrences.length > 0) {
            // 4. Batch create reports
            const reports = occurrences.map(occ => ({
                enrollment_id: enrollmentId,
                class_occurrence_id: occ.id,
                content: '',
                version: 1,
                is_completed: false
            }))

            await supabase
                .from('occurrence_reports')
                .insert(reports)
        }
    }
    


    /**
     * Delete all reports for an enrollment
     * @private
     */
    private static async deleteReportsForEnrollment(enrollmentId: string): Promise<void> {
        const { error } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('enrollment_id', enrollmentId)

        if (error) {
            console.error(`Failed to delete reports for enrollment ${enrollmentId}:`, error)
            // Don't throw - continue with enrollment deletion
        }
    }

    /**
     * Transfer a student to a different class session
     * This preserves historical reports and migrates them to the new session schedule
     */
    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        transferDate: string
    ): Promise<Enrollment> {
        // 1. Get current enrollment and course info
        const { data: enrollment, error: enrollError } = await supabase
            .from('enrollments')
            .select('class_session_id, course_id')
            .eq('id', enrollmentId)
            .single()

        if (enrollError) throw new Error(`Failed to fetch enrollment: ${enrollError.message}`)
        const oldSessionId = enrollment.class_session_id

        // 2. Fetch existing reports that need to be moved to the new session
        // We join with class_occurrences to verify they belong to the old session
        const { data: reportsToMigrate, error: reportsError } = await supabase
            .from('occurrence_reports')
            .select(`
                id, 
                content,
                class_occurrence_id,
                class_occurrence:class_occurrences!class_occurrence_id(occurrence_date, class_session_id)
            `)
            .eq('enrollment_id', enrollmentId)
            .eq('class_occurrence.class_session_id', oldSessionId)
            .gte('class_occurrence.occurrence_date', transferDate)
            .order('class_occurrence(occurrence_date)', { ascending: true })

        if (reportsError) throw new Error(`Failed to fetch reports for migration: ${reportsError.message}`)

        // 3. Ensure occurrences exist for the NEW session
        // We calculate lesson count to know how many occurrences to ensure/fetch
        const { data: lessons } = await supabase.from('lessons').select('id').eq('course_id', enrollment.course_id)
        const lessonCount = (lessons && lessons.length > 0) ? lessons.length : 12

        const start = new Date(transferDate)
        const endDate = new Date(start)
        endDate.setDate(endDate.getDate() + (lessonCount * 7))
        
        await OccurrenceService.generateOccurrences(newSessionId, start, endDate).catch(() => {})

        // 4. Fetch the target occurrences in the NEW session
        const { data: newOccurrences, error: targetError } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', newSessionId)
            .gte('occurrence_date', transferDate)
            .order('occurrence_date', { ascending: true })

        if (targetError) throw new Error(`Failed to fetch target occurrences: ${targetError.message}`)

        // 5. Intelligent Migration & Creation
        // We pair existing reports with new occurrences where possible
        const migrationPromises = []
        const maxPairIndex = Math.min(reportsToMigrate.length, newOccurrences.length)

        for (let i = 0; i < maxPairIndex; i++) {
            const report = reportsToMigrate[i]
            const newOcc = newOccurrences[i]
            if (!report || !newOcc) continue

            // Update path: re-point existing report to new occurrence
            migrationPromises.push(
                supabase.from('occurrence_reports').update({ class_occurrence_id: newOcc.id }).eq('id', report.id)
            )
        }

        // 6. Bulk Create any missing reports if new session has more occurrences than migrated reports
        if (newOccurrences.length > reportsToMigrate.length) {
            const missingOccs = newOccurrences.slice(reportsToMigrate.length)
            const newReports = missingOccs.map(occ => ({
                enrollment_id: enrollmentId,
                class_occurrence_id: occ.id,
                content: '',
                version: 1,
                is_completed: false
            }))
            migrationPromises.push(supabase.from('occurrence_reports').insert(newReports))
        }

        // 7. Cleanup: If old session had MORE reports than the new session provides, 
        // delete the excess ones (they have no place in the new layout)
        if (reportsToMigrate.length > newOccurrences.length) {
            const excessReportIds = reportsToMigrate.slice(newOccurrences.length).map(r => r.id)
            migrationPromises.push(supabase.from('occurrence_reports').delete().in('id', excessReportIds))
        }

        await Promise.all(migrationPromises)

        // 8. Update enrollment record
        const updated = await this.update(enrollmentId, { class_session_id: newSessionId })

        // 9. Sync occurrences in both old and new sessions (clean up orphans)
        if (oldSessionId) {
            await OccurrenceService.syncSessionOccurrences(oldSessionId).catch(() => {})
        }
        await OccurrenceService.syncSessionOccurrences(newSessionId).catch(() => {})

        return updated
    }
}
