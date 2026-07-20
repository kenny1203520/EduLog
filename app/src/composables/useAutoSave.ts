import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { ref } from 'vue'

export interface AutoSaveResult {
    success: boolean
    conflict?: boolean
    newVersion?: number
    serverVersion?: number
    serverReport?: OccurrenceReportDTO | null
    message?: string
}

export interface AutoSaveSuccess<TSnapshot, TResult extends AutoSaveResult> {
    snapshot: TSnapshot
    result: TResult
    revision: number
}

export interface AutoSaveOptions<TSnapshot, TResult extends AutoSaveResult = AutoSaveResult> {
    /** Delay after the latest edit before starting a save. */
    debounceMs?: number
    /** Persists the exact immutable snapshot associated with a revision. */
    onSave: (snapshot: TSnapshot) => Promise<TResult>
    /** Called when optimistic locking reports a conflict. */
    onConflict?: (serverReport: OccurrenceReportDTO | null, snapshot: TSnapshot) => void
    /** Called only for the exact snapshot that completed successfully. */
    onSuccess?: (saved: AutoSaveSuccess<TSnapshot, TResult>) => void | Promise<void>
    /** Called when a save fails without a conflict. */
    onError?: (message: string) => void
}

interface PendingSave<TSnapshot> {
    generation: number
    revision: number
    snapshot: TSnapshot
}

/**
 * Serializes auto-save requests and coalesces edits to the latest pending snapshot.
 * A successful request may only acknowledge the snapshot it actually submitted.
 */
export function useAutoSave<TSnapshot, TResult extends AutoSaveResult = AutoSaveResult>(
    options: AutoSaveOptions<TSnapshot, TResult>
) {
    const {
        debounceMs = 2000,
        onSave,
        onConflict,
        onSuccess,
        onError
    } = options

    const isSaving = ref(false)
    const lastSaved = ref<Date | null>(null)
    const hasUnsavedChanges = ref(false)
    const saveError = ref<string | null>(null)

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let processingPromise: Promise<void> | null = null
    let pendingSave: PendingSave<TSnapshot> | null = null
    let generation = 0
    let revision = 0
    let persistedRevision = 0
    let queueBlocked = false

    function clearTimer() {
        if (debounceTimer) {
            clearTimeout(debounceTimer)
            debounceTimer = null
        }
    }

    function enqueue(snapshot: TSnapshot): PendingSave<TSnapshot> {
        const job = {
            generation,
            revision: ++revision,
            snapshot
        }
        pendingSave = job
        hasUnsavedChanges.value = true
        saveError.value = null
        return job
    }

    function restoreFailedJob(job: PendingSave<TSnapshot>) {
        if (!pendingSave || pendingSave.revision < job.revision) {
            pendingSave = job
        }
        hasUnsavedChanges.value = true
    }

    async function processQueue(queueGeneration: number): Promise<void> {
        while (
            queueGeneration === generation &&
            pendingSave &&
            pendingSave.generation === queueGeneration
        ) {
            const job = pendingSave
            pendingSave = null
            isSaving.value = true
            saveError.value = null

            let result: TResult
            try {
                result = await onSave(job.snapshot)
            } catch (error: any) {
                if (queueGeneration !== generation) return
                const message = error?.message || 'Unknown error during save'
                saveError.value = message
                restoreFailedJob(job)
                queueBlocked = true
                onError?.(message)
                return
            }

            if (queueGeneration !== generation) return

            if (result.conflict) {
                restoreFailedJob(job)
                queueBlocked = true
                onConflict?.(result.serverReport || null, job.snapshot)
                return
            }

            if (!result.success) {
                const message = result.message || 'Failed to save'
                saveError.value = message
                restoreFailedJob(job)
                queueBlocked = true
                onError?.(message)
                return
            }

            persistedRevision = Math.max(persistedRevision, job.revision)
            lastSaved.value = new Date()
            await onSuccess?.({ snapshot: job.snapshot, result, revision: job.revision })

            // New input may have arrived while this request was in flight. Only the
            // submitted revision is acknowledged; the latest pending revision remains dirty.
            const latestPending = pendingSave as PendingSave<TSnapshot> | null
            hasUnsavedChanges.value = Boolean(
                latestPending &&
                latestPending.generation === generation &&
                latestPending.revision > persistedRevision
            )
        }
    }

    function ensureProcessing(): Promise<void> {
        if (queueBlocked) return Promise.resolve()
        if (processingPromise) return processingPromise

        const queueGeneration = generation
        const currentPromise = processQueue(queueGeneration).finally(() => {
            if (processingPromise === currentPromise) {
                processingPromise = null
            }
            if (queueGeneration === generation) {
                isSaving.value = false
            }
        })
        processingPromise = currentPromise
        return currentPromise
    }

    /** Queues a snapshot after the configured inactivity delay. */
    function triggerAutoSave(snapshot: TSnapshot): number {
        const job = enqueue(snapshot)
        clearTimer()

        if (processingPromise) {
            // The active request will immediately continue with the latest coalesced snapshot.
            return job.revision
        }

        if (queueBlocked) {
            return job.revision
        }

        debounceTimer = setTimeout(() => {
            debounceTimer = null
            void ensureProcessing()
        }, debounceMs)
        return job.revision
    }

    /**
     * Immediately queues and drains the latest snapshot. Returns false when the target
     * revision is still dirty because of an error, conflict, or document reset.
     */
    async function saveNow(snapshot?: TSnapshot): Promise<boolean> {
        const targetGeneration = generation
        const target = snapshot === undefined ? pendingSave : enqueue(snapshot)
        const targetRevision = target?.revision ?? persistedRevision
        clearTimer()
        queueBlocked = false

        while (targetGeneration === generation && persistedRevision < targetRevision) {
            if (!pendingSave && !processingPromise) break
            await ensureProcessing()
            if (queueBlocked) break
        }

        return targetGeneration === generation && persistedRevision >= targetRevision
    }

    function cancelAutoSave() {
        clearTimer()
    }

    /** Invalidates every queued/in-flight callback from the previous document. */
    function reset() {
        clearTimer()
        generation += 1
        revision = 0
        persistedRevision = 0
        queueBlocked = false
        pendingSave = null
        isSaving.value = false
        lastSaved.value = null
        hasUnsavedChanges.value = false
        saveError.value = null
    }

    function getLastSavedString(): string {
        if (!lastSaved.value) return 'Never'

        const diff = Date.now() - lastSaved.value.getTime()
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
        isSaving,
        lastSaved,
        hasUnsavedChanges,
        saveError,
        saveNow,
        triggerAutoSave,
        cancelAutoSave,
        reset,
        getLastSavedString
    }
}

export function debounce<T extends (...args: any[]) => any>(
    func: T,
    waitMs: number
): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null

    return (...args: Parameters<T>) => {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => func(...args), waitMs)
    }
}
