import { supabase } from '@/lib/supabase'
import { ClassOccurrence, type ClassOccurrenceDTO } from '@/models/ClassOccurrence'
import { OccurrenceQueryService } from './OccurrenceQueryService'
import { HolidayService } from '../holiday/HolidayService'
import { TeacherService } from '../teacher/TeacherService'
import { DateUtils } from '@/utils/DateUtils'

export class OccurrenceCommandService {
    private static generateOccurrenceDates(
        dayOfWeek: number,
        startDate: Date,
        endDate: Date
    ): Date[] {
        const dates: Date[] = []
        const current = new Date(startDate)
        current.setHours(0, 0, 0, 0)

        while (current.getDay() !== dayOfWeek && current <= endDate) {
            current.setDate(current.getDate() + 1)
        }

        while (current <= endDate) {
            dates.push(new Date(current))
            current.setDate(current.getDate() + 7)
        }

        return dates
    }

    private static formatDate(date: Date): string {
        return DateUtils.formatLocalDate(date)
    }

    static async generateOccurrences(
        sessionId: string,
        startDate: Date,
        endDate: Date
    ): Promise<ClassOccurrence[]> {
        const { data: session, error: sessionError } = await supabase
            .from('class_sessions')
            .select('*')
            .eq('id', sessionId)
            .single()

        if (sessionError) throw new Error(`Failed to fetch session: ${sessionError.message}`)

        let effectiveStartDate = startDate
        if (session.start_date) {
            const sessionStart = DateUtils.parseLocalDate(session.start_date) || new Date(session.start_date)
            if (effectiveStartDate < sessionStart) {
                effectiveStartDate = sessionStart
            }
        }

        let effectiveEndDate = endDate
        if (session.end_date) {
            const sessionEnd = DateUtils.parseLocalDate(session.end_date) || new Date(session.end_date)
            // Ensure sessionEnd is at the end of the day to avoid missing occurrences on the exact end_date
            sessionEnd.setHours(23, 59, 59, 999)
            if (effectiveEndDate > sessionEnd) {
                effectiveEndDate = sessionEnd
            }
        }

        if (effectiveStartDate > effectiveEndDate) return []

        const dayOfWeek = (session as any).day_of_week
        const timeZone = DateUtils.isValidTimeZone((session as any).time_zone)
            ? (session as any).time_zone
            : DateUtils.getDefaultTimeZone()
        const occurrenceDates = this.generateOccurrenceDates(dayOfWeek, effectiveStartDate, effectiveEndDate)

        // Fetch all session teachers with their effective periods
        let sessionTeachers: any[] = []
        try {
            sessionTeachers = await TeacherService.getSessionTeachers(sessionId)
        } catch (e) {
            console.error('Failed to fetch session teachers for occurrence generation:', e)
        }

        // Fetch existing occurrences to preserve attendance status
        const { data: existingOccs } = await supabase
            .from('class_occurrences')
            .select('occurrence_date, teacher_attendance, time_zone')
            .eq('class_session_id', sessionId)
            .gte('occurrence_date', this.formatDate(effectiveStartDate))
            .lte('occurrence_date', this.formatDate(effectiveEndDate))

        const existingOccurrenceMap: Record<string, any> = {}
        if (existingOccs) {
            existingOccs.forEach(occ => {
                existingOccurrenceMap[occ.occurrence_date] = occ
            })
        }

        const occurrences: Partial<ClassOccurrenceDTO>[] = occurrenceDates.map(date => {
            const dateStr = this.formatDate(date)
            
            // Find teachers active on this date
            const activeTeachers = sessionTeachers.filter(st => {
                const effectiveFrom = st.effective_from
                const effectiveTo = st.effective_to
                if (dateStr < effectiveFrom) return false
                if (effectiveTo && dateStr > effectiveTo) return false
                return true
            })
            
            let teacherIds = [...new Set(activeTeachers.map(t => t.id))]
            // Fallback to session owner if no teachers assigned
            if (teacherIds.length === 0 && (session as any).user_id) {
                teacherIds = [(session as any).user_id]
            }

            // Merge with existing attendance if it exists
            const existingOccurrence = existingOccurrenceMap[dateStr]
            const existingAttendance = existingOccurrence?.teacher_attendance || {}
            const updatedAttendance: any = {}

            teacherIds.forEach((id: string) => {
                if (existingAttendance.hasOwnProperty(id)) {
                    // Preserve existing status (true/false)
                    updatedAttendance[id] = existingAttendance[id]
                } else {
                    // New teacher for this occurrence, default to present (true)
                    updatedAttendance[id] = true
                }
            })

            return {
                class_session_id: sessionId,
                occurrence_date: dateStr,
                status: 'scheduled',
                original_start_time: (session as any).start_time,
                original_end_time: (session as any).end_time,
                time_zone: DateUtils.isValidTimeZone(existingOccurrence?.time_zone) ? existingOccurrence.time_zone : timeZone,
                is_conducted: true,
                teacher_ids: teacherIds,
                teacher_attendance: updatedAttendance
            }
        })

        const { data, error } = await supabase
            .from('class_occurrences')
            .upsert(occurrences, { onConflict: 'class_session_id,occurrence_date' })
            .select()

        if (error) throw new Error(`Failed to create occurrences: ${error.message}`)

        return (data as any[]).map((dto: any) => new ClassOccurrence(dto))
    }

