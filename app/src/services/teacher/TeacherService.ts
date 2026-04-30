import { supabase } from '@/lib/supabase'

export interface TeacherDTO {
    id?: string
    user_id?: string | null
    name: string
    email: string
    phone?: string | null
    birthday?: string | null
    gov_id?: string | null
    address?: string | null
    bio?: string | null
    created_at?: string
    updated_at?: string
}

export interface TeacherStatisticsDTO {
    totalTeachers: number
    linkedAccounts: number
    unlinkedAccounts: number
    completeProfiles: number
    teachersWithBirthday: number
    teachersWithGovId: number
}

type TeacherUpsertDTO = Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>

function normalizeTeacherPayload(payload: Partial<TeacherUpsertDTO>): Partial<TeacherUpsertDTO> {
    const normalized: Partial<TeacherUpsertDTO> = { ...payload }

    ;(['user_id', 'phone', 'birthday', 'gov_id', 'address', 'bio'] as const).forEach((key) => {
        const value = normalized[key]
        if (value === '') {
            normalized[key] = null
        }
    })

    return normalized
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

    static async getTeacherByUserId(userId: string | null | undefined): Promise<TeacherDTO | null> {
        if (!userId) return null

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

    static async createTeacher(teacher: TeacherUpsertDTO): Promise<TeacherDTO> {
        const { data, error } = await supabase
            .from('teachers')
            .insert([normalizeTeacherPayload(teacher)])
            .select()
            .single()

        if (error) throw new Error(`Failed to create teacher: ${error.message}`)
        return data as TeacherDTO
    }

    static async updateTeacher(
        id: string,
        updates: Partial<Omit<TeacherDTO, 'id' | 'created_at' | 'updated_at'>>
    ): Promise<TeacherDTO> {
        const { data, error } = await supabase
            .from('teachers')
            .update(normalizeTeacherPayload(updates))
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

    static getTeacherStatistics(teachers: TeacherDTO[]): TeacherStatisticsDTO {
        const totalTeachers = teachers.length
        const linkedAccounts = teachers.filter(teacher => !!teacher.user_id).length
        const unlinkedAccounts = totalTeachers - linkedAccounts
        const completeProfiles = teachers.filter(teacher => Boolean(teacher.name && teacher.email)).length
        const teachersWithBirthday = teachers.filter(teacher => Boolean(teacher.birthday)).length
        const teachersWithGovId = teachers.filter(teacher => Boolean(teacher.gov_id)).length

        return {
            totalTeachers,
            linkedAccounts,
            unlinkedAccounts,
            completeProfiles,
            teachersWithBirthday,
            teachersWithGovId
        }
    }

    static async bulkDeleteTeachers(ids: string[]): Promise<void> {
        for (const id of ids) {
            await this.deleteTeacher(id)
        }
    }

    // Session-teacher relationships
    static async getSessionTeachers(sessionId: string, onDate?: string): Promise<(TeacherDTO & { effective_from: string, effective_to: string | null })[]> {
        let query = supabase
            .from('class_session_teachers')
            .select(`
                teacher_id,
                effective_from,
                effective_to,
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
            // Ideally we also check effective_to >= onDate or effective_to is null
            // but for simplicity we filter in memory below
        }

        const { data, error } = await query
            .order('effective_from', { ascending: false })

        if (error) throw new Error(error.message)

        // Map and optionally filter by effective_to
        const results: (TeacherDTO & { effective_from: string, effective_to: string | null })[] = []

        ;(data as any[] || []).forEach(row => {
            if (row.teachers) {
                // If onDate is provided, check effective_to
                if (onDate && row.effective_to && row.effective_to < onDate) {
                    return // Teacher assignment expired before onDate
                }
                
                results.push({
                    ...(row.teachers as TeacherDTO),
                    effective_from: row.effective_from,
                    effective_to: row.effective_to
                })
            }
        })

        return results
    }

    static async replaceTeachersForSession(
        sessionId: string,
        teachers: { teacher_id: string, effective_from: string, effective_to?: string | null }[]
    ): Promise<void> {
        await this.clearSessionTeachers(sessionId)

        if (teachers.length === 0) return

        await this.assignTeachersToSession(sessionId, teachers)
    }

    static async assignTeachersToSession(
        sessionId: string,
        teachers: { teacher_id: string, effective_from: string, effective_to?: string | null }[]
    ): Promise<void> {
        if (teachers.length === 0) return

        const records = teachers.map(t => ({
            class_session_id: sessionId,
            teacher_id: t.teacher_id,
            effective_from: t.effective_from,
            effective_to: t.effective_to || null
        }))
        const { error } = await supabase
            .from('class_session_teachers')
            .insert(records)

        if (error) throw new Error(`Failed to assign teachers: ${error.message}`)
    }

    static async assignTeacherForDate(sessionId: string, teacherId: string, date: string): Promise<void> {
        const { error } = await supabase
            .from('class_session_teachers')
            .upsert({
                class_session_id: sessionId,
                teacher_id: teacherId,
                effective_from: date,
                effective_to: date
            }, { onConflict: 'class_session_id,teacher_id,effective_from' })

        if (error) throw new Error(`Failed to assign teacher for date: ${error.message}`)
    }

    static async removeTeacherAssignment(sessionId: string, teacherId: string, effectiveFrom: string): Promise<void> {
        const { error } = await supabase
            .from('class_session_teachers')
            .delete()
            .eq('class_session_id', sessionId)
            .eq('teacher_id', teacherId)
            .eq('effective_from', effectiveFrom)

        if (error) throw new Error(`Failed to remove teacher assignment: ${error.message}`)
    }

    static async clearSessionTeachers(sessionId: string): Promise<void> {
        const { error } = await supabase
            .from('class_session_teachers')
            .delete()
            .eq('class_session_id', sessionId)

        if (error) throw new Error(`Failed to clear session teachers: ${error.message}`)
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
