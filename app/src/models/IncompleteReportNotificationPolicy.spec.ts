import { describe, expect, it } from 'vitest'
import { IncompleteReportNotificationPolicy, type IncompleteReportNotificationRule } from './IncompleteReportNotificationPolicy'

const rules: IncompleteReportNotificationRule[] = [
    { scope_type: 'global', role_type_id: 'teacher' },
    { scope_type: 'classroom', classroom_id: 'room-1', role_type_id: 'coach' },
    { scope_type: 'class_session', class_session_id: 'session-1', role_type_id: 'assistant' }
]

describe('IncompleteReportNotificationPolicy', () => {
    it('uses the most specific configured scope', () => {
        expect(IncompleteReportNotificationPolicy.resolveRoleIds(rules, 'room-1', 'session-1')).toEqual(['assistant'])
        expect(IncompleteReportNotificationPolicy.resolveRoleIds(rules, 'room-1', 'session-2')).toEqual(['coach'])
        expect(IncompleteReportNotificationPolicy.resolveRoleIds(rules, 'room-2', 'session-2')).toEqual(['teacher'])
    })

    it('returns no recipients when no scope is configured', () => {
        expect(IncompleteReportNotificationPolicy.resolveRoleIds([], 'room-1', 'session-1')).toEqual([])
    })
})
