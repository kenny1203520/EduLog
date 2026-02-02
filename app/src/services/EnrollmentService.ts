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
     * This preserves historical reports and generates new ones for the new session
     */
    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        transferDate: string
    ): Promise<Enrollment> {
        // Step 1: Get old session ID from current enrollment
        const { data: currentEnrollment, error: enrollError } = await supabase
            .from('enrollments')
            .select('class_session_id')
            .eq('id', enrollmentId)
            .single()

        if (enrollError) throw new Error(`Failed to fetch enrollment: ${enrollError.message}`)

        const oldSessionId = currentEnrollment.class_session_id

        // Step 2: Get all occurrence IDs from the OLD session that are >= transfer date
        const { data: oldOccurrences, error: oldOccError } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', oldSessionId)
            .gte('occurrence_date', transferDate)

        if (oldOccError) {
            console.error('Failed to fetch old occurrences:', oldOccError)
        }

        // Step 3: Delete reports for those occurrences (using IN filter)
        if (oldOccurrences && oldOccurrences.length > 0) {
            const occurrenceIds = oldOccurrences.map(o => o.id)
            const { error: deleteError } = await supabase
                .from('occurrence_reports')
                .delete()
                .eq('enrollment_id', enrollmentId)
                .in('class_occurrence_id', occurrenceIds)

            if (deleteError) {
                console.error('Failed to clean up old session reports:', deleteError)
            }
        }

        // Step 4: Generate reports for new session using the standard generator
        const { data: enr } = await supabase
            .from('enrollments')
            .select('course_id')
            .eq('id', enrollmentId)
            .single()

        await this.generateReportsForSession(
            enrollmentId,
            newSessionId,
            transferDate,
            enr?.course_id || ''
        )

        // Step 6: Update enrollment
        const updated = await this.update(enrollmentId, { class_session_id: newSessionId })

        // Step 7: Clean up orphaned occurrences in old session
        if (oldSessionId) {
            await OccurrenceService.syncSessionOccurrences(oldSessionId).catch((err: any) => {
                console.error('Failed to sync old session after transfer:', err)
            })
        }

        return updated
    }
}
