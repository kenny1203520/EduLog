import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'

export const REPORT_CONFLICT_FIELDS = [
    'content',
    'content_document',
    'attendance_status',
    'is_completed',
    'progress_letter',
    'class_participation',
    'classroom_behavior',
    'contact_notes',
    'contact_notes_document',
    'class_notes',
    'class_notes_document',
    'lesson_id',
    'external_link'
] as const satisfies readonly (keyof OccurrenceReportDTO)[]

export const TRANSFER_REPORT_FIELDS = [
    'lesson_id',
    'is_completed',
    'progress_letter',
    'attendance',
    'class_participation',
    'classroom_behavior',
    'contact_notes',
    'class_notes',
    'content',
    'external_link'
] as const

export type TransferReportField = typeof TRANSFER_REPORT_FIELDS[number]
export type TransferReportFieldSource = 'source' | 'target'
export type TransferReportFieldSelections = Record<TransferReportField, TransferReportFieldSource>

export const RICH_REPORT_DOCUMENT_FIELDS = {
    contact_notes: 'contact_notes_document',
    class_notes: 'class_notes_document',
    content: 'content_document'
} as const

export const EDITOR_SCALAR_CONFLICT_FIELDS = [
    'lesson_id',
    'external_link',
    'is_completed',
    'progress_letter',
    'attendance_status',
    'class_participation',
    'classroom_behavior'
] as const satisfies readonly (keyof OccurrenceReportDTO)[]

const TRANSFER_FIELD_KEYS: Record<TransferReportField, readonly (keyof OccurrenceReportDTO)[]> = {
    lesson_id: ['lesson_id'],
    is_completed: ['is_completed'],
    progress_letter: ['progress_letter'],
    attendance: ['attendance_status', 'absence_reason'],
    class_participation: ['class_participation'],
    classroom_behavior: ['classroom_behavior'],
    contact_notes: ['contact_notes', 'contact_notes_document'],
    class_notes: ['class_notes', 'class_notes_document'],
    content: ['content', 'content_document'],
    external_link: ['external_link']
}

function normalized(value: unknown): unknown {
    return value === undefined ? null : value
}

/** Shared strict comparison used by editor and transfer conflict workflows. */
export function reportValuesDiffer(left: unknown, right: unknown): boolean {
    return JSON.stringify(normalized(left)) !== JSON.stringify(normalized(right))
}

function richNodeHasContent(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false
    const node = value as Record<string, unknown>
    if (typeof node.text === 'string' && node.text.trim().length > 0) return true
    if (Array.isArray(node.content) && node.content.some(richNodeHasContent)) return true
    return ['image', 'video', 'audio', 'attachment'].includes(String(node.type || ''))
}

/** Returns report fields that differ without assigning either side precedence. */
export function findReportConflictingFields(
    left: OccurrenceReportDTO,
    right: OccurrenceReportDTO
): (keyof OccurrenceReportDTO)[] {
    return REPORT_CONFLICT_FIELDS.filter(field => reportValuesDiffer(left[field], right[field]))
}

/** Treats false and zero as meaningful values while empty text/documents remain blank. */
export function isReportValueEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim().length === 0
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === 'object') {
        const record = value as Record<string, unknown>
        if (record.type === 'doc' && Array.isArray(record.content)) {
            return !record.content.some(richNodeHasContent)
        }
    }
    return false
}

/** Returns true when any logical value belonging to the transfer field is populated. */
export function isTransferFieldPopulated(report: OccurrenceReportDTO | null, field: TransferReportField): boolean {
    if (!report) return false
    return TRANSFER_FIELD_KEYS[field].some(key => !isReportValueEmpty(report[key]))
}

/** Compares a logical transfer field, including its companion document/reason value. */
export function transferFieldDiffers(
    source: OccurrenceReportDTO | null,
    target: OccurrenceReportDTO,
    field: TransferReportField
): boolean {
    if (!source) return false
    return TRANSFER_FIELD_KEYS[field].some(key => reportValuesDiffer(source[key], target[key]))
}

/** Defaults to source overwrite when source has content; otherwise preserves non-empty target data. */
export function createDefaultTransferFieldSelections(
    source: OccurrenceReportDTO | null,
    _target: OccurrenceReportDTO
): TransferReportFieldSelections {
    return Object.fromEntries(TRANSFER_REPORT_FIELDS.map(field => [
        field,
        isTransferFieldPopulated(source, field) ? 'source' : 'target'
    ])) as TransferReportFieldSelections
}
