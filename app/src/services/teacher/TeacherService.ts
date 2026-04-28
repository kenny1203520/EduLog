import { supabase } from '@/lib/supabase'

export interface TeacherDTO {
    id?: string
    user_id: string
    name: string
    email: string
    phone?: string
    address?: string
    bio?: string
    created_at?: string
    updated_at?: string
}

export class TeacherService {
    static async getTeachers(
        page: number = 1,
        perPage: number = 100,
        search?: string
    ): Promise<{ data: TeacherDTO[]; count: number }> {
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        let query = supabase
            .from('teachers')
            .select('*', { count: 'exact' })

        if (search) {
            query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
        }

        const { data, error, count } = await query
            .order('name', { ascending: true })
            .range(from, to)

        if (error) throw new Error(`Failed to fetch teachers: ${error.message}`)

        return {
            data: (data as TeacherDTO[]) || [],
            count: count || 0
        }
    }

    static async getAllTeachers(): Promise<TeacherDTO[]> {
        const { data, error } = await supabase
            .from('teachers')
            .select('*')
            .order('name', { ascending: true })

        if (error) throw new Error(error.message)
        return (data as TeacherDTO[]) || []
    }

    static async getTeacherById(id: string): Promise<TeacherDTO> {
        const { data, error } = await supabase
            .from('teachers')
            .select('*')
            .eq('id', id)
            .single()

        if (error) throw new Error(error.message)
        return data as TeacherDTO
    }

    static async getTeacherByUserId(userId: string): Promise<TeacherDTO | null> {
        const { data, error } = await supabase
            .from('teachers')
            .select('*')
            .eq('user_id', userId)
            .single()

        if (error) {
            if (error.code === 'PGRST116') return null // No rows
            throw new Error(error.message)
        }
        return data as TeacherDTO
    }

    static async createTeacher(teacher: Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>): Promise<TeacherDTO> {
        const { data, error } = await supabase
            .from('teachers')
            .insert([teacher])
            .select()
            .single()

        if (error) throw new Error(`Failed to create teacher: ${error.message}`)
        return data as TeacherDTO
    }

    static async updateTeacher(
        id: string,
        updates: Partial<Omit<TeacherDTO, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
    ): Promise<TeacherDTO> {
        const { data, error } = await supabase
            .from('teachers')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) throw new Error(`Failed to update teacher: ${error.message}`)
        return data as TeacherDTO
    }

    static async deleteTeacher(id: string): Promise<void> {
        const { error } = await supabase
            .from('teachers')
            .delete()
            .eq('id', id)

        if (error) throw new Error(`Failed to delete teacher: ${error.message}`)
    }

    // Session-teacher relationships
    static async getSessionTeachers(sessionId: string, onDate?: string): Promise<TeacherDTO[]> {
        let query = supabase
            .from('class_session_teachers')
            .select(`
                teacher_id,
                teachers (
                    id,
                    user_id,
                    name,
                    email,
                    phone,
                    address,
                    bio,
                    created_at,
                    updated_at
                )
            `)
            .eq('class_session_id', sessionId)

        if (onDate) {
            query = query.lte('effective_from', onDate)
        }

        const { data, error } = await query
            .order('effective_from', { ascending: false })

        if (error) throw new Error(error.message)

        // Deduplicate teachers (get the most recent assignment for each teacher)
        const teacherMap = new Map<string, TeacherDTO>()
        ;(data as any[] || []).forEach(row => {
            if (row.teachers && !teacherMap.has(row.teachers.id)) {
                teacherMap.set(row.teachers.id, row.teachers as TeacherDTO)
            }
        })

        return Array.from(teacherMap.values())
    }

    static async assignTeachersToSession(
        sessionId: string,
        teacherIds: string[],
        effectiveFrom: string = new Date().toISOString().split('T')[0]
    ): Promise<void> {
        const records = teacherIds.map(teacherId => ({
            class_session_id: sessionId,
            teacher_id: teacherId,
            effective_from: effectiveFrom
        }))

        const { error } = await supabase
            .from('class_session_teachers')
            .upsert(records, { onConflict: 'class_session_id,teacher_id,effective_from' })

        if (error) throw new Error(`Failed to assign teachers: ${error.message}`)
    }

    static async removeTeacherFromSession(sessionId: string, teacherId: string): Promise<void> {
        const { error } = await supabase
            .from('class_session_teachers')
            .delete()
            .eq('class_session_id', sessionId)
            .eq('teacher_id', teacherId)

        if (error) throw new Error(`Failed to remove teacher: ${error.message}`)
    }
}