    static async updateOccurrence(
        occurrenceId: string,
        updates: Partial<ClassOccurrenceDTO>
    ): Promise<ClassOccurrence> {
        // Guard: check if occurrence is within a holiday period
        const occurrence = await OccurrenceQueryService.getOccurrenceById(occurrenceId)
        const occurrenceDateStr = occurrence.occurrenceDate instanceof Date
            ? DateUtils.formatLocalDate(occurrence.occurrenceDate)
            : occurrence.occurrenceDate
        const { data: sessionInfo } = await supabase
            .from('class_sessions')
            .select('classroom_id')
            .eq('id', occurrence.classSessionId)
            .maybeSingle()
        const classroomId = sessionInfo?.classroom_id || undefined
        const isHoliday = await HolidayService.isHoliday(
            occurrenceDateStr,
            classroomId,
            occurrence.classSessionId
        )

        if (isHoliday) {
            // If marked as holiday, reject attempts to set is_conducted=true or any teacher_attendance=true
            if (updates.is_conducted === true) {
                throw new Error('Cannot set is_conducted=true for an occurrence during a holiday period.')
            }

            if (updates.teacher_attendance) {
                const hasAnyTrueAttendance = Object.values(updates.teacher_attendance).some(v => v === true)
                if (hasAnyTrueAttendance) {
                    throw new Error('Cannot set teacher attendance to present (true) for an occurrence during a holiday period.')
                }
            }
        }

        if (updates.teacher_attendance) {
            for (const [teacherId, isPresent] of Object.entries(updates.teacher_attendance)) {
                if (!isPresent) continue

                const isOnLeave = await HolidayService.isTeacherOnLeave(
                    occurrenceDateStr,
                    teacherId,
                    classroomId,
                    occurrence.classSessionId
                )

                if (isOnLeave) {
                    throw new Error('Cannot set teacher attendance to present (true) while the teacher is on leave.')
                }
            }
        }

        const { data, error } = await supabase
            .from('class_occurrences')
            .update(updates)
            .eq('id', occurrenceId)
            .select()
            .single()

        if (error) throw new Error(`Failed to update occurrence: ${error.message}`)

        return new ClassOccurrence(data)
    }

    static async completeOccurrence(occurrenceId: string): Promise<ClassOccurrence> {
        return this.updateOccurrence(occurrenceId, { status: 'completed' })
    }

    static async cancelOccurrence(
        occurrenceId: string,
        reason?: string
    ): Promise<ClassOccurrence> {
        const updates: Partial<ClassOccurrenceDTO> = { status: 'cancelled' }

        if (reason) {
            const occurrence = await OccurrenceQueryService.getOccurrenceById(occurrenceId)
            const existingNotes = occurrence.notes || ''
            updates.notes = existingNotes
                ? `${existingNotes}\nCancelled: ${reason}`
                : `Cancelled: ${reason}`
        }

        return this.updateOccurrence(occurrenceId, updates)
    }

    static async deleteOccurrence(occurrenceId: string): Promise<void> {
        const { error } = await supabase
            .from('class_occurrences')
            .delete()
            .eq('id', occurrenceId)

        if (error) throw new Error(error.message)
    }

    static async generateOccurrencesForAllSessions(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<number> {
        let query = supabase.from('class_sessions').select('id')

        if (sessionIds && sessionIds.length > 0) {
            query = query.in('id', sessionIds)
        }

        const { data: sessions, error } = await query

        if (error) throw new Error(error.message)

        let totalGenerated = 0

        for (const session of sessions || []) {
            const occurrences = await this.generateOccurrences(
                (session as any).id,
                startDate,
                endDate
            )
            totalGenerated += occurrences.length
        }

        return totalGenerated
    }
}
