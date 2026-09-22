import { apiDataClient } from '@/services/api/ApiDataClient'
import { Holiday } from '@/models/Holiday'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { apiV1Client } from '@/services/api/ApiV1Client'

/**
 * Query service for holidays
 * Handles retrieval of holiday information
 */
export class HolidayQueryService {
    /**
     * Lists all holidays ordered by start date
     */
    static async listHolidays(): Promise<Holiday[]> {
        if (getApiV1Mode() === 'v1') {
            const result = await apiResourceClient.list<any>('holidays', { perPage: 100, sort: 'start_date', mode: 'v1' })
            return (result.data || []).map((dto: any) => new Holiday(dto))
        }
        const { data, error } = await apiDataClient
            .from('holidays')
            .select('*')
            .order('start_date', { ascending: true })

        if (error) throw new Error(`Failed to fetch holidays: ${error.message}`)

        return data.map((dto: any) => new Holiday(dto))
    }

    /**
     * Checks if a specific date falls within any holiday range that applies to the given scope
     * @param dateStr - Date in YYYY-MM-DD format
     * @param classroomId - Optional classroom ID
     * @param sessionId - Optional session ID
     */
    static async isHoliday(dateStr: string, classroomId?: string, sessionId?: string): Promise<boolean> {
        if (getApiV1Mode() === 'v1') { const params = new URLSearchParams({ date: dateStr }); if (classroomId) params.set('classroom_id', classroomId); if (sessionId) params.set('class_session_id', sessionId); const result = await apiV1Client.get<{ matched: boolean }>('/holidays/check?' + params.toString()); return result.data.matched }
        let query = apiDataClient
            .from('holidays')
            .select('id')
            .lte('start_date', dateStr)
            .gte('end_date', dateStr)
            .eq('kind', 'closure')
        
        // Match Global (empty arrays) OR specific IDs in arrays
        const orConditions = [
            'and(classroom_ids.eq.{},class_session_ids.eq.{})'
        ]

        if (classroomId) {
            orConditions.push(`classroom_ids.cs.{${classroomId}}`)
        }
        if (sessionId) {
            orConditions.push(`class_session_ids.cs.{${sessionId}}`)
        }

        const { data, error } = await query
            .or(orConditions.join(','))
            .limit(1)

        if (error) {
            console.error('Error checking holiday:', error)
            return false
        }

        return (data || []).length > 0
    }

    static async isTeacherOnLeave(
        dateStr: string,
        teacherId: string,
        classroomId?: string,
        sessionId?: string
    ): Promise<boolean> {
        if (getApiV1Mode() === 'v1') { const params = new URLSearchParams({ date: dateStr, teacher_id: teacherId }); if (classroomId) params.set('classroom_id', classroomId); if (sessionId) params.set('class_session_id', sessionId); const result = await apiV1Client.get<{ matched: boolean }>('/holidays/check?' + params.toString()); return result.data.matched }
        let query = apiDataClient
            .from('holidays')
            .select('id')
            .lte('start_date', dateStr)
            .gte('end_date', dateStr)
            .eq('kind', 'teacher_leave')
            .contains('teacher_ids', [teacherId])

        const orConditions = [
            'and(classroom_ids.eq.{},class_session_ids.eq.{})'
        ]

        if (classroomId) {
            orConditions.push(`classroom_ids.cs.{${classroomId}}`)
        }
        if (sessionId) {
            orConditions.push(`class_session_ids.cs.{${sessionId}}`)
        }

        const { data, error } = await query
            .or(orConditions.join(','))
            .limit(1)

        if (error) {
            console.error('Error checking teacher leave:', error)
            return false
        }

        return (data || []).length > 0
    }
}
