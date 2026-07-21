import type { TextDocumentRepository } from '@/components/common/text-editor/types'
import type { OccurrenceReportDTO, ReportDraftSnapshot } from '@/models/OccurrenceReport'
import { ReportCommandService } from './ReportCommandService'
import { ReportQueryService } from './ReportQueryService'

/** Generic text-document repository adapter backed by versioned occurrence reports. */
export class OccurrenceReportRepository implements TextDocumentRepository<OccurrenceReportDTO, ReportDraftSnapshot> {
    private readonly userId?: string

    constructor(userId?: string) {
        this.userId = userId
    }

    async load(id: string) {
        const report = await ReportQueryService.getReportById(id)
        return { document: report.toDTO(), version: report.version }
    }

    async save(id: string, baseVersion: number | undefined, snapshot: ReportDraftSnapshot) {
        const result = await ReportCommandService.saveReport(id, baseVersion ?? 1, this.userId, {
            lessonId: snapshot.lessonId,
            isCompleted: snapshot.isCompleted,
            progressLetter: snapshot.progressLetter || null,
            attendanceStatus: snapshot.attendanceStatus,
            absenceReason: snapshot.absenceReason,
            classParticipation: snapshot.classParticipation,
            classroomBehavior: snapshot.classroomBehavior,
            contactNotes: snapshot.contactNotes,
            contactNotesDocument: snapshot.contactNotesDocument,
            classNotes: snapshot.classNotes,
            classNotesDocument: snapshot.classNotesDocument,
            content: snapshot.content,
            contentDocument: snapshot.contentDocument,
            externalLink: snapshot.externalLink
        })
        return {
            success: result.success,
            conflict: result.conflict,
            document: result.updatedReport,
            version: result.newVersion,
            message: result.message
        }
    }

    async restore(id: string, versionId: string, baseVersion?: number) {
        try {
            const report = await ReportCommandService.restoreReportVersion(id, versionId, this.userId, baseVersion)
            return { success: true, document: report.toDTO(), version: report.version }
        } catch (error: any) {
            return { success: false, conflict: /conflict/i.test(error?.message || ''), message: error?.message }
        }
    }
}
