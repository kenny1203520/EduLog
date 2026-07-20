import { supabase } from '@/lib/supabase'
import {
    OccurrenceReport,
    type OccurrenceReportDTO,
    type SaveReportResult
} from '@/models/OccurrenceReport'
import { EnrollmentProgressService } from '../enrollment/EnrollmentProgressService'
import { ReportLifecyclePolicy } from './ReportLifecyclePolicy'
import { ReportQueryService } from './ReportQueryService'

type ReportSaveData = {
    lessonId?: string
    isCompleted?: boolean
    progressLetter?: string | null
    attendanceStatus?: 'present' | 'absent' | 'pending'
    absenceReason?: string | null
    classParticipation?: number
    classroomBehavior?: number
    contactNotes?: string
    classNotes?: string
    content?: string
    externalLink?: string
}

type AttendanceOnlyData = {
    attendanceStatus: 'present' | 'absent' | 'pending'
    absenceReason?: string | null
}

export class ReportCommandService {
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
        const { data: serverReport, error: fetchError } = await supabase
            .from('occurrence_reports')
            .select('*')
            .eq('id', reportId)
            .single()

        if (fetchError) {
            return {
                success: false,
                conflict: false,
                message: `Failed to fetch report: ${fetchError.message}`
            }
        }

        if (serverReport.version !== currentVersion) {
            return {
                success: false,
                conflict: true,
                serverContent: serverReport.content,
                serverReport: serverReport,
                message: 'Conflict detected: Report was modified by another user'
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
                    message: `Cannot modify attendance status: This report is managed by the system (${serverReport.absence_reason}).`
                }
            }
            if (detailedData.absenceReason !== undefined && detailedData.absenceReason !== serverReport.absence_reason) {
                return {
                    success: false,
                    conflict: false,
                    message: `Cannot modify absence reason: This report is managed by the system (${serverReport.absence_reason}).`
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
            if (detailedData.contactNotes !== undefined) {
                updateData.contact_notes = detailedData.contactNotes
            }
            if (detailedData.classNotes !== undefined) {
                updateData.class_notes = detailedData.classNotes
            }
            if (detailedData.content !== undefined) {
                updateData.content = detailedData.content
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
                    message: 'Conflict detected: Concurrent modification'
                }
            }

            return {
                success: false,
                conflict: false,
                message: `Failed to save report: ${updateError.message}`
            }
        }

        if (detailedData?.lessonId && detailedData?.isCompleted !== undefined) {
            try {
                await ReportLifecyclePolicy.updateEnrollmentProgressAfterReport(
                    serverReport.enrollment_id,
                    reportId,
                    detailedData.lessonId,
                    detailedData.isCompleted
                )
            } catch (progressError: any) {
                console.error('Failed to update progress:', progressError)
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
            .select('*')
            .eq('id', reportId)
            .single()

        if (fetchError) {
            return {
                success: false,
                conflict: false,
                message: `Failed to fetch report: ${fetchError.message}`
            }
        }

        if (serverReport.version !== currentVersion) {
            return {
                success: false,
                conflict: true,
                serverContent: serverReport.content,
                serverReport: serverReport,
                message: 'Conflict detected: Report was modified by another user'
            }
        }

        const isSystemManaged = serverReport.absence_reason === 'holiday' || serverReport.absence_reason === 'suspension'
        if (isSystemManaged) {
            if (attendanceData.attendanceStatus !== serverReport.attendance_status) {
                return {
                    success: false,
                    conflict: false,
                    message: `Cannot modify attendance status: This report is managed by the system (${serverReport.absence_reason}).`
                }
            }

            if (attendanceData.absenceReason !== undefined && attendanceData.absenceReason !== serverReport.absence_reason) {
                return {
                    success: false,
                    conflict: false,
                    message: `Cannot modify absence reason: This report is managed by the system (${serverReport.absence_reason}).`
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
                    message: 'Conflict detected: Concurrent modification'
                }
            }

            return {
                success: false,
                conflict: false,
                message: `Failed to save attendance: ${updateError.message}`
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
                contact_notes: snap.contact_notes,
                class_notes: snap.class_notes,
                content: snap.content,
                external_link: snap.external_link
            }
        } else {
            updatePayload = {
                content: version.content
            }
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
            contact_notes: resolvedReport.contact_notes,
            class_notes: resolvedReport.class_notes,
            content: resolvedReport.content,
            external_link: resolvedReport.external_link,
            version: newVersion,
            last_edited_by: userId,
            last_edited_at: new Date().toISOString()
        }

        const { data: updated, error: updateError } = await supabase
            .from('occurrence_reports')
            .update(updatePayload)
            .eq('id', reportId)
            .select()
            .single()

        if (updateError) throw new Error(`Failed to resolve conflict: ${updateError.message}`)

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
        const { data: occurrence, error: occError } = await supabase
            .from('class_occurrences')
            .select('class_session_id')
            .eq('id', occurrenceId)
            .single()

        if (occError) throw new Error(`Failed to fetch occurrence: ${occError.message}`)

        const { data: enrollments, error: enrollError } = await supabase
            .from('enrollments')
            .select('id')
            .eq('class_session_id', occurrence.class_session_id)
            .eq('status', 'regular')

        if (enrollError) throw new Error(`Failed to fetch enrollments: ${enrollError.message}`)

        const reports: OccurrenceReport[] = []

        for (const enrollment of enrollments) {
            const report = await this.getOrCreateReport(enrollment.id, occurrenceId)
            reports.push(report)
        }

        return reports
    }
}
