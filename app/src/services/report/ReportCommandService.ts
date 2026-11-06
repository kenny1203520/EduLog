import {
    OccurrenceReport,
    type OccurrenceReportDTO,
    type SaveReportResult
} from '@/models/OccurrenceReport'
import { ReportQueryService } from './ReportQueryService'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'
import { createTextEditorContent } from '@/components/text-editor/content'
import { safeExternalHref } from '@/utils/safeExternalHref'
import { ApiV1Error, apiV1Client } from '@/services/api/ApiV1Client'
import { isBrowserOffline, isNetworkError } from '@/utils/networkErrors'

function assignRichTextPair(
    target: Record<string, unknown>,
    plainColumn: string,
    documentColumn: string,
    plainText: string | undefined,
    document: RichTextDocumentV1 | null | undefined
) {
    const content = createTextEditorContent(document || plainText || '')
    target[plainColumn] = content.plainText
    target[documentColumn] = content.richText
}

type ReportSaveData = {
    lessonId?: string
    isCompleted?: boolean
    progressLetter?: string | null
    attendanceStatus?: 'present' | 'absent' | 'pending'
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

function toApiReportData(data?: ReportSaveData): Record<string, unknown> {
    if (!data) return {}
    const result: Record<string, unknown> = {}
    if (data.lessonId !== undefined) result.lesson_id = data.lessonId
    if (data.isCompleted !== undefined) result.is_completed = data.isCompleted
    if (data.progressLetter !== undefined) result.progress_letter = data.progressLetter
    if (data.attendanceStatus !== undefined) result.attendance_status = data.attendanceStatus
    if (data.absenceReason !== undefined) result.absence_reason = data.absenceReason
    if (data.classParticipation !== undefined) result.class_participation = data.classParticipation
    if (data.classroomBehavior !== undefined) result.classroom_behavior = data.classroomBehavior
    if (data.contactNotes !== undefined || data.contactNotesDocument !== undefined) assignRichTextPair(result, 'contact_notes', 'contact_notes_document', data.contactNotes, data.contactNotesDocument)
    if (data.classNotes !== undefined || data.classNotesDocument !== undefined) assignRichTextPair(result, 'class_notes', 'class_notes_document', data.classNotes, data.classNotesDocument)
    if (data.content !== undefined || data.contentDocument !== undefined) assignRichTextPair(result, 'content', 'content_document', data.content, data.contentDocument)
    if (data.externalLink !== undefined) result.external_link = safeExternalHref(data.externalLink) || null
    return result
}

function isSystemManagedReason(value: unknown): boolean {
    const reason = String(value ?? '').trim().toLowerCase()
    return reason === 'holiday' || reason === 'suspension'
}

function isSystemManagedApiError(error: unknown): error is ApiV1Error {
    return error instanceof ApiV1Error && error.code === 'SYSTEM_MANAGED_REPORT'
}

function systemManagedFailure(message = 'Attendance is managed by the system'): SaveReportResult {
    return {
        success: false,
        conflict: false,
        errorCode: 'system_managed',
        message,
        messageKey: 'report.editor.system_managed_absence_notice'
    }
}

async function loadCanonicalReportV1(reportId: string): Promise<OccurrenceReportDTO> {
    const response = await apiV1Client.get<OccurrenceReportDTO>('/reports/' + encodeURIComponent(reportId))
    return response.data
}

/**
 * A report can become system-managed while an editor is open. Re-read the
 * canonical row, discard only attendance fields, and retry other edits once
 * against the current version. If attendance was the only edit, treating the
 * server value as the successful result is the safe close behavior.
 */
async function reconcileV1SystemManagedSave(
    reportId: string,
    detailedData: ReportSaveData | undefined,
    message: string
): Promise<SaveReportResult> {
    try {
        const canonical = await loadCanonicalReportV1(reportId)
        if (!isSystemManagedReason(canonical.absence_reason)) return systemManagedFailure(message)

        const nonAttendanceData = { ...(detailedData || {}) }
        delete nonAttendanceData.attendanceStatus
        delete nonAttendanceData.absenceReason
        const retryData = toApiReportData(nonAttendanceData)

        if (Object.keys(retryData).length === 0) {
            return { success: true, conflict: false, newVersion: canonical.version, updatedReport: canonical }
        }

        try {
            const response = await apiV1Client.patch<OccurrenceReportDTO>(
                '/reports/' + encodeURIComponent(reportId),
                { ...retryData, expected_version: canonical.version }
            )
            return { success: true, conflict: false, newVersion: response.data.version, updatedReport: response.data }
        } catch (retryError) {
            if (retryError instanceof ApiV1Error && retryError.status === 409) {
                return {
                    success: false,
                    conflict: true,
                    errorCode: 'conflict',
                    serverVersion: canonical.version,
                    serverReport: canonical,
                    message: retryError.message,
                    messageKey: 'errors.conflict'
                }
            }
            if (isSystemManagedApiError(retryError)) return systemManagedFailure(retryError.message)
            return { success: false, conflict: false, message: retryError instanceof Error ? retryError.message : message, messageKey: 'errors.unknown' }
        }
    } catch (reloadError) {
        return systemManagedFailure(reloadError instanceof Error ? reloadError.message : message)
    }
}

async function reconcileV1SystemManagedAttendance(reportId: string, message: string): Promise<SaveReportResult> {
    try {
        const canonical = await loadCanonicalReportV1(reportId)
        return isSystemManagedReason(canonical.absence_reason)
            ? { success: true, conflict: false, newVersion: canonical.version, updatedReport: canonical }
            : systemManagedFailure(message)
    } catch (reloadError) {
        return systemManagedFailure(reloadError instanceof Error ? reloadError.message : message)
    }
}
type AttendanceOnlyData = {
    attendanceStatus: 'present' | 'absent' | 'pending'
    absenceReason?: string | null
}

/** Report fields the v1 API accepts in a patch (server `reportPatch`, which rejects any other key). */
const REPORT_PATCH_FIELDS = [
    'lesson_id', 'is_completed', 'progress_letter', 'attendance_status', 'absence_reason',
    'class_participation', 'classroom_behavior', 'contact_notes', 'contact_notes_document',
    'class_notes', 'class_notes_document', 'content', 'content_document', 'external_link'
] as const

/** The editable part of a report; ids, version and timestamps are owned by the server. */
export function toReportPatch(report: OccurrenceReportDTO): Record<string, unknown> {
    const patch: Record<string, unknown> = {}
    for (const field of REPORT_PATCH_FIELDS) {
        const value = (report as unknown as Record<string, unknown>)[field]
        if (value !== undefined) patch[field] = value
    }
    return patch
}
/** Generic save failure; connection problems get a retryable `network_error` code. */
function saveFailure(error: unknown, message: string): SaveReportResult {
    if (isNetworkError(error) || isBrowserOffline()) {
        return {
            success: false,
            conflict: false,
            errorCode: 'network_error',
            message,
            messageKey: isBrowserOffline() ? 'report.editor.save_failed_offline' : 'report.editor.save_failed_network'
        }
    }
    return { success: false, conflict: false, message, messageKey: 'errors.unknown' }
}

export class ReportCommandService {

    static async createReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport> {
        const response = await apiV1Client.post<any>('/reports', { enrollment_id: enrollmentId, class_occurrence_id: occurrenceId })
        return new OccurrenceReport(response.data)
    }

    static async getOrCreateReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport> {
        const existing = await ReportQueryService.getReport(enrollmentId, occurrenceId)
        if (existing) return existing

        return this.createReport(enrollmentId, occurrenceId)
    }

    static async saveReport(
        reportId: string,
        currentVersion: number,
        _userId?: string,
        detailedData?: ReportSaveData
    ): Promise<SaveReportResult> {
        try {
            const response = await apiV1Client.patch<any>('/reports/' + encodeURIComponent(reportId), { ...toApiReportData(detailedData), expected_version: currentVersion })
            return { success: true, conflict: false, newVersion: response.data.version, updatedReport: response.data }
        } catch (error) {
            if (error instanceof ApiV1Error && error.status === 409) return { success: false, conflict: true, errorCode: 'conflict', message: error.message, messageKey: 'errors.conflict' }
            if (isSystemManagedApiError(error)) return reconcileV1SystemManagedSave(reportId, detailedData, error.message)
            return saveFailure(error, error instanceof Error ? error.message : 'Failed to save report')
        }
    }

    static async saveAttendanceOnly(
        reportId: string,
        currentVersion: number,
        _userId: string | undefined,
        attendanceData: AttendanceOnlyData
    ): Promise<SaveReportResult> {
        try {
            const response = await apiV1Client.patch<any>('/reports/' + encodeURIComponent(reportId), { attendance_status: attendanceData.attendanceStatus, ...(attendanceData.absenceReason !== undefined ? { absence_reason: attendanceData.absenceReason } : {}), expected_version: currentVersion })
            return { success: true, conflict: false, newVersion: response.data.version, updatedReport: response.data }
        } catch (error) {
            if (error instanceof ApiV1Error && error.status === 409) return { success: false, conflict: true, errorCode: 'conflict', message: error.message, messageKey: 'errors.conflict' }
            if (isSystemManagedApiError(error)) return reconcileV1SystemManagedAttendance(reportId, error.message)
            return saveFailure(error, error instanceof Error ? error.message : 'Failed to save attendance')
        }
    }

    static async restoreReportVersion(
        reportId: string,
        versionId: string,
        _userId?: string,
        currentVersion?: number
    ): Promise<OccurrenceReport> {
        if (currentVersion === undefined) throw new Error('expectedVersion is required to restore a report version')
        const response = await apiV1Client.post<any>(`/reports/${encodeURIComponent(reportId)}/versions/${encodeURIComponent(versionId)}/restore`, { expected_version: currentVersion })
        return new OccurrenceReport(response.data)
    }

    static async resolveConflict(
        reportId: string,
        resolvedReport: OccurrenceReportDTO,
        _userId?: string,
        expectedVersion?: number
    ): Promise<OccurrenceReport> {
        if (expectedVersion === undefined) throw new Error('expectedVersion is required to resolve a report conflict')
        const response = await apiV1Client.post<any>(`/reports/${encodeURIComponent(reportId)}/conflicts/resolve`, { expected_version: expectedVersion, report: toReportPatch(resolvedReport) })
        return new OccurrenceReport(response.data)
    }

    static async deleteReportAndRevertProgress(reportId: string): Promise<void> {
        await apiV1Client.delete('/reports/' + encodeURIComponent(reportId)); return
    }

    static async deleteReport(reportId: string): Promise<void> {
        await apiV1Client.delete('/reports/' + encodeURIComponent(reportId)); return
    }

    static async createReportsForOccurrence(
        occurrenceId: string
    ): Promise<OccurrenceReport[]> {
        const response = await apiV1Client.post<any[]>(`/occurrences/${encodeURIComponent(occurrenceId)}/reports`, {})
        return (response.data || []).map((row) => new OccurrenceReport(row))
    }
}


