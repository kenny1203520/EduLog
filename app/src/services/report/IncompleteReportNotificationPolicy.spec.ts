import { describe, expect, it } from 'vitest'
import {
    canReceiveIncompleteReportNotification,
    isTeacherPresentForScope
} from '../../../../supabase/volumes/functions/aggregate-incomplete-reports/policy'

describe('incomplete report notification eligibility', () => {
    const configuredAllow = { is_allowed: true, is_denied: false, policy_configured: true }

    it('requires assignment and explicit attendance before applying an allowed role policy', () => {
        expect(isTeacherPresentForScope('teacher-1', 'user-1', ['teacher-1'], { 'teacher-1': true })).toBe(true)
        expect(canReceiveIncompleteReportNotification(true, configuredAllow)).toBe(true)
        expect(canReceiveIncompleteReportNotification(false, configuredAllow)).toBe(false)
        expect(isTeacherPresentForScope('teacher-1', 'user-1', [], { 'teacher-1': true })).toBe(false)
    })

    it('lets an explicit false compatibility key override a true key', () => {
        expect(isTeacherPresentForScope(
            'teacher-1',
            'user-1',
            ['teacher-1', 'user-1'],
            { 'teacher-1': true, 'user-1': false }
        )).toBe(false)
    })

    it('fails closed when no notification policy is configured', () => {
        expect(canReceiveIncompleteReportNotification(true, {
            is_allowed: false,
            is_denied: false,
            policy_configured: false
        })).toBe(false)
    })

    it('requires an explicit allow and keeps deny precedence', () => {
        expect(canReceiveIncompleteReportNotification(true, {
            is_allowed: true,
            is_denied: true,
            policy_configured: true
        })).toBe(false)
        expect(canReceiveIncompleteReportNotification(true, {
            is_allowed: false,
            is_denied: false,
            policy_configured: true
        })).toBe(false)
    })

    it('excludes yuan on 2026-07-25 when the effective assistant policy denies notifications', () => {
        const yuanWasAssignedAndPresent = isTeacherPresentForScope(
            'yuan-teacher',
            'yuan-user',
            ['yuan-teacher'],
            { 'yuan-teacher': true }
        )

        expect(yuanWasAssignedAndPresent).toBe(true)
        expect(canReceiveIncompleteReportNotification(yuanWasAssignedAndPresent, {
            is_allowed: false,
            is_denied: true,
            policy_configured: true
        })).toBe(false)
    })
})
