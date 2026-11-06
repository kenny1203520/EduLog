import { markRaw } from 'vue'
import { useToast } from 'vue-toastification'
import { useI18n } from 'vue-i18n'
import ErrorToast from '@/components/ui/ErrorToast.vue'
import { describeError, PERSISTENT_ERROR_KEYS, TOAST_TIMEOUTS } from '@/services/errors/describeError'

type I18nParams = Record<string, unknown>

const errorToastComponent = markRaw(ErrorToast)

export interface ErrorKeyOptions {
    /** Keep the toast until the user closes it (failures the user has to act on). */
    persistent?: boolean
}

/**
 * Single entry point for user-facing success/failure feedback. Views and
 * components never call useToast directly, so every message is translated and
 * no raw English, SCREAMING_SNAKE_CASE code or `[object Object]` reaches the
 * user.
 *
 * Error toasts show what failed, why, and what to do next, plus a copyable
 * code for support. They stay 8 s (paused while hovered); causes the user has
 * to act on (expired sign-in, missing permission, unsaved changes) stay until
 * closed.
 */
export function useFeedback() {
    const toast = useToast()
    const { t, te } = useI18n()

    function success(key: string, params?: I18nParams) {
        toast.success(t(key, params || {}), { timeout: TOAST_TIMEOUTS.success })
    }

    function info(key: string, params?: I18nParams) {
        toast.info(t(key, params || {}), { timeout: TOAST_TIMEOUTS.info })
    }

    function warning(key: string, params?: I18nParams) {
        toast.warning(t(key, params || {}), { timeout: TOAST_TIMEOUTS.warning })
    }

    function hintFor(key: string): string | null {
        const hintKey = key.replace(/^errors\./, 'errors.hints.')
        return hintKey !== key && te(hintKey) ? t(hintKey) : null
    }

    function showError(content: { title: string | null; message: string; hint: string | null; code: string | null }, persistent: boolean) {
        toast.error({
            component: errorToastComponent,
            props: {
                ...content,
                labels: { details: t('errors.toast.details'), copy: t('errors.toast.copy'), copied: t('errors.toast.copied') },
            },
        }, { timeout: persistent ? false : TOAST_TIMEOUTS.error, closeOnClick: false })
    }

    /** Shows a translated error toast for a known i18n key. */
    function errorKey(key: string, params?: I18nParams, options: ErrorKeyOptions = {}) {
        showError({ title: null, message: t(key, params || {}), hint: hintFor(key), code: null },
            options.persistent ?? PERSISTENT_ERROR_KEYS.has(key))
    }

    /**
     * Resolves an unknown thrown/returned error -- an AppError, an API error,
     * a domain sentinel-code Error, a Supabase/PostgREST error, a `{ message }`
     * result or anything else -- to a translated error toast. `contextKey`
     * says what failed ("Could not add the contact") and becomes the title;
     * the cause becomes the message.
     */
    function reportError(error: unknown, contextKey = 'errors.unknown', options: ErrorKeyOptions = {}) {
        const description = describeError(error)
        const hasContext = contextKey !== 'errors.unknown'
        const code = [description.code, description.requestId].filter(Boolean).join(' · ') || null
        showError({
            title: hasContext ? t(contextKey) : null,
            message: t(description.i18nKey, description.i18nParams || {}),
            hint: hintFor(description.i18nKey),
            code,
        }, options.persistent ?? PERSISTENT_ERROR_KEYS.has(description.i18nKey))
    }

    return { success, info, warning, errorKey, reportError }
}
