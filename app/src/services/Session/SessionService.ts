import { supabase } from '@/lib/supabase'
import type { ClassSessionDTO } from '@/models/Classroom'
import { VisibilityPreferenceService } from '../VisibilityPreferenceService'

export type SessionVisibilityFilterMode = 'all' | 'visible' | 'hidden'

export class SessionService {
    static async getClassSessions(
        page: number = 1,
        perPage: number = 100,
        search?: string,
        classroomId?: string | null,
        visibilityMode: SessionVisibilityFilterMode = 'all'
    ): Promise<{ data: ClassSessionDTO[], count: number }> {
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        if (visibilityMode === 'all') {
            let query = supabase
                .from('class_sessions')
                .select('*', { count: 'exact' })

            if (search) {
                query = query.ilike('name', `%${search}%`)
            }

            if (classroomId) {
                query = query.eq('classroom_id', classroomId)
            }

            const { data, error, count } = await query
                .order('name', { ascending: true })
                .range(from, to)

            if (error) throw new Error(error.message)
            return { data: data as ClassSessionDTO[], count: count || 0 }
        }

        const chunkSize = Math.max(perPage, 250)
        const allSessions: ClassSessionDTO[] = []

        for (let offset = 0; ; offset += chunkSize) {
            let query = supabase
                .from('class_sessions')
                .select('*')

            if (search) {
                query = query.ilike('name', `%${search}%`)
            }

            if (classroomId) {
                query = query.eq('classroom_id', classroomId)
            }

            const { data, error } = await query
                .order('name', { ascending: true })
                .range(offset, offset + chunkSize - 1)

            if (error) throw new Error(error.message)

            const chunk = (data || []) as ClassSessionDTO[]
            allSessions.push(...chunk)

            if (chunk.length < chunkSize) {
                break
            }
        }

        const sessionIds = allSessions
            .map(session => session.id)
            .filter((id): id is string => Boolean(id))
        const hiddenIds = await VisibilityPreferenceService.getHiddenEntityIds('class_session', sessionIds)
        const filteredSessions = allSessions.filter(session => {
            const isHidden = !!session.id && hiddenIds.has(session.id)
            return visibilityMode === 'hidden' ? isHidden : !isHidden
        })

        return {
            data: filteredSessions.slice(from, to + 1),
            count: filteredSessions.length
        }
    }

    static async createClassSession(session: Partial<ClassSessionDTO>): Promise<ClassSessionDTO> {
        const { data, error } = await supabase.from('class_sessions').insert(session).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async updateClassSession(id: string, updates: Partial<ClassSessionDTO>): Promise<ClassSessionDTO> {
        const { data, error } = await supabase.from('class_sessions').update(updates).eq('id', id).select().single()
        if (error) throw new Error(error.message)
        return data
    }

    static async deleteClassSession(id: string): Promise<void> {
        const { error } = await supabase.from('class_sessions').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    static async getSessionDetails(sessionId: string) {
        const { data: session, error: sessionError } = await supabase
            .from('class_sessions')
            .select(`
          *,
          classroom:classrooms!classroom_id(id, name, address, external_link)
        `)
            .eq('id', sessionId)
            .single()

        if (sessionError) throw new Error(sessionError.message)

        const { count, error: countError } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('class_session_id', sessionId)
            .eq('status', 'active')

        if (countError) throw new Error(countError.message)

        return {
            ...session,
            classroom_name: session.classroom?.name || 'Unknown',
            classroom_address: session.classroom?.address || '',
            current_enrollments: count || 0
        }
    }
}
