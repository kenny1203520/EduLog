import { apiV1Client } from '@/services/api/ApiV1Client'

/** Resolves the canonical enrollment roster for a class occurrence. */
export class OccurrenceRosterService {
    static async getEffectiveEnrollmentIds(occurrenceId: string): Promise<string[]> {
        try { return (await apiV1Client.get<string[]>('/occurrences/' + encodeURIComponent(occurrenceId) + '/roster')).data || [] }
        catch (error: any) { throw new Error(`Failed to resolve occurrence roster: ${error?.message || 'request failed'}`) }
    }
}