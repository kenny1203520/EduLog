import {
    OccurrenceReport,
    type OccurrenceReportDTO,
    ReportVersion,
    type SaveReportResult
} from '@/models/OccurrenceReport'
import { ReportCommandService } from '../report/ReportCommandService'
import { ReportQueryService } from '../report/ReportQueryService'
import type { RichTextDocumentV1 } from '@/components/text-editor/types'

/**
 * Backward-compatible facade for report operations.
 * Internal responsibilities are split into command/query/policy services.
 */
export class OccurrenceReportService {
    static async getReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport | null> {
        return ReportQueryService.getReport(enrollmentId, occurrenceId)
    }

    static async createReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport> {
        return ReportCommandService.createReport(enrollmentId, occurrenceId)
    }

    static async getOrCreateReport(
        enrollmentId: string,
        occurrenceId: string
    ): Promise<OccurrenceReport> {
        return ReportCommandService.getOrCreateReport(enrollmentId, occurrenceId)
    }

    static async saveReport(
        reportId: string,
        currentVersion: number,
        userId?: string,
        detailedData?: {
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
            content?: string,
            contentDocument?: RichTextDocumentV1
            externalLink?: string
        }
    ): Promise<SaveReportResult> {
        return ReportCommandService.saveReport(reportId, currentVersion, userId, detailedData)
    }

    static async saveAttendanceOnly(
        reportId: string,
        currentVersion: number,
        userId: string | undefined,
        attendanceData: {
            attendanceStatus: 'present' | 'absent' | 'pending'
            absenceReason?: string | null
        }
    ): Promise<SaveReportResult> {
        return ReportCommandService.saveAttendanceOnly(reportId, currentVersion, userId, attendanceData)
    }

    static async getReportVersions(reportId: string): Promise<ReportVersion[]> {
        return ReportQueryService.getReportVersions(reportId)
    }

    static async restoreReportVersion(
        reportId: string,
        versionId: string,
        userId?: string,
        currentVersion?: number
    ): Promise<OccurrenceReport> {
        return ReportCommandService.restoreReportVersion(reportId, versionId, userId, currentVersion)
    }

    static async resolveConflict(
        reportId: string,
        resolvedReport: OccurrenceReportDTO,
        userId?: string,
        expectedVersion?: number
    ): Promise<OccurrenceReport> {
        return ReportCommandService.resolveConflict(reportId, resolvedReport, userId, expectedVersion)
    }

    static async getReportsByEnrollment(
        enrollmentId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: OccurrenceReport[], count: number }> {
        return ReportQueryService.getReportsByEnrollment(enrollmentId, page, perPage)
    }

    static async getAllReportsByEnrollment(enrollmentId: string): Promise<OccurrenceReport[]> {
        return ReportQueryService.getAllReportsByEnrollment(enrollmentId)
    }

    static async getProgressSummaryReportsByEnrollments(enrollmentIds: string[]): Promise<Map<string, OccurrenceReport[]>> {
        return ReportQueryService.getProgressSummaryReportsByEnrollments(enrollmentIds)
    }

    static async getProgressGapsByEnrollments(occurrenceId: string, enrollmentIds: string[]) {
        return ReportQueryService.getProgressGapsByEnrollments(occurrenceId, enrollmentIds)
    }

    static async getEnrollmentReportProgressContext(enrollmentId: string, occurrenceId: string, reportId: string) {
        return ReportQueryService.getEnrollmentReportProgressContext(enrollmentId, occurrenceId, reportId)
    }

    static async getReportsByOccurrence(
        occurrenceId: string
    ): Promise<OccurrenceReport[]> {
        return ReportQueryService.getReportsByOccurrence(occurrenceId)
    }

    static async getReportById(reportId: string): Promise<OccurrenceReport> {
        return ReportQueryService.getReportById(reportId)
    }

    static async deleteReportAndRevertProgress(reportId: string): Promise<void> {
        return ReportCommandService.deleteReportAndRevertProgress(reportId)
    }

    static async deleteReport(reportId: string): Promise<void> {
        return ReportCommandService.deleteReport(reportId)
    }

    static async createReportsForOccurrence(
        occurrenceId: string
    ): Promise<OccurrenceReport[]> {
        return ReportCommandService.createReportsForOccurrence(occurrenceId)
    }

    static async getReportsWithDetails(
        enrollmentId: string
    ): Promise<any[]> {
        return ReportQueryService.getReportsWithDetails(enrollmentId)
    }

    static async getPendingReports(scope: 'all' | 'my_present' = 'my_present'): Promise<any[]> {
        return ReportQueryService.getPendingReports(scope)
    }

    static async getReportsByLesson(
        lessonId: string,
        params: {
            excludeReportId?: string,
            page?: number,
            pageSize?: number,
            classroomId?: string,
            sessionId?: string,
            sortBy?: 'asc' | 'desc',
            search?: string
        } = {}
    ): Promise<{ data: any[], count: number }> {
        return ReportQueryService.getReportsByLesson(lessonId, params)
    }

    static async getReportsByStudent(
        studentId: string,
        params: {
            excludeReportId?: string,
            page?: number,
            pageSize?: number,
            courseId?: string,
            sortBy?: 'asc' | 'desc',
            search?: string
        } = {}
    ): Promise<{ data: any[], count: number }> {
        return ReportQueryService.getReportsByStudent(studentId, params)
    }

    static async getGlobalIncompleteReports(scope: 'all' | 'my_present' | 'my_notifications' = 'all'): Promise<any[]> {
        return ReportQueryService.getGlobalIncompleteReports(scope)
    }
}
