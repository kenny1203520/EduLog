import * as Y from 'yjs'
import {
    Awareness,
    applyAwarenessUpdate,
    encodeAwarenessUpdate,
    removeAwarenessStates
} from 'y-protocols/awareness'
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import { ApiRealtimeChannel } from './ApiRealtimeChannel'

export const uint8ArrayToBase64 = (u8: Uint8Array): string => {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < u8.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunkSize)))
    }
    return btoa(binary)
}

export const base64ToUint8Array = (base64: string): Uint8Array => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

interface AwarenessChange {
    added: number[]
    updated: number[]
    removed: number[]
}

interface ReportPresencePayload {
    clientId: number
    user?: Record<string, any>
    awarenessUpdateBase64: string
    updatedAt: string
}

export type ReportCollabInitialState = 'none' | 'loaded' | 'legacy' | 'stale' | 'error'
export type ReportCollabConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
export interface ReportCollabActivity {
    field?: string
    focused?: boolean
    caret?: number
    selectionEnd?: number
}
export interface ReportCollabPeer {
    clientId: number
    user?: { name: string; color: string }
    activity?: ReportCollabActivity
}

const REALTIME_READY_TIMEOUT_MS = 10000
const SNAPSHOT_REQUEST_TIMEOUT_MS = 10000
const SNAPSHOT_MAX_ATTEMPTS = 2
const MAX_YJS_UPDATE_BYTES = 256 * 1024
const MAX_SNAPSHOT_BYTES = 1024 * 1024
const MAX_AWARENESS_BYTES = 32 * 1024
function decodeBoundedBase64(value: string, maxBytes: number): Uint8Array {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length > Math.ceil(maxBytes * 4 / 3) + 4) {
        throw new Error('Invalid collaboration payload')
    }
    const decoded = base64ToUint8Array(value)
    if (decoded.byteLength > maxBytes) throw new Error('Collaboration payload exceeds size limit')
    return decoded
}

export interface SupabaseProviderOptions {
    snapshotDebounceMs?: number
    presenceEnabled?: boolean
    onStatus?: (status: ReportCollabConnectionStatus) => void
}

export class SupabaseProvider {
    public awareness: Awareness
    public ready: Promise<void>
    private channel: any
    private isDestroyed = false
    private isSubscribed = false
    private snapshotTimer: ReturnType<typeof setTimeout> | null = null
    private resolveReady!: () => void
    private rejectReady!: (reason?: unknown) => void
    private readyTimer: ReturnType<typeof setTimeout> | null = null
    private awarenessTimer: ReturnType<typeof setTimeout> | null = null
    private awarenessRequest: Promise<void> | null = null
    private awarenessPending = false
    private snapshotPromise: Promise<boolean> | null = null
    private pendingSnapshot: { key: string; state: string; version: number } | null = null
    private lastSnapshotKey: string | null = null
    private readonly remoteClientIds = new Set<number>()
    private readonly docUpdateHandler = (update: Uint8Array, origin: any) => {
        if (origin === this || this.isDestroyed) return

        if (this.isSubscribed && this.isRealtimeConnected()) {
            if (update.byteLength > MAX_YJS_UPDATE_BYTES) {
                this.onStatus?.('error')
                return
            }
            this.channel.send({
                type: 'broadcast',
                event: 'sync-update',
                payload: { update: uint8ArrayToBase64(update) }
            })
        }

        this.scheduleSnapshotSave()
    }
    private readonly awarenessUpdateHandler = (change: AwarenessChange, origin: any) => {
        if (origin === this || this.isDestroyed) return

        const changedLocalState = [...change.added, ...change.updated, ...change.removed].includes(this.awareness.clientID)
        if (changedLocalState) {
            this.queueTrackLocalAwareness()
        }
    }

    private supabase: SupabaseClient
    public doc: Y.Doc
    private roomId: string
    private userId?: string
    private baseReportVersion: number
    private readonly snapshotDebounceMs: number
    private readonly presenceEnabled: boolean
    private readonly onStatus?: (status: ReportCollabConnectionStatus) => void
    public initialState: ReportCollabInitialState = 'none'

