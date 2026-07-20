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
        expect(onError).toHaveBeenCalledWith('offline')
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
})
