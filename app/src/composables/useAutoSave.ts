import { ref } from 'vue'

/**
 * Options for auto-save functionality
 */
export interface AutoSaveOptions {
    /** Debounce delay in milliseconds (default: 2000ms / 2 seconds) */
    debounceMs?: number
    
    /** Callback function to save content, returns save result */
    onSave: (content: string) => Promise<{ success: boolean, conflict?: boolean, newVersion?: number, serverContent?: string }>
    
    /** Callback when a conflict is detected */
    onConflict?: (serverVersion: string) => void
    
    /** Callback after successful save */
    onSuccess?: (newVersion: number) => void
    
    /** Callback on save error */
    onError?: (message: string) => void
}

/**
 * Auto-save composable for real-time content saving
 * Implements debouncing, conflict detection, and status tracking
 * 
 * Usage:
 * ```ts
 * const { isSaving, lastSaved, triggerAutoSave } = useAutoSave({
 *   onSave: async (content) => await ReportService.saveReport(...),
 *   onConflict: (serverVersion) => showConflictModal(serverVersion)
 * })
 * 
 * watch(() => content.value, () => triggerAutoSave(content.value))
 * ```
 */
export function useAutoSave(options: AutoSaveOptions) {
    const {
        debounceMs = 2000,
        onSave,
        onConflict,
        onSuccess,
        onError
    } = options

    // State
    const isSaving = ref(false)
    const lastSaved = ref<Date | null>(null)
    const hasUnsavedChanges = ref(false)
    const saveError = ref<string | null>(null)
    
    // Debounce timer
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    /**
     * Clears the existing debounce timer
     */
    function clearTimer() {
        if (debounceTimer) {
            clearTimeout(debounceTimer)
            debounceTimer = null
        }
    }

    /**
     * Saves content immediately without debouncing
     */
    async function saveNow(content: string): Promise<void> {
        clearTimer()
        
        if (isSaving.value) {
            console.log('Save already in progress, skipping')
            return
        }

        isSaving.value = true
        saveError.value = null

        try {
            const result = await onSave(content)

            if (result.conflict) {
                // Conflict detected
                hasUnsavedChanges.value = true
                if (onConflict) {
                    onConflict(result.serverContent || '')
                }
            } else if (result.success) {
                // Success
                lastSaved.value = new Date()
                hasUnsavedChanges.value = false
                if (onSuccess && result.newVersion) {
                    onSuccess(result.newVersion)
                }
            } else {
                // Error
                const errorMsg = 'Failed to save'
                saveError.value = errorMsg
                hasUnsavedChanges.value = true
                if (onError) {
                    onError(errorMsg)
                }
            }
        } catch (error: any) {
            const errorMsg = error.message || 'Unknown error during save'
            saveError.value = errorMsg
            hasUnsavedChanges.value = true
            if (onError) {
                onError(errorMsg)
            }
        } finally {
            isSaving.value = false
        }
    }

    /**
     * Triggers auto-save with debouncing
     * Waits for debounceMs milliseconds of inactivity before saving
     */
    function triggerAutoSave(content: string): void {
        hasUnsavedChanges.value = true
        clearTimer()

        debounceTimer = setTimeout(() => {
            saveNow(content)
        }, debounceMs)
    }

    /**
     * Cancels pending auto-save
     */
    function cancelAutoSave(): void {
        clearTimer()
    }

    /**
     * Resets the auto-save state (e.g. when switching documents)
     */
    function reset(): void {
        clearTimer()
        isSaving.value = false
        lastSaved.value = null
        hasUnsavedChanges.value = false
        saveError.value = null
    }

    function getLastSavedString(): string {
        if (!lastSaved.value) return 'Never'
        
        const now = new Date()
        const diff = now.getTime() - lastSaved.value.getTime()
        const seconds = Math.floor(diff / 1000)
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)

        if (seconds < 10) return 'Just now'
        if (seconds < 60) return `${seconds}s ago`
        if (minutes < 60) return `${minutes}m ago`
        if (hours < 24) return `${hours}h ago`
        return lastSaved.value.toLocaleString()
    }

    return {
        // State
        isSaving,
        lastSaved,
        hasUnsavedChanges,
        saveError,
        
        // Methods
        saveNow,
        triggerAutoSave,
        cancelAutoSave,
        reset,
        getLastSavedString
    }
}

/**
 * Utility: Creates a debounced function
 * (Alternative implementation if needed elsewhere)
 */
export function debounce<T extends (...args: any[]) => any>(
    func: T,
    waitMs: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null

    return function(...args: Parameters<T>) {
        if (timeout) clearTimeout(timeout)
        
        timeout = setTimeout(() => {
            func(...args)
        }, waitMs)
    }
}
