import { supabase } from '@/lib/supabase'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'

/**
 * Transitional service focused on enrollment-only read/write operations.
 * Course/classroom/session/catalog concerns were moved to dedicated services.
 */
export class CourseService {
    static async getStudentEnrollments(studentId: string): Promise<Enrollment[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<EnrollmentDTO[]>('/enrollments?student_id=' + encodeURIComponent(studentId) + '&limit=100&sort=-created_at')
            return (response.data || []).map((dto) => new Enrollment(dto))
        }
        const { data, error } = await supabase
            .from('enrollments')
            .select(`
            *,
            courses (subject, stage, display_name),
            classrooms (name),
            class_sessions (name)
        `)
            .eq('student_id', studentId)

        if (error) throw new Error(error.message)

        return (data || []).map((d: any) => new Enrollment(d))
    }

    static async getEnrollmentById(id: string): Promise<Enrollment | null> {
        if (getApiV1Mode() === 'v1') {
            try { return new Enrollment((await apiResourceClient.get<EnrollmentDTO>('enrollments', id, 'v1')).data) } catch (error) { if ((error as any)?.status === 404) return null; throw error }
        }
        const { data, error } = await supabase
            .from('enrollments')
            .select(`
            *,
            courses (subject, stage, display_name),
            classrooms (name),
            class_sessions (name),
            students (name, email)
        `)
            .eq('id', id)
            .maybeSingle()

        if (error) throw new Error(error.message)
        if (!data) return null
        return new Enrollment(data)
    }

    /** Batched form of getEnrollmentById -- one request instead of one per id. */
    static async getEnrollmentsByIds(ids: string[]): Promise<Enrollment[]> {
        if (getApiV1Mode() === 'v1') {
            const rows = await Promise.all(ids.map((id) => this.getEnrollmentById(id)))
            return rows.filter((row): row is Enrollment => Boolean(row))
        }
        if (ids.length === 0) return []
        const { data, error } = await supabase
            .from('enrollments')
            .select(`
            *,
            courses (subject, stage, display_name),
            classrooms (name),
            class_sessions (name),
            students (name, email)
        `)
            .in('id', ids)

        if (error) throw new Error(error.message)
        return (data || []).map(dto => new Enrollment(dto))
    }

    static async enrollStudent(enrollment: Partial<EnrollmentDTO>): Promise<Enrollment> {
        if (getApiV1Mode() === 'v1') return new Enrollment((await apiResourceClient.create<EnrollmentDTO>('enrollments', enrollment, 'v1')).data)
        const { data, error } = await supabase.from('enrollments').insert(enrollment).select().single()
        if (error) throw new Error(error.message)
        return new Enrollment(data)
    }

    static async updateEnrollment(id: string, updates: Partial<EnrollmentDTO>): Promise<Enrollment> {
        if (getApiV1Mode() === 'v1') return new Enrollment((await apiResourceClient.update<EnrollmentDTO>('enrollments', id, updates, 'v1')).data)
        const { data, error } = await supabase.from('enrollments').update(updates).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return new Enrollment(data)
    }

    static async deleteEnrollment(id: string): Promise<void> {
        if (getApiV1Mode() === 'v1') { await apiResourceClient.remove('enrollments', id, 'v1'); return }
        const { error } = await supabase.from('enrollments').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    static async getEnrollmentsBySession(sessionId: string): Promise<{ data: Enrollment[] }> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<EnrollmentDTO[]>('/enrollments?class_session_id=' + encodeURIComponent(sessionId) + '&status=regular&limit=100&sort=created_at')
            return { data: (response.data || []).map((dto: any) => { const enrollment = new Enrollment(dto); if (dto.students) { enrollment.studentName = dto.students.name; enrollment.studentEmail = dto.students.email } return enrollment }).sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '', 'zh-Hant')) }
        }
        const { data, error } = await supabase
            .from('enrollments')
            .select(`
            *,
            courses (subject, stage, display_name),
            students (name, email)
        `)
            .eq('class_session_id', sessionId)
            .in('status', ['regular', 'trial'])
            .order('name', { foreignTable: 'students', ascending: true })

        if (error) throw new Error(error.message)

        const mappedEnrollments = (data || []).map((d: any) => {
            const enrollment = new Enrollment(d)
            if (d.students) {
                enrollment.studentName = d.students.name
                enrollment.studentEmail = d.students.email
            }
            return enrollment
        })

        mappedEnrollments.sort((a, b) => {
            const left = a.studentName || ''
            const right = b.studentName || ''
            return left.localeCompare(right, 'zh-Hant')
        })

        return {
            data: mappedEnrollments
        }
    }
}
