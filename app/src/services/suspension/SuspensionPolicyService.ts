import { supabase } from '@/lib/supabase'
import { Suspension, type SuspensionDTO } from '@/models/Suspension'

export class SuspensionPolicyService {
    static async validateNoOverlap(enrollmentId: string, startDate: string, endDate: string | null): Promise<void> {
        const { data: existingSuspensions } = await supabase
            .from('student_suspensions')
            .select('*')
            .eq('enrollment_id', enrollmentId)

        const suspensions = (existingSuspensions || []) as Suspension[]
        const hasOverlap = suspensions.some(s => {
            const startA = startDate
            const endA = endDate
            const startB = s.startDate
            const endB = s.endDate

            const startOverlaps = !endB || startA <= endB
            const endOverlaps = !endA || endA >= startB

            return startOverlaps && endOverlaps
        })

        if (hasOverlap) {
            throw new Error('Suspension period overlaps with an existing suspension.')
        }
    }

    static async syncReportsForSuspension(suspension: Suspension): Promise<void> {
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

        await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'absent',
                absence_reason: 'suspension'
            })
            .eq('enrollment_id', suspension.enrollmentId)
            .in('class_occurrence_id', ids)
            .or('content.eq.,content.is.null')
    }

    static async ensureReportsForRange(enrollmentId: string, startDate: string, endDate: string | null): Promise<void> {
        let query = supabase
            .from('class_occurrences')
            .select('id, occurrence_date, class_session_id')
            .gte('occurrence_date', startDate)
            .eq('is_conducted', true)

        if (endDate) {
            query = query.lte('occurrence_date', endDate)
        }

        const { data: enrollment } = await supabase
            .from('enrollments')
            .select('class_session_id')
            .eq('id', enrollmentId)
            .single()

        if (!enrollment) return

        query = query.eq('class_session_id', enrollment.class_session_id)

        const { data: occurrences } = await query
        if (!occurrences || occurrences.length === 0) return

        const { data: existingReports } = await supabase
            .from('occurrence_reports')
            .select('class_occurrence_id')
            .eq('enrollment_id', enrollmentId)
            .in('class_occurrence_id', occurrences.map(o => o.id))

        const existingIds = new Set(existingReports?.map(r => r.class_occurrence_id) || [])
        const missingOccurrences = occurrences.filter(o => !existingIds.has(o.id))

        if (missingOccurrences.length === 0) return

        const newReports = missingOccurrences.map(o => ({
            enrollment_id: enrollmentId,
            class_occurrence_id: o.id,
            version: 1,
            content: '',
            is_completed: false,
            attendance_status: 'pending'
        }))

        const { error } = await supabase
            .from('occurrence_reports')
            .insert(newReports)

        if (error) console.error('Failed to generate missing reports after unsuspension:', error)
    }

    static async revertReports(suspension: SuspensionDTO): Promise<void> {
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

        await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'pending',
                absence_reason: null
            })
            .eq('enrollment_id', suspension.enrollment_id)
            .in('class_occurrence_id', ids)
            .eq('attendance_status', 'absent')
            .eq('absence_reason', 'suspension')
    }
}
