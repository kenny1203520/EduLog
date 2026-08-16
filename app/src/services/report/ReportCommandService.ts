import { supabase } from '@/lib/supabase'
import {
    OccurrenceReport,
    type OccurrenceReportDTO,
    type SaveReportResult
} from '@/models/OccurrenceReport'
import { EnrollmentProgressService } from '../enrollment/EnrollmentProgressService'
import { ReportLifecyclePolicy } from './ReportLifecyclePolicy'
import { ReportQueryService } from './ReportQueryService'
import { OccurrenceRosterService } from '../occurrence/OccurrenceRosterService'
import type { RichTextDocumentV1 } from '@/components/common/text-editor/types'
import { createTextEditorContent } from '@/components/common/text-editor/content'

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
    classParticipation?: number
    classroomBehavior?: number
    contactNotes?: string
    contactNotesDocument?: RichTextDocumentV1
    classNotes?: string
    classNotesDocument?: RichTextDocumentV1
    content?: string
    contentDocument?: RichTextDocumentV1
    externalLink?: string
}

type AttendanceOnlyData = {
    attendanceStatus: 'present' | 'absent' | 'pending'
    absenceReason?: string | null
}

export class ReportCommandService {
    /** Full row fetch used only once a version conflict is confirmed, to populate the conflict-resolution UI. */
    private static async fetchFullReportForConflict(reportId: string): Promise<OccurrenceReportDTO | undefined> {
        const { data, error } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('id', reportId)
            .maybeSingle()
        if (error) {
            console.error('Failed to fetch full report for conflict resolution:', error)
            return undefined
        }
        return (data as OccurrenceReportDTO) || undefined
    }

