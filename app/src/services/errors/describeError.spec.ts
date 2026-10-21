import { describe, expect, it } from 'vitest'
import { describeError, toastSignature } from './describeError'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import { NetworkError } from './AppError'

const apiError = (status: number, code: string, reason?: string) => new ApiV1Error(status, {
    error: { code, message: 'English server text', request_id: 'req-1', trace_id: 'trace-1', details: reason ? { reason } : undefined },
})

describe('describeError', () => {
    it('keeps an AppError key and params', () => {
        expect(describeError(new NetworkError())).toMatchObject({ i18nKey: 'errors.network' })
    })

    it('maps an API business reason to its domain message and keeps the reason as the code', () => {
        expect(describeError(apiError(422, 'TRANSFER_INVALID', 'TARGET_SESSION_SAME_AS_CURRENT'))).toEqual({
            i18nKey: 'errors.domain.TARGET_SESSION_SAME_AS_CURRENT', code: 'TARGET_SESSION_SAME_AS_CURRENT', requestId: 'req-1',
        })
    })

    it('maps API statuses to causes instead of the English server text', () => {
        expect(describeError(apiError(403, 'PERMISSION_DENIED'))).toMatchObject({ i18nKey: 'errors.permission_denied', code: 'PERMISSION_DENIED' })
        expect(describeError(apiError(401, 'AUTH_INVALID')).i18nKey).toBe('errors.session_expired')
        expect(describeError(apiError(409, 'VERSION_CONFLICT')).i18nKey).toBe('errors.conflict')
        expect(describeError(apiError(503, 'RESOURCE_SERVICE_UNAVAILABLE')).i18nKey).toBe('errors.service_unavailable')
    })

    it('finds a sentinel code inside a plain error message', () => {
        expect(describeError(new Error('RPC failed: SOURCE_REPORT_HAS_CONTENT'))).toMatchObject({
            i18nKey: 'errors.domain.SOURCE_REPORT_HAS_CONTENT', code: 'SOURCE_REPORT_HAS_CONTENT',
        })
    })

    it('falls back to the unknown cause without exposing the message', () => {
        const description = describeError(new Error('Something odd happened in English'))
        expect(description.i18nKey).toBe('errors.unknown')
        expect(JSON.stringify(description)).not.toContain('Something odd')
    })
})

describe('toastSignature', () => {
    it('treats the same title and message as the same toast', () => {
        const content = (title: string) => ({ component: {}, props: { title, message: 'Network' } })
        expect(toastSignature('error', content('Save failed'))).toBe(toastSignature('error', content('Save failed')))
        expect(toastSignature('error', content('Save failed'))).not.toBe(toastSignature('error', content('Load failed')))
        expect(toastSignature('success', 'Saved')).toBe('success:Saved')
    })
})
