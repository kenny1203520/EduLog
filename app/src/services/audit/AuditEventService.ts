import { apiV1Client, type ApiMeta } from '@/services/api/ApiV1Client'
import { buildAuditEventQuery, type AuditEventFilters } from './AuditEventQuery'

export type AuditEvent = {
    id: string
    actor_user_id?: string | null
    action?: string | null
    domain?: string | null
    resource?: string | null
    resource_id?: string | null
    scope_id?: string | null
    request_id?: string | null
    outcome?: string | null
    metadata?: Record<string, unknown> | null
    created_at?: string | null
}

export type AuditUser = { id: string; display_name?: string | null; email?: string | null }

function metaTotal(meta: ApiMeta | undefined): number {
    return Number((meta as (ApiMeta & { total?: number }) | undefined)?.total)
}

export class AuditEventService {
    /** One page of audit events matching `filters`, with the server's total when it reports one. */
    static async listEvents(filters: AuditEventFilters, page: number, perPage: number, timeZone: string): Promise<{ events: AuditEvent[]; total: number }> {
        const query = buildAuditEventQuery(filters, page, perPage, timeZone)
        const result = await apiV1Client.get<AuditEvent[]>(`/audit-events?${query}`)
        const events = result.data ?? []
        const total = metaTotal(result.meta)
        return { events, total: Number.isFinite(total) ? total : events.length }
    }

    /** Every user profile the caller may read, for the actor filter. Throws when profiles are not readable. */
    static async listUsers(): Promise<AuditUser[]> {
        const limit = 100
        const users: AuditUser[] = []
        let offset = 0
        let total = Number.POSITIVE_INFINITY
        while (offset < total) {
            const response = await apiV1Client.get<AuditUser[]>(`/users?limit=${limit}&offset=${offset}&sort=display_name`)
            const page = response.data ?? []
            users.push(...page)
            const reported = metaTotal(response.meta)
            total = Number.isFinite(reported) ? reported : users.length
            if (!page.length) break
            offset += page.length
        }
        return users
    }
}
