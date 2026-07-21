import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import { computed, isRef, reactive, ref, watch, type Ref } from 'vue'

export interface AutoSaveResult {
    success: boolean
    conflict?: boolean
    newVersion?: number
    serverVersion?: number
    serverReport?: OccurrenceReportDTO | null
    message?: string
}

export type AutoSaveStatus = 'idle' | 'scheduled' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict' | 'disabled'

export interface EditorAutoSaveConfiguration {
    enabled: boolean
    debounceMs: number
    saveOnBlur: boolean
    saveOnSwitch: boolean
    saveOnUnmount: boolean
}

export interface AutoSaveSuccess<TSnapshot, TResult extends AutoSaveResult> {
    snapshot: TSnapshot
    result: TResult
    revision: number
}

type MaybeRef<T> = T | Ref<T>

export interface AutoSaveOptions<TSnapshot, TResult extends AutoSaveResult = AutoSaveResult> {
    enabled?: MaybeRef<boolean>
    debounceMs?: MaybeRef<number>
    saveOnBlur?: MaybeRef<boolean>
    saveOnSwitch?: MaybeRef<boolean>
    saveOnUnmount?: MaybeRef<boolean>
    onSave: (snapshot: TSnapshot) => Promise<TResult>
    onConflict?: (serverReport: OccurrenceReportDTO | null, snapshot: TSnapshot) => void
    onSuccess?: (saved: AutoSaveSuccess<TSnapshot, TResult>) => void | Promise<void>
    onError?: (message: string) => void
}

interface PendingSave<TSnapshot> {
    generation: number
    revision: number
    snapshot: TSnapshot
}

function resolveOption<T>(value: MaybeRef<T> | undefined, fallback: T): T {
    return value === undefined ? fallback : isRef(value) ? value.value : value
}

function clampDebounce(value: number): number {
    return Math.max(250, Math.min(30000, Math.round(Number(value) || 2000)))
}

