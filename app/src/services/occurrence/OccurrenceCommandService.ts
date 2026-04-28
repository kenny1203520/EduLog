import { supabase } from '@/lib/supabase'
import { ClassOccurrence, type ClassOccurrenceDTO } from '@/models/ClassOccurrence'
import { OccurrenceQueryService } from '../OccurrenceQueryService'

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

        const occurrences: Partial<ClassOccurrenceDTO>[] = occurrenceDates.map(date => ({
            class_session_id: sessionId,
            occurrence_date: this.formatDate(date),
            status: 'scheduled',
            original_start_time: (session as any).start_time,
            original_end_time: (session as any).end_time
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
