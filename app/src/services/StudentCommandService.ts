import { supabase } from '@/lib/supabase'
import { Student, type StudentDTO } from '@/models/Student'
import { EnrollmentService } from './EnrollmentService'

/**
 * Command service for students
 * Handles creation, updating, and deletion of students and related entities
 */
export class StudentCommandService {
    /**
     * Create a new student
     */
    static async create(student: Partial<StudentDTO>): Promise<Student> {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')

        const { data, error } = await supabase
            .from('students')
            .insert({ ...student, user_id: user.id })
            .select()
            .single()

        if (error) throw new Error(error.message)

        return new Student(data as StudentDTO)
    }

    /**
     * Update an existing student
     */
    static async update(id: string, updates: Partial<StudentDTO>): Promise<Student> {
        const { data, error } = await supabase
            .from('students')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) throw new Error(error.message)

        return new Student(data as StudentDTO)
    }

    /**
     * Delete a student
     * Performs manual cascade delete to ensure all related records are removed.
     */
    static async delete(id: string): Promise<void> {
        // 0. Delete Enrollments via EnrollmentService (this triggers occurrence sync)
        const enrollments = await EnrollmentService.getByStudentId(id)
        for (const enr of enrollments) {
            if (enr.id) {
                await EnrollmentService.delete(enr.id)
            }
        }

        // 1. Delete Contacts
        const { error: e1 } = await supabase.from('student_contacts').delete().eq('student_id', id)
        if (e1) throw new Error('Failed to delete contacts: ' + e1.message)

        // 2. Delete Schools
        const { error: e2 } = await supabase.from('student_schools').delete().eq('student_id', id)
        if (e2) throw new Error('Failed to delete schools: ' + e2.message)

        // 3. Delete Credentials
        const { error: e3 } = await supabase.from('student_credentials').delete().eq('student_id', id)
        if (e3) throw new Error('Failed to delete credentials: ' + e3.message)

        // 4. Delete Reports (Legacy or linked)
        const { error: e4 } = await supabase.from('reports').delete().eq('student_id', id)
        if (e4 && e4.code !== '42P01') {
            throw new Error('Failed to delete reports: ' + e4.message)
        }

        // 5. Finally Delete Student
        const { data, error } = await supabase
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
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')
        const { data, error } = await supabase.from('student_contacts').insert({ ...contact, user_id: user.id }).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async updateContact(id: string, contact: any) {
        const { data, error } = await supabase.from('student_contacts').update(contact).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async deleteContact(id: string) {
        const { error } = await supabase.from('student_contacts').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    // --- Schools ---
    static async addSchool(school: any) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')
        const { data, error } = await supabase.from('student_schools').insert({ ...school, user_id: user.id }).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async updateSchool(id: string, school: any) {
        const { data, error } = await supabase.from('student_schools').update(school).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async deleteSchool(id: string) {
        const { error } = await supabase.from('student_schools').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    // --- Credentials ---
    static async addCredential(credential: any) {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')
        const { data, error } = await supabase.from('student_credentials').insert({ ...credential, user_id: user.id }).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async updateCredential(id: string, credential: any) {
        const { data, error } = await supabase.from('student_credentials').update(credential).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async deleteCredential(id: string) {
        const { error } = await supabase.from('student_credentials').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }
}
