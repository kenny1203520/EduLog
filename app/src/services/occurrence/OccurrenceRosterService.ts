import { supabase } from '@/lib/supabase'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

type EffectiveEnrollmentRow = {
    enrollment_id: string
}

/** Resolves the canonical enrollment roster for a class occurrence. */
export class OccurrenceRosterService {
    static async getEffectiveEnrollmentIds(occurrenceId: string): Promise<string[]> {
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.get<string[]>('/occurrences/' + occurrenceId + '/roster')
            return response.data || []
        }
        const { data, error } = await supabase.rpc('get_effective_occurrence_enrollment_ids', {
            p_occurrence_id: occurrenceId
        })

        if (error) {
            throw new Error(`Failed to resolve occurrence roster: ${error.message}`)
        }

        return ((data || []) as EffectiveEnrollmentRow[]).map(row => row.enrollment_id)
    }
}
