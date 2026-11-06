import { Suspension, type SuspensionDTO } from '@/models/Suspension'
import { DateUtils } from '@/utils/dateUtils'
import { apiV1Client } from '@/services/api/ApiV1Client'

export class SuspensionCommandService {
    static async createSuspension(enrollmentId: string, startDate: string, endDate: string | null, reason?: string, timeZone?: string): Promise<Suspension> {
        const response = await apiV1Client.post<any>('/student-suspensions', { enrollment_id: enrollmentId, start_date: startDate, end_date: endDate, time_zone: DateUtils.isValidTimeZone(timeZone) ? timeZone : DateUtils.getDefaultTimeZone(), reason: reason ?? null })
        return new Suspension(response.data)
    }

    static async updateSuspension(id: string, updates: Partial<SuspensionDTO>): Promise<Suspension> {
        const response = await apiV1Client.patch<any>('/student-suspensions/' + id, updates)
        return new Suspension(response.data)
    }

    static async deleteSuspension(id: string): Promise<void> {
        await apiV1Client.delete('/student-suspensions/' + id)
        return
    }
}
