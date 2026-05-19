import { ref, computed, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { RealtimeReportService, type RealtimeUpdate } from '@/services/report/RealtimeReportService'
import { useAuthStore } from '@/stores/useAuthStore'

export interface RealtimeStatus {
    connected: boolean
    syncing: boolean
    hasConflict: boolean
    lastSyncTime: Date | null
    conflictMessage: string | null
}

export function useReportRealtime(reportId: Ref<string> | string) {
    const authStore = useAuthStore()
    const status = ref<RealtimeStatus>({
        connected: false,
        syncing: false,
        hasConflict: false,
        lastSyncTime: null,
        conflictMessage: null
    })

    const remoteUpdates = ref<RealtimeUpdate[]>([])
    const lockInfo = ref<any>(null)
    const isLocked = computed(() => lockInfo.value && lockInfo.value.locked_by !== authStore.user?.id)
    const lockedByOtherUser = computed(() => {
        if (!lockInfo.value) return null
        if (lockInfo.value.locked_by === authStore.user?.id) return null
        return lockInfo.value.locked_by
    })

    const reportIdValue = computed(() => (typeof reportId === 'string' ? reportId : reportId.value))

    /**
     * Initialize real-time subscriptions
     */
    const initializeRealtime = async () => {
        if (!reportIdValue.value) return

        try {
            // Subscribe to report changes
            RealtimeReportService.subscribeToReport(
                reportIdValue.value,
                handleRemoteUpdate
            )

            // Try to acquire lock
            const lockAcquired = await RealtimeReportService.acquireReportLock(
                reportIdValue.value,
                authStore.user?.id || '',
                10 // 10 minutes
            )

            if (!lockAcquired) {
                // Another user might have the lock, check who
                lockInfo.value = await RealtimeReportService.getReportLock(reportIdValue.value)
            }

            // Start heartbeat for presence
            if (authStore.user?.id) {
                RealtimeReportService.startHeartbeat(reportIdValue.value, authStore.user.id, 5)
            }

            status.value.connected = true
        } catch (err) {
            console.error('Failed to initialize realtime:', err)
            status.value.connected = false
        }
    }

    /**
     * Handle incoming remote updates
     */
    const handleRemoteUpdate = async (update: RealtimeUpdate) => {
        if (!update.new) return

        // Skip if this is our own update
        if (update.edited_by === authStore.user?.id) {
            status.value.lastSyncTime = new Date()
            return
        }

        remoteUpdates.value.push(update)
        status.value.syncing = true

        try {
            // Record sync - parent component handles conflict detection
            await RealtimeReportService.recordSync(
                reportIdValue.value,
                authStore.user?.id || '',
                update.new.version || 1,
                false,
                'field-merge'
            )

            status.value.lastSyncTime = new Date()
        } finally {
            status.value.syncing = false
        }
    }

    /**
     * Refresh lock status
     */
    const refreshLockStatus = async () => {
        if (!reportIdValue.value) return

        try {
            lockInfo.value = await RealtimeReportService.getReportLock(reportIdValue.value)
        } catch (err) {
            console.error('Error refreshing lock status:', err)
        }
    }

    /**
     * Request lock from another user
     */
    const requestLock = async () => {
        if (!reportIdValue.value || !isLocked.value) return

        try {
            const acquired = await RealtimeReportService.acquireReportLock(
                reportIdValue.value,
                authStore.user?.id || '',
                10
            )

            if (acquired) {
                lockInfo.value = null
                return true
            }

            return false
        } catch (err) {
            console.error('Error requesting lock:', err)
            return false
        }
    }

    /**
     * Force release lock (e.g., on page unload)
     */
    const releaseLock = async () => {
        if (!reportIdValue.value) return

        try {
            await RealtimeReportService.releaseReportLock(
                reportIdValue.value,
                authStore.user?.id || ''
            )
            lockInfo.value = null
        } catch (err) {
            console.error('Error releasing lock:', err)
        }
    }

    /**
     * Cleanup on unmount
     */
    const cleanup = () => {
        if (reportIdValue.value) {
            RealtimeReportService.stopHeartbeat(reportIdValue.value)
            RealtimeReportService.unsubscribeFromReport(reportIdValue.value)
            releaseLock()
        }
    }

    onMounted(() => {
        initializeRealtime()
    })

    onBeforeUnmount(() => {
        cleanup()
    })

    return {
        status,
        isLocked,
        lockedByOtherUser,
        remoteUpdates,
        refreshLockStatus,
        requestLock,
        releaseLock,
        cleanup,
        initializeRealtime
    }
}
