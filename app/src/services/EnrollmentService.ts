import { supabase } from '@/lib/supabase'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'

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

        // 2. If enrolled in a specific class session, generate reports for all future occurrences
        if (enrollment.class_session_id) {
            await this.generateReportsForSession(enrollment.id!, enrollment.class_session_id)
        }

        return new Enrollment(enrollment as EnrollmentDTO)
    }

    /**
     * Update an existing enrollment
     * Handles class transfers and classroom updates
     */
    static async update(enrollmentId: string, updates: Partial<EnrollmentDTO>): Promise<Enrollment> {
        // Fetch current enrollment to check for changes
        const { data: current, error: fetchError } = await supabase
            .from('enrollments')
            .select('class_session_id, classroom_id')
            .eq('id', enrollmentId)
            .single()

        if (fetchError) throw new Error(`Failed to fetch enrollment: ${fetchError.message}`)

        // Check if class session is changing (class transfer)
        const isClassTransfer = updates.class_session_id && updates.class_session_id !== current.class_session_id

        if (isClassTransfer) {
            // Delete old reports and generate new ones
            await this.deleteReportsForEnrollment(enrollmentId)
            await this.generateReportsForSession(enrollmentId, updates.class_session_id!)
        }

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
        // 1. Delete all occurrence reports
        await this.deleteReportsForEnrollment(enrollmentId)

        // 2. Delete enrollment progress records
        const { error: progressError } = await supabase
            .from('enrollment_progress')
            .delete()
            .eq('enrollment_id', enrollmentId)

        if (progressError && progressError.code !== '42P01') {
            throw new Error(`Failed to delete progress: ${progressError.message}`)
        }

        // 3. Delete the enrollment itself
        const { error: deleteError } = await supabase
            .from('enrollments')
            .delete()
            .eq('id', enrollmentId)

        if (deleteError) throw new Error(`Failed to delete enrollment: ${deleteError.message}`)
    }

    /**
     * Generate occurrence reports for all future class occurrences in a session
     * @private
     */
    private static async generateReportsForSession(enrollmentId: string, sessionId: string): Promise<void> {
        // Fetch all future occurrences for this session
        const today = new Date().toISOString().split('T')[0]
        
        const { data: occurrences, error: occError } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', sessionId)
            .gte('occurrence_date', today)
            .order('occurrence_date', { ascending: true })

        if (occError) {
            console.error('Failed to fetch occurrences:', occError)
            return
        }

        if (!occurrences || occurrences.length === 0) {
            console.warn(`No future occurrences found for session ${sessionId}`)
            return
        }

        // Batch create reports
        const reports = occurrences.map(occ => ({
            enrollment_id: enrollmentId,
            class_occurrence_id: occ.id,
            content: '',
            version: 1
        }))

        const { error: insertError } = await supabase
            .from('occurrence_reports')
            .insert(reports)

        if (insertError) {
            console.error('Failed to create reports:', insertError)
            // Don't throw - enrollment is created, reports can be generated later
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
        // Mark reports before transfer date as historical (keep them)
        // Delete reports after transfer date from old session
        const { error: deleteError } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('enrollment_id', enrollmentId)
            .filter('class_occurrences.occurrence_date', 'gte', transferDate)

        if (deleteError) {
            console.error('Failed to clean up old session reports:', deleteError)
        }

        // Generate reports for new session from transfer date onwards
        const { data: newOccurrences, error: occError } = await supabase
            .from('class_occurrences')
            .select('id')
            .eq('class_session_id', newSessionId)
            .gte('occurrence_date', transferDate)

        if (occError) throw new Error(`Failed to fetch new session occurrences: ${occError.message}`)

        if (newOccurrences && newOccurrences.length > 0) {
            const newReports = newOccurrences.map(occ => ({
                enrollment_id: enrollmentId,
                class_occurrence_id: occ.id,
                content: '',
                version: 1
            }))

            await supabase.from('occurrence_reports').insert(newReports)
        }

        // Update enrollment
        return this.update(enrollmentId, { class_session_id: newSessionId })
    }
}
