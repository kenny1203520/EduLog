import { supabase } from '@/lib/supabase'
import { ClassSessionFactory } from '@/models/ClassSession'
import { DateUtils } from '@/utils/DateUtils'
import { OccurrenceCommandService } from './OccurrenceCommandService'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'

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
    const hasMeaningfulReport = (occurrence.occurrence_reports || []).some(report => Boolean(
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
        if (getApiV1Mode() === 'v1') {
            const response = await apiV1Client.post<OccurrenceReconciliationResult>('/class-sessions/' + sessionId + '/occurrences/sync', { scope })
            return response.data
        }
        void scope
        const { data: rawSession, error: sessionError } = await supabase
            .from('class_sessions')
            .select('*, class_session_schedule_rules(*)')
            .eq('id', sessionId)
            .single()

        if (sessionError || !rawSession) {
            throw new Error(`Failed to fetch session for sync: ${sessionError?.message || 'not found'}`)
        }

        const session = ClassSessionFactory.create({
            ...(rawSession as any),
            schedule_rules: (rawSession as any).class_session_schedule_rules || []
        })
        const today = DateUtils.todayDate(session.timeZone)
        const todayString = DateUtils.formatLocalDate(today)
        let horizon = new Date(today)
        horizon.setMonth(horizon.getMonth() + 6)
        if (session.sessionType === 'camp' && session.endDate) {
            horizon = DateUtils.parseLocalDate(session.endDate) || horizon
        } else if (session.endDate) {
            const configuredEnd = DateUtils.parseLocalDate(session.endDate)
            if (configuredEnd && configuredEnd < horizon) horizon = configuredEnd
        }

        const planned = session.plannedOccurrences(today, horizon)
        const plannedByDate = new Map(planned.map(item => [item.occurrenceDate, item]))

        const { data, error: fetchError } = await supabase
            .from('class_occurrences')
            .select(`
                id,
                occurrence_date,
                status,
                notes,
                original_start_time,
                original_end_time,
                actual_start_time,
                actual_end_time,
                is_conducted,
                teacher_attendance,
                occurrence_reports (
                    id,
                    content,
                    class_notes,
                    contact_notes,
                    is_completed,
                    attendance_status,
                    version
                )
            `)
            .eq('class_session_id', sessionId)
            .gte('occurrence_date', todayString)

        if (fetchError) throw new Error(`Failed to fetch occurrences for sync: ${fetchError.message}`)

        const existing = (data || []) as ExistingOccurrenceRow[]
        const retainedDates = new Set<string>()
        const staleOccurrenceIds: string[] = []
        const placeholderReportIds: string[] = []
        const updates: Array<PromiseLike<unknown>> = []
        let updated = 0
        let preserved = 0

        for (const occurrence of existing) {
            const target = plannedByDate.get(occurrence.occurrence_date)
            if (occurrenceHasProtectedData(occurrence)) {
                retainedDates.add(occurrence.occurrence_date)
                preserved += 1
                continue
            }

            if (!target) {
                staleOccurrenceIds.push(occurrence.id)
                placeholderReportIds.push(...(occurrence.occurrence_reports || []).map(report => report.id))
                continue
            }

            retainedDates.add(occurrence.occurrence_date)
            if (
                occurrence.original_start_time?.slice(0, 5) !== target.startTime.slice(0, 5)
                || occurrence.original_end_time?.slice(0, 5) !== target.endTime.slice(0, 5)
            ) {
                updated += 1
                updates.push(
                    supabase
                        .from('class_occurrences')
                        .update({
                            original_start_time: target.startTime,
                            original_end_time: target.endTime,
                            time_zone: session.timeZone
                        })
                        .eq('id', occurrence.id)
                )
            }
        }

        if (updates.length > 0) await Promise.all(updates)

        if (placeholderReportIds.length > 0) {
            const { error } = await supabase.from('occurrence_reports').delete().in('id', placeholderReportIds)
            if (error) throw new Error(`Failed to delete placeholder reports: ${error.message}`)
        }

        if (staleOccurrenceIds.length > 0) {
            const { error } = await supabase.from('class_occurrences').delete().in('id', staleOccurrenceIds)
            if (error) throw new Error(`Failed to delete stale occurrences: ${error.message}`)
        }

        const created = await OccurrenceCommandService.generateOccurrences(
            sessionId,
            today,
            horizon,
            { skipExistingDates: retainedDates }
        )

        return {
            created: created.length,
            updated,
            deleted: staleOccurrenceIds.length,
            preserved
        }
    }
}
