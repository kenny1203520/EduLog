import { supabase } from '@/lib/supabase'
import { Holiday } from '@/models/Holiday'

/**
 * Query service for holidays
 * Handles retrieval of holiday information
 */
export class HolidayQueryService {
    /**
     * Lists all holidays ordered by start date
     */
    static async listHolidays(): Promise<Holiday[]> {
        const { data, error } = await supabase
            .from('holidays')
            .select('*')
            .order('start_date', { ascending: true })

        if (error) throw new Error(`Failed to fetch holidays: ${error.message}`)

        return data.map(dto => new Holiday(dto))
    }

    /**
     * Checks if a specific date falls within any holiday range that applies to the given scope
     * @param dateStr - Date in YYYY-MM-DD format
     * @param classroomId - Optional classroom ID
     * @param sessionId - Optional session ID
     */
    static async isHoliday(dateStr: string, classroomId?: string, sessionId?: string): Promise<boolean> {
        let query = supabase
            .from('holidays')
            .select('id')
            .lte('start_date', dateStr)
            .gte('end_date', dateStr)
        
        // Match Global (empty arrays) OR specific IDs in arrays
        const orConditions = [
            'and(classroom_ids.eq.{},class_session_ids.eq.{})'
        ]

        if (classroomId) {
            orConditions.push(`classroom_ids.cs.{${classroomId}}`)
        }
        if (sessionId) {
            orConditions.push(`class_session_ids.cs.{${sessionId}}`)
        }

        const { data, error } = await query.or(orConditions.join(',')).maybeSingle()

        if (error) {
            console.error('Error checking holiday:', error)
            return false
        }

        return !!data
    }
}
