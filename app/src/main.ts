import { createApp } from 'vue'
import { createPinia } from 'pinia'
import i18n from './i18n'
import './style.css'
import Toast, { useToast } from 'vue-toastification'
import 'vue-toastification/dist/index.css'
import App from './App.vue'
import router from './router'
import './pwa'
import { setupDocumentHead } from './utils/documentHead'
import { mapDomainError } from './services/errors/mapDomainError'
import { mapSupabaseError } from './services/errors/mapSupabaseError'
import { AppError } from './services/errors/AppError'
import { usePreferencesStore } from './stores/usePreferencesStore'

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
app.use(Toast, {
    position: 'top-right',
    timeout: 3000,
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
})

// Last-resort net for errors that never went through useFeedback -- a
// component's render/setup throw, or a rejected promise nobody awaited (both
// previously invisible: no console output, no toast, nothing). This is
// deliberately independent of useFeedback/useI18n's component context, since
// app.config.errorHandler and unhandledrejection can both fire with no active
// component instance.
function reportUncaughtError(error: unknown) {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
    const key = error instanceof AppError
        ? error.i18nKey
        : mapDomainError(message)?.i18nKey || mapSupabaseError(error).i18nKey
    useToast().error(i18n.global.t(key), { timeout: false })
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
