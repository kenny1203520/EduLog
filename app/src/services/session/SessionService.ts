import { supabase } from '@/lib/supabase'
import type { ClassSessionDTO } from '@/models/Classroom'
import { ClassSessionFactory, type ClassSessionScheduleRuleDTO } from '@/models/ClassSession'
import { VisibilityPreferenceService } from '../VisibilityPreferenceService'
import { DateUtils } from '@/utils/DateUtils'
import { SessionEligibilityPolicy } from '@/models/SessionEligibilityPolicy'

export type SessionVisibilityFilterMode = 'all' | 'visible' | 'hidden'

export class SessionService {
    private static hydrateSession(data: any): ClassSessionDTO {
        return {
            ...data,
            schedule_rules: data?.schedule_rules || data?.class_session_schedule_rules || []
        }
    }

    private static scheduleSelect = '*, class_session_schedule_rules(*)'

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
                .select(this.scheduleSelect, { count: 'exact' })

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
            return { data: (data || []).map(this.hydrateSession), count: count || 0 }
        }

        const chunkSize = Math.max(perPage, 250)
        const allSessions: ClassSessionDTO[] = []

        for (let offset = 0; ; offset += chunkSize) {
            let query = supabase
                .from('class_sessions')
                .select(this.scheduleSelect)

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

            const chunk = (data || []).map(this.hydrateSession)
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
        return this.saveClassSession(session)
    }

    static async updateClassSession(id: string, updates: Partial<ClassSessionDTO>): Promise<ClassSessionDTO> {
        return this.saveClassSession(updates, id)
    }

    static async saveClassSession(session: Partial<ClassSessionDTO>, id?: string): Promise<ClassSessionDTO> {
        const rules = (session.schedule_rules || session.class_session_schedule_rules || []) as ClassSessionScheduleRuleDTO[]
        const payload = {
            name: session.name || '',
            classroom_id: session.classroom_id || null,
            course_ids: session.course_ids || [],
            capacity: session.capacity ?? 10,
            lesson_number: session.lesson_number ?? null,
            external_link: session.external_link || null,
            start_date: session.start_date || null,
            end_date: session.end_date || null,
            time_zone: session.time_zone || 'Asia/Taipei',
            session_type: session.session_type || 'regular',
            schedule_mode: session.schedule_mode || (session.session_type === 'camp' ? 'specific_dates' : 'weekly')
        }

        const model = ClassSessionFactory.create({
            ...payload,
            id,
            schedule_rules: rules
        } as ClassSessionDTO)
        const validationErrors = model.validate()
        if (validationErrors.length > 0) throw new Error(validationErrors[0])

        const { data: savedId, error } = await supabase.rpc('save_class_session_with_schedule', {
            p_session: payload,
            p_rules: rules.map(rule => ({
                schedule_kind: rule.schedule_kind,
                day_of_week: rule.day_of_week ?? null,
                day_of_month: rule.day_of_month ?? null,
                occurrence_date: rule.occurrence_date || null,
                start_time: rule.start_time,
                end_time: rule.end_time
            })),
            p_session_id: id || null
        })
        if (error) throw new Error(error.message)
        return this.getClassSession(String(savedId))
    }

    static async getClassSession(id: string): Promise<ClassSessionDTO> {
        const { data, error } = await supabase
            .from('class_sessions')
            .select(this.scheduleSelect)
            .eq('id', id)
            .single()
        if (error) throw new Error(error.message)
        return this.hydrateSession(data)
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
        const { error } = await supabase.from('class_sessions').delete().eq('id', id)
        if (error) throw new Error(error.message)
    }

    static async getSessionDetails(sessionId: string) {
        const { data: session, error: sessionError } = await supabase
            .from('class_sessions')
            .select(`
          *,
          class_session_schedule_rules(*),
          classroom:classrooms!classroom_id(id, name, address, external_link)
        `)
            .eq('id', sessionId)
            .single()

        if (sessionError) throw new Error(sessionError.message)

        const { count, error: countError } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('class_session_id', sessionId)
            .eq('status', 'regular')

        if (countError) throw new Error(countError.message)

        return {
            ...this.hydrateSession(session),
            classroom_name: session.classroom?.name || 'Unknown',
            classroom_address: session.classroom?.address || '',
            current_enrollments: count || 0
        }
    }

    static async getMaxEnrollmentInDateRange(sessionId: string, startDate: string, endDate: string): Promise<number> {
        const { data: occurrences, error } = await supabase
            .from('class_occurrences')
            .select(`
                id,
                occurrence_date,
                occurrence_reports ( count )
            `)
            .eq('class_session_id', sessionId)
            .gte('occurrence_date', startDate)
            .lte('occurrence_date', endDate)

        if (error) throw new Error(error.message)
        if (!occurrences || occurrences.length === 0) return 0

        let maxCount = 0
        for (const occ of occurrences) {
            let count = 0
            if (Array.isArray(occ.occurrence_reports)) {
                count = occ.occurrence_reports[0]?.count || 0
            } else if (occ.occurrence_reports && typeof occ.occurrence_reports === 'object') {
                count = (occ.occurrence_reports as any).count || 0
            }
            if (count > maxCount) {
                maxCount = count
            }
        }
        return maxCount
    }
}
