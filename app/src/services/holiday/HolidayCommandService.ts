import { supabase } from '@/lib/supabase'
import { Holiday, type HolidayDTO } from '@/models/Holiday'
import { DateUtils } from '@/utils/DateUtils'

/**
 * Command service for holidays
 * Handles creation, updating, and deletion of holidays
 */
export class HolidayCommandService {
    /**
     * Adds a new holiday range with optional scopes
     */
    static async createHoliday(params: {
        startDate: string,
        endDate: string,
        name?: string,
        timeZone?: string,
        classroomIds?: string[],
        classSessionIds?: string[]
    }): Promise<Holiday> {
        const { data, error } = await supabase
            .from('holidays')
            .insert({
                start_date: params.startDate,
                end_date: params.endDate,
                time_zone: DateUtils.isValidTimeZone(params.timeZone) ? params.timeZone : DateUtils.getDefaultTimeZone(),
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
     * Deletes a holiday
     */
    static async deleteHoliday(id: string): Promise<void> {
        const { error } = await supabase
            .from('holidays')
            .delete()
            .eq('id', id)

        if (error) throw new Error(`Failed to delete holiday: ${error.message}`)
    }

    /**
     * Synchronizes existing reports within a holiday range.
     */
    private static async syncReportsForHoliday(holiday: Holiday): Promise<void> {
        // 1. Find all occurrences in range and scope (fetch full details including teacher_ids)
        let query = supabase
            .from('class_occurrences')
            .select('id, teacher_ids')
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

        // 2. Update reports: mark all affected reports as absent for the holiday
        const { error: reportError } = await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'absent',
                absence_reason: 'holiday',
                is_completed: false
            })
            .in('class_occurrence_id', occurrenceIds)

        if (reportError) {
            console.error('Failed to sync reports for holiday:', reportError)
        }

        // 3. Mark occurrences as not conducted and disable all teacher attendance
        for (const occ of occurrences) {
            const teacherAttendance = (occ.teacher_ids || []).reduce((acc: any, teacherId: string) => {
                acc[teacherId] = false
                return acc
            }, {})

            const { error: updateError } = await supabase
                .from('class_occurrences')
                .update({
                    is_conducted: false,
                    teacher_attendance: teacherAttendance
                })
                .eq('id', occ.id)

            if (updateError) {
                console.error(`Failed to update occurrence ${occ.id} for holiday:`, updateError)
            }
        }
    }
}
