import { supabase } from '@/lib/supabase'
import { DateUtils } from '@/utils/DateUtils'
import { OccurrenceCommandService } from './occurrence/OccurrenceCommandService'

export class OccurrenceSyncService {
    private static formatDate(date: Date): string {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
    }

    static async syncSessionOccurrences(sessionId: string, scope: 'future' | 'all' = 'future'): Promise<void> {
        const todayStr = this.formatDate(new Date())

        const { data: session } = await supabase
            .from('class_sessions')
            .select('day_of_week')
            .eq('id', sessionId)
            .single()

        const sessionDayOfWeek = session?.day_of_week

        let query = supabase
            .from('class_occurrences')
            .select(`
                id,
                occurrence_date,
                notes,
                actual_start_time,
                actual_end_time,
                is_conducted,
                occurrence_reports (
                    id,
                    content,
                    is_completed,
                    attendance_status
                )
            `)
            .eq('class_session_id', sessionId)

        if (scope === 'future') {
            query = query.gte('occurrence_date', todayStr)
        }

        const { data: occurrences, error: fetchError } = await query

        if (fetchError) throw new Error(`Failed to fetch occurrences for sync: ${fetchError.message}`)

        const ghostReportIds: string[] = []
        const occurrencesWithKeepReason = new Set<string>()

        ;(occurrences as any[]).forEach(occ => {
            const date = DateUtils.parseLocalDate(occ.occurrence_date)
            const isWrongDay = date && date.getDay() !== sessionDayOfWeek

            const hasManualData = (occ.notes && occ.notes.trim() !== '') ||
                occ.actual_start_time ||
                occ.is_conducted !== null

            const reports = occ.occurrence_reports || []
            let hasTrueRealReport = false
            const hasAnyReport = reports.length > 0

            reports.forEach((r: any) => {
                const isEmpty = !r.content || r.content.trim() === ''
                const isDefault = r.is_completed === false && !r.attendance_status

                if (isEmpty && isDefault) {
                    if (isWrongDay || scope === 'all') {
                        ghostReportIds.push(r.id)
                    }
                } else {
                    hasTrueRealReport = true
                }
            })

            const hasValue = hasManualData || hasTrueRealReport
            const isPlaceholderOnRightDay = !isWrongDay && hasAnyReport && scope !== 'all'

            if (hasValue || isPlaceholderOnRightDay) {
                occurrencesWithKeepReason.add(occ.id)
            }
        })

        if (ghostReportIds.length > 0) {
            await supabase.from('occurrence_reports').delete().in('id', ghostReportIds)
        }

        const idsToDelete = (occurrences as any[])
            .filter(occ => !occurrencesWithKeepReason.has(occ.id))
            .map(occ => occ.id)

        if (idsToDelete.length > 0) {
            const { error: deleteError } = await supabase
                .from('class_occurrences')
                .delete()
                .in('id', idsToDelete)

            if (deleteError) throw new Error(`Failed to delete stale occurrences: ${deleteError.message}`)
        }

        const { count: enrollmentCount } = await supabase
            .from('enrollments')
            .select('*', { count: 'exact', head: true })
            .eq('class_session_id', sessionId)
            .eq('status', 'active')

        if (enrollmentCount && enrollmentCount > 0) {
            const startDate = new Date()
            const endDate = new Date()
            endDate.setMonth(endDate.getMonth() + 6)
            await OccurrenceCommandService.generateOccurrences(sessionId, startDate, endDate)
        }
    }
}
