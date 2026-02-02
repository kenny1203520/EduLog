import { supabase } from '@/lib/supabase'
import { ClassOccurrence, type ClassOccurrenceDTO } from '@/models/ClassOccurrence'

/**
 * OccurrenceService handles business logic for class occurrences.
 * Responsible for generating, managing, and querying class occurrences.
 * 
 * Following Single Responsibility Principle - only handles occurrence-related operations.
 */
export class OccurrenceService {
    /**
     * Generates class occurrences for a session within a date range.
     * Based on the day_of_week from the class_session.
     * 
     * @param sessionId - The class session ID
     * @param startDate - Start of date range
     * @param endDate - End of date range
     * @returns Array of created occurrences
     */
    static async generateOccurrences(
        sessionId: string,
        startDate: Date,
        endDate: Date
    ): Promise<ClassOccurrence[]> {
        // Fetch session details
        const { data: session, error: sessionError } = await supabase
            .from('class_sessions')
            .select('*')
            .eq('id', sessionId)
            .single()

        if (sessionError) throw new Error(`Failed to fetch session: ${sessionError.message}`)

        const dayOfWeek = (session as any).day_of_week
        const occurrenceDates = this.generateOccurrenceDates(dayOfWeek, startDate, endDate)

        // Prepare occurrence records
        const occurrences: Partial<ClassOccurrenceDTO>[] = occurrenceDates.map(date => ({
            class_session_id: sessionId,
            occurrence_date: this.formatDate(date),
            status: 'scheduled',
            original_start_time: (session as any).start_time,
            original_end_time: (session as any).end_time
        }))

        // Bulk insert with conflict handling (upsert)
        const { data, error } = await supabase
            .from('class_occurrences')
            .upsert(occurrences, { onConflict: 'class_session_id,occurrence_date' })
            .select()

        if (error) throw new Error(`Failed to create occurrences: ${error.message}`)

        return data.map((dto: any) => new ClassOccurrence(dto))
    }

    /**
     * Helper: Generate dates for a specific day of week within range
     */
    private static generateOccurrenceDates(
        dayOfWeek: number,
        startDate: Date,
        endDate: Date
    ): Date[] {
        const dates: Date[] = []
        const current = new Date(startDate)
        current.setHours(0, 0, 0, 0)

        // Move to first occurrence of dayOfWeek
        while (current.getDay() !== dayOfWeek && current <= endDate) {
            current.setDate(current.getDate() + 1)
        }

        // Generate all occurrences
        while (current <= endDate) {
            dates.push(new Date(current))
            current.setDate(current.getDate() + 7) // Next week
        }

        return dates
    }

    /**
     * Gets all occurrences for a specific session with pagination
     */
    static async getOccurrencesBySession(
        sessionId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: ClassOccurrence[], count: number }> {
        const from = (page - 1) * perPage
        const to = from + perPage - 1

        const { data, error, count } = await supabase
            .from('class_occurrences')
            .select('*', { count: 'exact' })
            .eq('class_session_id', sessionId)
            .order('occurrence_date', { ascending: true })
            .range(from, to)

        if (error) throw new Error(`Failed to fetch occurrences: ${error.message}`)

        return {
            data: (data as any[]).map(dto => new ClassOccurrence(dto)),
            count: count || 0
        }
    }

    /**
     * Updates an occurrence (e.g., mark as not conducted)
     */
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
    /**
     * Gets occurrences within a date range
     */
    static async getOccurrencesByDateRange(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<ClassOccurrence[]> {
        let query = supabase
            .from('class_occurrences')
            .select(`
                *,
                class_sessions (
                    name,
                    classrooms (name)
                )
            `)
            .gte('occurrence_date', this.formatDate(startDate))
            .lte('occurrence_date', this.formatDate(endDate))
            .order('occurrence_date', { ascending: true })

        if (sessionIds && sessionIds.length > 0) {
            query = query.in('class_session_id', sessionIds)
        }

        const { data, error } = await query

        if (error) throw new Error(error.message)

        return data.map((dto: any) => {
            const occ = new ClassOccurrence(dto)
            
            if (dto.class_sessions) {
                occ.sessionName = dto.class_sessions.name
            }

            if (dto.class_sessions?.classrooms) {
                occ.classroomName = dto.class_sessions.classrooms.name
            }
            return occ
        })
    }

    /**
     * Gets a single occurrence by ID
     */
    static async getOccurrenceById(occurrenceId: string): Promise<ClassOccurrence> {
        const { data, error } = await supabase
            .from('class_occurrences')
            .select('*')
            .eq('id', occurrenceId)
            .single()

        if (error) throw new Error(error.message)

        return new ClassOccurrence(data as any)
    }

    /**
     * Marks an occurrence as completed
     */
    static async completeOccurrence(occurrenceId: string): Promise<ClassOccurrence> {
        return this.updateOccurrence(occurrenceId, { status: 'completed' })
    }

    /**
     * Cancels an occurrence with optional reason
     */
    static async cancelOccurrence(
        occurrenceId: string,
        reason?: string
    ): Promise<ClassOccurrence> {
        const updates: Partial<ClassOccurrenceDTO> = { status: 'cancelled' }

        if (reason) {
            const occurrence = await this.getOccurrenceById(occurrenceId)
            const existingNotes = occurrence.notes || ''
            updates.notes = existingNotes 
                ? `${existingNotes}\nCancelled: ${reason}` 
                : `Cancelled: ${reason}`
        }

        return this.updateOccurrence(occurrenceId, updates)
    }

    /**
     * Deletes an occurrence (use with caution)
     */
    static async deleteOccurrence(occurrenceId: string): Promise<void> {
        const { error } = await supabase
            .from('class_occurrences')
            .delete()
            .eq('id', occurrenceId)

        if (error) throw new Error(error.message)
    }

    /**
     * Generates occurrences for all sessions within a date range
     * Useful for bulk generation
     */
    static async generateOccurrencesForAllSessions(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<number> {
        // Fetch sessions
        let query = supabase.from('class_sessions').select('id')

        if (sessionIds && sessionIds.length > 0) {
            query = query.in('id', sessionIds)
        }

        const { data: sessions, error } = await query

        if (error) throw new Error(error.message)

        let totalGenerated = 0

        // Generate for each session
        for (const session of sessions) {
            const occurrences = await this.generateOccurrences(
                (session as any).id,
                startDate,
                endDate
            )
            totalGenerated += occurrences.length
        }

        return totalGenerated
    }

    /**
     * Helper: Format date as YYYY-MM-DD
     */
    private static formatDate(date: Date): string {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    /**
     * Gets occurrences for today across all sessions
     */
    static async getTodayOccurrences(): Promise<ClassOccurrence[]> {
        const today = new Date()
        return this.getOccurrencesByDateRange(today, today)
    }

    /**
     * Gets upcoming occurrences (next 7 days)
     */
    static async getUpcomingOccurrences(days: number = 7): Promise<ClassOccurrence[]> {
        const today = new Date()
        const future = new Date()
        future.setDate(today.getDate() + days)

        return this.getOccurrencesByDateRange(today, future)
    }
}
