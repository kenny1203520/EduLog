import { ref, computed, onMounted, onBeforeUnmount, watch, type Ref } from 'vue'
import { PresenceService, type EditorPresence } from '@/services/report/PresenceService'
import { RealtimeReportService } from '@/services/report/RealtimeReportService'
import { useAuthStore } from '@/stores/useAuthStore'

export function useEditorPresence(reportId: Ref<string> | string) {
    const authStore = useAuthStore()
    const activeEditors = ref<EditorPresence[]>([])
    const presenceUpdateInterval = ref<ReturnType<typeof setInterval> | null>(null)
    const isTracking = ref(false)

    const reportIdValue = computed(() => (typeof reportId === 'string' ? reportId : reportId.value))

    const otherEditors = computed(() =>
        activeEditors.value.filter((e) => e.userId !== authStore.user?.id)
    )

    const editorCount = computed(() => activeEditors.value.length)

    const presenceString = computed(() =>
        PresenceService.formatPresenceString(otherEditors.value)
    )

    const hasOtherEditors = computed(() => otherEditors.value.length > 0)

    /**
     * Initialize presence tracking
     */
    const startTracking = async () => {
        if (!reportIdValue.value || isTracking.value) return

        try {
            // Add current user's presence
            await PresenceService.addPresence(
                reportIdValue.value,
                authStore.user?.id || '',
                authStore.user?.email || '',
                authStore.user?.user_metadata?.full_name || authStore.user?.email || 'Unknown'
            )

            isTracking.value = true

            // Fetch initial presence list
            await refreshPresence()

            // Subscribe to presence changes
            RealtimeReportService.subscribeToActiveEditors(
                reportIdValue.value,
                handlePresenceChange
            )

            // Poll for presence updates every 5 seconds
            presenceUpdateInterval.value = setInterval(() => {
                refreshPresence()
            }, 5000)
        } catch (err) {
            console.error('Failed to start tracking presence:', err)
        }
    }

    /**
     * Stop tracking presence
     */
    const stopTracking = async () => {
        if (!reportIdValue.value || !isTracking.value) return

        try {
            // Remove presence
            await PresenceService.removePresence(reportIdValue.value, authStore.user?.id || '')

            // Clear interval
            if (presenceUpdateInterval.value) {
                clearInterval(presenceUpdateInterval.value)
                presenceUpdateInterval.value = null
            }

            // Clear cached presence
            PresenceService.clearReportPresence(reportIdValue.value)
            activeEditors.value = []
            isTracking.value = false
        } catch (err) {
            console.error('Failed to stop tracking presence:', err)
        }
    }

    /**
     * Refresh presence list
     */
    const refreshPresence = async () => {
        if (!reportIdValue.value) return

        try {
            const presences = await PresenceService.getActivePresence(reportIdValue.value)
            activeEditors.value = presences
        } catch (err) {
            console.error('Error refreshing presence:', err)
        }
    }

    /**
     * Handle presence changes from realtime updates
     */
    const handlePresenceChange = async (editors: any[]) => {
        // Convert ActiveEditor[] to EditorPresence[]
        activeEditors.value = editors as EditorPresence[]
    }

    /**
     * Get editor by user ID
     */
    const getEditor = (userId: string): EditorPresence | undefined =>
        activeEditors.value.find((e) => e.userId === userId)

    /**
     * Get editor color
     */
    const getEditorColor = (userId: string): string => {
        const editor = getEditor(userId)
        return editor?.color || '#999999'
    }

    /**
     * Format editor list as readable string
     */
    const getEditorListFormatted = (): string => {
        if (otherEditors.value.length === 0) {
            return ''
        }

        return otherEditors.value.map((e) => e.displayName).join(', ')
    }

    /**
     * Check if a specific user is active
     */
    const isUserActive = (userId: string): boolean =>
        activeEditors.value.some((e) => e.userId === userId)

    /**
     * Get active editor count
     */
    const getActiveEditorCount = (): number => activeEditors.value.length

    onMounted(() => {
        startTracking()
    })

    onBeforeUnmount(() => {
        stopTracking()
    })

    watch(reportIdValue, () => {
        // Reset when report changes
        stopTracking()
        startTracking()
    })

    return {
        activeEditors,
        otherEditors,
        editorCount,
        presenceString,
        hasOtherEditors,
        isTracking,
        startTracking,
        stopTracking,
        refreshPresence,
        getEditor,
        getEditorColor,
        getEditorListFormatted,
        isUserActive,
        getActiveEditorCount
    }
}
