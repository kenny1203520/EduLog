import { apiDataClient } from '@/services/api/ApiDataClient'
import { ClassOccurrence } from '@/models/ClassOccurrence'
import { DateUtils } from '@/utils/DateUtils'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

export class OccurrenceQueryService {
    private static formatDate(date: Date): string {
        return DateUtils.formatLocalDate(date)
    }

    private static fromApi(row: any): ClassOccurrence {
        const occurrence = new ClassOccurrence(row)
        const session = Array.isArray(row?.class_sessions) ? row.class_sessions[0] : row?.class_sessions
        if (session) {
            occurrence.sessionName = session.name
            if (!row.time_zone && DateUtils.isValidTimeZone(session.time_zone)) occurrence.timeZone = session.time_zone
            const classroom = Array.isArray(session.classrooms) ? session.classrooms[0] : session.classrooms
            if (classroom) {
                occurrence.classroomName = classroom.name
                occurrence.classroomColor = classroom.color
            }
        }
        return occurrence
    }

    static async getOccurrencesBySession(
        sessionId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: ClassOccurrence[]; count: number }> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<any[]>('/occurrences?class_session_id=' + encodeURIComponent(sessionId) + '&limit=' + perPage + '&offset=' + ((page - 1) * perPage) + '&sort=occurrence_date')
            return { data: (response.data || []).map((row) => new ClassOccurrence(row)), count: Number((response.meta as any)?.total || 0) }
        }
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        const { data, error, count } = await apiDataClient
            .from('class_occurrences')
            .select('*', { count: 'exact' })
            .eq('class_session_id', sessionId)
            .order('occurrence_date', { ascending: true })
            .range(from, to)

        if (error) throw new Error(`Failed to fetch occurrences: ${error.message}`)

        return {
            data: (data as any[]).map((dto: any) => new ClassOccurrence(dto)),
            count: count || 0
        }
    }

    static async getOccurrencesByDateRange(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<ClassOccurrence[]> {
        if (getApiV1Mode() === 'v1') {
            const params = new URLSearchParams({ start: this.formatDate(startDate), end: this.formatDate(endDate), limit: '100', offset: '0', sort: 'occurrence_date' })
            if (sessionIds?.length) params.set('session_ids', sessionIds.join(','))
            const response = await apiV1Client.get<any[]>(`/occurrences?${params}`)
            return (response.data || []).map((row) => this.fromApi(row))
        }
        let query = apiDataClient
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

    static async getOccurrenceBySessionAndDate(sessionId: string, occurrenceDate: string): Promise<ClassOccurrence | null> {
        if (getApiV1Mode() === 'v1') {
            const params = new URLSearchParams({
                class_session_id: sessionId,
                date: occurrenceDate,
                limit: '1',
                sort: '-created_at'
            })
            const response = await apiV1Client.get<any[]>(`/occurrences?${params}`)
            const row = response.data?.[0]
            return row ? this.fromApi(row) : null
        }

        const { data, error } = await apiDataClient
            .from('class_occurrences')
            .select('*')
            .eq('class_session_id', sessionId)
            .eq('occurrence_date', occurrenceDate)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (error) throw new Error(`Failed to fetch occurrence: ${error.message}`)
        return data ? new ClassOccurrence(data as any) : null
    }

    static async getPreferredOccurrence(
        sessionId: string,
        referenceDate: Date
    ): Promise<ClassOccurrence | null> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<any>(`/occurrences/${encodeURIComponent(sessionId)}/preferred?date=${encodeURIComponent(this.formatDate(referenceDate))}`)
            return response.data ? this.fromApi(response.data) : null
        }
        const reference = this.formatDate(referenceDate)
        const { data: previous, error: previousError } = await apiDataClient
            .from('class_occurrences')
            .select('*')
            .eq('class_session_id', sessionId)
            .lte('occurrence_date', reference)
            .order('occurrence_date', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (previousError) throw new Error(previousError.message)
        if (previous) return new ClassOccurrence(previous as any)

        const { data: next, error: nextError } = await apiDataClient
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
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<any[]>(`/occurrences?ids=${encodeURIComponent(occurrenceIds.join(','))}&limit=${Math.min(100, occurrenceIds.length)}&offset=0&sort=occurrence_date`)
            return (response.data || []).map((row) => this.fromApi(row))
        }
        const { data, error } = await apiDataClient
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
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<any>(`/occurrences/${encodeURIComponent(sessionId)}/navigation?date=${encodeURIComponent(this.formatDate(occurrenceDate))}`)
            const row = direction === 'previous' ? (response.data as any)?.previous : (response.data as any)?.next
            return row ? this.fromApi(row) : null
        }
        const date = this.formatDate(occurrenceDate)
        let query = apiDataClient
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
        if (getApiV1Mode() === 'v1') { const response = await apiV1Client.get<any>('/occurrences/' + encodeURIComponent(occurrenceId)); return this.fromApi(response.data) }
        const { data, error } = await apiDataClient
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

