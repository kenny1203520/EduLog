import type { OccurrenceReportDTO, ReportDraftSnapshot } from '@/models/OccurrenceReport'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import { createTextEditorContent } from '@/components/text-editor/content'
import { normalizeAbsenceReasonCode } from '@/utils/absenceReason'
import { safeExternalHref } from '@/utils/safeExternalHref'

export type AttendanceStatus = 'present' | 'absent' | 'pending'
export type SystemManagedReason = 'holiday' | 'suspension'

/** The fields a report save sends; only the ones that changed are set. */
export type ReportSavePayload = {
    lessonId?: string
    isCompleted?: boolean
    progressLetter?: string | null
    attendanceStatus?: AttendanceStatus
    absenceReason?: string | null
    classParticipation?: number | null
    classroomBehavior?: number | null
    contactNotes?: string
    contactNotesDocument?: RichTextDocumentV1
    classNotes?: string
    classNotesDocument?: RichTextDocumentV1
    content?: string
    contentDocument?: RichTextDocumentV1
    externalLink?: string
}

/** Holiday and suspension absences are set by the system and never edited in a report. */
export function normalizeSystemManagedReason(value: unknown): SystemManagedReason | null {
    const reason = String(value ?? '').trim().toLowerCase()
    return reason === 'holiday' || reason === 'suspension' ? reason : null
}

/** Ratings are 1..n; anything else (0, '', null, NaN) means "not rated". */
export function normalizeReportRating(value: unknown): number | null {
    const rating = value === null || value === undefined || value === '' ? null : Number(value)
    return typeof rating === 'number' && Number.isFinite(rating) && rating > 0 ? rating : null
}

/** "A-C" for a range, otherwise whichever end is set. */
export function composeProgressLetter(start: string | null | undefined, end: string | null | undefined): string {
    if (start && end) return `${start}-${end}`
    return start || end || ''
}

function normalizeAbsenceReason(status: AttendanceStatus, reason: string | null | undefined): string | null {
    return status === 'absent' ? (reason || '') : null
}

/** The values a report's initial props describe, as the editor's saved baseline. */
export interface ReportSnapshotSource {
    initialLessonId?: string
    initialIsCompleted?: boolean
    initialProgressStart?: string
    initialProgressEnd?: string
    initialAttendanceStatus?: AttendanceStatus
    initialAbsenceReason?: string
    initialClassParticipation?: number | null
    initialClassroomBehavior?: number | null
    initialContactNotes?: string
    initialContactNotesDocument?: RichTextDocumentV1 | null
    initialClassNotes?: string
    initialClassNotesDocument?: RichTextDocumentV1 | null
    initialContent?: string
    initialContentDocument?: RichTextDocumentV1 | null
    initialReportExternalLink?: string
}

export function buildSnapshotFromProps(source: ReportSnapshotSource): ReportDraftSnapshot {
    const initialStatus = source.initialAttendanceStatus || 'pending'
    const managedReason = normalizeSystemManagedReason(source.initialAbsenceReason)
    const contact = createTextEditorContent(source.initialContactNotesDocument || source.initialContactNotes || '')
    const classNotesContent = createTextEditorContent(source.initialClassNotesDocument || source.initialClassNotes || '')
    const main = createTextEditorContent(source.initialContentDocument || source.initialContent || '')

    return {
        lessonId: source.initialLessonId || '',
        isCompleted: source.initialIsCompleted ?? false,
        progressLetter: composeProgressLetter(source.initialProgressStart, source.initialProgressEnd),
        attendanceStatus: initialStatus,
        absenceReason: initialStatus === 'absent'
            ? (managedReason || normalizeAbsenceReasonCode(normalizeAbsenceReason(initialStatus, source.initialAbsenceReason)))
            : null,
        classParticipation: normalizeReportRating(source.initialClassParticipation),
        classroomBehavior: normalizeReportRating(source.initialClassroomBehavior),
        contactNotes: contact.plainText,
        contactNotesDocument: contact.richText,
        classNotes: classNotesContent.plainText,
        classNotesDocument: classNotesContent.richText,
        content: main.plainText,
        contentDocument: main.richText,
        externalLink: safeExternalHref(source.initialReportExternalLink) || ''
    }
}

