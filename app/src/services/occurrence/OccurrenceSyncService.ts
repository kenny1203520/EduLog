import { apiV1Client } from '@/services/api/ApiV1Client'

export interface OccurrenceReconciliationResult {
    created: number
    updated: number
    deleted: number
    preserved: number
}
export interface ExistingOccurrenceRow {
    id: string
    occurrence_date: string
    status: string
    notes?: string | null
    actual_start_time?: string | null
    actual_end_time?: string | null
    original_start_time?: string | null
    original_end_time?: string | null
    is_conducted?: boolean | null
    teacher_attendance?: Record<string, boolean> | null
    occurrence_reports?: Array<{
        id: string
        content?: string | null
        class_notes?: string | null
        contact_notes?: string | null
        is_completed?: boolean | null
        attendance_status?: string | null
        version?: number | null
    }>
}

export function occurrenceHasProtectedData(occurrence: ExistingOccurrenceRow): boolean {
    const hasManualOccurrenceData = Boolean(
        occurrence.notes?.trim()
        || occurrence.actual_start_time
        || occurrence.actual_end_time
        || occurrence.status !== 'scheduled'
        || occurrence.is_conducted === false
        || Object.values(occurrence.teacher_attendance || {}).some(value => value === false)
    )
    const hasMeaningfulReport = (occurrence.occurrence_reports || []).some((report: any) => Boolean(
        report.content?.trim()
        || report.class_notes?.trim()
        || report.contact_notes?.trim()
        || report.is_completed
        || (report.attendance_status && report.attendance_status !== 'pending')
        || (report.version || 1) > 1
    ))
    return hasManualOccurrenceData || hasMeaningfulReport
}

export class OccurrenceSyncService {
    static async syncSessionOccurrences(
        sessionId: string,
        scope: 'future' | 'all' = 'future'
    ): Promise<OccurrenceReconciliationResult> {
        const response = await apiV1Client.post<OccurrenceReconciliationResult>('/class-sessions/' + sessionId + '/occurrences/sync', { scope })
        return response.data
    }
}
