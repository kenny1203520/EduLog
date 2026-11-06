import type { ClassSessionDTO } from '@/models/Classroom'
import { ClassSessionFactory, type ClassSessionScheduleRuleDTO } from '@/models/ClassSession'
import { VisibilityPreferenceService } from '../VisibilityPreferenceService'
import { DateUtils } from '@/utils/DateUtils'
import { SessionEligibilityPolicy } from '@/models/SessionEligibilityPolicy'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { apiV1Client } from '@/services/api/ApiV1Client'

export type SessionVisibilityFilterMode = 'all' | 'visible' | 'hidden'

export interface ClassSessionOption {
    id: string
    name: string
    classroom_id?: string | null
    course_ids?: string[]
}

export class SessionService {
    private static hydrateSession(data: any): ClassSessionDTO {
        return {
            ...data,
            schedule_rules: data?.schedule_rules || data?.class_session_schedule_rules || []
        }
    }

    private static toScheduleRuleInput(rule: ClassSessionScheduleRuleDTO): Omit<ClassSessionScheduleRuleDTO, 'id' | 'class_session_id' | 'created_at' | 'updated_at'> {
        const input = { ...rule }
        delete input.id
        delete input.class_session_id
        delete input.created_at
        delete input.updated_at
        return input
    }

    static async getClassSessions(
        page: number = 1,
        perPage: number = 100,
        search?: string,
        classroomId?: string | null,
        visibilityMode: SessionVisibilityFilterMode = 'all'
    ): Promise<{ data: ClassSessionDTO[], count: number }> {
        if (visibilityMode === 'all') {
            const response = await apiResourceClient.list<any>('class-sessions', { page, perPage, search, sort: 'name', classroomId: classroomId || undefined })
            let rows = (response.data || []).map(this.hydrateSession)
            if (classroomId) rows = rows.filter((row: any) => row.classroom_id === classroomId)
            return { data: rows, count: Number(response.meta?.total ?? rows.length) }
        }
        const from = (page - 1) * perPage
        const to = from + perPage - 1
        const allSessions: ClassSessionDTO[] = []
        for (let chunkPage = 1; ; chunkPage += 1) {
            const response = await apiResourceClient.list<any>('class-sessions', { page: chunkPage, perPage: 100, search, sort: 'name', classroomId: classroomId || undefined })
            const chunk = (response.data || []).map(this.hydrateSession)
            allSessions.push(...(classroomId ? chunk.filter((row: any) => row.classroom_id === classroomId) : chunk))
            const total = Number(response.meta?.total ?? 0)
            if (chunk.length < 100 || (total > 0 && chunkPage * 100 >= total)) break
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

    static async getAllClassSessions(search?: string, classroomId?: string | null, visibilityMode: SessionVisibilityFilterMode = 'all'): Promise<{ data: ClassSessionDTO[], count: number }> {
        const pageSize = 100
        const sessions: ClassSessionDTO[] = []
        let page = 1
        let total = 0
        do {
            const result = await this.getClassSessions(page, pageSize, search, classroomId, visibilityMode)
            sessions.push(...result.data)
            total = result.count
            page += 1
            if (result.data.length === 0) break
        } while (sessions.length < total)
        return { data: sessions, count: total }
    }

    static async getClassSessionOptions(page: number = 1, perPage: number = 100): Promise<{ data: ClassSessionOption[]; count: number }> {
        const pageSize = Math.min(Math.max(1, Math.trunc(perPage)), 100)
        const response = await apiResourceClient.list<ClassSessionOption>('class-sessions', { page, perPage: pageSize, sort: 'name' })
        return { data: response.data || [], count: Number(response.meta?.total ?? response.data?.length ?? 0) }
    }

    static async getAllClassSessionOptions(): Promise<{ data: ClassSessionOption[], count: number }> {
        const pageSize = 100
        const sessions: ClassSessionOption[] = []
        let page = 1
        let total = 0
        do {
            const result = await this.getClassSessionOptions(page, pageSize)
            sessions.push(...result.data)
            total = result.count
            page += 1
            if (result.data.length === 0) break
        } while (sessions.length < total)
        return { data: sessions, count: total }
    }
    static async createClassSession(session: Partial<ClassSessionDTO>): Promise<ClassSessionDTO> {
        return this.saveClassSession(session)
    }

    static async updateClassSession(id: string, updates: Partial<ClassSessionDTO>): Promise<ClassSessionDTO> {
        return this.saveClassSession(updates, id)
    }

    static async saveClassSession(session: Partial<ClassSessionDTO>, id?: string): Promise<ClassSessionDTO> {
        const rules = (session.schedule_rules || session.class_session_schedule_rules || []) as ClassSessionScheduleRuleDTO[]
        const payload = { name: session.name || '', classroom_id: session.classroom_id || null, course_ids: session.course_ids || [], capacity: session.capacity ?? 10, lesson_number: session.lesson_number ?? null, external_link: session.external_link || null, start_date: session.start_date || null, end_date: session.end_date || null, time_zone: DateUtils.isValidTimeZone(session.time_zone) ? session.time_zone : DateUtils.getDefaultTimeZone(), session_type: session.session_type || 'regular', schedule_mode: session.schedule_mode || (session.session_type === 'camp' ? 'specific_dates' : 'weekly'), schedule_rules: rules.map(this.toScheduleRuleInput) }
        const response = id ? await apiResourceClient.update<any>('class-sessions', id, payload) : await apiResourceClient.create<any>('class-sessions', payload)
        return this.hydrateSession(response.data)
    }

    static async getClassSession(id: string): Promise<ClassSessionDTO> {
        const response = await apiResourceClient.get<any>('class-sessions', id)
        return this.hydrateSession(response.data)
    }

    /**
     * Loads a class session and verifies that it can teach the requested course.
     */
    static async getCompatibleClassSession(sessionId: string, courseId: string): Promise<ClassSessionDTO> {
        const session = await this.getClassSession(sessionId)
        if (!SessionEligibilityPolicy.supportsCourse(session, courseId)) {
            throw new Error('TARGET_SESSION_COURSE_MISMATCH')
        }
        return session
    }

    static async isScheduledOn(sessionId: string, date: string): Promise<boolean> {
        const session = await this.getClassSession(sessionId)
        return ClassSessionFactory.create(session).isScheduledOn(date)
    }

    static async getNextScheduledDate(sessionId: string, afterDate: string): Promise<string | null> {
        const session = ClassSessionFactory.create(await this.getClassSession(sessionId))
        const start = DateUtils.addDays(DateUtils.parseLocalDate(afterDate) || new Date(afterDate), 1)
        let end = new Date(start)
        end.setFullYear(end.getFullYear() + 2)
        if (session.endDate) end = DateUtils.parseLocalDate(session.endDate) || end
        return session.plannedOccurrences(start, end)[0]?.occurrenceDate || null
    }

    static async getGenerationEndDate(sessionId: string, startDate: string, targetCount: number): Promise<Date> {
        const session = ClassSessionFactory.create(await this.getClassSession(sessionId))
        const start = DateUtils.parseLocalDate(startDate) || new Date(startDate)
        if (session.sessionType === 'camp') {
            return DateUtils.parseLocalDate(session.endDate || '') || start
        }

        let end = new Date(start)
        end.setMonth(end.getMonth() + 6)
        const maximum = new Date(start)
        maximum.setFullYear(maximum.getFullYear() + 5)
        if (session.endDate) {
            const configuredEnd = DateUtils.parseLocalDate(session.endDate)
            if (configuredEnd && configuredEnd < maximum) maximum.setTime(configuredEnd.getTime())
        }

        while (end < maximum && session.plannedOccurrences(start, end).length < targetCount) {
            end.setMonth(end.getMonth() + 6)
        }
        return end > maximum ? maximum : end
    }

    static async deleteClassSession(id: string): Promise<void> {
        await apiResourceClient.remove('class-sessions', id)
        return
    }

    static async getSessionDetails(sessionId: string) {
        const response = await apiV1Client.get<any>('/class-sessions/' + encodeURIComponent(sessionId) + '/details')
        return response.data
    }

    static async getMaxEnrollmentInDateRange(sessionId: string, startDate: string, endDate: string): Promise<number> {
        const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
        const response = await apiV1Client.get<{ max_occupancy?: number }>('/class-sessions/' + encodeURIComponent(sessionId) + '/enrollment-peak?' + params.toString())
        return Number(response.data?.max_occupancy ?? 0)
    }
}