/** Serializes saves and only acknowledges the immutable snapshot submitted for a revision. */
export function useAutoSave<TSnapshot, TResult extends AutoSaveResult = AutoSaveResult>(
    options: AutoSaveOptions<TSnapshot, TResult>
) {
    const configuration = reactive<EditorAutoSaveConfiguration>({
        enabled: resolveOption(options.enabled, true),
        debounceMs: clampDebounce(resolveOption(options.debounceMs, 2000)),
        saveOnBlur: resolveOption(options.saveOnBlur, false),
        saveOnSwitch: resolveOption(options.saveOnSwitch, true),
        saveOnUnmount: resolveOption(options.saveOnUnmount, true)
    })

    const isSaving = ref(false)
    const isScheduled = ref(false)
    const lastSaved = ref<Date | null>(null)
    const hasUnsavedChanges = ref(false)
    const saveError = ref<string | null>(null)
    const hasConflict = ref(false)
    const currentRevision = ref(0)
    const persistedRevision = ref(0)

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let processingPromise: Promise<void> | null = null
    let pendingSave: PendingSave<TSnapshot> | null = null
    let generation = 0
    let queueBlocked = false
    let drainRequested = false

    const status = computed<AutoSaveStatus>(() => {
        if (hasConflict.value) return 'conflict'
        if (saveError.value) return 'error'
        if (isSaving.value) return 'saving'
        if (!configuration.enabled && hasUnsavedChanges.value) return 'disabled'
        if (isScheduled.value) return 'scheduled'
        if (hasUnsavedChanges.value) return 'dirty'
        if (lastSaved.value) return 'saved'
        return 'idle'
    })

    function clearTimer() {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = null
        isScheduled.value = false
    }

    function enqueue(snapshot: TSnapshot): PendingSave<TSnapshot> {
        const job = { generation, revision: ++currentRevision.value, snapshot }
        pendingSave = job
        hasUnsavedChanges.value = true
        saveError.value = null
        hasConflict.value = false
        return job
    }

    function restoreFailedJob(job: PendingSave<TSnapshot>) {
        if (!pendingSave || pendingSave.revision < job.revision) pendingSave = job
        hasUnsavedChanges.value = true
    }

    async function processQueue(queueGeneration: number): Promise<void> {
        while (
            queueGeneration === generation &&
            pendingSave &&
            pendingSave.generation === queueGeneration &&
            (configuration.enabled || drainRequested)
        ) {
            const job = pendingSave
            pendingSave = null
            isSaving.value = true
            saveError.value = null
            hasConflict.value = false

            let result: TResult
            try {
                result = await options.onSave(job.snapshot)
            } catch (error: any) {
                if (queueGeneration !== generation) return
                const message = error?.message || 'Unknown error during save'
                saveError.value = message
                restoreFailedJob(job)
                queueBlocked = true
                options.onError?.(message)
                return
            }

            if (queueGeneration !== generation) return
            if (result.conflict) {
                restoreFailedJob(job)
                queueBlocked = true
                hasConflict.value = true
                options.onConflict?.(result.serverReport || null, job.snapshot)
                return
            }
            if (!result.success) {
                const message = result.message || 'Failed to save'
                saveError.value = message
                restoreFailedJob(job)
                queueBlocked = true
                options.onError?.(message)
                return
            }

            persistedRevision.value = Math.max(persistedRevision.value, job.revision)
            lastSaved.value = new Date()
            await options.onSuccess?.({ snapshot: job.snapshot, result, revision: job.revision })
            const latestPending = pendingSave as PendingSave<TSnapshot> | null
            hasUnsavedChanges.value = Boolean(
                latestPending && latestPending.generation === generation && latestPending.revision > persistedRevision.value
            )
        }
    }

    function ensureProcessing(): Promise<void> {
        if (queueBlocked) return Promise.resolve()
        if (processingPromise) return processingPromise
        const queueGeneration = generation
        const currentPromise = processQueue(queueGeneration).finally(() => {
            if (processingPromise === currentPromise) processingPromise = null
            if (queueGeneration === generation) isSaving.value = false
        })
        processingPromise = currentPromise
        return currentPromise
    }

    function schedule(): void {
        clearTimer()
        if (!configuration.enabled || queueBlocked || !pendingSave || processingPromise) return
        isScheduled.value = true
        debounceTimer = setTimeout(() => {
            debounceTimer = null
            isScheduled.value = false
            void ensureProcessing()
        }, configuration.debounceMs)
    }

    function triggerAutoSave(snapshot: TSnapshot): number {
        const job = enqueue(snapshot)
        clearTimer()
        if (!processingPromise) schedule()
        return job.revision
    }

    async function saveNow(snapshot?: TSnapshot): Promise<boolean> {
        const targetGeneration = generation
        const target = snapshot === undefined ? pendingSave : enqueue(snapshot)
        const targetRevision = target?.revision ?? persistedRevision.value
        clearTimer()
        queueBlocked = false
        drainRequested = true

        try {
            while (targetGeneration === generation && persistedRevision.value < targetRevision) {
                if (!pendingSave && !processingPromise) break
                await ensureProcessing()
                if (queueBlocked) break
            }
            return targetGeneration === generation && persistedRevision.value >= targetRevision
        } finally {
            drainRequested = false
        }
    }

    function setEnabled(enabled: boolean): void {
        configuration.enabled = enabled
        if (!enabled) clearTimer()
        else if (pendingSave) schedule()
    }

    function configure(updates: Partial<EditorAutoSaveConfiguration>): EditorAutoSaveConfiguration {
        if (updates.debounceMs !== undefined) configuration.debounceMs = clampDebounce(updates.debounceMs)
        if (updates.saveOnBlur !== undefined) configuration.saveOnBlur = updates.saveOnBlur
        if (updates.saveOnSwitch !== undefined) configuration.saveOnSwitch = updates.saveOnSwitch
        if (updates.saveOnUnmount !== undefined) configuration.saveOnUnmount = updates.saveOnUnmount
        if (updates.enabled !== undefined) setEnabled(updates.enabled)
        else if (isScheduled.value) schedule()
        return getConfiguration()
    }

    function getConfiguration(): EditorAutoSaveConfiguration { return { ...configuration } }
    function cancelScheduled() { clearTimer() }
    function cancelAutoSave() { cancelScheduled() }
    function retry(): Promise<boolean> { return saveNow() }

    function reset() {
        clearTimer()
        generation += 1
        currentRevision.value = 0
        persistedRevision.value = 0
        queueBlocked = false
        drainRequested = false
        pendingSave = null
        isSaving.value = false
        lastSaved.value = null
        hasUnsavedChanges.value = false
        saveError.value = null
        hasConflict.value = false
    }

    function getLastSavedString(): string {
        if (!lastSaved.value) return 'Never'
        const seconds = Math.floor((Date.now() - lastSaved.value.getTime()) / 1000)
        const minutes = Math.floor(seconds / 60)
        const hours = Math.floor(minutes / 60)
        if (seconds < 10) return 'Just now'
        if (seconds < 60) return `${seconds}s ago`
        if (minutes < 60) return `${minutes}m ago`
        if (hours < 24) return `${hours}h ago`
        return lastSaved.value.toLocaleString()
    }

    ;(['enabled', 'debounceMs', 'saveOnBlur', 'saveOnSwitch', 'saveOnUnmount'] as const).forEach(key => {
        const source = options[key]
        if (isRef(source)) watch(source, value => configure({ [key]: value } as Partial<EditorAutoSaveConfiguration>))
    })

    return {
        configuration, status, isSaving, isScheduled, lastSaved, hasUnsavedChanges, saveError, hasConflict,
        currentRevision, persistedRevision, saveNow, drain: saveNow, retry, triggerAutoSave,
        setEnabled, configure, getConfiguration, cancelScheduled, cancelAutoSave, reset, getLastSavedString
    }
}

export function debounce<T extends (...args: any[]) => any>(func: T, waitMs: number): (...args: Parameters<T>) => void {
    let timeout: ReturnType<typeof setTimeout> | null = null
    return (...args: Parameters<T>) => {
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => func(...args), waitMs)
    }
}
