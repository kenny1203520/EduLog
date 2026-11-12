import { getCurrentScope, onScopeDispose, ref } from 'vue'
import type { ReportDraftSnapshot } from '@/models/OccurrenceReport'
import { reportLessonEntriesEqual } from '@/models/ReportEditorSnapshot'
import { localDraftStore, type LocalDraftStore, type LocalReportDraft, type LocalReportDraftInput } from '@/services/report/LocalDraftStore'

/**
 * What to do with a device-local draft found when a report opens:
 * - `discard`: it matches the server already, nothing was lost
 * - `none`: the editor already shows it (e.g. recovered from the collab doc)
 * - `restore`: same base version as the server, offer to put it back
 * - `merge`: someone saved the report since, merge through the conflict flow
 */
export type DraftRecoveryAction = 'discard' | 'none' | 'restore' | 'merge'

function sameSnapshot(a: ReportDraftSnapshot, b: ReportDraftSnapshot): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ReportDraftSnapshot>
    for (const key of keys) {
        if (key === 'lessonEntries') {
            if (!reportLessonEntriesEqual(a.lessonEntries, b.lessonEntries)) return false
            continue
        }
        if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) return false
    }
    return true
}

export function classifyDraftRecovery(
    draft: Pick<LocalReportDraft, 'baseVersion' | 'snapshot'>,
    server: { version: number | undefined; snapshot: ReportDraftSnapshot },
    current: ReportDraftSnapshot
): DraftRecoveryAction {
    if (sameSnapshot(draft.snapshot, server.snapshot)) return 'discard'
    if (sameSnapshot(draft.snapshot, current)) return 'none'
    return draft.baseVersion === server.version ? 'restore' : 'merge'
}

/**
 * The draft's own edits (fields it changed relative to its base) laid over the
 * current server state; fields only the server changed keep the server value.
 */
export function mergeDraftOntoServer(
    draft: Pick<LocalReportDraft, 'baseSnapshot' | 'snapshot'>,
    server: ReportDraftSnapshot
): ReportDraftSnapshot {
    const merged = { ...server } as Record<keyof ReportDraftSnapshot, unknown>
    for (const key of Object.keys(draft.snapshot) as Array<keyof ReportDraftSnapshot>) {
        const changed = key === 'lessonEntries'
            ? !reportLessonEntriesEqual(draft.snapshot.lessonEntries, draft.baseSnapshot?.lessonEntries)
            : JSON.stringify(draft.snapshot[key] ?? null) !== JSON.stringify(draft.baseSnapshot?.[key] ?? null)
        if (changed) {
            merged[key] = draft.snapshot[key]
        }
    }
    return merged as unknown as ReportDraftSnapshot
}

export interface ReportLocalDraftOptions {
    userId: () => string | undefined
    store?: LocalDraftStore
    debounceMs?: number
}

/** Debounced, user-scoped persistence of unsaved report edits to this device. */
export function useReportLocalDraft(options: ReportLocalDraftOptions) {
    const store = options.store ?? localDraftStore
    const debounceMs = options.debounceMs ?? 800
    /** True once the latest unsaved edits are on disk. */
    const persisted = ref(false)

    let timer: ReturnType<typeof setTimeout> | null = null
    let pending: { reportId: string; draft: LocalReportDraftInput } | null = null
    let writeChain: Promise<unknown> = Promise.resolve()

    function enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const next = writeChain.then(operation, operation)
        writeChain = next.catch(() => undefined)
        return next
    }

    function clearTimer() {
        if (timer) clearTimeout(timer)
        timer = null
    }

    function schedule(reportId: string, draft: LocalReportDraftInput): void {
        if (!reportId || !options.userId()) return
        pending = { reportId, draft }
        persisted.value = false
        clearTimer()
        timer = setTimeout(() => { void flush() }, debounceMs)
    }

    function flush(): Promise<boolean> {
        clearTimer()
        const job = pending
        const userId = options.userId()
        pending = null
        if (!job || !userId) return Promise.resolve(false)
        return enqueue(async () => {
            const saved = await store.save(userId, job.reportId, job.draft)
            // A newer edit may have been scheduled while this one was writing.
            if (!pending) persisted.value = saved
            return saved
        })
    }

    /** Drops any pending write and deletes the stored draft for this report. */
    function discard(reportId: string | undefined): Promise<void> {
        if (pending && (!reportId || pending.reportId === reportId)) {
            clearTimer()
            pending = null
        }
        persisted.value = false
        const userId = options.userId()
        if (!reportId || !userId) return Promise.resolve()
        return enqueue(() => store.delete(userId, reportId))
    }

    function load(reportId: string | undefined): Promise<LocalReportDraft | null> {
        const userId = options.userId()
        if (!reportId || !userId) return Promise.resolve(null)
        return enqueue(() => store.get(userId, reportId))
    }

    if (getCurrentScope()) onScopeDispose(() => { void flush() })

    return { persisted, schedule, flush, discard, load }
}