    constructor(
        supabase: SupabaseClient,
        doc: Y.Doc,
        roomId: string,
        baseReportVersion: number,
        userId?: string,
        options: SupabaseProviderOptions = {}
    ) {
        this.supabase = supabase
        this.doc = doc
        this.roomId = roomId
        this.baseReportVersion = baseReportVersion
        this.userId = userId
        this.snapshotDebounceMs = Math.max(250, Math.min(30000, options.snapshotDebounceMs ?? 2500))
        this.presenceEnabled = options.presenceEnabled ?? true
        this.onStatus = options.onStatus
        this.awareness = new Awareness(this.doc)
        this.ready = new Promise((resolve, reject) => {
            this.resolveReady = resolve
            this.rejectReady = reject
        })
        this.readyTimer = setTimeout(() => {
            this.failReady(new Error('Realtime collaboration subscription timed out'))
        }, REALTIME_READY_TIMEOUT_MS)

        const presenceKey = `${this.userId || 'anonymous'}:${this.awareness.clientID}`
        this.channel = getApiV1Mode() === 'v1'
            ? new ApiRealtimeChannel(this.roomId, presenceKey)
            : this.supabase.channel(`room:${this.roomId}`, {
                config: {
                    private: true,
                    broadcast: { ack: false },
                    presence: { key: presenceKey }
                }
            })

        this.setupYjs()
        this.setupSupabase()
        this.onStatus?.('connecting')

        this.channel.subscribe(async (status: string) => {
            if (this.isDestroyed) return

            if (status === 'SUBSCRIBED') {
                this.isSubscribed = true
                try {
                    await this.loadInitialState()
                    if (this.presenceEnabled) await this.trackLocalAwareness()
                    this.onStatus?.('connected')
                    if (this.readyTimer) clearTimeout(this.readyTimer)
                    this.readyTimer = null
                    this.resolveReady()
                } catch (error) {
                    this.isSubscribed = false
                    this.onStatus?.('error')
                    this.failReady(error instanceof Error ? error : new Error(String(error)))
                }
            } else {
                this.isSubscribed = false
                const failed = status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'
                this.onStatus?.(failed ? 'error' : 'disconnected')
                if (failed) this.failReady(new Error('Realtime collaboration channel ' + status.toLowerCase()))
            }
        })
    }

    private isRealtimeConnected(): boolean {
        return getApiV1Mode() === 'v1' ? this.isSubscribed : this.supabase.realtime.isConnected()
    }

    private setupYjs() {
        this.doc.on('update', this.docUpdateHandler)
        if (this.presenceEnabled) this.awareness.on('update', this.awarenessUpdateHandler)
    }

    private setupSupabase() {
        this.channel.on('broadcast', { event: 'sync-update' }, (payload: any) => {
            if (this.isDestroyed) return
            const encodedUpdate = payload.payload?.update
            if (typeof encodedUpdate !== 'string') return

            try {
                const update = decodeBoundedBase64(encodedUpdate, MAX_YJS_UPDATE_BYTES)
                Y.applyUpdate(this.doc, update, this)
            } catch (error) {
                console.warn('Rejected invalid collaboration update:', error)
                this.onStatus?.('error')
            }
        })

        if (!this.presenceEnabled) return

        this.channel.on('presence', { event: 'sync' }, () => {
            if (this.isDestroyed) return
            const state = this.channel.presenceState()
            const seenRemoteClientIds = new Set<number>()

            Object.values(state).forEach((presences) => {
                ;(presences as any[]).forEach((presence) => {
                    const payload = presence as Partial<ReportPresencePayload>
                    if (
                        typeof payload.clientId !== 'number' ||
                        payload.clientId === this.awareness.clientID ||
                        typeof payload.awarenessUpdateBase64 !== 'string'
                    ) {
                        return
                    }

                    seenRemoteClientIds.add(payload.clientId)
                    this.remoteClientIds.add(payload.clientId)
                    try {
                        applyAwarenessUpdate(this.awareness, decodeBoundedBase64(payload.awarenessUpdateBase64, MAX_AWARENESS_BYTES), this)
                    } catch (error) {
                        console.warn('Rejected invalid collaboration awareness:', error)
                    }
                })
            })

            const removed = [...this.remoteClientIds].filter((clientId) => !seenRemoteClientIds.has(clientId))
            if (removed.length > 0) {
                removeAwarenessStates(this.awareness, removed, this)
                removed.forEach((clientId) => {
                    this.remoteClientIds.delete(clientId)
                })
            }
        })

        this.channel.on('presence', { event: 'join' }, () => {
            if (!this.isDestroyed) {
                this.queueTrackLocalAwareness()
            }
        })

        this.channel.on('presence', { event: 'leave' }, () => {
            if (!this.isDestroyed) {
                const state = this.channel.presenceState()
                const seenRemoteClientIds = new Set<number>()
                Object.values(state).forEach((presences) => {
                    ;(presences as any[]).forEach((presence) => {
                        const payload = presence as Partial<ReportPresencePayload>
                        if (typeof payload.clientId === 'number' && payload.clientId !== this.awareness.clientID) {
                            seenRemoteClientIds.add(payload.clientId)
                        }
                    })
                })
                const removed = [...this.remoteClientIds].filter((clientId) => !seenRemoteClientIds.has(clientId))
                if (removed.length > 0) {
                    removeAwarenessStates(this.awareness, removed, this)
                    removed.forEach((clientId) => this.remoteClientIds.delete(clientId))
                }
            }
        })
    }

