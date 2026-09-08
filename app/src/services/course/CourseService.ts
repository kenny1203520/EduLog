import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { apiResourceClient } from '@/services/api/ApiResourceClient'

export class CourseService {
    static async getStudentEnrollments(studentId: string): Promise<Enrollment[]> {
        const response = await apiV1Client.get<EnrollmentDTO[]>('/enrollments?student_id=' + encodeURIComponent(studentId) + '&limit=100&sort=-created_at')
        return (response.data || []).map((dto: any) => new Enrollment(dto))
    }

    static async getEnrollmentById(id: string): Promise<Enrollment | null> {
        try { return new Enrollment((await apiResourceClient.get<EnrollmentDTO>('enrollments', id)).data) } catch (error) { if ((error as any)?.status === 404) return null; throw error }
    }

    static async getEnrollmentsByIds(ids: string[]): Promise<Enrollment[]> {
        if (ids.length === 0) return []
        const rows = await Promise.all(ids.map((id: any) => this.getEnrollmentById(id)))
        return rows.filter((row): row is Enrollment => Boolean(row))
    }

    static async enrollStudent(enrollment: Partial<EnrollmentDTO>): Promise<Enrollment> {
        return new Enrollment((await apiResourceClient.create<EnrollmentDTO>('enrollments', enrollment)).data)
    }

    static async updateEnrollment(id: string, updates: Partial<EnrollmentDTO>): Promise<Enrollment> {
        return new Enrollment((await apiResourceClient.update<EnrollmentDTO>('enrollments', id, updates)).data)
    }

    static async deleteEnrollment(id: string): Promise<void> {
        await apiResourceClient.remove('enrollments', id)
    }

    static async getEnrollmentsBySession(sessionId: string): Promise<{ data: Enrollment[] }> {
        const response = await apiV1Client.get<EnrollmentDTO[]>('/enrollments?class_session_id=' + encodeURIComponent(sessionId) + '&status=regular&limit=100&sort=created_at')
        const data = (response.data || []).map((dto: any) => {
            const enrollment = new Enrollment(dto)
            if (dto.students) { enrollment.studentName = dto.students.name; enrollment.studentEmail = dto.students.email }
            return enrollment
        })
        data.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '', 'zh-Hant'))
        return { data }
    }
}