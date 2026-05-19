import { ref, computed, onMounted, onBeforeUnmount, type Ref } from 'vue'
import { RealtimeReportService, type ReportLockInfo } from '@/services/report/RealtimeReportService'
import { useAuthStore } from '@/stores/useAuthStore'
import { useToast } from 'vue-toastification'

export function useReportLocking(reportId: Ref<string> | string) {
    const authStore = useAuthStore()
    const toast = useToast()
    
    const lockInfo = ref<ReportLockInfo | null>(null)
    const isLocked = ref(false)
    const lockCheckInterval = ref<ReturnType<typeof setInterval> | null>(null)
    const durationMinutes = ref(10)

    const reportIdValue = computed(() => (typeof reportId === 'string' ? reportId : (reportId as Ref<string>).value))

    const isLockedByCurrentUser = computed(() =>
        lockInfo.value?.locked_by === authStore.user?.id
    )

    const isLockedByOther = computed(() =>
        isLocked.value && !isLockedByCurrentUser.value
    )

    const lockTimeRemaining = computed(() => {
        if (!lockInfo.value) return null

        const now = new Date().getTime()
        const expiresAt = new Date(lockInfo.value.expires_at).getTime()
        const remaining = Math.max(0, expiresAt - now)

        if (remaining === 0) return null

        const minutes = Math.floor(remaining / 60000)
        const seconds = Math.floor((remaining % 60000) / 1000)

        return `${minutes}:${seconds.toString().padStart(2, '0')}`
    })

    /**
     * Attempt to acquire lock
     */
    const acquireLock = async (): Promise<boolean> => {
        if (!reportIdValue.value || !authStore.user?.id) return false

        try {
            const success = await RealtimeReportService.acquireReportLock(
                reportIdValue.value,
                authStore.user.id,
                durationMinutes.value
            )

            if (success) {
                isLocked.value = true
                await checkLockStatus()
                toast.success('Report locked for editing')
                return true
            } else {
                // Another user has the lock
                await checkLockStatus()
                toast.info('Report is locked by another user')
                return false
            }
        } catch (err) {
            console.error('Error acquiring lock:', err)
            toast.error('Failed to acquire lock')
            return false
        }
    }

    /**
     * Release lock
     */
    const releaseLock = async (): Promise<void> => {
        if (!reportIdValue.value || !authStore.user?.id) return

        try {
            await RealtimeReportService.releaseReportLock(
                reportIdValue.value,
                authStore.user.id
            )
            isLocked.value = false
            lockInfo.value = null
        } catch (err) {
            console.error('Error releasing lock:', err)
        }
    }

    /**
     * Check current lock status
     */
    const checkLockStatus = async (): Promise<void> => {
        if (!reportIdValue.value) return

        try {
            const lock = await RealtimeReportService.getReportLock(reportIdValue.value)
            lockInfo.value = lock
            isLocked.value = lock !== null
        } catch (err) {
            console.error('Error checking lock status:', err)
        }
    }

    /**
     * Try to take lock from another user (forces release)
     * Only use with explicit user consent
     */
    const forceTakeLock = async (): Promise<boolean> => {
        if (!reportIdValue.value || !lockInfo.value) return false

        try {
            // Release the other user's lock
            await RealtimeReportService.releaseReportLock(
                reportIdValue.value,
                lockInfo.value.locked_by
            )

            // Now try to acquire for ourselves
            return await acquireLock()
        } catch (err) {
            console.error('Error forcing lock:', err)
            toast.error('Failed to force lock')
            return false
        }
    }

    /**
     * Check periodically if lock is still held
     */
    const startLockMonitoring = (): void => {
        if (lockCheckInterval.value) return

        lockCheckInterval.value = setInterval(async () => {
            await checkLockStatus()
        }, 30000) // Check every 30 seconds
    }

    /**
     * Stop monitoring lock
     */
    const stopLockMonitoring = (): void => {
        if (lockCheckInterval.value) {
            clearInterval(lockCheckInterval.value)
            lockCheckInterval.value = null
        }
    }

    /**
     * Initialize locking system
     */
    const initialize = async (): Promise<void> => {
        try {
            await acquireLock()
            startLockMonitoring()
        } catch (err) {
            console.error('Error initializing lock:', err)
        }
    }

    /**
     * Cleanup on unmount
     */
    const cleanup = async (): Promise<void> => {
        stopLockMonitoring()
        if (isLockedByCurrentUser.value) {
            await releaseLock()
        }
    }

    onMounted(() => {
        initialize()
    })

    onBeforeUnmount(() => {
        cleanup()
    })

    return {
        lockInfo,
        isLocked,
        isLockedByCurrentUser,
        isLockedByOther,
        lockTimeRemaining,
        durationMinutes,
        acquireLock,
        releaseLock,
        checkLockStatus,
        forceTakeLock,
        startLockMonitoring,
        stopLockMonitoring,
        initialize,
        cleanup
    }
}
