import type { OccurrenceReportDTO, ReportDraftSnapshot, ReportLessonEntryDTO } from '@/models/OccurrenceReport'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import { createTextEditorContent } from '@/components/text-editor/content'
import { normalizeAbsenceReasonCode } from '@/utils/absenceReason'
import { safeExternalHref } from '@/utils/safeExternalHref'

export type AttendanceStatus = 'present' | 'absent' | 'pending'
export type SystemManagedReason = 'holiday' | 'suspension'

/** Creates a UUID for a lesson row that predates the multi-lesson API shape. */
export function createLessonEntryId(): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
    return `00000000-0000-4000-8000-${Math.floor(Math.random() * 0xffffffffffff).toString(16).padStart(12, '0')}`
}

function legacyLessonEntryId(enrollmentId: string | undefined, lessonId: string): string {
    const seed = `${enrollmentId || 'legacy'}:${lessonId}`
    const hash = (suffix: number) => {
        let value = 2166136261 ^ suffix
        for (let index = 0; index < seed.length; index += 1) {
            value = Math.imul(value ^ seed.charCodeAt(index)!, 16777619)
        }
        return (value >>> 0).toString(16).padStart(8, '0')
    }
    const hex = [0, 1, 2, 3].map(hash).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function normalizeLessonEntries(
    entries: ReportLessonEntryDTO[] | undefined,
    enrollmentId: string | undefined,
    lessonId: string | undefined,
    isCompleted: boolean,
    progressLetter: string | null | undefined,
    primaryLessonEntryId: string | null | undefined
): { entries: ReportLessonEntryDTO[]; primaryLessonEntryId: string | null } {
    const source = Array.isArray(entries) ? entries : []
    const compatibleSource = source.length || !lessonId
        ? source
        : [{ id: legacyLessonEntryId(enrollmentId, lessonId || ''), enrollment_id: enrollmentId || '', lesson_id: lessonId || null, is_completed: isCompleted, progress_letter: progressLetter || null }]
    const normalized = compatibleSource.map(entry => ({
        ...entry,
        id: entry.id || createLessonEntryId(),
        enrollment_id: entry.enrollment_id || enrollmentId || '',
        lesson_id: entry.lesson_id || null,
        is_completed: entry.is_completed ?? false,
        progress_letter: entry.progress_letter || null,
    }))
    const primary = normalized.find(entry => entry.id === primaryLessonEntryId) || normalized[0]
    return { entries: normalized, primaryLessonEntryId: primary?.id ?? null }
}

/** Compares saved lesson data while ignoring display-only course/lesson labels. */
export function reportLessonEntriesEqual(left: ReportLessonEntryDTO[] | undefined, right: ReportLessonEntryDTO[] | undefined): boolean {
    const project = (entries: ReportLessonEntryDTO[] | undefined) => (entries ?? []).map(entry => ({
        id: entry.id,
        enrollment_id: entry.enrollment_id,
        lesson_id: entry.lesson_id ?? null,
        is_completed: entry.is_completed ?? false,
        progress_letter: entry.progress_letter ?? null,
    }))
    return JSON.stringify(project(left)) === JSON.stringify(project(right))
}

/** The fields a report save sends; only the ones that changed are set. */
export type ReportSavePayload = {
    lessonId?: string
    isCompleted?: boolean
    progressLetter?: string | null
    lessonEntries?: ReportLessonEntryDTO[]
    primaryLessonEntryId?: string | null
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
    enrollmentId?: string
    initialLessonId?: string
    initialIsCompleted?: boolean
    initialProgressStart?: string
    initialProgressEnd?: string
    initialLessonEntries?: ReportLessonEntryDTO[]
    initialPrimaryLessonEntryId?: string | null
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
    const progressLetter = composeProgressLetter(source.initialProgressStart, source.initialProgressEnd)
    const normalizedEntries = normalizeLessonEntries(
        source.initialLessonEntries,
        source.enrollmentId,
        source.initialLessonId,
        source.initialIsCompleted ?? false,
        progressLetter,
        source.initialPrimaryLessonEntryId
    )
    const primaryEntry = normalizedEntries.entries.find(entry => entry.id === normalizedEntries.primaryLessonEntryId)

    return {
        lessonId: primaryEntry?.lesson_id || source.initialLessonId || '',
        isCompleted: primaryEntry?.is_completed ?? source.initialIsCompleted ?? false,
        progressLetter: primaryEntry?.progress_letter || progressLetter,
        lessonEntries: normalizedEntries.entries,
        primaryLessonEntryId: normalizedEntries.primaryLessonEntryId,
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
    const normalizedEntries = normalizeLessonEntries(
        report.lesson_entries,
        report.enrollment_id,
        report.lesson_id,
        report.is_completed ?? false,
        report.progress_letter,
        report.primary_lesson_entry_id
    )
    const primaryEntry = normalizedEntries.entries.find(entry => entry.id === normalizedEntries.primaryLessonEntryId)
    return {
        lessonId: primaryEntry?.lesson_id || report.lesson_id || '',
        isCompleted: primaryEntry?.is_completed ?? report.is_completed ?? false,
        progressLetter: primaryEntry?.progress_letter || report.progress_letter || '',
        lessonEntries: normalizedEntries.entries,
        primaryLessonEntryId: normalizedEntries.primaryLessonEntryId,
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
        const unchanged = key === 'lessonEntries'
            ? reportLessonEntriesEqual(current.lessonEntries, previous.lessonEntries)
            : JSON.stringify(current[key] ?? null) === JSON.stringify(previous[key] ?? null)
        if (!unchanged) {
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
    addIfChanged('lessonEntries', () => {
        payload.lessonEntries = current.lessonEntries ?? []
    })
    addIfChanged('primaryLessonEntryId', () => {
        payload.primaryLessonEntryId = current.primaryLessonEntryId ?? null
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
