import { supabase } from '@/lib/supabase'
import { Enrollment } from '@/models/Enrollment'

export class EnrollmentQueryService {
    /**
     * Get all enrollments for a student with expanded relations.
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
     * Get active enrollments as candidates for make-up classes.
     */
    static async getActiveEnrollmentCandidates(): Promise<Enrollment[]> {
        const { data, error } = await supabase
            .from('enrollments')
            .select(`
                *,
                courses (subject, stage, display_name),
                classrooms (name),
                class_sessions (id, name, day_of_week, start_time, end_time),
                students (name, email)
            `)
            .in('status', ['regular', 'trial'])
            .order('created_at', { ascending: false })

        if (error) throw new Error(`Failed to fetch active enrollments: ${error.message}`)

        return (data as any[]).map(dto => new Enrollment(dto))
    }
}
