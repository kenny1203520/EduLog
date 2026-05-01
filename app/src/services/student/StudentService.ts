import { Student, type StudentDTO } from '@/models/Student'
import { StudentCommandService } from './StudentCommandService'
import { StudentQueryService } from './StudentQueryService'

/**
 * Backward-compatible facade for student operations.
 * Internal responsibilities are split into command/query services.
 */
export class StudentService {
    // Query methods
    static async getAll(page: number = 1, perPage: number = 1000, search?: string): Promise<{ data: Student[], count: number }> {
        return StudentQueryService.getAll(page, perPage, search)
    }

    static async getById(id: string): Promise<Student | null> {
        return StudentQueryService.getById(id)
    }

    // Command methods - Student CRUD
    static async create(student: Partial<StudentDTO>): Promise<Student> {
        return StudentCommandService.create(student)
    }

    static async update(id: string, updates: Partial<StudentDTO>): Promise<Student> {
        return StudentCommandService.update(id, updates)
    }

    static async delete(id: string): Promise<void> {
        return StudentCommandService.delete(id)
    }

    // Contact management
    static async addContact(contact: any) {
        return StudentCommandService.addContact(contact)
    }

    static async updateContact(id: string, contact: any) {
        return StudentCommandService.updateContact(id, contact)
    }

    static async deleteContact(id: string) {
        return StudentCommandService.deleteContact(id)
    }

    // School management
    static async addSchool(school: any) {
        return StudentCommandService.addSchool(school)
    }

    static async updateSchool(id: string, school: any) {
        return StudentCommandService.updateSchool(id, school)
    }

    static async deleteSchool(id: string) {
        return StudentCommandService.deleteSchool(id)
    }

    // Credential management
    static async addCredential(credential: any) {
        return StudentCommandService.addCredential(credential)
    }

    static async updateCredential(id: string, credential: any) {
        return StudentCommandService.updateCredential(id, credential)
    }

    static async deleteCredential(id: string) {
        return StudentCommandService.deleteCredential(id)
    }
}
