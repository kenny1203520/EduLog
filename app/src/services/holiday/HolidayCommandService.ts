import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { Holiday, type HolidayDTO } from '@/models/Holiday'

type HolidayKind = 'closure' | 'teacher_leave'

/**
 * Command service for holidays
 * Handles creation, updating, and deletion of holidays
 */
export class HolidayCommandService {
    /**
     * Adds a new holiday range with optional scopes
     */
    static async createHoliday(params: {
        startDate: string,
        endDate: string,
        name?: string,
        timeZone?: string,
        kind?: HolidayKind,
        classroomIds?: string[],
        classSessionIds?: string[],
        teacherIds?: string[]
    }): Promise<Holiday> {
        const result = await apiResourceClient.create<any>('holidays', { start_date: params.startDate, end_date: params.endDate, time_zone: params.timeZone, name: params.name, kind: params.kind === 'teacher_leave' ? 'teacher_leave' : 'closure', classroom_ids: params.classroomIds || [], class_session_ids: params.classSessionIds || [], teacher_ids: params.teacherIds || [] })
        return new Holiday(result.data)
    }

    /**
     * Updates an existing holiday
     */
    static async updateHoliday(id: string, updates: Partial<HolidayDTO>): Promise<Holiday> {
        const result = await apiResourceClient.update<any>('holidays', id, updates); return new Holiday(result.data)
    }

    /**
     * Deletes a holiday
     */
    static async deleteHoliday(id: string): Promise<void> {
        await apiResourceClient.remove('holidays', id); return
    }
}
