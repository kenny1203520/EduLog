import { type EnrollmentDTO, Enrollment } from '@/models/Enrollment'
import { EnrollmentCommandService } from './EnrollmentCommandService'
import { EnrollmentQueryService } from './EnrollmentQueryService'

type EnrollmentCreateOptions = {
    targetReportCount?: number
}

type EnrollmentUpdateOptions = {
    targetTotalReports?: number
}

/**
 * Backward-compatible facade for enrollment operations.
 * Internal responsibilities are split into command/query/status-policy services.
 */
export class EnrollmentService {
    static async getByStudentId(studentId: string): Promise<Enrollment[]> {
        return EnrollmentQueryService.getByStudentId(studentId)
    }

    static async create(
        enrollmentData: Partial<EnrollmentDTO>,
        options: EnrollmentCreateOptions = {}
    ): Promise<Enrollment> {
        return EnrollmentCommandService.create(enrollmentData, options)
    }

    static async getActiveEnrollmentCandidates(): Promise<Enrollment[]> {
        return EnrollmentQueryService.getActiveEnrollmentCandidates()
    }

    static async addEnrollmentToSessionOccurrence(
        enrollmentId: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<void> {
        return EnrollmentCommandService.addEnrollmentToSessionOccurrence(
            enrollmentId,
            targetSessionId,
            targetDate
        )
    }

    static async update(
        enrollmentId: string,
        updates: Partial<EnrollmentDTO>,
        options: EnrollmentUpdateOptions = {}
    ): Promise<Enrollment> {
        return EnrollmentCommandService.update(enrollmentId, updates, options)
    }

    static async delete(enrollmentId: string): Promise<void> {
        return EnrollmentCommandService.delete(enrollmentId)
    }

    static async transferClass(
        enrollmentId: string,
        newSessionId: string,
        originalLastDate: string,
        transferDate: string
    ): Promise<Enrollment> {
        return EnrollmentCommandService.transferClass(
            enrollmentId,
            newSessionId,
            originalLastDate,
            transferDate
        )
    }

    static async transferSingleLesson(
        enrollmentId: string,
        originalDate: string,
        targetSessionId: string,
        targetDate: string
    ): Promise<void> {
        return EnrollmentCommandService.transferSingleLesson(
            enrollmentId,
            originalDate,
            targetSessionId,
            targetDate
        )
    }
}
