import { apiV1Client } from '@/services/api/ApiV1Client'
import { Enrollment } from '@/models/Enrollment'

export class EnrollmentQueryService {
    /**
     * Get all enrollments for a student with expanded relations.
     */
    static async getByStudentId(studentId: string): Promise<Enrollment[]> {
        const response = await apiV1Client.get<any[]>('/enrollments?student_id=' + encodeURIComponent(studentId) + '&limit=100&sort=-created_at')
        return (response.data || []).map((dto: any) => new Enrollment(dto))
    }

    /**
     * Get active enrollments as candidates for make-up classes.
     */
    static async getActiveEnrollmentCandidates(): Promise<Enrollment[]> {
        const response = await apiV1Client.get<any[]>('/enrollments?status=regular&limit=100&sort=-created_at')
        return (response.data || []).map((dto: any) => new Enrollment(dto))
    }
}
