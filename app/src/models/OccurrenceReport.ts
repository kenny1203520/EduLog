/**
 * OccurrenceReport represents a student's report for a specific class occurrence.
 * Supports versioning for conflict resolution and auto-save functionality.
 */

import { DateUtils } from '@/utils/dateUtils'
import { calculateTextEditorMetrics, createTextEditorContent } from '@/components/text-editor/content'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import type { SourceReportIdentity } from '@/utils/sourceReportLink'

export interface OccurrenceReportDTO {
    id?: string
    enrollment_id: string
    class_occurrence_id: string
    lesson_id?: string
    is_completed?: boolean
    lesson_entries?: ReportLessonEntryDTO[]
    primary_lesson_entry_id?: string | null

    // Detailed report fields
    progress_letter?: string  // A-Z when incomplete
    attendance_status?: 'present' | 'absent' | 'pending'
    absence_reason?: string
    class_participation?: number | null
    classroom_behavior?: number | null
    contact_notes?: string
    class_notes?: string
    content: string
    contact_notes_document?: RichTextDocumentV1 | null
    class_notes_document?: RichTextDocumentV1 | null
    content_document?: RichTextDocumentV1 | null
    external_link?: string
    // Read-only identity of the imported source report (null when not imported)
    source_origin?: string | null
    source_admission_id?: string | null
    source_report_id?: string | null

    version: number
    occurrence_date?: string
    last_edited_by?: string
    last_edited_at?: string
    created_at?: string
    updated_at?: string
}

/** A course lesson recorded during a single attendance/report event. */
export interface ReportLessonEntryDTO {
    id: string
    enrollment_id: string
    lesson_id: string | null
    is_completed: boolean
    progress_letter: string | null
    course_id?: string
    course_name?: string
    lesson_sequence?: number
    lesson_title?: string
}

/** Immutable editor state used by the serialized report save queue. */
export interface ReportDraftSnapshot {
    lessonId: string
    isCompleted: boolean
    progressLetter: string
    lessonEntries?: ReportLessonEntryDTO[]
    primaryLessonEntryId?: string | null
    attendanceStatus: 'present' | 'absent' | 'pending'
    absenceReason: string | null
    classParticipation: number | null
    classroomBehavior: number | null
    contactNotes: string
    contactNotesDocument: RichTextDocumentV1
    classNotes: string
    classNotesDocument: RichTextDocumentV1
    content: string
    contentDocument: RichTextDocumentV1
    externalLink: string
}

export interface ReportVersionDTO {
    id?: string
    occurrence_report_id: string
    version: number
    content: string
    edited_by?: string
    snapshot?: any
    created_at?: string
}

/**
 * OccurrenceReport domain model
 */
export class OccurrenceReport implements SourceReportIdentity {
    id?: string
    enrollmentId: string
    classOccurrenceId: string
    lessonId?: string
    isCompleted?: boolean
    lessonEntries: ReportLessonEntryDTO[] = []
    primaryLessonEntryId: string | null = null

    // Detailed fields
    progressLetter?: string
    attendanceStatus?: 'present' | 'absent' | 'pending'
    absenceReason?: string
    classParticipation?: number | null
    classroomBehavior?: number | null
    contactNotes?: string
    contactNotesDocument: RichTextDocumentV1
    classNotes?: string
    classNotesDocument: RichTextDocumentV1
    content: string
    contentDocument: RichTextDocumentV1
    externalLink?: string
    sourceOrigin: string | null = null
    sourceAdmissionId: string | null = null
    sourceReportId: string | null = null

    version: number
    occurrenceDate?: Date
    lastEditedBy?: string
    lastEditedAt?: Date
    createdAt?: Date
    updatedAt?: Date

    constructor(data: OccurrenceReportDTO) {
        this.enrollmentId = ''
        this.classOccurrenceId = ''
        this.content = ''
        this.contentDocument = createTextEditorContent('').richText
        this.contactNotesDocument = createTextEditorContent('').richText
        this.classNotesDocument = createTextEditorContent('').richText
        this.version = 1
        this.applyDTO(data)
    }

