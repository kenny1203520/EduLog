import { OccurrenceService } from '../OccurrenceService'

export class EnrollmentTransferToolService {
    static buildTransferEndDate(startDate: string, lessonCount: number): Date {
        const start = new Date(startDate)
        const endDate = new Date(start)
        endDate.setDate(endDate.getDate() + (lessonCount * 7))
        return endDate
    }

    static async syncSessionPair(oldSessionId: string | null, newSessionId: string): Promise<void> {
        if (oldSessionId) {
            await OccurrenceService.syncSessionOccurrences(oldSessionId).catch(() => {})
        }

        await OccurrenceService.syncSessionOccurrences(newSessionId).catch(() => {})
    }
}
