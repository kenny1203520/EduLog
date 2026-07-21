import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import i18n from '@/i18n'
import { DateUtils } from '@/utils/DateUtils'
import { UserPreferenceService } from '@/services/UserPreferenceService'
import { AggregateService } from '@/services/AggregateService'
import { DEFAULT_EDITOR_USER_SETTINGS, normalizeEditorUserSettings } from '@/components/common/text-editor/settings'

export const usePreferencesStore = defineStore('preferences', () => {
    const globalFontScale = ref(Number(localStorage.getItem('globalFontScale')) || 100)
    const editorFontScale = ref(Number(localStorage.getItem('editorFontScale')) || 100)
    const editorSettings = ref(normalizeEditorUserSettings(parseStoredEditorSettings()))
    const locale = ref(localStorage.getItem('locale') || 'zh-TW')
    const timeZone = ref(DateUtils.getDefaultTimeZone())
    const isLoadingRemotePreferences = ref(false)
    let isApplyingRemotePreferences = false

    function parseStoredEditorSettings(): unknown {
        try { return JSON.parse(localStorage.getItem('editorSettings') || 'null') }
        catch { return DEFAULT_EDITOR_USER_SETTINGS }
    }

    const MIN_SCALE = 70
    const MAX_SCALE = 200
    const STEP = 10
    const preferredTimeZones = [
        'Asia/Taipei',
        'Asia/Hong_Kong',
        'Asia/Tokyo',
        'Asia/Seoul',
        'Asia/Singapore',
        'Europe/London',
        'Europe/Paris',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'UTC'
    ]

    const timeZoneOptions = computed(() => {
        const supported = DateUtils.getSupportedTimeZones()
        const merged = [...preferredTimeZones, ...supported]
        return Array.from(new Set(merged))
            .filter(DateUtils.isValidTimeZone)
            .map(zone => ({ value: zone, label: DateUtils.formatTimeZoneLabel(zone, locale.value) }))
    })

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
        if (isApplyingRemotePreferences) return
        UserPreferenceService.updateCurrentUserEditorSettings(value).catch(error => {
            console.warn('Failed to save editor preferences:', error)
        })
    }, { deep: true })
    
    watch(locale, (val) => {
        localStorage.setItem('locale', val)
        // @ts-ignore
        i18n.global.locale.value = val
    }, { immediate: true })

    watch(timeZone, (val) => {
        if (!DateUtils.isValidTimeZone(val)) {
            timeZone.value = DateUtils.getBrowserTimeZone()
            return
        }
        localStorage.setItem('timeZone', val)
        if (isApplyingRemotePreferences) return
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
