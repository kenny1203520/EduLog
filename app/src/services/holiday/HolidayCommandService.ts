import { supabase } from '@/lib/supabase'
import { Holiday, type HolidayDTO } from '@/models/Holiday'
import { DateUtils } from '@/utils/DateUtils'

type HolidayOccurrence = {
    id: string
    teacher_ids?: string[] | null
    class_session_id?: string | null
    occurrence_date: string
    class_sessions?: { classroom_id?: string | null } | { classroom_id?: string | null }[] | null
}

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
        await this.syncReportsForHoliday(holiday)
        return holiday
    }

    /**
     * Updates an existing holiday
     */
    static async updateHoliday(id: string, updates: Partial<HolidayDTO>): Promise<Holiday> {
        const existingHoliday = await this.getHolidayById(id)

        const { data, error } = await supabase
            .from('holidays')
            .update(updates)
            .eq('id', id)
            .select()
            .single()

        if (error) throw new Error(`Failed to update holiday: ${error.message}`)

        const holiday = new Holiday(data)
        if (existingHoliday) {
            await this.releaseReportsForHoliday(existingHoliday)
        }
        await this.syncReportsForHoliday(holiday)
        return holiday
    }

    /**
     * Deletes a holiday
     */
    static async deleteHoliday(id: string): Promise<void> {
        const existingHoliday = await this.getHolidayById(id)

        const { error } = await supabase
            .from('holidays')
            .delete()
            .eq('id', id)

        if (error) throw new Error(`Failed to delete holiday: ${error.message}`)

        if (existingHoliday) {
            await this.releaseReportsForHoliday(existingHoliday)
        }
    }

    private static async getHolidayById(id: string): Promise<Holiday | null> {
        const { data, error } = await supabase
            .from('holidays')
            .select('*')
            .eq('id', id)
            .maybeSingle()

        if (error) {
            throw new Error(`Failed to fetch holiday before mutation: ${error.message}`)
        }

        return data ? new Holiday(data) : null
    }

    private static async getOccurrencesForHoliday(holiday: Holiday): Promise<HolidayOccurrence[]> {
        let query = supabase
            .from('class_occurrences')
            .select('id, teacher_ids, class_session_id, occurrence_date, class_sessions(classroom_id)')
            .gte('occurrence_date', holiday.startDate)
            .lte('occurrence_date', holiday.endDate)

        if (holiday.classSessionIds.length > 0) {
            query = query.in('class_session_id', holiday.classSessionIds)
        } else if (holiday.classroomIds.length > 0) {
            const { data: sessionIds, error: sessionError } = await supabase
                .from('class_sessions')
                .select('id')
                .in('classroom_id', holiday.classroomIds)

            if (sessionError) {
                throw new Error(`Failed to fetch sessions for holiday classrooms: ${sessionError.message}`)
            }

            if (!sessionIds || sessionIds.length === 0) return []
            query = query.in('class_session_id', sessionIds.map(s => s.id))
        }

        const { data, error } = await query

        if (error) {
            throw new Error(`Failed to fetch occurrences for holiday: ${error.message}`)
        }

        return (data || []) as HolidayOccurrence[]
    }

    private static getOccurrenceClassroomId(occurrence: HolidayOccurrence): string | undefined {
        const joined = occurrence.class_sessions
        if (Array.isArray(joined)) {
            return joined[0]?.classroom_id || undefined
        }

        return joined?.classroom_id || undefined
    }

    private static holidayAppliesToOccurrence(holiday: HolidayDTO, occurrence: HolidayOccurrence): boolean {
        const classroomIds = holiday.classroom_ids || []
        const classSessionIds = holiday.class_session_ids || []
        const classroomId = this.getOccurrenceClassroomId(occurrence)

        if (classroomIds.length === 0 && classSessionIds.length === 0) {
            return true
        }

        if (occurrence.class_session_id && classSessionIds.includes(occurrence.class_session_id)) {
            return true
        }

        return !!classroomId && classroomIds.includes(classroomId)
    }

    private static async isStillHoliday(occurrence: HolidayOccurrence): Promise<boolean> {
        const { data, error } = await supabase
            .from('holidays')
            .select('id, start_date, end_date, classroom_ids, class_session_ids')
            .lte('start_date', occurrence.occurrence_date)
            .gte('end_date', occurrence.occurrence_date)

        if (error) {
            throw new Error(`Failed to check remaining holidays: ${error.message}`)
        }

        return (data || []).some(holiday => this.holidayAppliesToOccurrence(holiday as HolidayDTO, occurrence))
    }

    /**
     * Releases reports that were controlled by a removed/changed holiday.
     */
    private static async releaseReportsForHoliday(holiday: Holiday): Promise<void> {
        const occurrences = await this.getOccurrencesForHoliday(holiday)
        if (occurrences.length === 0) return

        const releasableOccurrences: HolidayOccurrence[] = []
        for (const occurrence of occurrences) {
            const stillHoliday = await this.isStillHoliday(occurrence)
            if (!stillHoliday) {
                releasableOccurrences.push(occurrence)
            }
        }

        if (releasableOccurrences.length === 0) return

        const occurrenceIds = releasableOccurrences.map(o => o.id)

        const { error: reportError } = await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'pending',
                absence_reason: null
            })
            .in('class_occurrence_id', occurrenceIds)
            .eq('attendance_status', 'absent')
            .eq('absence_reason', 'holiday')

        if (reportError) {
            throw new Error(`Failed to release reports after holiday removal: ${reportError.message}`)
        }

        for (const occ of releasableOccurrences) {
            const teacherAttendance = (occ.teacher_ids || []).reduce((acc: Record<string, boolean>, teacherId: string) => {
                acc[teacherId] = true
                return acc
            }, {})

            const { error: updateError } = await supabase
                .from('class_occurrences')
                .update({
                    is_conducted: true,
                    teacher_attendance: teacherAttendance
                })
                .eq('id', occ.id)

            if (updateError) {
                throw new Error(`Failed to restore occurrence ${occ.id} after holiday removal: ${updateError.message}`)
            }
        }
    }

    /**
     * Synchronizes existing reports within a holiday range.
     */
    private static async syncReportsForHoliday(holiday: Holiday): Promise<void> {
        const occurrences = await this.getOccurrencesForHoliday(holiday)

        if (!occurrences || occurrences.length === 0) return
        const occurrenceIds = occurrences.map(o => o.id)

        // 2. Update reports: mark all affected reports as absent for the holiday
        const { error: reportError } = await supabase
            .from('occurrence_reports')
            .update({
                attendance_status: 'absent',
                absence_reason: 'holiday'
            })
            .in('class_occurrence_id', occurrenceIds)

        if (reportError) {
            throw new Error(`Failed to sync reports for holiday: ${reportError.message}`)
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
                throw new Error(`Failed to update occurrence ${occ.id} for holiday: ${updateError.message}`)
            }
        }
    }
}
