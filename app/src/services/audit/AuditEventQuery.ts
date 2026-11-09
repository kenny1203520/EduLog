import { DateUtils } from '@/utils/dateUtils'

export type AuditEventFilters = {
    from: string
    to: string
    actorUserId: string
    domain: '' | 'system' | 'teaching'
    outcome: '' | 'success' | 'denied' | 'failure'
    resource: string
    action: string
    search: string
}

type AuditFilter = { field: string; operator: 'eq' | 'gte' | 'lt' | 'ilike'; value: string }

function containsLikePattern(value: string) {
    return `%${value.trim().replace(/[%_,()]/g, '')}%`
}

export function buildAuditEventQuery(filters: AuditEventFilters, page: number, perPage: number, timeZone: string) {
    const params = new URLSearchParams({
        limit: String(perPage),
        offset: String(Math.max(0, page - 1) * perPage),
        sort: '-created_at',
    })
    const conditions: AuditFilter[] = []
    if (filters.from) {
        const start = DateUtils.zonedDateTimeToInstant(filters.from, '00:00', timeZone)
        if (start) conditions.push({ field: 'created_at', operator: 'gte', value: start.toISOString() })
    }
    if (filters.to) {
        const followingDay = DateUtils.addDaysToDateString(filters.to, 1)
        const endExclusive = DateUtils.zonedDateTimeToInstant(followingDay, '00:00', timeZone)
        if (endExclusive) conditions.push({ field: 'created_at', operator: 'lt', value: endExclusive.toISOString() })
    }
    if (filters.actorUserId) conditions.push({ field: 'actor_user_id', operator: 'eq', value: filters.actorUserId })
    if (filters.domain) conditions.push({ field: 'domain', operator: 'eq', value: filters.domain })
    if (filters.outcome) conditions.push({ field: 'outcome', operator: 'eq', value: filters.outcome })
    if (filters.resource.trim()) conditions.push({ field: 'resource', operator: 'ilike', value: containsLikePattern(filters.resource) })
    if (filters.action.trim()) conditions.push({ field: 'action', operator: 'ilike', value: containsLikePattern(filters.action) })
    if (conditions.length) params.set('filters', JSON.stringify(conditions))
    if (filters.search.trim()) params.set('search', filters.search.trim().replace(/[%_,()]/g, ''))
    return params.toString()
}