    static async createReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport> {
        const newReport = await ReportLifecyclePolicy.buildInitialReportPayload(enrollmentId, occurrenceId)

        let { data: created, error: createError } = await supabase
            .from('occurrence_reports')
            .insert(newReport)
            .select()
            .single()

        if (createError?.message?.includes('occurrence_reports_attendance_status_check')) {
            const retryPayload: Partial<OccurrenceReportDTO> = {
                enrollment_id: enrollmentId,
                class_occurrence_id: occurrenceId,
                content: '',
                version: 1,
                is_completed: false,
                attendance_status: 'pending'
            }

            const retryResult = await supabase
                .from('occurrence_reports')
                .insert(retryPayload)
                .select()
                .single()

            created = retryResult.data
            createError = retryResult.error
        }

        if (createError) throw new Error(`Failed to create report: ${createError.message}`)

        return new OccurrenceReport(created)
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
        userId?: string,
        detailedData?: ReportSaveData
    ): Promise<SaveReportResult> {
        // Narrow pre-fetch: the CAS check and the system-managed guard below
        // only ever read these three columns. The three rich-text jsonb
        // columns are only needed to populate the conflict-resolution UI,
        // which is the rare path -- fetched separately, only when a conflict
        // is actually detected, instead of on every single autosave.
        const { data: serverReport, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('version, absence_reason, attendance_status, enrollment_id')
            .eq('id', reportId)
            .single()

        if (fetchError) {
            return {
                success: false,
                conflict: false,
                message: `Failed to fetch report: ${fetchError.message}`,
                messageKey: 'errors.unknown'
            }
        }

        if (serverReport.version !== currentVersion) {
            const fullServerReport = await this.fetchFullReportForConflict(reportId)
            return {
                success: false,
                conflict: true,
                serverContent: fullServerReport?.content,
                serverReport: fullServerReport,
                message: 'Conflict detected: Report was modified by another user',
                messageKey: 'errors.conflict'
            }
        }

        // Guard: if absence_reason is system-managed (holiday or suspension),
        // reject attempts to change it or the attendance status
        const isSystemManaged = serverReport.absence_reason === 'holiday' || serverReport.absence_reason === 'suspension'
        if (isSystemManaged && detailedData) {
            if (detailedData.attendanceStatus !== undefined && detailedData.attendanceStatus !== serverReport.attendance_status) {
                return {
                    success: false,
                    conflict: false,
                    message: `Cannot modify attendance status: This report is managed by the system (${serverReport.absence_reason}).`,
                    messageKey: 'report.editor.system_managed_absence_notice'
                }
            }
            if (detailedData.absenceReason !== undefined && detailedData.absenceReason !== serverReport.absence_reason) {
                return {
                    success: false,
                    conflict: false,
                    message: `Cannot modify absence reason: This report is managed by the system (${serverReport.absence_reason}).`,
                    messageKey: 'report.editor.system_managed_absence_notice'
                }
            }
        }

        const newVersion = currentVersion + 1

        const updateData: any = {
            version: newVersion,
            last_edited_by: userId,
            last_edited_at: new Date().toISOString()
        }

        if (detailedData) {
            if (detailedData.lessonId !== undefined) {
                updateData.lesson_id = detailedData.lessonId
            }
            if (detailedData.externalLink !== undefined) {
                updateData.external_link = detailedData.externalLink
            }
            if (detailedData.isCompleted !== undefined) {
                updateData.is_completed = detailedData.isCompleted
            }
            if (detailedData.progressLetter !== undefined) {
                updateData.progress_letter = detailedData.progressLetter || null
            }
            if (detailedData.attendanceStatus !== undefined) {
                updateData.attendance_status = detailedData.attendanceStatus
            }
            if (detailedData.absenceReason !== undefined) {
                updateData.absence_reason = detailedData.absenceReason
            }
            if (detailedData.classParticipation !== undefined) {
                updateData.class_participation = detailedData.classParticipation
            }
            if (detailedData.classroomBehavior !== undefined) {
                updateData.classroom_behavior = detailedData.classroomBehavior
            }
            if (detailedData.contactNotes !== undefined || detailedData.contactNotesDocument !== undefined) {
                assignRichTextPair(updateData, 'contact_notes', 'contact_notes_document', detailedData.contactNotes, detailedData.contactNotesDocument)
            }
            if (detailedData.classNotes !== undefined || detailedData.classNotesDocument !== undefined) {
                assignRichTextPair(updateData, 'class_notes', 'class_notes_document', detailedData.classNotes, detailedData.classNotesDocument)
            }
            if (detailedData.content !== undefined || detailedData.contentDocument !== undefined) {
                assignRichTextPair(updateData, 'content', 'content_document', detailedData.content, detailedData.contentDocument)
            }
        }

        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update(updateData)
            .eq('id', reportId)
            .eq('version', currentVersion)
            .select()
            .single()

        if (updateError) {
            if (updateError.code === 'PGRST116') {
                return {
                    success: false,
                    conflict: true,
                    message: 'Conflict detected: Concurrent modification',
                    messageKey: 'errors.conflict'
                }
            }

            return {
                success: false,
                conflict: false,
                message: `Failed to save report: ${updateError.message}`,
                messageKey: 'errors.unknown'
            }
        }

        if (updated.lesson_id && (detailedData?.lessonId !== undefined || detailedData?.isCompleted !== undefined)) {
            try {
                await ReportLifecyclePolicy.ensureNextOccurrenceReportAfterSave(
                    serverReport.enrollment_id,
                    reportId
                )
            } catch (progressError: any) {
                console.error('Failed to reconcile enrollment lifecycle:', progressError)
            }
        }

        return {
            success: true,
            conflict: false,
            newVersion: updated.version,
            updatedReport: updated as OccurrenceReportDTO
        }
    }

    static async saveAttendanceOnly(
        reportId: string,
        currentVersion: number,
        userId: string | undefined,
        attendanceData: AttendanceOnlyData
    ): Promise<SaveReportResult> {
        const { data: serverReport, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('version, absence_reason, attendance_status')
            .eq('id', reportId)
            .single()

        if (fetchError) {
            return {
                success: false,
                conflict: false,
                message: `Failed to fetch report: ${fetchError.message}`,
                messageKey: 'errors.unknown'
            }
        }

        if (serverReport.version !== currentVersion) {
            const fullServerReport = await this.fetchFullReportForConflict(reportId)
            return {
                success: false,
                conflict: true,
                serverContent: fullServerReport?.content,
                serverReport: fullServerReport,
                message: 'Conflict detected: Report was modified by another user',
                messageKey: 'errors.conflict'
            }
        }

        const isSystemManaged = serverReport.absence_reason === 'holiday' || serverReport.absence_reason === 'suspension'
        if (isSystemManaged) {
            if (attendanceData.attendanceStatus !== serverReport.attendance_status) {
                return {
                    success: false,
                    conflict: false,
                    message: `Cannot modify attendance status: This report is managed by the system (${serverReport.absence_reason}).`,
                    messageKey: 'report.editor.system_managed_absence_notice'
                }
            }

            if (attendanceData.absenceReason !== undefined && attendanceData.absenceReason !== serverReport.absence_reason) {
                return {
                    success: false,
                    conflict: false,
                    message: `Cannot modify absence reason: This report is managed by the system (${serverReport.absence_reason}).`,
                    messageKey: 'report.editor.system_managed_absence_notice'
                }
            }
        }

        const newVersion = currentVersion + 1
        const updateData: any = {
            attendance_status: attendanceData.attendanceStatus,
            version: newVersion,
            last_edited_by: userId,
            last_edited_at: new Date().toISOString()
        }

        if (attendanceData.absenceReason !== undefined) {
            updateData.absence_reason = attendanceData.absenceReason
        }

        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update(updateData)
            .eq('id', reportId)
            .eq('version', currentVersion)
            .select()
            .single()

        if (updateError) {
            if (updateError.code === 'PGRST116') {
                return {
                    success: false,
                    conflict: true,
                    message: 'Conflict detected: Concurrent modification',
                    messageKey: 'errors.conflict'
                }
            }

            return {
                success: false,
                conflict: false,
                message: `Failed to save attendance: ${updateError.message}`,
                messageKey: 'errors.unknown'
            }
        }

        return {
            success: true,
            conflict: false,
            newVersion: updated.version,
            updatedReport: updated as OccurrenceReportDTO
        }
    }

    static async restoreReportVersion(
        reportId: string,
        versionId: string,
        userId?: string,
        currentVersion?: number
    ): Promise<OccurrenceReport> {
        const { data: version, error: versionError } = await supabase
            .from('report_versions')
            .select('*')
            .eq('id', versionId)
            .single()

        if (versionError || !version) throw new Error(`Failed to fetch version: ${versionError?.message}`)

        // Guard: check if current report is system-managed and handle version conflicts
        const { data: current } = await supabase
            .from('occurrence_reports')
            .select('version, absence_reason')
            .eq('id', reportId)
            .single()

        if (current && currentVersion !== undefined && current.version !== currentVersion) {
            throw new Error('Conflict detected: Report was modified by another user')
        }

        const isSystemManaged = current?.absence_reason === 'holiday' || current?.absence_reason === 'suspension'
        if (isSystemManaged && version.snapshot) {
            const snap = version.snapshot
            // If the version would restore a different absence_reason, reject
            if (snap.absence_reason !== current.absence_reason) {
                throw new Error(`Cannot restore version: This report is managed by the system (${current.absence_reason}) and its absence reason cannot be modified.`)
            }
        }

        let updatePayload: any = {}

        if (version.snapshot) {
            const snap = version.snapshot
            updatePayload = {
                lesson_id: snap.lesson_id,
                is_completed: snap.is_completed,
                progress_letter: snap.progress_letter,
                attendance_status: snap.attendance_status,
                absence_reason: snap.absence_reason,
                class_participation: snap.class_participation,
                classroom_behavior: snap.classroom_behavior,
                external_link: snap.external_link
            }
            assignRichTextPair(updatePayload, 'contact_notes', 'contact_notes_document', snap.contact_notes, snap.contact_notes_document)
            assignRichTextPair(updatePayload, 'class_notes', 'class_notes_document', snap.class_notes, snap.class_notes_document)
            assignRichTextPair(updatePayload, 'content', 'content_document', snap.content, snap.content_document)
        } else {
            assignRichTextPair(updatePayload, 'content', 'content_document', version.content, null)
        }

        const newVersion = (current?.version || 0) + 1

        updatePayload.version = newVersion
        updatePayload.last_edited_by = userId
        updatePayload.last_edited_at = new Date().toISOString()

        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update(updatePayload)
            .eq('id', reportId)
            .select()
            .single()

        if (updateError) throw new Error(`Failed to restore version: ${updateError.message}`)

        if (updated.lesson_id) {
            try {
                await ReportLifecyclePolicy.ensureNextOccurrenceReportAfterSave(
                    updated.enrollment_id,
                    reportId
                )
            } catch (progressError: any) {
                console.error('Failed to reconcile enrollment lifecycle after restore:', progressError)
            }
        }

        return new OccurrenceReport(updated)
    }

    static async resolveConflict(
        reportId: string,
        resolvedReport: OccurrenceReportDTO,
        userId?: string
    ): Promise<OccurrenceReport> {
        const { data: current, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('id', reportId)
            .single()

        if (fetchError) throw new Error(`Failed to fetch report: ${fetchError.message}`)

        // Guard: if current report is system-managed, reject attempts to change it
        const isSystemManaged = current.absence_reason === 'holiday' || current.absence_reason === 'suspension'
        if (isSystemManaged) {
            if (resolvedReport.absence_reason !== current.absence_reason) {
                throw new Error(`Cannot resolve conflict: This report is managed by the system (${current.absence_reason}) and its attendance/absence cannot be modified.`)
            }
        }

        const newVersion = current.version + 1

        const updatePayload: any = {
            lesson_id: resolvedReport.lesson_id || null,
            is_completed: resolvedReport.is_completed,
            progress_letter: resolvedReport.progress_letter || null,
            attendance_status: resolvedReport.attendance_status,
            absence_reason: resolvedReport.absence_reason,
            class_participation: resolvedReport.class_participation,
            classroom_behavior: resolvedReport.classroom_behavior,
            external_link: resolvedReport.external_link,
            version: newVersion,
            last_edited_by: userId,
            last_edited_at: new Date().toISOString()
        }
        assignRichTextPair(updatePayload, 'contact_notes', 'contact_notes_document', resolvedReport.contact_notes, resolvedReport.contact_notes_document)
        assignRichTextPair(updatePayload, 'class_notes', 'class_notes_document', resolvedReport.class_notes, resolvedReport.class_notes_document)
        assignRichTextPair(updatePayload, 'content', 'content_document', resolvedReport.content, resolvedReport.content_document)

        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update(updatePayload)
            .eq('id', reportId)
            .select()
            .single()

        if (updateError) throw new Error(`Failed to resolve conflict: ${updateError.message}`)

        if (updated.lesson_id) {
            try {
                await ReportLifecyclePolicy.ensureNextOccurrenceReportAfterSave(
                    updated.enrollment_id,
                    reportId
                )
            } catch (progressError: any) {
                console.error('Failed to reconcile enrollment lifecycle after conflict resolution:', progressError)
            }
        }

        return new OccurrenceReport(updated)
    }

    static async deleteReportAndRevertProgress(reportId: string): Promise<void> {
        const { data: report, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('enrollment_id')
            .eq('id', reportId)
            .single()

        if (fetchError || !report) throw new Error(`Failed to fetch report for deletion: ${fetchError?.message}`)

        const { error: deleteError } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('id', reportId)

        if (deleteError) throw new Error(`Failed to delete report: ${deleteError.message}`)

        await EnrollmentProgressService.recalculateEnrollmentProgress(report.enrollment_id)
    }

    static async deleteReport(reportId: string): Promise<void> {
        const { error } = await supabase
            .from('occurrence_reports')
            .delete()
            .eq('id', reportId)

        if (error) throw new Error(error.message)
    }

    static async createReportsForOccurrence(
        occurrenceId: string
    ): Promise<OccurrenceReport[]> {
        const enrollmentIds = await OccurrenceRosterService.getEffectiveEnrollmentIds(occurrenceId)
        if (enrollmentIds.length === 0) return ReportQueryService.getReportsByOccurrence(occurrenceId)

        const { data: existing, error: existingError } = await supabase
            .from('occurrence_reports')
            .select('enrollment_id')
            .eq('class_occurrence_id', occurrenceId)
            .in('enrollment_id', enrollmentIds)

        if (existingError) throw new Error(existingError.message)
        const existingIds = new Set((existing || []).map(report => report.enrollment_id))
        const missingIds = enrollmentIds.filter(id => !existingIds.has(id))

        if (missingIds.length > 0) {
            const payloads = await Promise.all(missingIds.map(enrollmentId =>
                ReportLifecyclePolicy.buildInitialReportPayload(enrollmentId, occurrenceId)
            ))
            const { error: insertError } = await supabase
                .from('occurrence_reports')
                .upsert(payloads, {
                    onConflict: 'enrollment_id,class_occurrence_id',
                    ignoreDuplicates: true
                })
            if (insertError) throw new Error(`Failed to ensure occurrence reports: ${insertError.message}`)
        }

        return ReportQueryService.getReportsByOccurrence(occurrenceId)
    }
}
