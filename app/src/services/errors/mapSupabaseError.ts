export interface MappedError {
    i18nKey: string
}

/** Postgres/PostgREST error codes we can give the user a specific, actionable message for. */
const PG_CODE_KEYS: Record<string, string> = {
    PGRST116: 'errors.conflict',
    '23505': 'errors.unique_violation',
    '23503': 'errors.foreign_key_violation',
    '42501': 'errors.permission_denied',
    PGRST301: 'errors.session_expired'
}

function hasCode(error: unknown): error is { code: string } {
    return typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
}

function extractMessage(error: unknown): string | undefined {
    if (!error) return undefined
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && 'message' in error) {
        const message = (error as { message?: unknown }).message
        return typeof message === 'string' ? message : undefined
    }
    return undefined
}

/**
 * Maps a Supabase/PostgREST error (or anything error-shaped) to a translated,
 * user-safe i18n key. Never returns raw database text -- an RLS rejection, a
 * constraint name, or "new row violates row-level security policy ..." must
 * never reach the UI verbatim.
 */
export function mapSupabaseError(error: unknown): MappedError {
    if (hasCode(error) && PG_CODE_KEYS[error.code]) {
        return { i18nKey: PG_CODE_KEYS[error.code] }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { i18nKey: 'errors.network' }
    }

    const message = extractMessage(error)
    if (message && /network|fetch|Failed to fetch|ERR_INTERNET|ERR_CONNECTION/i.test(message)) {
        return { i18nKey: 'errors.network' }
    }

    return { i18nKey: 'errors.unknown' }
}
