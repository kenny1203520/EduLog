import { supabase } from '@/lib/supabase'
import { Enrollment, type EnrollmentDTO } from '@/models/Enrollment'

/**
 * Transitional service focused on enrollment-only read/write operations.
 * Course/classroom/session/catalog concerns were moved to dedicated services.
 */
export class CourseService {
    static async getStudentEnrollments(studentId: string): Promise<Enrollment[]> {
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
        const { data, error } = await supabase.from('enrollments').insert(enrollment).select().single()
        if (error) throw new Error(error.message)
        return new Enrollment(data)
    }

    static async updateEnrollment(id: string, updates: Partial<EnrollmentDTO>): Promise<Enrollment> {
        const { data, error } = await supabase.from('enrollments').update(updates).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return new Enrollment(data)
    }

    static async deleteEnrollment(id: string): Promise<void> {
        const { error } = await supabase.from('enrollments').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    static async getEnrollmentsBySession(sessionId: string): Promise<{ data: Enrollment[] }> {
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
