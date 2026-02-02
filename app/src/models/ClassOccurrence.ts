/**
 * ClassOccurrence represents a single class session that occurs on a specific date.
 * This is different from ClassSession which defines the recurring schedule.
 * 
 * Example: If a class session is "Monday 10:00 AM", then each Monday generates
 * a separate ClassOccurrence instance.
 */

export interface ClassOccurrenceDTO {
    id?: string
    class_session_id: string
    occurrence_date: string // YYYY-MM-DD format
    status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled'
    original_start_time?: string // HH:MM:SS
    original_end_time?: string // HH:MM:SS
    actual_start_time?: string // HH:MM:SS
    actual_end_time?: string // HH:MM:SS
    notes?: string
    is_conducted?: boolean // Default true
    created_at?: string
    updated_at?: string
}

/**
 * ClassOccurrence domain model with business logic
 */
export class ClassOccurrence {
    id?: string
    classSessionId: string
    occurrenceDate: Date
    status: 'scheduled' | 'completed' | 'cancelled' | 'rescheduled'
    originalStartTime?: string
    originalEndTime?: string
    actualStartTime?: string
    actualEndTime?: string
    notes?: string
    isConducted: boolean
    createdAt?: Date
    updatedAt?: Date
    classroomName?: string
    sessionName?: string

    constructor(data: ClassOccurrenceDTO) {
        this.id = data.id
        this.classSessionId = data.class_session_id
        this.occurrenceDate = new Date(data.occurrence_date)
        this.status = data.status
        this.originalStartTime = data.original_start_time
        this.originalEndTime = data.original_end_time
        this.actualStartTime = data.actual_start_time
        this.actualEndTime = data.actual_end_time
        this.notes = data.notes
        this.isConducted = data.is_conducted ?? true
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
        this.updatedAt = data.updated_at ? new Date(data.updated_at) : undefined
    }

    /**
     * Converts domain model back to DTO for API calls
     */
    toDTO(): ClassOccurrenceDTO {
        return {
            id: this.id,
            class_session_id: this.classSessionId,
            occurrence_date: this.formatDate(this.occurrenceDate),
            status: this.status,
            original_start_time: this.originalStartTime,
            original_end_time: this.originalEndTime,
            actual_start_time: this.actualStartTime,
            actual_end_time: this.actualEndTime,
            notes: this.notes,
            created_at: this.createdAt?.toISOString(),
            updated_at: this.updatedAt?.toISOString()
        }
    }

    /**
     * Formats date as YYYY-MM-DD
     */
    formatDate(date: Date): string {
        return date.toISOString().split('T')[0] || ''
    }

    /**
     * Check if occurrence is in the past
     */
    get isPast(): boolean {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        return this.occurrenceDate < today
    }

    /**
     * Check if occurrence is today
     */
    get isToday(): boolean {
        const today = new Date()
        return this.formatDate(this.occurrenceDate) === this.formatDate(today)
    }

    /**
     * Check if occurrence is completed
     */
    get isCompleted(): boolean {
        return this.status === 'completed'
    }

    /**
     * Check if occurrence is cancelled
     */
    get isCancelled(): boolean {
        return this.status === 'cancelled'
    }

    /**
     * Check if occurrence is scheduled
     */
    get isScheduled(): boolean {
        return this.status === 'scheduled'
    }

    /**
     * Get the actual or original start time
     */
    get effectiveStartTime(): string | undefined {
        return this.actualStartTime || this.originalStartTime
    }

    /**
     * Get the actual or original end time
     */
    get effectiveEndTime(): string | undefined {
        return this.actualEndTime || this.originalEndTime
    }

    /**
     * Mark occurrence as completed
     */
    markCompleted(): void {
        this.status = 'completed'
    }

    /**
     * Cancel occurrence with optional reason
     */
    cancel(reason?: string): void {
        this.status = 'cancelled'
        if (reason) {
            this.notes = this.notes ? `${this.notes}\nCancelled: ${reason}` : `Cancelled: ${reason}`
        }
    }

    /**
     * Get display string for occurrence
     */
    get displayString(): string {
        const dateStr = this.occurrenceDate.toLocaleDateString()
        const timeStr = this.effectiveStartTime ? ` ${this.effectiveStartTime.slice(0, 5)}` : ''
        return `${dateStr}${timeStr}`
    }
}
