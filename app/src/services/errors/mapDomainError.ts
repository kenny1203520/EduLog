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
 * ORIGINAL_REPORT_NOT_FOUND is deliberately absent: nothing in the codebase
 * throws it (it was a dead branch in TransferModal.vue).
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
    REPORT_ALREADY_EXISTS: 'errors.domain.REPORT_ALREADY_EXISTS'
}

/** Returns the matching translated key for a message containing a known sentinel code, or null. */
export function mapDomainError(message: string | undefined | null): MappedError | null {
    if (!message) return null
    for (const code in DOMAIN_ERROR_KEYS) {
        if (message.includes(code)) return { i18nKey: DOMAIN_ERROR_KEYS[code] }
    }
    return null
}
