import { ClassOccurrence, type ClassOccurrenceDTO } from '@/models/ClassOccurrence'
import { OccurrenceCommandService } from './OccurrenceCommandService'
import { OccurrenceQueryService } from './OccurrenceQueryService'
import { OccurrenceSyncService } from './OccurrenceSyncService'
import type { OccurrenceReconciliationResult } from './OccurrenceSyncService'
import { apiV1Client } from '@/services/api/ApiV1Client'

/**
 * Backward-compatible facade for class occurrence operations.
 * Internal responsibilities are split into command/query/sync services.
 */
export class OccurrenceService {
    static async generateOccurrences(
        sessionId: string,
        startDate: Date,
        endDate: Date
    ): Promise<ClassOccurrence[]> {
        return OccurrenceCommandService.generateOccurrences(sessionId, startDate, endDate)
    }

    static async getOccurrencesBySession(
        sessionId: string,
        page: number = 1,
        perPage: number = 50
    ): Promise<{ data: ClassOccurrence[]; count: number }> {
        return OccurrenceQueryService.getOccurrencesBySession(sessionId, page, perPage)
    }

    static async updateOccurrence(
        occurrenceId: string,
        updates: Partial<ClassOccurrenceDTO>
    ): Promise<ClassOccurrence> {
        return OccurrenceCommandService.updateOccurrence(occurrenceId, updates)
    }

    /** Report totals and completed counts per lesson date (YYYY-MM-DD) for one class. */
    static async getReportCompletionByDate(sessionId: string, from: string, to: string): Promise<Record<string, { total: number; completed: number }>> {
        const response = await apiV1Client.get<Array<{ occurrence_date: string; total: number; completed: number }>>(
            `/class-sessions/${encodeURIComponent(sessionId)}/report-completion?from=${from}&to=${to}`
        )
        const byDate: Record<string, { total: number; completed: number }> = {}
        for (const row of response.data || []) {
            const entry = byDate[row.occurrence_date] ?? { total: 0, completed: 0 }
            entry.total += row.total
            entry.completed += row.completed
            byDate[row.occurrence_date] = entry
        }
        return byDate
    }

    static async getOccurrencesByDateRange(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<ClassOccurrence[]> {
        return OccurrenceQueryService.getOccurrencesByDateRange(startDate, endDate, sessionIds)
    }

    static async getOccurrenceBySessionAndDate(sessionId: string, occurrenceDate: string): Promise<ClassOccurrence | null> {
        return OccurrenceQueryService.getOccurrenceBySessionAndDate(sessionId, occurrenceDate)
    }

    static async getOccurrencesByIds(occurrenceIds: string[]): Promise<ClassOccurrence[]> {
        return OccurrenceQueryService.getOccurrencesByIds(occurrenceIds)
    }

    static async getPreferredOccurrence(
        sessionId: string,
        referenceDate: Date
    ): Promise<ClassOccurrence | null> {
        return OccurrenceQueryService.getPreferredOccurrence(sessionId, referenceDate)
    }

    static async getAdjacentOccurrence(
        sessionId: string,
        occurrenceDate: Date,
        direction: 'previous' | 'next'
    ): Promise<ClassOccurrence | null> {
        return OccurrenceQueryService.getAdjacentOccurrence(sessionId, occurrenceDate, direction)
    }

    static async getOccurrenceNavigationState(
        sessionId: string,
        occurrenceDate: Date
    ): Promise<{ previous: ClassOccurrence | null; next: ClassOccurrence | null }> {
        return OccurrenceQueryService.getOccurrenceNavigationState(sessionId, occurrenceDate)
    }

    static async getOccurrenceById(occurrenceId: string): Promise<ClassOccurrence> {
        return OccurrenceQueryService.getOccurrenceById(occurrenceId)
    }

    static async completeOccurrence(occurrenceId: string): Promise<ClassOccurrence> {
        return OccurrenceCommandService.completeOccurrence(occurrenceId)
    }

    static async cancelOccurrence(
        occurrenceId: string,
        reason?: string
    ): Promise<ClassOccurrence> {
        return OccurrenceCommandService.cancelOccurrence(occurrenceId, reason)
    }

    static async deleteOccurrence(occurrenceId: string): Promise<void> {
        return OccurrenceCommandService.deleteOccurrence(occurrenceId)
    }

    static async generateOccurrencesForAllSessions(
        startDate: Date,
        endDate: Date,
        sessionIds?: string[]
    ): Promise<number> {
        return OccurrenceCommandService.generateOccurrencesForAllSessions(startDate, endDate, sessionIds)
    }

    static async getTodayOccurrences(timeZone?: string): Promise<ClassOccurrence[]> {
        return OccurrenceQueryService.getTodayOccurrences(timeZone)
    }

    static async getUpcomingOccurrences(days: number = 7, timeZone?: string): Promise<ClassOccurrence[]> {
        return OccurrenceQueryService.getUpcomingOccurrences(days, timeZone)
    }

    static async syncSessionOccurrences(
        sessionId: string,
        scope: 'future' | 'all' = 'future'
    ): Promise<OccurrenceReconciliationResult> {
        return OccurrenceSyncService.syncSessionOccurrences(sessionId, scope)
    }
}
