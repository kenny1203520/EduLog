import { OccurrenceService } from '../occurrence/OccurrenceService'

export class EnrollmentTransferToolService {
    static buildTransferEndDate(startDate: string, lessonCount: number): Date {
        const start = new Date(startDate)
        const endDate = new Date(start)
        endDate.setDate(endDate.getDate() + (lessonCount * 7))
        return endDate
    }

    static async syncSessionPair(oldSessionId: string | null, newSessionId: string): Promise<void> {
        if (oldSessionId) {
            await OccurrenceService.syncSessionOccurrences(oldSessionId).catch((err: any) => {
                console.error('Failed to sync the old session\'s occurrences after transfer:', err)
            })
        }

        await OccurrenceService.syncSessionOccurrences(newSessionId).catch((err: any) => {
            console.error('Failed to sync the new session\'s occurrences after transfer:', err)
        })
    }
}
