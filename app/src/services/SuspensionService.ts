import { supabase } from '@/lib/supabase'
import { Suspension, type SuspensionDTO } from '@/models/Suspension'

export class SuspensionService {
    /**
     * List suspensions for an enrollment
     */
    static async getSuspensions(enrollmentId: string): Promise<Suspension[]> {
        const { data, error } = await supabase
            .from('student_suspensions')
            .select('*')
            .eq('enrollment_id', enrollmentId)
            .order('start_date', { ascending: false })

        if (error) throw new Error(`Failed to fetch suspensions: ${error.message}`)

        return data.map(dto => new Suspension(dto))
    }

    /**
     * Check if a specific date is suspended for an enrollment
     */
    static async isSuspended(enrollmentId: string, dateStr: string): Promise<boolean> {
        // We can check locally if we have the list, but for specific checks (like report generation), 
        // a direct DB query is safer if we don't have the context.
        // However, usually we should use a loaded list to avoid N+1.
        // For this single check, let's query.
        
        const { count, error } = await supabase
            .from('student_suspensions')
            .select('*', { count: 'exact', head: true })
            .eq('enrollment_id', enrollmentId)
            .lte('start_date', dateStr)
            .or(`end_date.is.null,end_date.gte.${dateStr}`)

        if (error) {
            console.error('Failed to check suspension status', error)
            return false
        }

        return (count || 0) > 0
    }

    /**
     * Create a suspension and sync reports
     */
    static async createSuspension(enrollmentId: string, startDate: string, endDate: string | null, reason?: string): Promise<Suspension> {
        // Validation: Check for overlaps
        const existingSuspensions = await this.getSuspensions(enrollmentId)
        const hasOverlap = existingSuspensions.some(s => {
            // New: [StartA, EndA]
            // Existing: [StartB, EndB]
            // Overlap if StartA <= EndB (or EndB null) AND (EndA >= StartB or EndA null)
            
            const startA = startDate
            const endA = endDate // null = infinity

            const startB = s.startDate
            const endB = s.endDate // null = infinity

            // Check if ranges overlap
            const startOverlaps = !endB || startA <= endB
            const endOverlaps = !endA || endA >= startB

            return startOverlaps && endOverlaps
        })

        if (hasOverlap) {
            throw new Error('Suspension period overlaps with an existing suspension.')
        }

        const { data, error } = await supabase
            .from('student_suspensions')
            .insert({
                enrollment_id: enrollmentId,
                start_date: startDate,
                end_date: endDate,
                reason: reason
            })
            .select()
            .single()

        if (error) throw new Error(`Failed to create suspension: ${error.message}`)
        
        const suspension = new Suspension(data)
        await this.syncReportsForSuspension(suspension)
        return suspension
    }

    /**
     * Update a suspension and sync reports
     */
    static async updateSuspension(id: string, updates: Partial<SuspensionDTO>): Promise<Suspension> {
        const { data, error } = await supabase
            .from('student_suspensions')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) throw new Error(`Failed to update suspension: ${error.message}`)

        const suspension = new Suspension(data)
        await this.syncReportsForSuspension(suspension)
        return suspension
    }

    /**
     * Delete a suspension and revert reports (optional, hard to revert perfectly so we just unset the reason if it matches)
     */
    static async deleteSuspension(id: string): Promise<void> {
        // First get the suspension to know the range
        const { data: suspension, error: fetchError } = await supabase
            .from('student_suspensions')
            .select('*')
            .eq('id', id)
            .single()
        
        if (fetchError) throw new Error(fetchError.message)

        const { error } = await supabase
            .from('student_suspensions')
            .delete()
            .eq('id', id)

        if (error) throw new Error(`Failed to delete suspension: ${error.message}`)

        // Attempt to clean up reports (only if they are marked as suspension)
        await this.parametricallyRevertReports(suspension)
    }

    /**
     * Sync reports: Mark as Absent/Suspension within range
     */
    private static async syncReportsForSuspension(suspension: Suspension): Promise<void> {
        // Find occurrence IDs in range
        let dateFilter = supabase
            .from('class_occurrences')
            .select('id')
            .gte('occurrence_date', suspension.startDate)
        
        if (suspension.endDate) {
            dateFilter = dateFilter.lte('occurrence_date', suspension.endDate)
        }

        const { data: occurrences } = await dateFilter
        
        if (!occurrences || occurrences.length === 0) return

        const ids = occurrences.map(o => o.id)

        // Apply update
        await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'absent',
                absence_reason: 'suspension',
                is_completed: false
            })
            .eq('enrollment_id', suspension.enrollmentId)
            .in('class_occurrence_id', ids)
            .or('content.eq.,content.is.null') 
    }

    private static async parametricallyRevertReports(suspension: SuspensionDTO): Promise<void> {
        // Find occurrence IDs in range
         let dateFilter = supabase
            .from('class_occurrences')
            .select('id')
            .gte('occurrence_date', suspension.start_date)
        
        if (suspension.end_date) {
            dateFilter = dateFilter.lte('occurrence_date', suspension.end_date)
        }

        const { data: occurrences } = await dateFilter
        
        if (!occurrences || occurrences.length === 0) return
        const ids = occurrences.map(o => o.id)

        // Revert reports that have 'suspension' as reason
        await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'present', // Default back to present? or leave absent but clear reason?
                absence_reason: null
                // We keep is_completed as false maybe? Users should manually resume.
                // But generally reverting to 'present' is risky if they were absent for other reasons.
                // Safest is to just clear the 'suspension' reason.
            })
            .eq('enrollment_id', suspension.enrollment_id)
            .in('class_occurrence_id', ids)
            .eq('absence_reason', 'suspension')
    }
}
