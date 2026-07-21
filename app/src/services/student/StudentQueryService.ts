import { supabase } from '@/lib/supabase'
import { Student } from '@/models/Student'

/**
 * Query service for students
 * Handles retrieval of student information
 */
export class StudentQueryService {
    /**
     * Fetch all students ordered by name with pagination
     */
    static async getAll(page: number = 1, perPage: number = 1000, search?: string): Promise<{ data: Student[], count: number }> {
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        let query = supabase
            .from('students')
            .select('*, student_contacts(*), student_schools(*), student_credentials(*), enrollments(*, classrooms(name), courses(subject, stage, display_name), class_sessions(*, class_session_schedule_rules(*)))', { count: 'exact' })            .order('name')

        if (search) {
            query = query.ilike('name', `%${search}%`)
        }

        const { data, error, count } = await query.range(from, to)

        if (error) throw new Error(error.message)

        return {
            data: (data as any[]).map(dto => new Student(dto)),
            count: count || 0
        }
    }

    /**
     * Get a single student by ID
     */
    static async getById(id: string): Promise<Student | null> {
        const { data, error } = await supabase
            .from('students')
            .select('*, student_contacts(*), student_schools(*), student_credentials(*), enrollments(*, classrooms(name), courses(subject, stage, display_name), class_sessions(*, class_session_schedule_rules(*)))')
            .eq('id', id)
            .single()

        if (error) throw new Error(error.message)
        if (!data) return null

        return new Student(data as any)
    }
}
