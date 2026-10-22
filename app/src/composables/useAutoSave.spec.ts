import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAutoSave, type AutoSaveResult } from './useAutoSave'

interface Snapshot {
    content: string
}

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
    })
    return { promise, resolve, reject }
}

afterEach(() => {
    vi.useRealTimers()
})

describe('useAutoSave', () => {
    it('keeps edits dirty while disabled and allows a manual drain', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn().mockResolvedValue({ success: true })
        const autoSave = useAutoSave<Snapshot>({ enabled: false, debounceMs: 500, onSave })

        autoSave.triggerAutoSave({ content: 'manual only' })
        await vi.advanceTimersByTimeAsync(1000)
        expect(onSave).not.toHaveBeenCalled()
        expect(autoSave.status.value).toBe('disabled')
        expect(autoSave.hasUnsavedChanges.value).toBe(true)

        await expect(autoSave.drain()).resolves.toBe(true)
        expect(onSave).toHaveBeenCalledWith({ content: 'manual only' })
        expect(autoSave.hasUnsavedChanges.value).toBe(false)
    })

    it('reschedules a pending revision when runtime debounce configuration changes', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn().mockResolvedValue({ success: true })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 2000, onSave })
        autoSave.triggerAutoSave({ content: 'configured' })
        autoSave.configure({ debounceMs: 500 })

        await vi.advanceTimersByTimeAsync(499)
        expect(onSave).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        expect(onSave).toHaveBeenCalledTimes(1)
        expect(autoSave.getConfiguration().debounceMs).toBe(500)
    })

    it('persists an edit made while an older snapshot is still saving', async () => {
        vi.useFakeTimers()
        const firstSave = deferred<AutoSaveResult>()
        const onSave = vi.fn()
            .mockImplementationOnce(() => firstSave.promise)
            .mockResolvedValueOnce({ success: true, newVersion: 3 })
        const saved: string[] = []
        const autoSave = useAutoSave<Snapshot>({
            debounceMs: 2000,
            onSave,
            onSuccess: ({ snapshot }) => {
                saved.push(snapshot.content)
            }
        })

        autoSave.triggerAutoSave({ content: 'A' })
        await vi.advanceTimersByTimeAsync(2000)
        expect(onSave).toHaveBeenCalledWith({ content: 'A' })
        expect(autoSave.isSaving.value).toBe(true)

        autoSave.triggerAutoSave({ content: 'B' })
        expect(autoSave.hasUnsavedChanges.value).toBe(true)
        const drained = autoSave.saveNow()
        firstSave.resolve({ success: true, newVersion: 2 })

        await expect(drained).resolves.toBe(true)
        expect(onSave.mock.calls.map(([snapshot]) => snapshot.content)).toEqual(['A', 'B'])
        expect(saved).toEqual(['A', 'B'])
        expect(autoSave.hasUnsavedChanges.value).toBe(false)
    })

    it('coalesces rapid edits to the newest snapshot before the debounce expires', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn().mockResolvedValue({ success: true, newVersion: 2 })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 2000, onSave })

        autoSave.triggerAutoSave({ content: 'A' })
        autoSave.triggerAutoSave({ content: 'B' })
        autoSave.triggerAutoSave({ content: 'C' })

        await vi.advanceTimersByTimeAsync(1999)
        expect(onSave).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)

        expect(onSave).toHaveBeenCalledTimes(1)
        expect(onSave).toHaveBeenCalledWith({ content: 'C' })
        expect(autoSave.hasUnsavedChanges.value).toBe(false)
    })

    it('keeps a failed snapshot dirty and retries it during a manual drain', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn()
            .mockResolvedValueOnce({ success: false, message: 'offline' })
            .mockResolvedValueOnce({ success: true, newVersion: 2 })
        const onError = vi.fn()
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 2000, onSave, onError })

        autoSave.triggerAutoSave({ content: 'retry me' })
        await vi.advanceTimersByTimeAsync(2000)

        expect(autoSave.hasUnsavedChanges.value).toBe(true)
        expect(autoSave.saveError.value).toBe('offline')
        // onError also receives the failed TResult (e.g. for a messageKey the
        // UI can translate) alongside the plain message string.
        expect(onError).toHaveBeenCalledWith('offline', { success: false, message: 'offline' }, { revision: 1 })
        await expect(autoSave.saveNow()).resolves.toBe(true)
        expect(onSave).toHaveBeenCalledTimes(2)
        expect(autoSave.hasUnsavedChanges.value).toBe(false)
    })

    it('returns false instead of repeatedly retrying a failed manual drain', async () => {
        const onSave = vi.fn().mockResolvedValue({ success: false, message: 'still offline' })
        const autoSave = useAutoSave<Snapshot>({ onSave })

        autoSave.triggerAutoSave({ content: 'pending' })

        await expect(autoSave.saveNow()).resolves.toBe(false)
        expect(onSave).toHaveBeenCalledTimes(1)
        expect(autoSave.hasUnsavedChanges.value).toBe(true)
    })

    it('keeps conflicts dirty and reports the exact conflicting snapshot', async () => {
        vi.useFakeTimers()
        const serverReport = {
            id: 'report-1',
            enrollment_id: 'enrollment-1',
            class_occurrence_id: 'occurrence-1',
            content: 'server',
            version: 5
        }
        const onConflict = vi.fn()
        const autoSave = useAutoSave<Snapshot>({
            debounceMs: 2000,
            onSave: async () => ({ success: false, conflict: true, serverReport }),
            onConflict
        })
        const snapshot = { content: 'local' }

        autoSave.triggerAutoSave(snapshot)
        await vi.advanceTimersByTimeAsync(2000)

        expect(autoSave.hasUnsavedChanges.value).toBe(true)
        expect(onConflict).toHaveBeenCalledWith(serverReport, snapshot)
    })

    it('ignores completion callbacks from a reset document generation', async () => {
        vi.useFakeTimers()
        const oldSave = deferred<AutoSaveResult>()
        const onSave = vi.fn()
            .mockImplementationOnce(() => oldSave.promise)
            .mockResolvedValueOnce({ success: true, newVersion: 2 })
        const saved: string[] = []
        const autoSave = useAutoSave<Snapshot>({
            debounceMs: 2000,
            onSave,
            onSuccess: ({ snapshot }) => {
                saved.push(snapshot.content)
            }
        })

        autoSave.triggerAutoSave({ content: 'old report' })
        await vi.advanceTimersByTimeAsync(2000)
        autoSave.reset()
        autoSave.triggerAutoSave({ content: 'new report' })
        const drained = autoSave.saveNow()
        oldSave.resolve({ success: true, newVersion: 99 })

        await expect(drained).resolves.toBe(true)
        expect(saved).toEqual(['new report'])
        expect(autoSave.hasUnsavedChanges.value).toBe(false)
    })

    it('re-arms the debounced queue on new input after a failed save instead of stalling forever', async () => {
        // Regression: enqueue() used to clear saveError/hasConflict but leave
        // queueBlocked set after a failure, so schedule() kept early-returning on
        // every subsequent edit and status silently read back as 'dirty' -- the
        // user would keep typing into a queue that would never debounce-save
        // again without an explicit saveNow()/retry() call. This covers the
        // automatic-debounce path; the sibling test above already covers the
        // manual-drain retry path.
        vi.useFakeTimers()
        let callCount = 0
        const onSave = vi.fn(async (): Promise<AutoSaveResult> => {
            callCount += 1
            if (callCount === 1) return { success: false, message: 'network error' }
            return { success: true, newVersion: callCount }
        })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 2000, onSave })

        autoSave.triggerAutoSave({ content: 'first' })
        await vi.advanceTimersByTimeAsync(2000)
        expect(onSave).toHaveBeenCalledTimes(1)
        expect(autoSave.saveError.value).toBe('network error')
        expect(autoSave.status.value).toBe('error')

        // New input after the failure must clear the block and reschedule --
        // without any explicit retry()/saveNow() call from the caller.
        autoSave.triggerAutoSave({ content: 'second' })
        expect(autoSave.status.value).not.toBe('error')

        await vi.advanceTimersByTimeAsync(2000)
        expect(onSave).toHaveBeenCalledTimes(2)
        expect(autoSave.saveError.value).toBeNull()
        expect(autoSave.status.value).toBe('saved')
    })

    it('does not spin retrying on its own while blocked and no new input arrives', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn().mockResolvedValue({ success: false, message: 'boom' })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 2000, onSave })

        autoSave.triggerAutoSave({ content: 'a' })
        await vi.advanceTimersByTimeAsync(2000)
        expect(onSave).toHaveBeenCalledTimes(1)

        // No new input: advancing time must not trigger further saves on its own.
        await vi.advanceTimersByTimeAsync(60000)
        expect(onSave).toHaveBeenCalledTimes(1)
    })
})

