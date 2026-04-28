import { Suspension, type SuspensionDTO } from '@/models/Suspension'
import { SuspensionCommandService } from './SuspensionCommandService'
import { SuspensionQueryService } from './SuspensionQueryService'

export class SuspensionService {
    static async getSuspensions(enrollmentId: string): Promise<Suspension[]> {
        return SuspensionQueryService.getSuspensions(enrollmentId)
    }

    static async isSuspended(enrollmentId: string, dateStr: string): Promise<boolean> {
        return SuspensionQueryService.isSuspended(enrollmentId, dateStr)
    }

    static async createSuspension(enrollmentId: string, startDate: string, endDate: string | null, reason?: string): Promise<Suspension> {
        return SuspensionCommandService.createSuspension(enrollmentId, startDate, endDate, reason)
    }

    static async updateSuspension(id: string, updates: Partial<SuspensionDTO>): Promise<Suspension> {
        return SuspensionCommandService.updateSuspension(id, updates)
    }

    static async deleteSuspension(id: string): Promise<void> {
        return SuspensionCommandService.deleteSuspension(id)
    }
}
