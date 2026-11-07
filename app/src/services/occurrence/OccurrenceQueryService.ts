import { ClassOccurrence } from '@/models/ClassOccurrence'
import { DateUtils } from '@/utils/dateUtils'
import { apiV1Client } from '@/services/api/ApiV1Client'

export class OccurrenceQueryService {
    /** The API's maximum page size for /occurrences. */
    private static readonly PAGE_SIZE = 100
    private static readonly MAX_PAGES = 50

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
        const response = await apiV1Client.get<any[]>('/occurrences?class_session_id=' + encodeURIComponent(sessionId) + '&limit=' + perPage + '&offset=' + ((page - 1) * perPage) + '&sort=occurrence_date')
        return { data: (response.data || []).map((row) => new ClassOccurrence(row)), count: Number((response.meta as any)?.total || 0) }
    }

    static async getOccurrencesByDateRange(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<ClassOccurrence[]> {
        const rows: any[] = []
        for (let page = 0; page < this.MAX_PAGES; page++) {
            const params = new URLSearchParams({ start: this.formatDate(startDate), end: this.formatDate(endDate), limit: String(this.PAGE_SIZE), offset: String(page * this.PAGE_SIZE), sort: 'occurrence_date' })
            if (sessionIds?.length) params.set('session_ids', sessionIds.join(','))
            const response = await apiV1Client.get<any[]>(`/occurrences?${params}`)
            const batch = response.data || []
            rows.push(...batch)
            const total = Number((response.meta as any)?.total)
            if (batch.length < this.PAGE_SIZE || (Number.isFinite(total) && rows.length >= total)) break
        }
        return rows.map((row) => this.fromApi(row))
    }

    static async getOccurrenceBySessionAndDate(sessionId: string, occurrenceDate: string): Promise<ClassOccurrence | null> {
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

    static async getPreferredOccurrence(
        sessionId: string,
        referenceDate: Date
    ): Promise<ClassOccurrence | null> {
        const response = await apiV1Client.get<any>(`/occurrences/${encodeURIComponent(sessionId)}/preferred?date=${encodeURIComponent(this.formatDate(referenceDate))}`)
        return response.data ? this.fromApi(response.data) : null
    }

    static async getOccurrencesByIds(occurrenceIds: string[]): Promise<ClassOccurrence[]> {
        if (occurrenceIds.length === 0) return []
        const response = await apiV1Client.get<any[]>(`/occurrences?ids=${encodeURIComponent(occurrenceIds.join(','))}&limit=${Math.min(100, occurrenceIds.length)}&offset=0&sort=occurrence_date`)
        return (response.data || []).map((row) => this.fromApi(row))
    }

    static async getAdjacentOccurrence(
        sessionId: string,
        occurrenceDate: Date,
        direction: 'previous' | 'next'
    ): Promise<ClassOccurrence | null> {
        const response = await apiV1Client.get<any>(`/occurrences/${encodeURIComponent(sessionId)}/navigation?date=${encodeURIComponent(this.formatDate(occurrenceDate))}`)
        const row = direction === 'previous' ? (response.data as any)?.previous : (response.data as any)?.next
        return row ? this.fromApi(row) : null
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
        const response = await apiV1Client.get<any>('/occurrences/' + encodeURIComponent(occurrenceId)); return this.fromApi(response.data)
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

