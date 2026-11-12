import type { OccurrenceReportDTO, ReportDraftSnapshot } from '@/models/OccurrenceReport'
import { buildSnapshotFromDto, reportLessonEntriesEqual } from '@/models/ReportEditorSnapshot'

export interface ReportConflictMergeResult {
    payload: Record<string, unknown>
    conflictFields: string[]
    mergedTextFields: string[]
    changed: boolean
}

const textFields = [
    { name: 'content', local: 'content', document: 'contentDocument', server: 'content', serverDocument: 'content_document' },
    { name: 'contactNotes', local: 'contactNotes', document: 'contactNotesDocument', server: 'contact_notes', serverDocument: 'contact_notes_document' },
    { name: 'classNotes', local: 'classNotes', document: 'classNotesDocument', server: 'class_notes', serverDocument: 'class_notes_document' }
] as const

const metadataFields = [
    { name: 'lessonId', local: 'lessonId', server: 'lesson_id', payload: 'lessonId' },
    { name: 'isCompleted', local: 'isCompleted', server: 'is_completed', payload: 'isCompleted' },
    { name: 'progressLetter', local: 'progressLetter', server: 'progress_letter', payload: 'progressLetter' },
    { name: 'attendanceStatus', local: 'attendanceStatus', server: 'attendance_status', payload: 'attendanceStatus' },
    { name: 'absenceReason', local: 'absenceReason', server: 'absence_reason', payload: 'absenceReason' },
    { name: 'classParticipation', local: 'classParticipation', server: 'class_participation', payload: 'classParticipation' },
    { name: 'classroomBehavior', local: 'classroomBehavior', server: 'classroom_behavior', payload: 'classroomBehavior' },
    { name: 'externalLink', local: 'externalLink', server: 'external_link', payload: 'externalLink' }
] as const

function equal(a: unknown, b: unknown): boolean {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function textFromReport(report: OccurrenceReportDTO, field: typeof textFields[number]): string {
    const value = report[field.server]
    return typeof value === 'string' ? value : ''
}

function addTextPayload(payload: Record<string, unknown>, field: typeof textFields[number], snapshot: ReportDraftSnapshot) {
    payload[field.local] = snapshot[field.local]
    payload[field.document] = snapshot[field.document]
}

/**
 * Performs a conservative three-way merge. Yjs-ready editors may provide the
 * already merged local text; plain fallback editors never silently overwrite a
 * server text change.
 */
export function mergeReportConflict(
    base: ReportDraftSnapshot,
    local: ReportDraftSnapshot,
    server: OccurrenceReportDTO,
    collaborationReady: boolean
): ReportConflictMergeResult {
    const payload: Record<string, unknown> = {}
    const conflictFields: string[] = []
    const mergedTextFields: string[] = []
    let changed = false

    for (const field of textFields) {
        const baseValue = String(base[field.local] || '')
        const localValue = String(local[field.local] || '')
        const serverValue = textFromReport(server, field)
        if (equal(localValue, serverValue)) continue
        if (equal(localValue, baseValue)) continue
        if (equal(serverValue, baseValue) || collaborationReady) {
            addTextPayload(payload, field, local)
            changed = true
            if (!equal(serverValue, baseValue)) mergedTextFields.push(field.name)
        } else {
            conflictFields.push(field.name)
        }
    }

    for (const field of metadataFields) {
        const baseValue = base[field.local]
        const localValue = local[field.local]
        const serverValue = server[field.server]
        if (equal(localValue, serverValue)) continue
        if (equal(localValue, baseValue)) continue
        if (equal(serverValue, baseValue)) {
            payload[field.payload] = localValue
            changed = true
        } else {
            conflictFields.push(field.name)
        }
    }

    const baseEntries = base.lessonEntries ?? []
    const localEntries = local.lessonEntries ?? []
    const serverSnapshot = buildSnapshotFromDto(server)
    const serverEntries = serverSnapshot.lessonEntries ?? []
    const basePrimary = base.primaryLessonEntryId ?? null
    const localPrimary = local.primaryLessonEntryId ?? null
    const serverPrimary = serverSnapshot.primaryLessonEntryId ?? null
    if (!reportLessonEntriesEqual(localEntries, serverEntries) || !equal(localPrimary, serverPrimary)) {
        if (!reportLessonEntriesEqual(localEntries, baseEntries) || !equal(localPrimary, basePrimary)) {
            if (reportLessonEntriesEqual(serverEntries, baseEntries) && equal(serverPrimary, basePrimary)) {
                payload.lessonEntries = localEntries
                payload.primaryLessonEntryId = localPrimary
                changed = true
            } else {
                conflictFields.push('lessonEntries')
            }
        }
    }

    return { payload, conflictFields, mergedTextFields, changed }
}
