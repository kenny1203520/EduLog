export interface TeacherAssignmentDateRange {
    effective_from: string
    effective_to?: string | null
}

export interface IndexedTeacherAssignment<T> {
    config: T
    index: number
}

export function partitionTeacherAssignments<T extends TeacherAssignmentDateRange>(assignments: T[], today: string) {
    const indexed = assignments.map((config, index) => ({ config, index }))
    const currentAndUpcoming = indexed
        .filter(({ config }) => !config.effective_to || config.effective_to >= today)
        .sort((left, right) => left.config.effective_from.localeCompare(right.config.effective_from))
    const past = indexed
        .filter(({ config }) => Boolean(config.effective_to && config.effective_to < today))
        .sort((left, right) => (right.config.effective_to || '').localeCompare(left.config.effective_to || '') || right.config.effective_from.localeCompare(left.config.effective_from))

    return { currentAndUpcoming, past }
}

export function paginateTeacherAssignments<T>(items: T[], requestedPage: number, pageSize = 10) {
    const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
    const page = Math.min(Math.max(1, requestedPage), pageCount)
    const offset = (page - 1) * pageSize
    return { items: items.slice(offset, offset + pageSize), page, pageCount, total: items.length }
}
