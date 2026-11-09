import { Student, type StudentDTO, type StudentSchoolCreate, type StudentSchoolUpdate } from '@/models/Student'
import { DateUtils } from '@/utils/dateUtils'
import { createTextEditorContent } from '@/components/text-editor/content'
import { apiResourceClient } from '@/services/api/ApiResourceClient'

/**
 * Command service for students
 * Handles creation, updating, and deletion of students and related entities
 */
export class StudentCommandService {
    /**
     * Create a new student
     */
    static async create(student: Partial<StudentDTO>): Promise<Student> {
        const result = await apiResourceClient.create<any>('students', this.normalizeStudent(student))
        return new Student(result.data)
    }

    /**
     * Update an existing student
     */
    static async update(id: string, updates: Partial<StudentDTO>): Promise<Student> {
        const result = await apiResourceClient.update<any>('students', id, this.normalizeStudent(updates))
        return new Student(result.data)
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
        await apiResourceClient.remove('students', id); return
    }

    // --- Contacts ---
    static async addContact(contact: any) {
        return (await apiResourceClient.create<any>('student-contacts', contact)).data
    }

    static async updateContact(id: string, contact: any) {
        return (await apiResourceClient.update<any>('student-contacts', id, contact)).data
    }

    static async deleteContact(id: string) {
        await apiResourceClient.remove<any>('student-contacts', id); return
    }

    // --- Schools ---
    private static normalizeSchool(school: StudentSchoolUpdate): StudentSchoolUpdate {
        const payload: StudentSchoolUpdate = {}
        const fields = ['student_id', 'name', 'status', 'grade', 'class', 'school_student_id', 'start_date', 'end_date', 'time_zone'] as const
        for (const field of fields) {
            if (school[field] === undefined) continue
            const value = school[field]
            Object.assign(payload, { [field]: (field === 'start_date' || field === 'end_date') && value === '' ? null : value })
        }
        if (school.time_zone !== undefined) {
            payload.time_zone = DateUtils.isValidTimeZone(school.time_zone ?? undefined) ? school.time_zone : DateUtils.getDefaultTimeZone()
        }
        return payload
    }

    static async addSchool(school: StudentSchoolCreate) {
        const payload = this.normalizeSchool({ ...school, time_zone: school.time_zone ?? DateUtils.getDefaultTimeZone() })
        return (await apiResourceClient.create<any>('student-schools', payload)).data
    }

    static async updateSchool(id: string, school: StudentSchoolUpdate) {
        const updates = this.normalizeSchool(school)
        return (await apiResourceClient.update<any>('student-schools', id, updates)).data
    }

    static async deleteSchool(id: string) {
        await apiResourceClient.remove<any>('student-schools', id); return
    }

    // --- Credentials ---
    static async addCredential(credential: any) {
        return (await apiResourceClient.create<any>('student-credentials', credential)).data
    }

    static async updateCredential(id: string, credential: any) {
        return (await apiResourceClient.update<any>('student-credentials', id, credential)).data
    }

    static async deleteCredential(id: string) {
        await apiResourceClient.remove<any>('student-credentials', id); return
    }
}
