import type { TextEditorContentInput } from '@/components/text-editor/types'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import type { TransferConflictDisplayContext } from '@/services/enrollment/EnrollmentTransferQueryService'
import { DateUtils } from '@/utils/dateUtils'
import { absenceReasonLabel } from '@/utils/absenceReason'
import type { TransferReportField } from './ReportFieldConflictService'

type Translate = (key: string) => string

export type TransferConflictDisplayValue =
    | { kind: 'text'; text: string; tone?: 'default' | 'success' | 'danger' | 'warning' }
    | { kind: 'rating'; text: string; rating: number }
    | { kind: 'link'; text: string; detail: string; href: string }
    | { kind: 'rich'; content: TextEditorContentInput }

function translated(t: Translate, key: string, fallback: string): string {
    const value = t(key)
    return value === key ? fallback : value
}

function timeText(instant: Date | null, locale: string, timeZone: string): string {
    if (!instant) return ''
    return new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).format(instant)
}

export class TransferReportConflictDisplayService {
    /** Formats occurrence context without exposing technical identifiers. */
    static formatContext(
        context: TransferConflictDisplayContext,
        locale: string,
        timeZone: string,
        t: Translate
    ): { title: string; details: string } {
        const sourceTimeZone = DateUtils.isValidTimeZone(context.sessionTimeZone || undefined)
            ? context.sessionTimeZone || timeZone
            : timeZone
        const start = DateUtils.zonedDateTimeToInstant(context.occurrenceDate, context.startTime || undefined, sourceTimeZone)
        const end = DateUtils.zonedDateTimeToInstant(context.occurrenceDate, context.endTime || undefined, sourceTimeZone)
        const displayDate = start
            ? start.toLocaleDateString(locale, { timeZone })
            : DateUtils.displayDate(context.occurrenceDate, locale, timeZone)
        const range = [timeText(start, locale, timeZone), timeText(end, locale, timeZone)]
            .filter(Boolean)
            .join('–')
        const session = context.sessionName || translated(t, 'student.transfer_conflict.unknown_session', 'Unknown class')
        const classroom = context.classroomName || translated(t, 'student.transfer_conflict.unknown_classroom', 'Unknown classroom')
        return {
            title: `${displayDate} · ${session}`,
            details: [classroom, range].filter(Boolean).join(' · ')
        }
    }

    /** Returns a readable lesson name, keeping its UUID out of the primary display. */
    static formatLesson(context: TransferConflictDisplayContext, t: Translate): string {
        if (!context.lessonTitle) {
            return translated(t, 'student.transfer_conflict.unknown_lesson', 'Unknown lesson')
        }
        return context.lessonSequence == null
            ? context.lessonTitle
            : `#${context.lessonSequence} ${context.lessonTitle}`
    }

    /** Builds a typed presentation value for each selectable report field. */
    static formatField(
        report: OccurrenceReportDTO | null,
        context: TransferConflictDisplayContext,
        field: TransferReportField,
        t: Translate
    ): TransferConflictDisplayValue {
        const empty = translated(t, 'student.transfer_conflict.not_filled', 'Not filled')
        if (!report) return { kind: 'text', text: empty }

        if (field === 'lesson_id') {
            return { kind: 'text', text: this.formatLesson(context, t) }
        }
        if (field === 'is_completed') {
            return report.is_completed
                ? { kind: 'text', text: translated(t, 'report.completed', 'Completed'), tone: 'success' }
                : { kind: 'text', text: translated(t, 'report.incomplete', 'Incomplete'), tone: 'warning' }
        }
        if (field === 'attendance') {
            const status = report.attendance_status || 'pending'
            const labels = {
                present: translated(t, 'report.editor.present', 'Present'),
                absent: translated(t, 'report.editor.absent', 'Absent'),
                pending: translated(t, 'student.transfer_conflict.attendance_pending', 'Pending')
            }
            const tone = status === 'present' ? 'success' : status === 'absent' ? 'danger' : 'warning'
            if (status !== 'absent' || !report.absence_reason) {
                return { kind: 'text', text: labels[status], tone }
            }
            const reason = absenceReasonLabel(report.absence_reason, t) || report.absence_reason
            return { kind: 'text', text: `${labels.absent} · ${reason}`, tone }
        }
        if (field === 'class_participation' || field === 'classroom_behavior') {
            const rating = Number(report[field])
            if (!Number.isFinite(rating)) return { kind: 'text', text: empty }
            const normalized = Math.max(0, Math.min(5, rating))
            return { kind: 'rating', rating: normalized, text: `${normalized}/5` }
        }
        if (field === 'progress_letter') {
            const progress = report.progress_letter?.trim()
            return { kind: 'text', text: progress ? progress.replace('-', ' → ') : empty }
        }
        if (field === 'external_link') {
            const href = report.external_link?.trim()
            if (!href) return { kind: 'text', text: empty }
            try {
                const url = new URL(href)
                const detail = `${url.pathname}${url.search}` === '/' ? '' : `${url.pathname}${url.search}`
                return {
                    kind: 'link',
                    text: url.hostname.replace(/^www\./, ''),
                    detail: detail.length > 64 ? `${detail.slice(0, 61)}…` : detail,
                    href
                }
            } catch {
                return { kind: 'text', text: href }
            }
        }
        if (field === 'contact_notes' || field === 'class_notes' || field === 'content') {
            const documentField = `${field}_document` as keyof OccurrenceReportDTO
            const content = report[documentField] || report[field]
            return content
                ? { kind: 'rich', content: content as TextEditorContentInput }
                : { kind: 'text', text: empty }
        }

        return { kind: 'text', text: empty }
    }
}