export function buildSnapshotFromDto(report: OccurrenceReportDTO): ReportDraftSnapshot {
    const contact = createTextEditorContent(report.contact_notes_document || report.contact_notes || '')
    const classNotesContent = createTextEditorContent(report.class_notes_document || report.class_notes || '')
    const main = createTextEditorContent(report.content_document || report.content || '')
    return {
        lessonId: report.lesson_id || '',
        isCompleted: report.is_completed ?? false,
        progressLetter: report.progress_letter || '',
        attendanceStatus: report.attendance_status || 'pending',
        absenceReason: normalizeSystemManagedReason(report.absence_reason)
            || normalizeAbsenceReasonCode(normalizeAbsenceReason(report.attendance_status || 'pending', report.absence_reason)),
        classParticipation: normalizeReportRating(report.class_participation),
        classroomBehavior: normalizeReportRating(report.classroom_behavior),
        contactNotes: contact.plainText,
        contactNotesDocument: contact.richText,
        classNotes: classNotesContent.plainText,
        classNotesDocument: classNotesContent.richText,
        content: main.plainText,
        contentDocument: main.richText,
        externalLink: report.external_link || ''
    }
}

/**
 * Compares the editor's snapshot with the last saved one and returns the
 * changed keys and the save payload for them. A rich-text change also sends
 * its plain text. With `includeAttendance: false` attendance is left out, so
 * system-managed attendance never becomes a mutation.
 */
export function buildDirtyReportPayload(
    current: ReportDraftSnapshot,
    previous: ReportDraftSnapshot,
    options: { includeAttendance: boolean }
): { keys: Array<keyof ReportDraftSnapshot>, payload: ReportSavePayload } {
    const keys: Array<keyof ReportDraftSnapshot> = []
    const payload: ReportSavePayload = {}

    const addIfChanged = <K extends keyof ReportDraftSnapshot>(
        key: K,
        assign: () => void
    ) => {
        if (JSON.stringify(current[key] ?? null) !== JSON.stringify(previous[key] ?? null)) {
            keys.push(key)
            assign()
        }
    }

    addIfChanged('lessonId', () => {
        payload.lessonId = current.lessonId || undefined
    })
    addIfChanged('isCompleted', () => {
        payload.isCompleted = current.isCompleted
    })
    addIfChanged('progressLetter', () => {
        payload.progressLetter = current.progressLetter || null
    })
    if (options.includeAttendance) {
        addIfChanged('attendanceStatus', () => {
            payload.attendanceStatus = current.attendanceStatus
        })
        addIfChanged('absenceReason', () => {
            payload.absenceReason = current.absenceReason
        })
    }
    addIfChanged('classParticipation', () => {
        payload.classParticipation = current.classParticipation
    })
    addIfChanged('classroomBehavior', () => {
        payload.classroomBehavior = current.classroomBehavior
    })
    addIfChanged('contactNotes', () => {
        payload.contactNotes = current.contactNotes
    })
    addIfChanged('contactNotesDocument', () => {
        payload.contactNotes = current.contactNotes
        payload.contactNotesDocument = current.contactNotesDocument
    })
    addIfChanged('classNotes', () => {
        payload.classNotes = current.classNotes
    })
    addIfChanged('classNotesDocument', () => {
        payload.classNotes = current.classNotes
        payload.classNotesDocument = current.classNotesDocument
    })
    addIfChanged('content', () => {
        payload.content = current.content
    })
    addIfChanged('contentDocument', () => {
        payload.content = current.content
        payload.contentDocument = current.contentDocument
    })
    addIfChanged('externalLink', () => {
        payload.externalLink = current.externalLink
    })

    return { keys, payload }
}

/** Only attendance changed: saved through the attendance-only endpoint. */
export function isAttendanceOnlyChange(keys: Array<keyof ReportDraftSnapshot>): boolean {
    return keys.length > 0 && keys.every(key => key === 'attendanceStatus' || key === 'absenceReason')
}
