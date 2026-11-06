import { ClassOccurrence, type ClassOccurrenceDTO } from '@/models/ClassOccurrence'
import { OccurrenceQueryService } from './OccurrenceQueryService'
import { DateUtils } from '@/utils/dateUtils'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { apiV1Client } from '@/services/api/ApiV1Client'

export class OccurrenceCommandService {
    private static formatDate(date: Date): string {
        return DateUtils.formatLocalDate(date)
    }

    static async generateOccurrences(
        sessionId: string,
        startDate: Date,
        endDate: Date,
        options: { skipExistingDates?: Set<string> } = {}
    ): Promise<ClassOccurrence[]> {
        const response = await apiV1Client.post<any>('/occurrences/generate', { class_session_id: sessionId, start_date: this.formatDate(startDate), end_date: this.formatDate(endDate), skip_existing_dates: options.skipExistingDates ? [...options.skipExistingDates] : undefined })
        return (response.data || []).map((dto: any) => new ClassOccurrence(dto))
    }

    static async updateOccurrence(
        occurrenceId: string,
        updates: Partial<ClassOccurrenceDTO>
    ): Promise<ClassOccurrence> {
        const response = await apiResourceClient.update<any>('occurrences', occurrenceId, updates); return new ClassOccurrence(response.data)
    }

    static async completeOccurrence(occurrenceId: string): Promise<ClassOccurrence> {
        return this.updateOccurrence(occurrenceId, { status: 'completed' })
    }

    static async cancelOccurrence(
        occurrenceId: string,
        reason?: string
    ): Promise<ClassOccurrence> {
        const updates: Partial<ClassOccurrenceDTO> = { status: 'cancelled' }

        if (reason) {
            const occurrence = await OccurrenceQueryService.getOccurrenceById(occurrenceId)
            const existingNotes = occurrence.notes || ''
            updates.notes = existingNotes
                ? `${existingNotes}\nCancelled: ${reason}`
                : `Cancelled: ${reason}`
        }

        return this.updateOccurrence(occurrenceId, updates)
    }

    static async deleteOccurrence(occurrenceId: string): Promise<void> {
        await apiResourceClient.remove('occurrences', occurrenceId); return
    }

    static async generateOccurrencesForAllSessions(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<number> {
        let totalGenerated = 0
        for (let page = 1; ; page += 1) {
            const response = await apiResourceClient.list<any>('class-sessions', { page, perPage: 100 })
            for (const session of response.data || []) {
                if (sessionIds && sessionIds.length > 0 && !sessionIds.includes(session.id)) continue
                totalGenerated += (await this.generateOccurrences(session.id, startDate, endDate)).length
            }
            if (!response.data?.length || (response.meta?.total !== undefined && page * 100 >= Number(response.meta.total)) || (response.data?.length ?? 0) < 100) break
        }
        return totalGenerated
    }
}

