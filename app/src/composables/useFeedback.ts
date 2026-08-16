import { useToast } from 'vue-toastification'
import { useI18n } from 'vue-i18n'
import { AppError } from '@/services/errors/AppError'
import { mapDomainError } from '@/services/errors/mapDomainError'
import { mapSupabaseError } from '@/services/errors/mapSupabaseError'

type I18nParams = Record<string, unknown>

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
 * Single entry point for user-facing success/failure feedback. Replaces the
 * pattern of every view/component importing useToast directly and either
 * showing a raw English message, an untranslated SCREAMING_SNAKE_CASE domain
 * code, or `[object Object]` from `toast.error(e as string)`.
 *
 * Error toasts do not auto-dismiss (the global default is 3s) -- a failure
 * the user didn't get to read before it vanished is not feedback.
 */
export function useFeedback() {
    const toast = useToast()
    const { t } = useI18n()

    function success(key: string, params?: I18nParams) {
        toast.success(t(key, params || {}))
    }

    function info(key: string, params?: I18nParams) {
        toast.info(t(key, params || {}))
    }

    function warning(key: string, params?: I18nParams) {
        toast.warning(t(key, params || {}), { timeout: false })
    }

    /** Shows a translated, persistent error toast for a known i18n key. */
    function errorKey(key: string, params?: I18nParams) {
        toast.error(t(key, params || {}), { timeout: false })
    }

    /**
     * Resolves an unknown thrown/returned error -- an AppError, a domain
     * sentinel-code Error, a Supabase/PostgREST error, a `{ message }` result
     * object, or anything else -- to a translated, persistent error toast.
     * This is the replacement for `toast.error(e.message || String(e))` and
     * `toast.error(e as string)`.
     */
    function reportError(error: unknown, fallbackKey = 'errors.unknown') {
        if (error instanceof AppError) {
            errorKey(error.i18nKey, error.i18nParams)
            return
        }

        const message = extractMessage(error)
        const domain = mapDomainError(message)
        if (domain) {
            errorKey(domain.i18nKey)
            return
        }

        const mapped = mapSupabaseError(error)
        errorKey(mapped.i18nKey || fallbackKey)
    }

    return { success, info, warning, errorKey, reportError }
}
