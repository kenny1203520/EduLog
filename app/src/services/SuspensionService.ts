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
        // 1. Fetch old data to compare ranges
        const { data: oldData, error: fetchError } = await supabase
            .from('student_suspensions')
            .select('*')
            .eq('id', id)
            .single()

        if (fetchError) throw new Error(`Failed to fetch original suspension: ${fetchError.message}`)
        const oldSuspension = new Suspension(oldData)

        // 2. Perform Update
        const { data: newData, error: updateError } = await supabase
            .from('student_suspensions')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (updateError) throw new Error(`Failed to update suspension: ${updateError.message}`)

        const newSuspension = new Suspension(newData)

        // 3. Logic to Revert/Sync
        // Case A: End date moved earlier (Shortened suspension) -> Revert reports in the gap
        // Old: [Start, OldEnd]
        // New: [Start, NewEnd]
        // Gap: (NewEnd, OldEnd]
        if (oldSuspension.endDate && newSuspension.endDate && newSuspension.endDate < oldSuspension.endDate) {
            const revertStart = new Date(newSuspension.endDate)
            revertStart.setDate(revertStart.getDate() + 1) // Start revert from the day AFTER new end date
            const revertStartStr = revertStart.toISOString().split('T')[0] as string
            
            const gapSuspension = {
                enrollment_id: newSuspension.enrollmentId,
                start_date: revertStartStr,
                end_date: oldSuspension.endDate
            } as any

             await this.parametricallyRevertReports(gapSuspension)
            // Generate missing reports for this gap so they become editable
            if (newSuspension.enrollmentId) {
                await this.ensureReportsForRange(newSuspension.enrollmentId, revertStartStr, oldSuspension.endDate)
            }
        }
        // Case B: Suspension ended (was indefinite, now has end date) -> Revert reports after new end date
        else if (!oldSuspension.endDate && newSuspension.endDate) {
             const revertStart = new Date(newSuspension.endDate)
             revertStart.setDate(revertStart.getDate() + 1)
             const revertStartStr = revertStart.toISOString().split('T')[0] as string

             // Revert everything after the new end date
             const gapSuspension = {
                 enrollment_id: newSuspension.enrollmentId,
                 start_date: revertStartStr,
                 end_date: null // Unlimited future
             } as any

             await this.parametricallyRevertReports(gapSuspension)
             if (newSuspension.enrollmentId) {
                await this.ensureReportsForRange(newSuspension.enrollmentId, revertStartStr, null)
             }
        }
        
        // 4. Always sync the NEW range to ensure coverage
        await this.syncReportsForSuspension(newSuspension)
        
        return newSuspension
    }

    /**
     * Ensures reports exist for a given range (useful when un-suspending).
     * Only creates them if they don't exist.
     */
    private static async ensureReportsForRange(enrollmentId: string, startDate: string, endDate: string | null): Promise<void> {
        // 1. Get occurrences in range
        let query = supabase
            .from('class_occurrences')
            .select('id, occurrence_date, class_session_id')
            .gte('occurrence_date', startDate)
            .eq('is_conducted', true) // Only conducted classes need reports

        if (endDate) {
            query = query.lte('occurrence_date', endDate)
        }

        // We need to filter by the enrollment's class session to be accurate
        // First get enrollment class session
        const { data: enrollment } = await supabase
            .from('enrollments')
            .select('class_session_id')
            .eq('id', enrollmentId)
            .single()
        
        if (!enrollment) return

        query = query.eq('class_session_id', enrollment.class_session_id)

        const { data: occurrences } = await query
        if (!occurrences || occurrences.length === 0) return

        // 2. Check which ones have reports
        const { data: existingReports } = await supabase
            .from('occurrence_reports')
            .select('class_occurrence_id')
            .eq('enrollment_id', enrollmentId)
            .in('class_occurrence_id', occurrences.map(o => o.id))

        const existingIds = new Set(existingReports?.map(r => r.class_occurrence_id) || [])
        const missingOccurrences = occurrences.filter(o => !existingIds.has(o.id))

        if (missingOccurrences.length === 0) return

        // 3. Bulk insert missing reports
        const newReports = missingOccurrences.map(o => ({
            enrollment_id: enrollmentId,
            class_occurrence_id: o.id,
            version: 1,
            content: '',
            is_completed: false, // Start as incomplete so they show up as "Missing"
            attendance_status: undefined // No default attendance
        }))

        const { error } = await supabase
            .from('occurrence_reports')
            .insert(newReports)

        if (error) console.error('Failed to generate missing reports after unsuspension:', error)
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