    private async loadInitialState() {
        try {
            if (getApiV1Mode() === 'v1') {
                const response = await apiV1Client.get<{ snapshot_base64: string | null; base_report_version: number | null }>(`/reports/${this.roomId}/collaboration`)
                const data = response.data
                if (!data?.snapshot_base64) { this.initialState = 'none'; return }
                if (data.base_report_version === null || data.base_report_version === undefined) { this.initialState = 'legacy'; return }
                if (Number(data.base_report_version) !== this.baseReportVersion) { this.initialState = 'stale'; return }
                Y.applyUpdate(this.doc, decodeBoundedBase64(data.snapshot_base64, MAX_SNAPSHOT_BYTES), this)
                this.initialState = 'loaded'
                return
            }
            const { data, error } = await this.supabase
                .from('report_collab_docs')
                .select('snapshot_base64, base_report_version')
                .eq('occurrence_report_id', this.roomId)
                .maybeSingle()

            if (error) {
                console.error('loadInitialState db error:', error)
                this.initialState = 'error'
                throw new Error(error.message || 'Failed to load collaboration state')
            }

            if (!data?.snapshot_base64) {
                this.initialState = 'none'
                return
            }

            if (data.base_report_version === null || data.base_report_version === undefined) {
                this.initialState = 'legacy'
                return
            }

            if (Number(data.base_report_version) !== this.baseReportVersion) {
                this.initialState = 'stale'
                return
            }

            if (data.snapshot_base64) {
                const update = decodeBoundedBase64(data.snapshot_base64, MAX_SNAPSHOT_BYTES)
                Y.applyUpdate(this.doc, update, this)
                this.initialState = 'loaded'
            }
        } catch (err) {
            console.error('Failed to load document state:', err)
            this.initialState = 'error'
            throw err
        }
    }

    private failReady(reason: Error): void {
        if (this.isDestroyed) return
        if (this.readyTimer) clearTimeout(this.readyTimer)
        this.readyTimer = null
        this.rejectReady(reason)
    }

    private scheduleSnapshotSave() {
        if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
        this.snapshotTimer = setTimeout(() => {
            this.snapshotTimer = null
            void this.saveSnapshot().catch(err => console.error('Failed to auto-save document:', err))
        }, this.snapshotDebounceMs)
    }

    public async saveSnapshot(): Promise<boolean> {
        if (this.isDestroyed) return false
        const state = uint8ArrayToBase64(Y.encodeStateAsUpdate(this.doc))
        if (state.length > Math.ceil(MAX_SNAPSHOT_BYTES * 4 / 3) + 4) {
            this.onStatus?.('error')
            return false
        }
        const payload = { key: this.baseReportVersion + ':' + state, state, version: this.baseReportVersion }
        if (payload.key === this.lastSnapshotKey) return true
        this.pendingSnapshot = payload
        if (!this.snapshotPromise) this.snapshotPromise = this.flushSnapshots()
        return this.snapshotPromise
    }

    private async flushSnapshots(): Promise<boolean> {
        let result = true
        try {
            while (this.pendingSnapshot && !this.isDestroyed) {
                const payload = this.pendingSnapshot
                this.pendingSnapshot = null
                if (payload.key === this.lastSnapshotKey) continue
                result = await this.persistSnapshot(payload)
                if (result) this.lastSnapshotKey = payload.key
            }
            return result
        } finally {
            this.snapshotPromise = null
            if (this.pendingSnapshot && !this.isDestroyed) {
                this.snapshotPromise = this.flushSnapshots()
            }
        }
    }

