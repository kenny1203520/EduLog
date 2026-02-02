import { supabase } from '@/lib/supabase'
import { Holiday, type HolidayDTO } from '@/models/Holiday'

export class HolidayService {
    /**
     * Lists all holidays ordered by start date
     */
    static async listHolidays(): Promise<Holiday[]> {
        const { data, error } = await supabase
            .from('holidays')
            .select('*, classrooms(name), class_sessions(name)')
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
        
        // Return true if any of these match:
        // 1. Global holiday (both NULL)
        // 2. Classroom-specific holiday
        // 3. Session-specific holiday
        
        const orConditions = [
            'and(classroom_id.is.null,class_session_id.is.null)'
        ]

        if (classroomId) {
            orConditions.push(`classroom_id.eq.${classroomId}`)
        }
        if (sessionId) {
            orConditions.push(`class_session_id.eq.${sessionId}`)
        }

        const { data, error } = await query.or(orConditions.join(',')).maybeSingle()

        if (error) {
            console.error('Error checking holiday:', error)
            return false
        }

        return !!data
    }

    /**
     * Adds a new holiday range with optional scope
     */
    static async createHoliday(params: {
        startDate: string, 
        endDate: string, 
        name?: string,
        classroomId?: string,
        classSessionId?: string
    }): Promise<Holiday> {
        const { data, error } = await supabase
            .from('holidays')
            .insert({
                start_date: params.startDate,
                end_date: params.endDate,
                name: params.name,
                classroom_id: params.classroomId || null,
                class_session_id: params.classSessionId || null
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
     * Marks reports as Absent/Holiday if they are currently "Present" and have no content.
     */
    private static async syncReportsForHoliday(holiday: Holiday): Promise<void> {
        // 1. Find all occurrences in range and scope
        let query = supabase
            .from('class_occurrences')
            .select('id')
            .gte('occurrence_date', holiday.startDate)
            .lte('occurrence_date', holiday.endDate)
        
        if (holiday.classSessionId) {
            query = query.eq('class_session_id', holiday.classSessionId)
        } else if (holiday.classroomId) {
            // occurrences don't directly have classroom_id? Let's check session
            const { data: sessionIds } = await supabase
                .from('class_sessions')
                .select('id')
                .eq('classroom_id', holiday.classroomId)
            
            if (!sessionIds || sessionIds.length === 0) return
            query = query.in('class_session_id', sessionIds.map(s => s.id))
        }

        const { data: occurrences } = await query
        
        if (!occurrences || occurrences.length === 0) return
        const occurrenceIds = occurrences.map(o => o.id)

        // 2. Find and update reports for these occurrences
        // Only update if content is empty (to avoid overwriting manual work)
        const { error } = await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'absent',
                absence_reason: 'holiday',
                is_completed: false
            })
            .in('class_occurrence_id', occurrenceIds)
            .or('content.eq.,content.is.null') // Only if content is empty or null

        if (error) {
            console.error('Failed to sync reports for holiday:', error)
        } else {
            console.log(`Successfully synced reports for holiday range ${holiday.startDate} to ${holiday.endDate}`)
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
