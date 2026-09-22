import { apiDataClient } from '@/services/api/ApiDataClient'
import { Student, type StudentDTO } from '@/models/Student'
import { EnrollmentService } from '../enrollment/EnrollmentService'
import { DateUtils } from '@/utils/DateUtils'
import { createTextEditorContent } from '@/components/common/text-editor/content'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

/**
 * Command service for students
 * Handles creation, updating, and deletion of students and related entities
 */
export class StudentCommandService {
    /**
     * Create a new student
     */
    static async create(student: Partial<StudentDTO>): Promise<Student> {
        if (getApiV1Mode() === 'v1') {
            const result = await apiResourceClient.create<any>('students', this.normalizeStudent(student), 'v1')
            return new Student(result.data)
        }
        const { data: { user } } = await apiDataClient.auth.getUser()
        if (!user) throw new Error('User not authenticated')

        const { data, error } = await apiDataClient
            .from('students')
            .insert(this.normalizeStudent(student))
            .select()
            .single()

        if (error) throw new Error(error.message)

        return new Student(data as StudentDTO)
    }

    /**
     * Update an existing student
     */
    static async update(id: string, updates: Partial<StudentDTO>): Promise<Student> {
        if (getApiV1Mode() === 'v1') {
            const result = await apiResourceClient.update<any>('students', id, this.normalizeStudent(updates), 'v1')
            return new Student(result.data)
        }
        const { data, error } = await apiDataClient
            .from('students')
            .update(this.normalizeStudent(updates))
            .eq('id', id)
            .select()
            .single()

        if (error) throw new Error(error.message)

        return new Student(data as StudentDTO)
    }

    private static normalizeStudent(student: Partial<StudentDTO>): Partial<StudentDTO> {
        if (student.notes_document || student.notes !== undefined) {
            const notes = createTextEditorContent(student.notes_document || student.notes || '')
            return { ...student, notes: notes.plainText, notes_document: notes.richText }
        }
        return student
    }

    /**
     * Delete a student
     * Performs manual cascade delete to ensure all related records are removed.
     */
    static async delete(id: string): Promise<void> {
        if (getApiV1Mode() === 'v1') { await apiResourceClient.remove('students', id, 'v1'); return }
        // 0. Delete Enrollments via EnrollmentService (this triggers occurrence sync)
        const enrollments = await EnrollmentService.getByStudentId(id)
        for (const enr of enrollments) {
            if (enr.id) {
                await EnrollmentService.delete(enr.id)
            }
        }

        // 1. Delete Contacts
        const { error: e1 } = await apiDataClient.from('student_contacts').delete().eq('student_id', id)
        if (e1) throw new Error('Failed to delete contacts: ' + e1.message)

        // 2. Delete Schools
        const { error: e2 } = await apiDataClient.from('student_schools').delete().eq('student_id', id)
        if (e2) throw new Error('Failed to delete schools: ' + e2.message)

        // 3. Delete Credentials
        const { error: e3 } = await apiDataClient.from('student_credentials').delete().eq('student_id', id)
        if (e3) throw new Error('Failed to delete credentials: ' + e3.message)

        // 5. Finally Delete Student
        const { data, error } = await apiDataClient
            .from('students')
            .delete()
            .eq('id', id)
            .select()

        if (error) throw new Error(error.message)

        if (data?.length === 0) {
            throw new Error('Delete failed: No records deleted. This usually means Row Level Security (RLS) policies are blocking the deletion or you do not have permission.')
        }
    }

    // --- Contacts ---
    static async addContact(contact: any) {
        if (getApiV1Mode() === 'v1') return (await apiResourceClient.create<any>('student-contacts', contact, 'v1')).data
        const { data: { user } } = await apiDataClient.auth.getUser()
        if (!user) throw new Error('User not authenticated')
        const { data, error } = await apiDataClient.from('student_contacts').insert(contact).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async updateContact(id: string, contact: any) {
        if (getApiV1Mode() === 'v1') return (await apiResourceClient.update<any>('student-contacts', id, contact, 'v1')).data
        const { data, error } = await apiDataClient.from('student_contacts').update(contact).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async deleteContact(id: string) {
        if (getApiV1Mode() === 'v1') { await apiResourceClient.remove<any>('student-contacts', id, 'v1'); return }
        const { error } = await apiDataClient.from('student_contacts').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    // --- Schools ---
    static async addSchool(school: any) {
        const timeZone = DateUtils.isValidTimeZone(school.time_zone) ? school.time_zone : DateUtils.getDefaultTimeZone()
        if (getApiV1Mode() === 'v1') return (await apiResourceClient.create<any>('student-schools', { ...school, time_zone: timeZone }, 'v1')).data
        const { data: { user } } = await apiDataClient.auth.getUser()
        if (!user) throw new Error('User not authenticated')
        const { data, error } = await apiDataClient.from('student_schools').insert({ ...school, time_zone: timeZone }).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async updateSchool(id: string, school: any) {
        const updates = {
            ...school,
            time_zone: DateUtils.isValidTimeZone(school.time_zone) ? school.time_zone : DateUtils.getDefaultTimeZone()
        }
        if (getApiV1Mode() === 'v1') return (await apiResourceClient.update<any>('student-schools', id, updates, 'v1')).data
        const { data, error } = await apiDataClient.from('student_schools').update(updates).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async deleteSchool(id: string) {
        if (getApiV1Mode() === 'v1') { await apiResourceClient.remove<any>('student-schools', id, 'v1'); return }
        const { error } = await apiDataClient.from('student_schools').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    // --- Credentials ---
    static async addCredential(credential: any) {
        if (getApiV1Mode() === 'v1') return (await apiResourceClient.create<any>('student-credentials', credential, 'v1')).data
        const { data: { user } } = await apiDataClient.auth.getUser()
        if (!user) throw new Error('User not authenticated')
        const { data, error } = await apiDataClient.from('student_credentials').insert(credential).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async updateCredential(id: string, credential: any) {
        if (getApiV1Mode() === 'v1') return (await apiResourceClient.update<any>('student-credentials', id, credential, 'v1')).data
        const { data, error } = await apiDataClient.from('student_credentials').update(credential).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async deleteCredential(id: string) {
        if (getApiV1Mode() === 'v1') { await apiResourceClient.remove<any>('student-credentials', id, 'v1'); return }
        const { error } = await apiDataClient.from('student_credentials').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }
}
