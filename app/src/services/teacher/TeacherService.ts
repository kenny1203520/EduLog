import { supabase } from '@/lib/supabase'
import type { RichTextDocumentV1 } from '@/components/common/text-editor/types'
import { createTextEditorContent } from '@/components/common/text-editor/content'

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
    bio_document?: RichTextDocumentV1 | null
    teacher_credentials?: TeacherCredentialDTO[]
    created_at?: string
    updated_at?: string
}

export interface SessionTeacherAssignmentDTO extends TeacherDTO {
    effective_from: string
    effective_to: string | null
    role_id: string
    role?: { id: string; name: string; code?: string | null } | null
}

export interface TeacherCredentialDTO {
    id?: string
    teacher_id?: string
    platform: string
    username?: string
    password?: string
    url?: string
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

    if (normalized.bio_document || normalized.bio !== undefined) {
        const bio = createTextEditorContent(normalized.bio_document || normalized.bio || '')
        normalized.bio = bio.plainText || null
        normalized.bio_document = bio.richText
    }

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

    static async getAllTeachersWithCredentials(): Promise<TeacherDTO[]> {
        const { data, error } = await supabase
            .from('teachers')
            .select('*, teacher_credentials(*)')
            .order('name', { ascending: true })

        if (error) throw new Error(error.message)
        return (data as TeacherDTO[]) || []
    }

    static async getTeacherById(id: string): Promise<TeacherDTO> {
        const { data, error } = await supabase
            .from('teachers')
            .select('*, teacher_credentials(*)')
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
            .maybeSingle()

        if (error) {
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
        if (ids.length === 0) return
        const { error } = await supabase
            .from('teachers')
            .delete()
            .in('id', ids)

        if (error) throw new Error(`Failed to delete teachers: ${error.message}`)
    }

    static async addCredential(credential: TeacherCredentialDTO): Promise<TeacherCredentialDTO> {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('User not authenticated')

        const { data, error } = await supabase
            .from('teacher_credentials')
            .insert({ ...credential, user_id: user.id })
            .select()
            .single()

        if (error) throw new Error(error.message)
        return data as TeacherCredentialDTO
    }

    static async updateCredential(id: string, credential: Partial<TeacherCredentialDTO>): Promise<TeacherCredentialDTO> {
        const { data, error } = await supabase
            .from('teacher_credentials')
            .update(credential)
            .eq('id', id)
            .select()
            .single()

        if (error) throw new Error(error.message)
        return data as TeacherCredentialDTO
    }

    static async deleteCredential(id: string): Promise<void> {
        const { error } = await supabase
            .from('teacher_credentials')
            .delete()
            .eq('id', id)

        if (error) throw new Error(error.message)
    }

    // Session-teacher relationships
    static async getSessionTeachers(sessionId: string, onDate?: string): Promise<SessionTeacherAssignmentDTO[]> {
        let query = supabase
            .from('class_session_teachers')
            .select(`
                teacher_id,
                effective_from,
                effective_to,
                role_id,
                roles (id, name, code),
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
        const results: SessionTeacherAssignmentDTO[] = []

        ;(data as any[] || []).forEach(row => {
            if (row.teachers) {
                // If onDate is provided, check effective_to
                if (onDate && row.effective_to && row.effective_to < onDate) {
                    return // Teacher assignment expired before onDate
                }
                
                results.push({
                    ...(row.teachers as TeacherDTO),
                    effective_from: row.effective_from,
                    effective_to: row.effective_to,
                    role_id: row.role_id,
                    role: row.roles || null
                })
            }
        })

        return results
    }

    static async replaceTeachersForSession(
        sessionId: string,
        teachers: { teacher_id: string, role_id: string, effective_from: string, effective_to?: string | null }[]
    ): Promise<void> {
        await this.clearSessionTeachers(sessionId)

        if (teachers.length === 0) return

        await this.assignTeachersToSession(sessionId, teachers)
    }

    static async assignTeachersToSession(
        sessionId: string,
        teachers: { teacher_id: string, role_id: string, effective_from: string, effective_to?: string | null }[]
    ): Promise<void> {
        if (teachers.length === 0) return

        const records = teachers.map(t => ({
            class_session_id: sessionId,
            teacher_id: t.teacher_id,
            role_id: t.role_id,
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