describe('useAutoSave network retry', () => {
    it('retries network failures with 5/10/30/60 s backoff until the save succeeds', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn()
            .mockResolvedValueOnce({ success: false, errorCode: 'network_error', message: 'Network offline' })
            .mockResolvedValueOnce({ success: false, errorCode: 'network_error', message: 'Network offline' })
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce({ success: true, newVersion: 2 })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 500, onSave })

        autoSave.triggerAutoSave({ content: 'offline edit' })
        await vi.advanceTimersByTimeAsync(500)
        expect(onSave).toHaveBeenCalledTimes(1)
        expect(autoSave.errorKind.value).toBe('network')
        expect(autoSave.status.value).toBe('error')

        await vi.advanceTimersByTimeAsync(4999)
        expect(onSave).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(onSave).toHaveBeenCalledTimes(2)

        await vi.advanceTimersByTimeAsync(10000)
        expect(onSave).toHaveBeenCalledTimes(3)

        await vi.advanceTimersByTimeAsync(30000)
        expect(onSave).toHaveBeenCalledTimes(4)
        expect(onSave).toHaveBeenLastCalledWith({ content: 'offline edit' })
        expect(autoSave.status.value).toBe('saved')
        expect(autoSave.errorKind.value).toBeNull()

        await vi.advanceTimersByTimeAsync(120000)
        expect(onSave).toHaveBeenCalledTimes(4)
        autoSave.dispose()
    })

    it('keeps retrying every 60 s after the schedule is exhausted', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn().mockResolvedValue({ success: false, errorCode: 'request_timeout', message: 'timed out' })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 500, onSave })
        autoSave.triggerAutoSave({ content: 'x' })
        await vi.advanceTimersByTimeAsync(500 + 5000 + 10000 + 30000 + 60000)
        expect(onSave).toHaveBeenCalledTimes(5)
        await vi.advanceTimersByTimeAsync(60000)
        expect(onSave).toHaveBeenCalledTimes(6)
        autoSave.dispose()
    })

    it('resends immediately when the browser comes back online', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn()
            .mockResolvedValueOnce({ success: false, errorCode: 'network_error', message: 'Network offline' })
            .mockResolvedValueOnce({ success: true, newVersion: 2 })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 500, onSave })

        autoSave.triggerAutoSave({ content: 'queued' })
        await vi.advanceTimersByTimeAsync(500)
        window.dispatchEvent(new Event('offline'))
        expect(autoSave.isOnline.value).toBe(false)

        window.dispatchEvent(new Event('online'))
        await vi.advanceTimersByTimeAsync(0)
        expect(onSave).toHaveBeenCalledTimes(2)
        expect(autoSave.isOnline.value).toBe(true)
        expect(autoSave.status.value).toBe('saved')
        expect(autoSave.nextRetryAt.value).toBeNull()
        autoSave.dispose()
    })

    it('does not retry version conflicts or permission errors on its own', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn()
            .mockResolvedValueOnce({ success: false, conflict: true, serverReport: null })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 500, onSave })
        autoSave.triggerAutoSave({ content: 'a' })
        await vi.advanceTimersByTimeAsync(500)
        window.dispatchEvent(new Event('online'))
        await vi.advanceTimersByTimeAsync(120000)
        expect(onSave).toHaveBeenCalledTimes(1)
        expect(autoSave.status.value).toBe('conflict')
        autoSave.dispose()

        const denied = vi.fn().mockResolvedValue({ success: false, errorCode: 'permission_denied', message: 'denied' })
        const second = useAutoSave<Snapshot>({ debounceMs: 500, onSave: denied })
        second.triggerAutoSave({ content: 'b' })
        await vi.advanceTimersByTimeAsync(120000)
        expect(denied).toHaveBeenCalledTimes(1)
        expect(second.errorKind.value).toBe('other')
        second.dispose()
    })

    it('stops listening and retrying once disposed', async () => {
        vi.useFakeTimers()
        const onSave = vi.fn().mockResolvedValue({ success: false, errorCode: 'network_error', message: 'Network offline' })
        const autoSave = useAutoSave<Snapshot>({ debounceMs: 500, onSave })
        autoSave.triggerAutoSave({ content: 'a' })
        await vi.advanceTimersByTimeAsync(500)
        autoSave.dispose()
        window.dispatchEvent(new Event('online'))
        await vi.advanceTimersByTimeAsync(120000)
        expect(onSave).toHaveBeenCalledTimes(1)
    })
})

describe('isNetworkSaveFailure', () => {
    it('classifies transient failures only', async () => {
        const { isNetworkSaveFailure } = await import('./useAutoSave')
        expect(isNetworkSaveFailure('Network offline')).toBe(true)
        expect(isNetworkSaveFailure('Failed to fetch')).toBe(true)
        expect(isNetworkSaveFailure('API request failed with status 503')).toBe(true)
        expect(isNetworkSaveFailure('x', { success: false, errorCode: 'save_outcome_unknown' })).toBe(true)
        expect(isNetworkSaveFailure('x', { success: false, errorCode: 'validation_error' })).toBe(false)
        expect(isNetworkSaveFailure('x', { success: false, conflict: true })).toBe(false)
        expect(isNetworkSaveFailure('boom')).toBe(false)
    })
})
