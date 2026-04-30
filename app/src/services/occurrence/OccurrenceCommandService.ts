import { supabase } from '@/lib/supabase'
import { ClassOccurrence, type ClassOccurrenceDTO } from '@/models/ClassOccurrence'
import { OccurrenceQueryService } from './OccurrenceQueryService'
import { HolidayService } from '../holiday/HolidayService'

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
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
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

        const dayOfWeek = (session as any).day_of_week
        const occurrenceDates = this.generateOccurrenceDates(dayOfWeek, startDate, endDate)

        // Determine default teacher ids: prefer last existing occurrence's teachers,
        // then the session roster, and finally the session owner.
        let defaultTeacherIds: string[] = []
        try {
            const startStr = this.formatDate(startDate)
            const { data: lastOcc }: any = await supabase
                .from('class_occurrences')
                .select('teacher_ids')
                .eq('class_session_id', sessionId)
                .lt('occurrence_date', startStr)
                .order('occurrence_date', { ascending: false })
                .limit(1)

            if (lastOcc && lastOcc.length > 0 && lastOcc[0].teacher_ids) {
                defaultTeacherIds = lastOcc[0].teacher_ids
            } else {
                const { data: sessionTeachers, error: sessionTeachersError } = await supabase
                    .from('class_session_teachers')
                    .select('teacher_id, effective_from')
                    .eq('class_session_id', sessionId)
                    .lte('effective_from', startStr)
                    .order('effective_from', { ascending: false })

                if (sessionTeachersError) throw sessionTeachersError

                const teacherIds = Array.from(new Set((sessionTeachers || []).map((row: any) => row.teacher_id).filter(Boolean)))
                if (teacherIds.length > 0) {
                    defaultTeacherIds = teacherIds
                } else if ((session as any).user_id) {
                    defaultTeacherIds = [(session as any).user_id]
                }
            }
        } catch (e) {
            // fallback
            if ((session as any).user_id) defaultTeacherIds = [(session as any).user_id]
        }

        const occurrences: Partial<ClassOccurrenceDTO>[] = occurrenceDates.map(date => ({
            class_session_id: sessionId,
            occurrence_date: this.formatDate(date),
            status: 'scheduled',
            original_start_time: (session as any).start_time,
            original_end_time: (session as any).end_time,
            is_conducted: true,
            teacher_ids: defaultTeacherIds,
            teacher_attendance: defaultTeacherIds.reduce((acc: any, id: string) => { acc[id] = true; return acc }, {})
        }))

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
            ? occurrence.occurrenceDate.toISOString().split('T')[0]
            : occurrence.occurrenceDate
        const isHoliday = await HolidayService.isHoliday(
            occurrenceDateStr,
            undefined,
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
