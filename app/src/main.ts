import { createApp, markRaw } from 'vue'
import { createPinia } from 'pinia'
import i18n from './i18n'
import './style.css'
import Toast, { POSITION, useToast, type PluginOptions } from 'vue-toastification'
import 'vue-toastification/dist/index.css'
import App from './App.vue'
import router from './router'
import './pwa'
import { setupDocumentHead } from './utils/documentHead'
import { describeError, MAX_TOASTS, PERSISTENT_ERROR_KEYS, TOAST_TIMEOUTS, toastSignature } from './services/errors/describeError'
import ErrorToast from './components/ui/ErrorToast.vue'
import { usePreferencesStore } from './stores/usePreferencesStore'
import { preventIosInputZoom } from './lib/iosViewport'
import { localDraftStore } from './services/report/LocalDraftStore'

preventIosInputZoom(document, navigator)
// Unsaved report drafts are kept for at most 7 days on this device.
void localDraftStore.purgeExpired()

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)
// Instantiating the store here (rather than leaving it to whichever
// component happens to use it first, e.g. LanguageSwitcher) makes the
// locale/i18n sync in usePreferencesStore's immediate watcher run
// deterministically at startup instead of incidentally on first render.
usePreferencesStore()
setupDocumentHead(router)
const narrowScreen = window.matchMedia('(max-width: 639px)')
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const toastPosition = () => narrowScreen.matches ? POSITION.TOP_CENTER : POSITION.TOP_RIGHT
const toastOptions: PluginOptions = {
    position: toastPosition(),
    timeout: TOAST_TIMEOUTS.success,
    maxToasts: MAX_TOASTS,
    newestOnTop: true,
    transition: reducedMotion.matches ? 'Vue-Toastification__fade' : 'Vue-Toastification__bounce',
    // The same message twice is shown once.
    filterBeforeCreate: (toast, toasts) => {
        const signature = toastSignature(String(toast.type), toast.content)
        return toasts.some(existing => toastSignature(String(existing.type), existing.content) === signature) ? false : toast
    },
    closeOnClick: true,
    pauseOnFocusLoss: true,
    pauseOnHover: true,
    draggable: true,
    draggablePercent: 0.6,
    showCloseButtonOnHover: false,
    hideProgressBar: false,
    closeButton: 'button',
    icon: true,
    rtl: false
}
app.use(Toast, toastOptions)
narrowScreen.addEventListener('change', () => useToast().updateDefaults({ position: toastPosition() }))

// Last-resort net for errors that never went through useFeedback -- a
// component's render/setup throw, or a rejected promise nobody awaited (both
// previously invisible: no console output, no toast, nothing). This is
// deliberately independent of useFeedback/useI18n's component context, since
// app.config.errorHandler and unhandledrejection can both fire with no active
// component instance.
function reportUncaughtError(error: unknown) {
    const { t, te } = i18n.global
    const description = describeError(error)
    const hintKey = description.i18nKey.replace(/^errors\./, 'errors.hints.')
    useToast().error({
        component: markRaw(ErrorToast),
        props: {
            title: null,
            message: t(description.i18nKey, description.i18nParams || {}),
            hint: te(hintKey) ? t(hintKey) : null,
            code: [description.code, description.requestId].filter(Boolean).join(' · ') || null,
            labels: { details: t('errors.toast.details'), copy: t('errors.toast.copy'), copied: t('errors.toast.copied') },
        },
    }, { timeout: PERSISTENT_ERROR_KEYS.has(description.i18nKey) ? false : TOAST_TIMEOUTS.error, closeOnClick: false })
}

app.config.errorHandler = (err, _instance, info) => {
    console.error('Unhandled error:', err, info)
    reportUncaughtError(err)
}

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason)
    reportUncaughtError(event.reason)
})

app.mount('#app')
