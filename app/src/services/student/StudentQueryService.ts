import { Student, type StudentContactDTO, type StudentCredentialDTO, type StudentDTO, type StudentSchoolDTO } from '@/models/Student'
import { PageApiService } from '@/services/api/PageApiService'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
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
        // Each sensitive section is fetched only when its read capability holds.
        const capabilities = result.data.capabilities
        const [personal, contacts, schools, credentials] = await Promise.all([
            capabilities?.personal?.read === true ? PageApiService.getStudentPrivateDetails(id).then(response => response.data?.student) : undefined,
            capabilities?.contacts?.read === true ? apiResourceClient.list<StudentContactDTO>('student-contacts', { studentId: id, sort: 'created_at' }).then(response => response.data ?? []) : undefined,
            capabilities?.schools?.read === true ? apiResourceClient.list<StudentSchoolDTO>('student-schools', { studentId: id, sort: '-start_date' }).then(response => response.data ?? []) : undefined,
            capabilities?.credentials?.read === true ? StudentCredentialsQueryService.getForStudent(id) : undefined,
        ])
        const dto: StudentDTO = { ...result.data, ...(personal ?? {}) }
        if (contacts) dto.student_contacts = contacts
        if (schools) dto.student_schools = schools
        if (credentials) dto.student_credentials = credentials satisfies StudentCredentialDTO[]
        return new Student(dto)
    }
}
