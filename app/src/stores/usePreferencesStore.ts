import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import i18n, { type SupportedLocale } from '@/i18n'
import { DateUtils } from '@/utils/dateUtils'
import { TimeZoneService } from '@/services/preference/TimeZoneService'
import { UserPreferenceService } from '@/services/preference/UserPreferenceService'
import { AggregateService } from '@/services/api/AggregateService'
import { DEFAULT_EDITOR_USER_SETTINGS, normalizeEditorUserSettings } from '@/components/text-editor/settings'

function readStoredLocale(): SupportedLocale {
    // Guards against a stale/corrupted localStorage value (e.g. from an older
    // build) silently becoming an invalid i18n.global.locale assignment.
    return localStorage.getItem('locale') === 'en' ? 'en' : 'zh-TW'
}

export const usePreferencesStore = defineStore('preferences', () => {
    const globalFontScale = ref(Number(localStorage.getItem('globalFontScale')) || 100)
    const editorFontScale = ref(Number(localStorage.getItem('editorFontScale')) || 100)
    const editorSettings = ref(normalizeEditorUserSettings(parseStoredEditorSettings()))
    const locale = ref<SupportedLocale>(readStoredLocale())
    const timeZone = ref(DateUtils.getDefaultTimeZone())
    const isLoadingRemotePreferences = ref(false)
    let isApplyingRemotePreferences = false
    // Do not turn the initial values (or values being hydrated from the BFF)
    // into a PATCH request.  Persistence starts only after the first load has
    // settled, when a user can actually change a preference.
    let canPersistRemotePreferences = false

    function parseStoredEditorSettings(): unknown {
        try { return JSON.parse(localStorage.getItem('editorSettings') || 'null') }
        catch { return DEFAULT_EDITOR_USER_SETTINGS }
    }

    const MIN_SCALE = 70
    const MAX_SCALE = 200
    const STEP = 10
    const timeZoneOptions = computed(() => TimeZoneService.getOptions(locale.value))

    const timeZoneLabel = computed(() => DateUtils.formatTimeZoneLabel(timeZone.value, locale.value))

    // Apply global font scale to document root
    watch(globalFontScale, (val) => {
        localStorage.setItem('globalFontScale', val.toString())
        if (typeof document !== 'undefined') {
            document.documentElement.style.fontSize = `${val}%`
        }
    }, { immediate: true })

    watch(editorFontScale, (val) => {
        localStorage.setItem('editorFontScale', val.toString())
        editorSettings.value.appearance = { ...(editorSettings.value.appearance || {}), fontScale: val }
    })

    watch(editorSettings, (value) => {
        localStorage.setItem('editorSettings', JSON.stringify(value))
        if (isApplyingRemotePreferences || !canPersistRemotePreferences) return
        UserPreferenceService.updateCurrentUserEditorSettings(value).catch(error => {
            console.warn('Failed to save editor preferences:', error)
        })
    }, { deep: true })
    
    watch(locale, (val) => {
        localStorage.setItem('locale', val)
        i18n.global.locale.value = val
    }, { immediate: true })

    watch(timeZone, (val) => {
        if (!DateUtils.isValidTimeZone(val)) {
            timeZone.value = DateUtils.getBrowserTimeZone()
            return
        }
        localStorage.setItem('timeZone', val)
        if (isApplyingRemotePreferences || !canPersistRemotePreferences) return
        UserPreferenceService.updateCurrentUserTimeZone(val).catch(error => {
            console.warn('Failed to save time zone preference:', error)
        })
    }, { immediate: true })

    function adjustGlobalScale(delta: number) {
        const newVal = Number(globalFontScale.value) + delta
        if (newVal >= MIN_SCALE && newVal <= MAX_SCALE) {
            globalFontScale.value = newVal
        }
    }

    function adjustEditorScale(delta: number) {
        const newVal = Number(editorFontScale.value) + delta
        if (newVal >= MIN_SCALE && newVal <= MAX_SCALE) {
            editorFontScale.value = newVal
        }
    }

    async function loadUserPreferences() {
        isLoadingRemotePreferences.value = true
        try {
            // Try the aggregated endpoint first (single request)
            try {
                const agg = await AggregateService.getUserPreferencesAggregate()
                const remote = agg?.preferences || null
                if (remote?.time_zone && DateUtils.isValidTimeZone(remote.time_zone)) {
                    isApplyingRemotePreferences = true
                    timeZone.value = remote.time_zone
                    localStorage.setItem('timeZone', remote.time_zone)
                    isApplyingRemotePreferences = false
                }
                if (remote?.editor_settings) {
                    isApplyingRemotePreferences = true
                    editorSettings.value = normalizeEditorUserSettings(remote.editor_settings)
                    editorFontScale.value = editorSettings.value.appearance?.fontScale || editorFontScale.value
                    isApplyingRemotePreferences = false
                }
            } catch (e) {
                // Fallback to previous direct service if aggregate endpoint fails
                const remote = await UserPreferenceService.getCurrentUserPreferences()
                if (remote?.time_zone && DateUtils.isValidTimeZone(remote.time_zone)) {
                    isApplyingRemotePreferences = true
                    timeZone.value = remote.time_zone
                    localStorage.setItem('timeZone', remote.time_zone)
                    isApplyingRemotePreferences = false
                }
                if (remote?.editor_settings) {
                    isApplyingRemotePreferences = true
                    editorSettings.value = normalizeEditorUserSettings(remote.editor_settings)
                    editorFontScale.value = editorSettings.value.appearance?.fontScale || editorFontScale.value
                    isApplyingRemotePreferences = false
                }
            }
        } catch (error) {
            console.warn('Failed to load user preferences:', error)
        } finally {
            isApplyingRemotePreferences = false
            isLoadingRemotePreferences.value = false
            canPersistRemotePreferences = true
        }
    }

    return {
        globalFontScale,
        editorFontScale,
        editorSettings,
        adjustGlobalScale,
        adjustEditorScale,
        locale,
        timeZone,
        timeZoneLabel,
        timeZoneOptions,
        isLoadingRemotePreferences,
        loadUserPreferences,
        STEP
    }
})
