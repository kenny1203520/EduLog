import { describe, expect, it, vi } from 'vitest'
import { absenceReasonLabel, normalizeAbsenceReasonCode } from './absenceReason'

describe('absence reason localization', () => {
    it('localizes stable reason codes', () => {
        const translate = vi.fn((key: string) => key === 'report.editor.absence_reasons.reason_not_provided'
            ? '未告知原因'
            : key)

        expect(absenceReasonLabel('reason_not_provided', translate)).toBe('未告知原因')
        expect(translate).toHaveBeenCalledOnce()
    })

    it('normalizes legacy localized labels before display and persistence', () => {
        const translate = vi.fn((key: string) => key)

        expect(normalizeAbsenceReasonCode('未告知原因')).toBe('reason_not_provided')
        expect(absenceReasonLabel('未告知原因', translate)).toBe('report.editor.absence_reasons.reason_not_provided')
        expect(translate).toHaveBeenCalledOnce()
    })

    it('preserves custom text without treating it as an i18n key', () => {
        const translate = vi.fn((key: string) => key)

        expect(absenceReasonLabel('家長另行說明', translate)).toBe('家長另行說明')
        expect(translate).not.toHaveBeenCalled()
    })
})