    private async persistSnapshot(payload: { key: string; state: string; version: number }): Promise<boolean> {
        if (getApiV1Mode() === 'v1') {
            try {
                const response = await apiV1Client.post<{ saved: boolean }>(`/reports/${this.roomId}/collaboration`, { snapshot_base64: payload.state, base_report_version: payload.version })
                return response.data?.saved === true
            } catch (error) {
                console.error('Failed to save collaboration snapshot through API:', error)
                return false
            }
        }
        for (let attempt = 0; attempt < SNAPSHOT_MAX_ATTEMPTS; attempt += 1) {
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), SNAPSHOT_REQUEST_TIMEOUT_MS)
            try {
                const request: any = this.supabase.rpc('save_report_collab_snapshot', {
                    p_occurrence_report_id: this.roomId,
                    p_snapshot_base64: payload.state,
                    p_base_report_version: payload.version
                })
                const query = typeof request?.abortSignal === 'function' ? request.abortSignal(controller.signal) : request
                const result: any = await Promise.race([
                    query,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('snapshot request timeout')), SNAPSHOT_REQUEST_TIMEOUT_MS))
                ])
                clearTimeout(timeout)
                if (result?.error) {
                    console.error('Failed to save snapshot:', result.error)
                    return false
                }
                return result?.data === true
            } catch (err) {
                clearTimeout(timeout)
                if (attempt + 1 >= SNAPSHOT_MAX_ATTEMPTS) {
                    console.error('saveSnapshot exception:', err)
                    return false
                }
            }
        }
        return false
    }

    /** Advances the canonical version used to guard future snapshot writes. */
    public setBaseReportVersion(version: number) {
        this.baseReportVersion = version
    }

    public get connected(): boolean {
        return this.isSubscribed
    }

    public getActivePeers(): ReportCollabPeer[] {
        return [...this.awareness.getStates().entries()]
            .filter(([clientId]) => clientId !== this.awareness.clientID)
            .map(([clientId, state]) => ({
                clientId,
                user: state.user,
                activity: state.activity
            }))
    }

    private queueTrackLocalAwareness(): void {
        if (this.isDestroyed) return
        this.awarenessPending = true
        if (this.awarenessTimer || this.awarenessRequest) return
        this.awarenessTimer = setTimeout(() => {
            this.awarenessTimer = null
            void this.flushAwareness()
        }, 60)
    }

    private async flushAwareness(): Promise<void> {
        if (this.awarenessRequest) return
        this.awarenessPending = false
        this.awarenessRequest = this.trackLocalAwareness().finally(() => {
            this.awarenessRequest = null
            if (this.awarenessPending && !this.isDestroyed) this.queueTrackLocalAwareness()
        })
        await this.awarenessRequest
    }

    private async trackLocalAwareness() {
        if (this.isDestroyed || !this.isSubscribed || !this.isRealtimeConnected()) return

        const localState = this.awareness.getLocalState()
        if (!localState) {
            await this.channel.untrack()
            return
        }

        const awarenessUpdate = encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])
        if (awarenessUpdate.byteLength > MAX_AWARENESS_BYTES) {
            this.onStatus?.('error')
            return
        }

        await this.channel.track({
            clientId: this.awareness.clientID,
            user: localState.user,
            awarenessUpdateBase64: uint8ArrayToBase64(awarenessUpdate),
            updatedAt: new Date().toISOString()
        } satisfies ReportPresencePayload)
    }

    public async destroy() {
        if (this.isDestroyed) return

        this.isDestroyed = true
        if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
        if (this.awarenessTimer) clearTimeout(this.awarenessTimer)
        this.snapshotTimer = null
        this.awarenessTimer = null
        this.awarenessPending = false
        if (this.readyTimer) clearTimeout(this.readyTimer)
        this.readyTimer = null
        this.resolveReady()
        this.doc.off('update', this.docUpdateHandler)
        if (this.presenceEnabled) this.awareness.off('update', this.awarenessUpdateHandler)
        removeAwarenessStates(this.awareness, [...this.remoteClientIds], this)
        try {
            await this.channel.untrack()
        } catch (err) {
            console.warn('Failed to untrack report collaboration presence:', err)
        }
        try {
            await this.channel.unsubscribe()
        } catch (err) {
            console.warn('Failed to unsubscribe report collaboration channel:', err)
        }
        if (getApiV1Mode() !== 'v1') this.supabase.removeChannel(this.channel as RealtimeChannel)
        this.awareness.destroy()
        this.remoteClientIds.clear()
        this.onStatus?.('disconnected')
    }
}
