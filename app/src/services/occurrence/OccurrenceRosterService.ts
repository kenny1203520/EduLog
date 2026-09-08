import { apiDataClient } from '@/services/api/ApiDataClient'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

/** Resolves the canonical enrollment roster for a class occurrence. */
export class OccurrenceRosterService {
    static async getEffectiveEnrollmentIds(occurrenceId: string): Promise<string[]> {
        if (getApiV1Mode() === 'mock') {
            const { data, error } = await apiDataClient.rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: occurrenceId })
            if (error) throw new Error(`Failed to resolve occurrence roster: ${error.message}`)
            return (data || []).map((row: any) => row.enrollment_id).filter(Boolean)
        }
        try { return (await apiV1Client.get<string[]>('/occurrences/' + encodeURIComponent(occurrenceId) + '/roster')).data || [] }
        catch (error: any) { throw new Error(`Failed to resolve occurrence roster: ${error?.message || 'request failed'}`) }
    }
}