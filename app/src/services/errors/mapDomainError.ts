export interface MappedError {
    i18nKey: string
}

/**
 * SCREAMING_SNAKE_CASE sentinel codes thrown by services and Postgres RPCs
 * (via `RAISE EXCEPTION '<CODE>'` / `throw new Error('<CODE>')`), mapped to a
 * generic translated message. Call sites that need friendlier, context-specific
 * wording (e.g. classroom.add_student_duplicate_report) can still check for a
 * code before falling back to this mapper -- this exists so nothing falls
 * through to a raw SCREAMING_SNAKE_CASE string or an untranslated English
 * message, which is what happened everywhere this table was previously
 * duplicated ad hoc per component.
 *
 * Transfer RPC codes reach the client as `ApiV1Error.reason` (the server's
 * `error.details.reason`); `domainErrorCode` prefers it over the message.
 */
const DOMAIN_ERROR_KEYS: Record<string, string> = {
    TARGET_DATE_NOT_CLASS_DAY: 'errors.domain.TARGET_DATE_NOT_CLASS_DAY',
    TARGET_SESSION_SAME_AS_CURRENT: 'errors.domain.TARGET_SESSION_SAME_AS_CURRENT',
    TARGET_SESSION_COURSE_MISMATCH: 'errors.domain.TARGET_SESSION_COURSE_MISMATCH',
    TARGET_REPORT_ALREADY_EXISTS: 'errors.domain.TARGET_REPORT_ALREADY_EXISTS',
    ORIGINAL_REPORT_AMBIGUOUS: 'errors.domain.ORIGINAL_REPORT_AMBIGUOUS',
    ORIGINAL_DATE_NOT_CLASS_DAY: 'errors.domain.ORIGINAL_DATE_NOT_CLASS_DAY',
    ORIGINAL_OCCURRENCE_NOT_IN_ENROLLMENT_SESSION: 'errors.domain.ORIGINAL_OCCURRENCE_NOT_IN_ENROLLMENT_SESSION',
    DUPLICATE_OCCURRENCE_REPORT: 'errors.domain.DUPLICATE_OCCURRENCE_REPORT',
    MAKEUP_DATE_NOT_CLASS_DAY: 'errors.domain.MAKEUP_DATE_NOT_CLASS_DAY',
    COURSE_REQUIRED_FOR_SESSION: 'errors.domain.COURSE_REQUIRED_FOR_SESSION',
    ROLE_NAME_REQUIRED: 'errors.domain.ROLE_NAME_REQUIRED',
    TRANSFER_CONFLICT_STALE: 'errors.domain.TRANSFER_CONFLICT_STALE',
    SOURCE_OCCURRENCE_NOT_EFFECTIVE: 'errors.domain.SOURCE_OCCURRENCE_NOT_EFFECTIVE',
    TARGET_OCCURRENCE_ALREADY_EFFECTIVE: 'errors.domain.TARGET_OCCURRENCE_ALREADY_EFFECTIVE',
    TARGET_OCCURRENCE_NOT_EFFECTIVE: 'errors.domain.TARGET_OCCURRENCE_NOT_EFFECTIVE',
    SOURCE_AND_TARGET_OCCURRENCES_MATCH: 'errors.domain.SOURCE_AND_TARGET_OCCURRENCES_MATCH',
    SINGLE_LESSON_TRANSFER_FORBIDDEN: 'errors.domain.SINGLE_LESSON_TRANSFER_FORBIDDEN',
    SINGLE_LESSON_TRANSFER_ALREADY_EXISTS: 'errors.domain.SINGLE_LESSON_TRANSFER_ALREADY_EXISTS',
    SINGLE_LESSON_TRANSFER_NOT_FOUND: 'errors.domain.SINGLE_LESSON_TRANSFER_NOT_FOUND',
    SOURCE_REPORT_ALREADY_EXISTS: 'errors.domain.SOURCE_REPORT_ALREADY_EXISTS',
    ORIGINAL_REPORT_NOT_FOUND: 'errors.domain.ORIGINAL_REPORT_NOT_FOUND',
    SOURCE_REPORT_HAS_CONTENT: 'errors.domain.SOURCE_REPORT_HAS_CONTENT',
    TRANSFER_CHAIN_HAS_MERGED_REPORT: 'errors.domain.TRANSFER_CHAIN_HAS_MERGED_REPORT',
    REPORT_ALREADY_EXISTS: 'errors.domain.REPORT_ALREADY_EXISTS',
    TRANSFER_NOTE_TOO_LONG: 'errors.domain.TRANSFER_NOTE_TOO_LONG',
    ACCOUNT_EXISTS: 'errors.domain.ACCOUNT_EXISTS',
    PROTECTED_ROLE_NOT_ALLOWED: 'errors.domain.PROTECTED_ROLE_NOT_ALLOWED',
    ROLE_NOT_FOUND: 'errors.domain.ROLE_NOT_FOUND',
    ACCOUNT_NOT_PENDING: 'errors.domain.ACCOUNT_NOT_PENDING',
    AUTH_ADMIN_UNAVAILABLE: 'errors.domain.AUTH_ADMIN_UNAVAILABLE',
    SENSITIVE_PERMISSION_REQUIRED: 'errors.domain.SENSITIVE_PERMISSION_REQUIRED',
    STUDENT_ACCESS_DENIED: 'errors.domain.STUDENT_ACCESS_DENIED'
}

/** Every sentinel code this table translates; the locale contract test checks each has a message. */
export const DOMAIN_ERROR_CODES: readonly string[] = Object.keys(DOMAIN_ERROR_KEYS)

/** Returns the translated key for an API error code that is exactly a known sentinel code, or null. */
export function mapDomainErrorCode(code: string | undefined | null): MappedError | null {
    return code && Object.hasOwn(DOMAIN_ERROR_KEYS, code) ? { i18nKey: DOMAIN_ERROR_KEYS[code]! } : null
}

/** Returns the matching translated key for a message containing a known sentinel code, or null. */
export function mapDomainError(message: string | undefined | null): MappedError | null {
    if (!message) return null
    for (const code in DOMAIN_ERROR_KEYS) {
        if (message.includes(code)) return { i18nKey: DOMAIN_ERROR_KEYS[code] }
    }
    return null
}

/** Returns the business-rule code carried by an error: the API reason when present, otherwise its message. */
export function domainErrorCode(error: unknown): string | undefined {
    if (!error) return undefined
    if (typeof error === 'string') return error
    if (typeof error === 'object') {
        const reason = (error as { reason?: unknown }).reason
        if (typeof reason === 'string' && reason) return reason
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string') return message
    }
    return undefined
}

/** True when the error carries the given business-rule code. */
export function hasDomainErrorCode(error: unknown, code: string): boolean {
    return domainErrorCode(error)?.includes(code) ?? false
}