    /** Applies an authoritative database representation to this model instance. */
    applyDTO(data: OccurrenceReportDTO): void {
        this.id = data.id
        this.enrollmentId = data.enrollment_id
        this.classOccurrenceId = data.class_occurrence_id
        this.lessonId = data.lesson_id
        this.isCompleted = data.is_completed ?? false
        this.lessonEntries = Array.isArray(data.lesson_entries) ? data.lesson_entries.map(entry => ({ ...entry })) : []
        if (!this.lessonEntries.length && data.lesson_id) {
            this.lessonEntries = [{
                id: globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000001',
                enrollment_id: data.enrollment_id,
                lesson_id: data.lesson_id,
                is_completed: data.is_completed ?? false,
                progress_letter: data.progress_letter || null,
            }]
        }
        this.primaryLessonEntryId = data.primary_lesson_entry_id ?? this.lessonEntries[0]?.id ?? null

        // Detailed fields
        this.progressLetter = data.progress_letter
        this.attendanceStatus = data.attendance_status
        this.absenceReason = data.absence_reason
        this.classParticipation = data.class_participation
        this.classroomBehavior = data.classroom_behavior
        this.contactNotes = data.contact_notes
        this.classNotes = data.class_notes
        const contact = createTextEditorContent(data.contact_notes_document || data.contact_notes || '')
        const classNotes = createTextEditorContent(data.class_notes_document || data.class_notes || '')
        const content = createTextEditorContent(data.content_document || data.content || '')
        this.contactNotes = contact.plainText
        this.contactNotesDocument = contact.richText
        this.classNotes = classNotes.plainText
        this.classNotesDocument = classNotes.richText
        this.content = content.plainText
        this.contentDocument = content.richText
        this.externalLink = data.external_link
        this.sourceOrigin = data.source_origin ?? null
        this.sourceAdmissionId = data.source_admission_id ?? null
        this.sourceReportId = data.source_report_id ?? null

        this.version = data.version
        this.occurrenceDate = DateUtils.parseLocalDate(data.occurrence_date)
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
            lesson_entries: this.lessonEntries.map(entry => ({ ...entry })),
            primary_lesson_entry_id: this.primaryLessonEntryId,

            // Detailed fields
            progress_letter: this.progressLetter,
            attendance_status: this.attendanceStatus,
            absence_reason: this.absenceReason,
            class_participation: this.classParticipation,
            classroom_behavior: this.classroomBehavior,
            contact_notes: this.contactNotes,
            contact_notes_document: this.contactNotesDocument,
            class_notes: this.classNotes,
            class_notes_document: this.classNotesDocument,
            content: this.content,
            content_document: this.contentDocument,
            external_link: this.externalLink,
            source_origin: this.sourceOrigin,
            source_admission_id: this.sourceAdmissionId,
            source_report_id: this.sourceReportId,

            version: this.version,
            occurrence_date: DateUtils.formatLocalDate(this.occurrenceDate),
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
        return calculateTextEditorMetrics(this.content).wordCount
    }

    /**
     * Get character count
     */
    get characterCount(): number {
        return calculateTextEditorMetrics(this.content).characterCount
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
    snapshot?: any
    createdAt?: Date

    constructor(data: ReportVersionDTO) {
        this.id = data.id
        this.occurrenceReportId = data.occurrence_report_id
        this.version = data.version
        this.content = data.content
        this.editedBy = data.edited_by
        this.snapshot = data.snapshot
        this.createdAt = data.created_at ? new Date(data.created_at) : undefined
    }

    toDTO(): ReportVersionDTO {
        return {
            id: this.id,
            occurrence_report_id: this.occurrenceReportId,
            version: this.version,
            content: this.content,
            edited_by: this.editedBy,
            snapshot: this.snapshot,
            created_at: this.createdAt?.toISOString()
        }
    }

    /**
     * Get display string for version
     */
    get displayString(): string {
        const timeStr = this.createdAt ? DateUtils.displayDateTime(this.createdAt) : 'Unknown time'
        return `Version ${this.version} - ${timeStr}`
    }
}

/**
 * Result of a save operation
 */
export interface SaveReportResult {
    success: boolean
    /** Developer-facing (English) detail for logs -- never render directly to the user. */
    message?: string
    /** i18n key the UI should translate and show instead of `message`. */
    messageKey?: string
    newVersion?: number
    conflict?: boolean
    serverContent?: string
    serverReport?: OccurrenceReportDTO // Full server report for deep comparison
    updatedReport?: OccurrenceReportDTO // Authoritative row returned after a successful save
    errorCode?: 'request_timeout' | 'save_outcome_unknown' | 'network_error' | 'conflict' | 'permission_denied' | 'validation_error' | 'system_managed'
    /** Latest canonical version observed while reconciling a conflict. */
    serverVersion?: number
    /** True when the local draft was safely merged and retried. */
    merged?: boolean
    /** Metadata/text fields that require an explicit user decision. */
    conflictFields?: string[]
}
