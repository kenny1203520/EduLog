import { supabase } from '@/lib/supabase'
import { ClassOccurrence } from '@/models/ClassOccurrence'
import { DateUtils } from '@/utils/DateUtils'

export class OccurrenceQueryService {
    private static formatDate(date: Date): string {
        return DateUtils.formatLocalDate(date)
    }

    static async getOccurrencesBySession(
        sessionId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: ClassOccurrence[]; count: number }> {
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        const { data, error, count } = await supabase
            .from('class_occurrences')
            .select('*', { count: 'exact' })
            .eq('class_session_id', sessionId)
            .order('occurrence_date', { ascending: true })
            .range(from, to)

        if (error) throw new Error(`Failed to fetch occurrences: ${error.message}`)

        return {
            data: (data as any[]).map(dto => new ClassOccurrence(dto)),
            count: count || 0
        }
    }

    static async getOccurrencesByDateRange(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<ClassOccurrence[]> {
        let query = supabase
            .from('class_occurrences')
            .select(`
                *,
                class_sessions (
                    name,
                    time_zone,
                    classrooms (name, color)
                )
            `)
            .gte('occurrence_date', this.formatDate(startDate))
            .lte('occurrence_date', this.formatDate(endDate))
            .order('occurrence_date', { ascending: true })

        if (sessionIds && sessionIds.length > 0) {
            query = query.in('class_session_id', sessionIds)
        }

        const { data, error } = await query

        if (error) throw new Error(error.message)

        return (data as any[]).map((dto: any) => {
            const occ = new ClassOccurrence(dto)

            if (dto.class_sessions) {
                occ.sessionName = dto.class_sessions.name
                if (!dto.time_zone && DateUtils.isValidTimeZone(dto.class_sessions.time_zone)) {
                    occ.timeZone = dto.class_sessions.time_zone
                }
            }

            if (dto.class_sessions?.classrooms) {
                occ.classroomName = dto.class_sessions.classrooms.name
                occ.classroomColor = dto.class_sessions.classrooms.color
            }

            return occ
        })
    }

    static async getPreferredOccurrence(
        sessionId: string,
        referenceDate: Date
    ): Promise<ClassOccurrence | null> {
        const reference = this.formatDate(referenceDate)
        const { data: previous, error: previousError } = await supabase
            .from('class_occurrences')
            .select('*')
            .eq('class_session_id', sessionId)
            .lte('occurrence_date', reference)
            .order('occurrence_date', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (previousError) throw new Error(previousError.message)
        if (previous) return new ClassOccurrence(previous as any)

        const { data: next, error: nextError } = await supabase
            .from('class_occurrences')
            .select('*')
            .eq('class_session_id', sessionId)
            .gt('occurrence_date', reference)
            .order('occurrence_date', { ascending: true })
            .limit(1)
            .maybeSingle()

        if (nextError) throw new Error(nextError.message)
        return next ? new ClassOccurrence(next as any) : null
    }

    static async getOccurrencesByIds(occurrenceIds: string[]): Promise<ClassOccurrence[]> {
        if (occurrenceIds.length === 0) return []
        const { data, error } = await supabase
            .from('class_occurrences')
            .select(`
                *,
                class_sessions (
                    name,
                    time_zone,
                    classrooms (name, color)
                )
            `)
            .in('id', occurrenceIds)

        if (error) throw new Error(error.message)

        return (data as any[]).map((dto: any) => {
            const occurrence = new ClassOccurrence(dto)
            if (dto.class_sessions) {
                occurrence.sessionName = dto.class_sessions.name
                if (!dto.time_zone && DateUtils.isValidTimeZone(dto.class_sessions.time_zone)) {
                    occurrence.timeZone = dto.class_sessions.time_zone
                }
            }
            if (dto.class_sessions?.classrooms) {
                occurrence.classroomName = dto.class_sessions.classrooms.name
                occurrence.classroomColor = dto.class_sessions.classrooms.color
            }
            return occurrence
        })
    }

    static async getAdjacentOccurrence(
        sessionId: string,
        occurrenceDate: Date,
        direction: 'previous' | 'next'
    ): Promise<ClassOccurrence | null> {
        const date = this.formatDate(occurrenceDate)
        let query = supabase
            .from('class_occurrences')
            .select('*')
            .eq('class_session_id', sessionId)

        query = direction === 'previous'
            ? query.lt('occurrence_date', date).order('occurrence_date', { ascending: false })
            : query.gt('occurrence_date', date).order('occurrence_date', { ascending: true })

        const { data, error } = await query.limit(1).maybeSingle()
        if (error) throw new Error(error.message)
        return data ? new ClassOccurrence(data as any) : null
    }

    static async getOccurrenceNavigationState(
        sessionId: string,
        occurrenceDate: Date
    ): Promise<{ previous: ClassOccurrence | null; next: ClassOccurrence | null }> {
        const [previous, next] = await Promise.all([
            this.getAdjacentOccurrence(sessionId, occurrenceDate, 'previous'),
            this.getAdjacentOccurrence(sessionId, occurrenceDate, 'next')
        ])
        return { previous, next }
    }

    static async getOccurrenceById(occurrenceId: string): Promise<ClassOccurrence> {
        const { data, error } = await supabase
            .from('class_occurrences')
            .select('*')
            .eq('id', occurrenceId)
            .single()

        if (error) throw new Error(error.message)

        return new ClassOccurrence(data as any)
    }

    static async getTodayOccurrences(timeZone: string = DateUtils.getDefaultTimeZone()): Promise<ClassOccurrence[]> {
        const today = DateUtils.todayDate(timeZone)
        return this.getOccurrencesByDateRange(today, today)
    }

    static async getUpcomingOccurrences(days: number = 7, timeZone: string = DateUtils.getDefaultTimeZone()): Promise<ClassOccurrence[]> {
        const today = DateUtils.todayDate(timeZone)
        const future = DateUtils.addDays(today, days)

        return this.getOccurrencesByDateRange(today, future)
    }
}
