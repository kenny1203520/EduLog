import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiRealtimeChannel } from '@/services/report/ApiRealtimeChannel'
import { invalidationAffectsDate } from '@/services/session/ClassSessionInvalidation'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import type { RealtimeBadgeTone } from '@/components/ui/RealtimeStatusBadge.vue'

export type SessionRealtimeStatus = 'connecting' | 'subscribing' | 'connected' | 'offline' | 'reconnecting' | 'forbidden' | 'expired' | 'disabled'

export interface RealtimeRefreshOptions {
    reportOnly?: boolean
    refreshCatalog?: boolean
}

interface SessionRealtimeOptions {
    sessionId: string
    userId: () => string | undefined
    /** The date (YYYY-MM-DD) whose invalidations matter right now. */
    selectedDate: () => string
    /** Re-reads the page state after relevant remote changes. */
    refresh: (options: RealtimeRefreshOptions) => Promise<void>
}

function payloadOf(event: unknown): Record<string, unknown> {
    const payload = event && typeof event === 'object' && 'payload' in event
        ? (event as { payload?: unknown }).payload
        : event
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
}

/**
 * The class-session live-update channel: connection status for the badge, and
 * invalidation events coalesced into serialized refresh passes.
 */
export function useSessionRealtime(options: SessionRealtimeOptions) {
    const { t } = useI18n()
    const preferences = usePreferencesStore()

    const realtimeStatus = ref<SessionRealtimeStatus>('connecting')
    const realtimeStatusDetail = ref('')
    const isRealtimeRefreshing = ref(false)
    const realtimeRefreshError = ref(false)
    const lastRealtimeUpdateAt = ref<Date | null>(null)

    let classSessionChannel: ApiRealtimeChannel | null = null
    let realtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null
    let realtimeRefreshRunning = false
    let pendingRealtimeInvalidations: unknown[] = []
    let hasJoinedClassSessionChannel = false

    const realtimeStatusMessage = computed(() => {
        if (realtimeRefreshError.value) return t('classroom.live_update_failed')
        if (isRealtimeRefreshing.value) return t('classroom.live_update_loading')
        switch (realtimeStatus.value) {
            case 'forbidden': return t('classroom.live_updates_forbidden')
            case 'expired': return t('classroom.live_updates_expired')
            case 'disabled': return t('classroom.live_updates_disabled')
            case 'offline': return t('classroom.live_updates_offline')
            case 'connecting': return t('classroom.live_updates_connecting')
            case 'subscribing': return t('classroom.live_updates_subscribing')
            case 'reconnecting': return t('classroom.live_updates_reconnecting')
            default: return t('classroom.live_updates_connected')
        }
    })

    // Live updates only refresh the roster; the page works without them, so the
    // status is a fixed-size badge that recolors instead of a bar that shifts content.
    const realtimeBadge = computed<{ tone: RealtimeBadgeTone; label: string; canRetry: boolean }>(() => {
        if (realtimeRefreshError.value) return { tone: 'warning', label: t('classroom.live_badge_refresh_failed'), canRetry: true }
        if (isRealtimeRefreshing.value) return { tone: 'connecting', label: t('classroom.live_badge_refreshing'), canRetry: false }
        switch (realtimeStatus.value) {
            case 'connected': return { tone: 'live', label: t('classroom.live_badge_live'), canRetry: false }
            case 'connecting':
            case 'subscribing': return { tone: 'connecting', label: t('classroom.live_badge_connecting'), canRetry: false }
            case 'offline':
            case 'reconnecting': return { tone: 'warning', label: t('classroom.live_badge_paused'), canRetry: true }
            default: return { tone: 'paused', label: t('classroom.live_badge_unavailable'), canRetry: false }
        }
    })

    const lastRealtimeUpdateLabel = computed(() => lastRealtimeUpdateAt.value
        ? lastRealtimeUpdateAt.value.toLocaleTimeString(preferences.locale, {
            timeZone: preferences.timeZone,
            hour: '2-digit',
            minute: '2-digit',
        })
        : '')

    function scheduleRealtimeRefresh(invalidation?: unknown) {
        pendingRealtimeInvalidations.push(invalidation ?? {})
        if (realtimeRefreshTimer || realtimeRefreshRunning) return
        realtimeRefreshTimer = setTimeout(() => {
            realtimeRefreshTimer = null
            void flushRealtimeInvalidations()
        }, 300)
    }

    async function flushRealtimeInvalidations() {
        if (realtimeRefreshRunning || pendingRealtimeInvalidations.length === 0) return
        const events = pendingRealtimeInvalidations.splice(0)
        const selectedDate = options.selectedDate()
        const relevantEvents = events.map(payloadOf).filter(payload => invalidationAffectsDate(selectedDate, payload))

        if (relevantEvents.length) {
            const reportOnly = relevantEvents.every(payload => payload.change === 'report')
            const refreshCatalog = relevantEvents.some(payload => payload.change === 'course_catalog' || payload.change === 'course' || payload.change === 'reconnect')
            realtimeRefreshRunning = true
            try {
                await options.refresh({ reportOnly, refreshCatalog })
            } finally {
                realtimeRefreshRunning = false
            }
        }

        if (pendingRealtimeInvalidations.length && !realtimeRefreshTimer) {
            realtimeRefreshTimer = setTimeout(() => {
                realtimeRefreshTimer = null
                void flushRealtimeInvalidations()
            }, 0)
        }
    }

    function startClassSessionRealtime() {
        const presenceKey = `${options.userId() || 'user'}:${Date.now()}`
        classSessionChannel = new ApiRealtimeChannel(options.sessionId, presenceKey, 'class_session')
            .on('broadcast', { event: 'class_session_invalidated' }, (message) => scheduleRealtimeRefresh(message?.payload))
        classSessionChannel.subscribe((status, detail) => {
            if (status === 'SUBSCRIBED') {
                realtimeStatus.value = 'connected'
                realtimeStatusDetail.value = ''
                if (hasJoinedClassSessionChannel) scheduleRealtimeRefresh({ change: 'reconnect' })
                hasJoinedClassSessionChannel = true
            } else if (status === 'CONNECTING') {
                realtimeStatus.value = 'connecting'
            } else if (status === 'SUBSCRIBING') {
                realtimeStatus.value = 'subscribing'
            } else if (status === 'RECONNECTING') {
                realtimeStatus.value = 'reconnecting'
            } else if (status === 'CHANNEL_ERROR') {
                realtimeStatusDetail.value = detail || ''
            } else if (status === 'OFFLINE') {
                realtimeStatus.value = 'offline'
                realtimeStatusDetail.value = ''
            } else if (status === 'PERMISSION_DENIED') {
                realtimeStatus.value = 'forbidden'
                realtimeStatusDetail.value = detail || ''
            } else if (status === 'AUTH_EXPIRED') {
                realtimeStatus.value = 'expired'
                realtimeStatusDetail.value = detail || ''
            } else if (status === 'ACCOUNT_DISABLED') {
                realtimeStatus.value = 'disabled'
                realtimeStatusDetail.value = detail || ''
            } else {
                if (!['forbidden', 'expired', 'disabled'].includes(realtimeStatus.value)) realtimeStatus.value = 'reconnecting'
            }
        })
    }

    function retryRealtimeAction() {
        if (realtimeRefreshError.value) {
            scheduleRealtimeRefresh()
            return
        }
        classSessionChannel?.reconnect()
        realtimeStatus.value = 'connecting'
    }

    onBeforeUnmount(() => {
        if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer)
        realtimeRefreshTimer = null
        void classSessionChannel?.unsubscribe()
        classSessionChannel = null
    })

    return {
        realtimeStatusDetail,
        isRealtimeRefreshing,
        realtimeRefreshError,
        lastRealtimeUpdateAt,
        realtimeStatusMessage,
        realtimeBadge,
        lastRealtimeUpdateLabel,
        scheduleRealtimeRefresh,
        startClassSessionRealtime,
        retryRealtimeAction,
    }
}
