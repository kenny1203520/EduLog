/**
 * OccurrenceReport represents a student's report for a specific class occurrence.
 * Supports versioning for conflict resolution and auto-save functionality.
 */

export interface OccurrenceReportDTO {
    id?: string
    enrollment_id: string
    class_occurrence_id: string
    lesson_id?: string
    is_completed?: boolean
    
    // Detailed report fields
    progress_letter?: string  // A-H when incomplete
    attendance_status?: 'present' | 'absent'
    absence_reason?: string
    class_participation?: number
    classroom_behavior?: number
    contact_notes?: string
    class_notes?: string
    content: string
    external_link?: string
    
    version: number
    last_edited_by?: string
    last_edited_at?: string
    created_at?: string
    updated_at?: string
}

export interface ReportVersionDTO {
    id?: string
    occurrence_report_id: string
    version: number
    content: string
    edited_by?: string
    created_at?: string
}

/**
 * OccurrenceReport domain model
 */
export class OccurrenceReport {
    id?: string
    enrollmentId: string
    classOccurrenceId: string
    lessonId?: string
    isCompleted?: boolean
    
    // Detailed fields
    progressLetter?: string
    attendanceStatus?: 'present' | 'absent'
    absenceReason?: string
    classParticipation?: number
    classroomBehavior?: number
    contactNotes?: string
    classNotes?: string
    content: string
    externalLink?: string
    
    version: number
    lastEditedBy?: string
    lastEditedAt?: Date
    createdAt?: Date
    updatedAt?: Date

    constructor(data: OccurrenceReportDTO) {
        this.id = data.id
        this.enrollmentId = data.enrollment_id
        this.classOccurrenceId = data.class_occurrence_id
        this.lessonId = data.lesson_id
        this.isCompleted = data.is_completed ?? true
        
        // Detailed fields
        this.progressLetter = data.progress_letter
        this.attendanceStatus = data.attendance_status
        this.absenceReason = data.absence_reason
        this.classParticipation = data.class_participation
        this.classroomBehavior = data.classroom_behavior
        this.contactNotes = data.contact_notes
        this.classNotes = data.class_notes
        this.content = data.content
        this.externalLink = data.external_link
        
        this.version = data.version
        this.lastEditedBy = data.last_edited_by
        this.lastEditedAt = data.last_edited_at ? new Date(data.last_edited_at) : undefined
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
        this.updatedAt = data.updated_at ? new Date(data.updated_at) : undefined
    }

    /**
     * Converts domain model to DTO
     */
    toDTO(): OccurrenceReportDTO {
        return {
            id: this.id,
            enrollment_id: this.enrollmentId,
            class_occurrence_id: this.classOccurrenceId,
            lesson_id: this.lessonId,
            is_completed: this.isCompleted,
            
            // Detailed fields
            progress_letter: this.progressLetter,
            attendance_status: this.attendanceStatus,
            absence_reason: this.absenceReason,
            class_participation: this.classParticipation,
            classroom_behavior: this.classroomBehavior,
            contact_notes: this.contactNotes,
            class_notes: this.classNotes,
            content: this.content,
            external_link: this.externalLink,
            
            version: this.version,
            last_edited_by: this.lastEditedBy,
            last_edited_at: this.lastEditedAt?.toISOString(),
            created_at: this.createdAt?.toISOString(),
            updated_at: this.updatedAt?.toISOString()
        }
    }

    /**
     * Check if report is empty
     */
    get isEmpty(): boolean {
        return !this.content || this.content.trim().length === 0
    }

    /**
     * Get word count
     */
    get wordCount(): number {
        if (this.isEmpty) return 0
        return this.content.trim().split(/\s+/).length
    }

    /**
     * Get character count
     */
    get characterCount(): number {
        return this.content.length
    }

    /**
     * Check if report was recently edited (within last 5 minutes)
     */
    get isRecentlyEdited(): boolean {
        if (!this.lastEditedAt) return false
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
        return this.lastEditedAt > fiveMinutesAgo
    }

    /**
     * Increment version (for optimistic locking)
     */
    incrementVersion(): void {
        this.version++
    }

    /**
     * Get start progress letter (e.g. "A" from "A-C" or "A")
     */
    get progressStart(): string {
        return this.progressLetter ? (this.progressLetter.split('-')[0] || '') : ''
    }

    /**
     * Get end progress letter (e.g. "C" from "A-C")
     */
    get progressEnd(): string {
        return this.progressLetter && this.progressLetter.includes('-') ? (this.progressLetter.split('-')[1] || '') : ''
    }

    /**
     * Update content and metadata
     */
    updateContent(newContent: string, editorId?: string): void {
        this.content = newContent
        this.lastEditedBy = editorId
        this.lastEditedAt = new Date()
    }
}

/**
 * ReportVersion represents a historical version of a report
 */
export class ReportVersion {
    id?: string
    occurrenceReportId: string
    version: number
    content: string
    editedBy?: string
    createdAt?: Date

    constructor(data: ReportVersionDTO) {
        this.id = data.id
        this.occurrenceReportId = data.occurrence_report_id
        this.version = data.version
        this.content = data.content
        this.editedBy = data.edited_by
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
    }

    toDTO(): ReportVersionDTO {
        return {
            id: this.id,
            occurrence_report_id: this.occurrenceReportId,
            version: this.version,
            content: this.content,
            edited_by: this.editedBy,
            created_at: this.createdAt?.toISOString()
        }
    }

    /**
     * Get display string for version
     */
    get displayString(): string {
        const timeStr = this.createdAt?.toLocaleString() || 'Unknown time'
        return `Version ${this.version} - ${timeStr}`
    }
}

/**
 * Result of a save operation
 */
export interface SaveReportResult {
    success: boolean
    message?: string
    newVersion?: number
    conflict?: boolean
    serverContent?: string
    serverReport?: OccurrenceReportDTO // Full server report for deep comparison
}