import { apiDataClient } from '@/services/api/ApiDataClient'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { Enrollment } from '@/models/Enrollment'

export class EnrollmentQueryService {
    /**
     * Get all enrollments for a student with expanded relations.
     */
    static async getByStudentId(studentId: string): Promise<Enrollment[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<any[]>('/enrollments?student_id=' + encodeURIComponent(studentId) + '&limit=100&sort=-created_at')
            return (response.data || []).map((dto: any) => new Enrollment(dto))
        }
        const { data, error } = await apiDataClient
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
                    capacity,
                    time_zone,
                    session_type,
                    schedule_mode,
                    class_session_schedule_rules (*)
                )
            `)
            .eq('student_id', studentId)
            .order('created_at', { ascending: false })

        if (error) throw new Error(`Failed to fetch enrollments: ${error.message}`)

        return (data as any[]).map((dto: any) => new Enrollment(dto))
    }

    /**
     * Get active enrollments as candidates for make-up classes.
     */
    static async getActiveEnrollmentCandidates(): Promise<Enrollment[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<any[]>('/enrollments?status=regular&limit=100&sort=-created_at')
            return (response.data || []).map((dto: any) => new Enrollment(dto))
        }
        const { data, error } = await apiDataClient
            .from('enrollments')
            .select(`
                *,
                courses (subject, stage, display_name),
                classrooms (name),
                class_sessions (id, name, day_of_week, start_time, end_time, time_zone, session_type, schedule_mode, class_session_schedule_rules (*)),
                students (name, email)
            `)
            .in('status', ['regular', 'trial'])
            .order('created_at', { ascending: false })

        if (error) throw new Error(`Failed to fetch active enrollments: ${error.message}`)

        return (data as any[]).map((dto: any) => new Enrollment(dto))
    }
}
