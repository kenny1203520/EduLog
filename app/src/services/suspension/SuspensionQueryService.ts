import { Suspension } from '@/models/Suspension'
import { apiResourceClient } from '@/services/api/ApiResourceClient'

export class SuspensionQueryService {
    static async getSuspensions(enrollmentId: string): Promise<Suspension[]> {
        const response = await apiResourceClient.list<any>('student-suspensions', { enrollmentId, perPage: 100, sort: '-start_date' })
        return (response.data || []).map((dto: any) => new Suspension(dto))
    }

    static async isSuspended(enrollmentId: string, dateStr: string): Promise<boolean> {
        const suspensions = await this.getSuspensions(enrollmentId)
        return suspensions.some((item) => item.startDate <= dateStr && (!item.endDate || item.endDate >= dateStr))
    }
}
