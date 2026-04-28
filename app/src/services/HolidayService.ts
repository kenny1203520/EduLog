import { Holiday, type HolidayDTO } from '@/models/Holiday'
import { HolidayCommandService } from './holiday/HolidayCommandService'
import { HolidayQueryService } from './holiday/HolidayQueryService'

/**
 * Backward-compatible facade for holiday operations.
 * Internal responsibilities are split into command/query services.
 */
export class HolidayService {
    static async listHolidays(): Promise<Holiday[]> {
        return HolidayQueryService.listHolidays()
    }

    static async isHoliday(dateStr: string, classroomId?: string, sessionId?: string): Promise<boolean> {
        return HolidayQueryService.isHoliday(dateStr, classroomId, sessionId)
    }

    static async createHoliday(params: {
        startDate: string,
        endDate: string,
        name?: string,
        classroomIds?: string[],
        classSessionIds?: string[]
    }): Promise<Holiday> {
        return HolidayCommandService.createHoliday(params)
    }

    static async updateHoliday(id: string, updates: Partial<HolidayDTO>): Promise<Holiday> {
        return HolidayCommandService.updateHoliday(id, updates)
    }

    static async deleteHoliday(id: string): Promise<void> {
        return HolidayCommandService.deleteHoliday(id)
    }
}
