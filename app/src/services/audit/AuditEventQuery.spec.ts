import { describe, expect, it } from 'vitest'
import { buildAuditEventQuery, type AuditEventFilters } from './AuditEventQuery'

const emptyFilters: AuditEventFilters = {
    from: '', to: '', actorUserId: '', domain: '', outcome: '', resource: '', action: '', search: '',
}

describe('buildAuditEventQuery', () => {
    it('uses server pagination and newest-first ordering', () => {
        const query = new URLSearchParams(buildAuditEventQuery(emptyFilters, 3, 20, 'Asia/Taipei'))
        expect(query.get('limit')).toBe('20')
        expect(query.get('offset')).toBe('40')
        expect(query.get('sort')).toBe('-created_at')
    })

    it('combines date, actor, domain, result, resource, action and keyword filters', () => {
        const query = new URLSearchParams(buildAuditEventQuery({
            ...emptyFilters,
            from: '2026-01-02', to: '2026-01-03', actorUserId: 'user-id', domain: 'teaching', outcome: 'denied',
            resource: 'class', action: 'up', search: 'teacher',
        }, 1, 20, 'Asia/Taipei'))
        expect(JSON.parse(query.get('filters') || '[]')).toEqual([
            { field: 'created_at', operator: 'gte', value: '2026-01-01T16:00:00.000Z' },
            { field: 'created_at', operator: 'lt', value: '2026-01-03T16:00:00.000Z' },
            { field: 'actor_user_id', operator: 'eq', value: 'user-id' },
            { field: 'domain', operator: 'eq', value: 'teaching' },
            { field: 'outcome', operator: 'eq', value: 'denied' },
            { field: 'resource', operator: 'ilike', value: '%class%' },
            { field: 'action', operator: 'ilike', value: '%up%' },
        ])
        expect(query.get('search')).toBe('teacher')
    })

    it('uses local calendar boundaries across daylight-saving transitions', () => {
        const query = new URLSearchParams(buildAuditEventQuery({
            ...emptyFilters, from: '2026-03-08', to: '2026-03-08',
        }, 1, 20, 'America/New_York'))
        expect(JSON.parse(query.get('filters') || '[]')).toEqual([
            { field: 'created_at', operator: 'gte', value: '2026-03-08T05:00:00.000Z' },
            { field: 'created_at', operator: 'lt', value: '2026-03-09T04:00:00.000Z' },
        ])
    })
})
