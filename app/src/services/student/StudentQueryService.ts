import { apiDataClient } from '@/services/api/ApiDataClient'
import { Student } from '@/models/Student'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { PageApiService } from '@/services/api/PageApiService'
import { StudentCredentialsQueryService } from './StudentCredentialsQueryService'

/**
 * Query service for students
 * Handles retrieval of student information
 */
export class StudentQueryService {
    /**
     * Fetch all students ordered by name with pagination
     */
    static async getAll(page: number = 1, perPage: number = 1000, search?: string): Promise<{ data: Student[], count: number }> {
        if (getApiV1Mode() === 'v1') {
            const result = await PageApiService.getStudentsOverview({ limit: perPage, offset: (page - 1) * perPage, search, sort: 'name' })
            const students = (result.data || []).map((dto: any) => new Student(dto))
            return { data: students, count: Number(result.meta?.total ?? students.length) }
        }
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        let query = apiDataClient
            .from('students')
            .select('*, student_contacts(*), student_schools(*), student_credentials(*), enrollments(*, classrooms(name), courses(subject, stage, display_name), class_sessions(*, class_session_schedule_rules(*)))', { count: 'exact' })            .order('name')

        if (search) {
            query = query.ilike('name', `%${search}%`)
        }

        const { data, error, count } = await query.range(from, to)

        if (error) throw new Error(error.message)

        return {
            data: (data as any[]).map((dto: any) => new Student(dto)),
            count: count || 0
        }
    }

    /**
     * Get a single student by ID
     */
    static async getById(id: string): Promise<Student | null> {
        if (getApiV1Mode() === 'v1') {
            const result = await PageApiService.getStudentProfile(id)
            if (!result.data) return null
            if (result.data.capabilities?.read_sensitive !== true) return new Student(result.data)
            const [privateDetails, credentials] = await Promise.all([
                PageApiService.getStudentPrivateDetails(id),
                StudentCredentialsQueryService.getForStudent(id),
            ])
            const privateData = privateDetails.data
            return new Student({
                ...result.data,
                ...(privateData?.student ?? {}),
                student_contacts: privateData?.contacts ?? [],
                student_schools: privateData?.schools ?? [],
                student_credentials: credentials,
            })
        }
        const { data, error } = await apiDataClient
            .from('students')
            .select('*, student_contacts(*), student_schools(*), student_credentials(*), enrollments(*, classrooms(name), courses(subject, stage, display_name), class_sessions(*, class_session_schedule_rules(*)))')
            .eq('id', id)
            .single()

        if (error) throw new Error(error.message)
        if (!data) return null

        return new Student(data as any)
    }
}
