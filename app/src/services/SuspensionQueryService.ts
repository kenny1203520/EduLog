import { supabase } from '@/lib/supabase'
import { Suspension } from '@/models/Suspension'

export class SuspensionQueryService {
    static async getSuspensions(enrollmentId: string): Promise<Suspension[]> {
        const { data, error } = await supabase
            .from('student_suspensions')
            .select('*')
            .eq('enrollment_id', enrollmentId)
            .order('start_date', { ascending: false })

        if (error) throw new Error(`Failed to fetch suspensions: ${error.message}`)

        return (data || []).map(dto => new Suspension(dto))
    }

    static async isSuspended(enrollmentId: string, dateStr: string): Promise<boolean> {
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
}
