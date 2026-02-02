import { supabase } from '@/lib/supabase'
import { Holiday, type HolidayDTO } from '@/models/Holiday'

export class HolidayService {
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

    /**
     * Adds a new holiday range with optional scopes
     */
    static async createHoliday(params: {
        startDate: string, 
        endDate: string, 
        name?: string,
        classroomIds?: string[],
        classSessionIds?: string[]
    }): Promise<Holiday> {
        const { data, error } = await supabase
            .from('holidays')
            .insert({
                start_date: params.startDate,
                end_date: params.endDate,
                name: params.name,
                classroom_ids: params.classroomIds || [],
                class_session_ids: params.classSessionIds || []
            })
            .select()
            .single()

        if (error) {
            throw new Error(`Failed to create holiday: ${error.message}`)
        }

        const holiday = new Holiday(data)
        // Background sync existing reports
        this.syncReportsForHoliday(holiday).catch(console.error)
        return holiday
    }

    /**
     * Updates an existing holiday
     */
    static async updateHoliday(id: string, updates: Partial<HolidayDTO>): Promise<Holiday> {
        const { data, error } = await supabase
            .from('holidays')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) throw new Error(`Failed to update holiday: ${error.message}`)

        const holiday = new Holiday(data)
        // Background sync existing reports for the new range
        this.syncReportsForHoliday(holiday).catch(console.error)
        return holiday
    }

    /**
     * Synchronizes existing reports within a holiday range.
     */
    private static async syncReportsForHoliday(holiday: Holiday): Promise<void> {
        // 1. Find all occurrences in range and scope
        let query = supabase
            .from('class_occurrences')
            .select('id')
            .gte('occurrence_date', holiday.startDate)
            .lte('occurrence_date', holiday.endDate)
        
        if (holiday.classSessionIds.length > 0) {
            query = query.in('class_session_id', holiday.classSessionIds)
        } else if (holiday.classroomIds.length > 0) {
            const { data: sessionIds } = await supabase
                .from('class_sessions')
                .select('id')
                .in('classroom_id', holiday.classroomIds)
            
            if (!sessionIds || sessionIds.length === 0) return
            query = query.in('class_session_id', sessionIds.map(s => s.id))
        }

        const { data: occurrences } = await query
        
        if (!occurrences || occurrences.length === 0) return
        const occurrenceIds = occurrences.map(o => o.id)

        // 2. Update reports
        const { error } = await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'absent',
                absence_reason: 'holiday',
                is_completed: false
            })
            .in('class_occurrence_id', occurrenceIds)
            .or('content.eq.,content.is.null')

        if (error) {
            console.error('Failed to sync reports for holiday:', error)
        }
    }

    /**
     * Deletes a holiday
     */
    static async deleteHoliday(id: string): Promise<void> {
        const { error } = await supabase
            .from('holidays')
            .delete()
            .eq('id', id)

        if (error) throw new Error(`Failed to delete holiday: ${error.message}`)
    }
}
