import { supabase } from '@/lib/supabase'

type EffectiveEnrollmentRow = {
    enrollment_id: string
}

/** Resolves the canonical enrollment roster for a class occurrence. */
export class OccurrenceRosterService {
    static async getEffectiveEnrollmentIds(occurrenceId: string): Promise<string[]> {
        const { data, error } = await supabase.rpc('get_effective_occurrence_enrollment_ids', {
            p_occurrence_id: occurrenceId
        })

        if (error) {
            throw new Error(`Failed to resolve occurrence roster: ${error.message}`)
        }

        return ((data || []) as EffectiveEnrollmentRow[]).map(row => row.enrollment_id)
    }
}
