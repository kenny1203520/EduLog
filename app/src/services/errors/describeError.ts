import { AppError } from './AppError'
import { domainErrorCode, mapDomainError, mapDomainErrorCode } from './mapDomainError'
import { mapErrorKey } from './mapErrorKey'

/** A user-facing description of an error: what to show, and a code for support. */
export interface ErrorDescription {
    /** i18n key of the cause, e.g. errors.network. */
    i18nKey: string
    i18nParams?: Record<string, unknown>
    /** Machine code for support (API code or reason, Postgres code); never shown as the message. */
    code: string | null
    /** API request id, when the error came from the API. */
    requestId: string | null
}

/** API error codes (by status) that map to a known cause. */
const API_STATUS_KEYS: Record<number, string> = {
    401: 'errors.session_expired',
    403: 'errors.permission_denied',
    408: 'errors.request_timeout',
    409: 'errors.conflict',
    422: 'errors.validation_failed',
    429: 'errors.rate_limited',
    502: 'errors.service_unavailable',
    503: 'errors.service_unavailable',
    504: 'errors.service_unavailable',
}

function field(error: unknown, name: string): unknown {
    return error && typeof error === 'object' ? (error as Record<string, unknown>)[name] : undefined
}

function stringField(error: unknown, name: string): string | null {
    const value = field(error, name)
    return typeof value === 'string' && value ? value : null
}

function messageOf(error: unknown): string | undefined {
    if (typeof error === 'string') return error
    return stringField(error, 'message') ?? undefined
}

/**
 * Resolves anything thrown (AppError, API error, domain sentinel code,
 * Supabase/PostgREST error, plain Error or string) to a translated cause.
 * Raw messages are never returned as display text.
 */
export function describeError(error: unknown): ErrorDescription {
    const reason = stringField(error, 'reason')
    const apiCode = stringField(error, 'code')
    const code = reason ?? apiCode
    const requestId = stringField(error, 'requestId') ?? stringField(error, 'request_id')

    if (error instanceof AppError) {
        return { i18nKey: error.i18nKey, i18nParams: error.i18nParams, code, requestId }
    }

    // The API puts its own codes (e.g. ACCOUNT_EXISTS) in `code`, with an English message.
    const domain = mapDomainErrorCode(apiCode) ?? mapDomainError(domainErrorCode(error)) ?? mapDomainError(messageOf(error))
    if (domain) return { i18nKey: domain.i18nKey, code: code ?? domainCodeIn(messageOf(error)), requestId }

    const status = field(error, 'status')
    if (typeof status === 'number' && API_STATUS_KEYS[status]) {
        return { i18nKey: API_STATUS_KEYS[status]!, code, requestId }
    }

    return { i18nKey: mapErrorKey(error).i18nKey, code, requestId }
}

function domainCodeIn(message: string | undefined): string | null {
    return message?.match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/)?.[0] ?? null
}

/** Causes the user has to act on; their toasts stay until closed. */
export const PERSISTENT_ERROR_KEYS: ReadonlySet<string> = new Set([
    'errors.session_expired',
    'errors.permission_denied',
    'errors.permission_required_for_settings',
    'errors.request_timeout',
    'errors.save_outcome_unknown',
    'errors.conflict',
])

/** How long each toast type stays (ms); false keeps it until closed. */
export const TOAST_TIMEOUTS = {
    success: 3000,
    info: 4000,
    warning: 6000,
    error: 8000,
} as const

/** At most this many toasts are on screen at once. */
export const MAX_TOASTS = 3

/** A key that identifies a toast's visible text, so the same message is shown once. */
export function toastSignature(type: string, content: unknown): string {
    if (typeof content === 'string') return `${type}:${content}`
    const props = field(content, 'props')
    if (props && typeof props === 'object') {
        const { title, message } = props as { title?: unknown; message?: unknown }
        return `${type}:${String(title ?? '')}|${String(message ?? '')}`
    }
    return `${type}:${String(content)}`
}
