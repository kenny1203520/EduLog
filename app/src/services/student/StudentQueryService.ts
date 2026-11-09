import { Student } from '@/models/Student'
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
        const result = await PageApiService.getStudentsOverview({ limit: perPage, offset: (page - 1) * perPage, search, sort: 'name' })
        const students = (result.data || []).map((dto: any) => new Student(dto))
        return { data: students, count: Number(result.meta?.total ?? students.length) }
    }

    /**
     * Get a single student by ID
     */
    static async getById(id: string): Promise<Student | null> {
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
}
