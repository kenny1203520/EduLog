import { describe, expect, it } from 'vitest'
import { domainErrorCode, hasDomainErrorCode, mapDomainError } from './mapDomainError'
import { mapSupabaseError } from './mapSupabaseError'
import { AppError, NetworkError, ValidationError, ConflictError, AuthorizationError } from './AppError'

describe('mapDomainError', () => {
    it('maps every known sentinel code to a distinct translated key', () => {
        const codes = [
            'TARGET_DATE_NOT_CLASS_DAY', 'TARGET_SESSION_SAME_AS_CURRENT', 'TARGET_SESSION_COURSE_MISMATCH',
            'TARGET_REPORT_ALREADY_EXISTS', 'ORIGINAL_REPORT_AMBIGUOUS', 'ORIGINAL_DATE_NOT_CLASS_DAY',
            'ORIGINAL_OCCURRENCE_NOT_IN_ENROLLMENT_SESSION', 'DUPLICATE_OCCURRENCE_REPORT',
            'MAKEUP_DATE_NOT_CLASS_DAY', 'COURSE_REQUIRED_FOR_SESSION', 'ROLE_NAME_REQUIRED',
            'TRANSFER_CONFLICT_STALE', 'REPORT_ALREADY_EXISTS',
            'SOURCE_OCCURRENCE_NOT_EFFECTIVE', 'TARGET_OCCURRENCE_ALREADY_EFFECTIVE', 'TARGET_OCCURRENCE_NOT_EFFECTIVE',
            'SOURCE_AND_TARGET_OCCURRENCES_MATCH', 'SINGLE_LESSON_TRANSFER_FORBIDDEN', 'SINGLE_LESSON_TRANSFER_ALREADY_EXISTS',
            'SINGLE_LESSON_TRANSFER_NOT_FOUND', 'SOURCE_REPORT_ALREADY_EXISTS', 'ORIGINAL_REPORT_NOT_FOUND'
        ]
        const keys = new Set<string>()
        for (const code of codes) {
            const mapped = mapDomainError(code)
            expect(mapped).not.toBeNull()
            expect(mapped!.i18nKey).toBe(`errors.domain.${code}`)
            keys.add(mapped!.i18nKey)
        }
        expect(keys.size).toBe(codes.length)
    })

    it('prefers the more specific TARGET_REPORT_ALREADY_EXISTS over the REPORT_ALREADY_EXISTS substring', () => {
        expect(mapDomainError('TARGET_REPORT_ALREADY_EXISTS')!.i18nKey).toBe('errors.domain.TARGET_REPORT_ALREADY_EXISTS')
    })

    it('prefers the API reason over the generic server message', () => {
        const apiError = Object.assign(new Error('The transfer violates a business rule'), { reason: 'SOURCE_OCCURRENCE_NOT_EFFECTIVE' })
        expect(domainErrorCode(apiError)).toBe('SOURCE_OCCURRENCE_NOT_EFFECTIVE')
        expect(hasDomainErrorCode(apiError, 'SOURCE_OCCURRENCE_NOT_EFFECTIVE')).toBe(true)
        expect(domainErrorCode(new Error('TARGET_REPORT_ALREADY_EXISTS'))).toBe('TARGET_REPORT_ALREADY_EXISTS')
    })

    it('returns null for messages with no known code', () => {
        expect(mapDomainError('some unrelated failure')).toBeNull()
        expect(mapDomainError(undefined)).toBeNull()
        expect(mapDomainError(null)).toBeNull()
    })
})

describe('mapSupabaseError', () => {
    it('maps known Postgres/PostgREST codes to specific keys', () => {
        expect(mapSupabaseError({ code: 'PGRST116' }).i18nKey).toBe('errors.conflict')
        expect(mapSupabaseError({ code: '23505' }).i18nKey).toBe('errors.unique_violation')
        expect(mapSupabaseError({ code: '23503' }).i18nKey).toBe('errors.foreign_key_violation')
        expect(mapSupabaseError({ code: '42501' }).i18nKey).toBe('errors.permission_denied')
        expect(mapSupabaseError({ code: 'PGRST301' }).i18nKey).toBe('errors.session_expired')
    })

    it('falls back to a generic unknown-error key instead of leaking raw error text', () => {
        expect(mapSupabaseError(new Error('new row violates row-level security policy for table "x"')).i18nKey).toBe('errors.unknown')
        expect(mapSupabaseError('some raw string')).not.toBe('some raw string')
        expect(mapSupabaseError(undefined).i18nKey).toBe('errors.unknown')
    })

    it('detects network failures from the message when offline status is unavailable', () => {
        expect(mapSupabaseError(new Error('Failed to fetch')).i18nKey).toBe('errors.network')
    })
})

describe('AppError hierarchy', () => {
    it('assigns the expected i18n key and kind per subclass', () => {
        expect(new NetworkError().i18nKey).toBe('errors.network')
        expect(new NetworkError().kind).toBe('network')
        expect(new ConflictError().i18nKey).toBe('errors.conflict')
        expect(new ConflictError().kind).toBe('conflict')
        expect(new AuthorizationError().i18nKey).toBe('errors.permission_denied')
        expect(new AuthorizationError().kind).toBe('authorization')
        const validation = new ValidationError('errors.validation_failed')
        expect(validation.i18nKey).toBe('errors.validation_failed')
        expect(validation.kind).toBe('validation')
        expect(validation).toBeInstanceOf(AppError)
        expect(validation).toBeInstanceOf(Error)
    })

    it('keeps the raw message developer-facing and separate from the i18n key', () => {
        const error = new NetworkError({ message: 'ECONNRESET while fetching /reports' })
        expect(error.message).toBe('ECONNRESET while fetching /reports')
        expect(error.i18nKey).toBe('errors.network')
    })
})
