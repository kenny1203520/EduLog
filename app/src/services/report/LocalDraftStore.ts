import type { ReportDraftSnapshot } from '@/models/OccurrenceReport'

/**
 * Device-local copy of report edits that have not reached the server yet.
 *
 * Drafts hold student data, so they are kept only while a save is pending:
 * the editor deletes a draft as soon as the server accepts the save, logout
 * wipes the store, and anything older than {@link DRAFT_MAX_AGE_MS} is purged
 * at startup. Every record is keyed by `userId:reportId` and reads are scoped
 * to the caller's user id, so a shared device never shows one teacher's draft
 * to another.
 */
export interface LocalReportDraft {
    key: string
    userId: string
    reportId: string
    /** Server version the edits were made on top of. */
    baseVersion: number
    /** Last server-confirmed state at `baseVersion`, used as the merge base. */
    baseSnapshot: ReportDraftSnapshot
    snapshot: ReportDraftSnapshot
    updatedAt: number
}

export type LocalReportDraftInput = Omit<LocalReportDraft, 'key' | 'userId' | 'reportId' | 'updatedAt'>

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const DB_NAME = 'edulog-report-drafts'
const DB_VERSION = 1
const STORE = 'drafts'

function draftKey(userId: string, reportId: string): string {
    return `${userId}:${reportId}`
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('Failed to read report draft from IndexedDB'))
    })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('Report draft transaction failed'))
        transaction.onabort = () => reject(transaction.error ?? new Error('Report draft transaction was aborted'))
    })
}

export class LocalDraftStore {
    private dbPromise: Promise<IDBDatabase | null> | null = null
    private readonly factory: () => IDBFactory | undefined
    private readonly now: () => number

    constructor(
        factory: () => IDBFactory | undefined = () => (typeof indexedDB === 'undefined' ? undefined : indexedDB),
        now: () => number = () => Date.now()
    ) {
        this.factory = factory
        this.now = now
    }

    /** False when the browser has no IndexedDB (or it failed to open), e.g. some private modes. */
    async isAvailable(): Promise<boolean> {
        return (await this.open()) !== null
    }

    async save(userId: string, reportId: string, draft: LocalReportDraftInput): Promise<boolean> {
        if (!userId || !reportId) return false
        const record: LocalReportDraft = {
            ...draft,
            key: draftKey(userId, reportId),
            userId,
            reportId,
            updatedAt: this.now()
        }
        // Vue proxies and editor documents are not structured-cloneable as-is.
        const plain = JSON.parse(JSON.stringify(record)) as LocalReportDraft
        return this.write(store => store.put(plain))
    }

    async get(userId: string, reportId: string): Promise<LocalReportDraft | null> {
        if (!userId || !reportId) return null
        const db = await this.open()
        if (!db) return null
        try {
            const store = db.transaction(STORE, 'readonly').objectStore(STORE)
            const record = await requestResult(store.get(draftKey(userId, reportId))) as LocalReportDraft | undefined
            if (!record || record.userId !== userId) return null
            if (this.now() - record.updatedAt > DRAFT_MAX_AGE_MS) {
                void this.delete(userId, reportId)
                return null
            }
            return record
        } catch (error) {
            console.warn('Local report draft could not be read', error)
            return null
        }
    }

    async delete(userId: string, reportId: string): Promise<void> {
        if (!userId || !reportId) return
        await this.write(store => store.delete(draftKey(userId, reportId)))
    }

    /** Removes drafts last touched more than `maxAgeMs` ago, for every user. */
    async purgeExpired(maxAgeMs = DRAFT_MAX_AGE_MS): Promise<number> {
        const db = await this.open()
        if (!db) return 0
        const cutoff = this.now() - maxAgeMs
        let removed = 0
        try {
            const transaction = db.transaction(STORE, 'readwrite')
            // Walk the updatedAt index oldest-first and stop at the first fresh draft.
            const request = transaction.objectStore(STORE).index('updatedAt').openCursor()
            request.onsuccess = () => {
                const cursor = request.result
                if (!cursor || (cursor.value as LocalReportDraft).updatedAt >= cutoff) return
                cursor.delete()
                removed += 1
                cursor.continue()
            }
            await transactionDone(transaction)
        } catch (error) {
            console.warn('Expired local report drafts could not be purged', error)
        }
        return removed
    }

    /** Wipes every draft on this device; used on logout. */
    async clearAll(): Promise<void> {
        await this.write(store => store.clear())
    }

    private async write(action: (store: IDBObjectStore) => IDBRequest): Promise<boolean> {
        const db = await this.open()
        if (!db) return false
        try {
            const transaction = db.transaction(STORE, 'readwrite')
            action(transaction.objectStore(STORE))
            await transactionDone(transaction)
            return true
        } catch (error) {
            console.warn('Local report draft could not be written', error)
            return false
        }
    }

    private open(): Promise<IDBDatabase | null> {
        this.dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
            let factory: IDBFactory | undefined
            try {
                factory = this.factory()
            } catch {
                factory = undefined
            }
            if (!factory) {
                resolve(null)
                return
            }
            try {
                const request = factory.open(DB_NAME, DB_VERSION)
                request.onupgradeneeded = () => {
                    const db = request.result
                    if (!db.objectStoreNames.contains(STORE)) {
                        const store = db.createObjectStore(STORE, { keyPath: 'key' })
                        store.createIndex('updatedAt', 'updatedAt')
                    }
                }
                request.onsuccess = () => {
                    const db = request.result
                    // Another tab upgrading the schema must not be blocked by us.
                    db.onversionchange = () => {
                        db.close()
                        this.dbPromise = null
                    }
                    resolve(db)
                }
                request.onerror = () => {
                    console.warn('Local report draft storage is unavailable', request.error)
                    resolve(null)
                }
                request.onblocked = () => resolve(null)
            } catch (error) {
                console.warn('Local report draft storage is unavailable', error)
                resolve(null)
            }
        })
        return this.dbPromise
    }
}

export const localDraftStore = new LocalDraftStore()
