import { Holiday } from '@/models/Holiday'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
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
        const result = await apiResourceClient.list<any>('holidays', { perPage: 100, sort: 'start_date' })
        return (result.data || []).map((dto: any) => new Holiday(dto))
    }

    /**
     * Checks if a specific date falls within any holiday range that applies to the given scope
     * @param dateStr - Date in YYYY-MM-DD format
     * @param classroomId - Optional classroom ID
     * @param sessionId - Optional session ID
     */
    static async isHoliday(dateStr: string, classroomId?: string, sessionId?: string): Promise<boolean> {
        const params = new URLSearchParams({ date: dateStr }); if (classroomId) params.set('classroom_id', classroomId); if (sessionId) params.set('class_session_id', sessionId); const result = await apiV1Client.get<{ matched: boolean }>('/holidays/check?' + params.toString()); return result.data.matched
    }

    static async isTeacherOnLeave(
        dateStr: string,
        teacherId: string,
        classroomId?: string,
        sessionId?: string
    ): Promise<boolean> {
        const params = new URLSearchParams({ date: dateStr, teacher_id: teacherId }); if (classroomId) params.set('classroom_id', classroomId); if (sessionId) params.set('class_session_id', sessionId); const result = await apiV1Client.get<{ matched: boolean }>('/holidays/check?' + params.toString()); return result.data.matched
    }
}
