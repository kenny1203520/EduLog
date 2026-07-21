import * as Y from 'yjs'
import {
    Awareness,
    applyAwarenessUpdate,
    encodeAwarenessUpdate,
    removeAwarenessStates
} from 'y-protocols/awareness'
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

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

export interface SupabaseProviderOptions {
    snapshotDebounceMs?: number
    presenceEnabled?: boolean
    onStatus?: (status: ReportCollabConnectionStatus) => void
}

export class SupabaseProvider {
    public awareness: Awareness
    public ready: Promise<void>
    private channel: RealtimeChannel
    private isDestroyed = false
    private isSubscribed = false
    private snapshotTimer: ReturnType<typeof setTimeout> | null = null
    private resolveReady!: () => void
    private readonly remoteClientIds = new Set<number>()
    private readonly docUpdateHandler = (update: Uint8Array, origin: any) => {
        if (origin === this || this.isDestroyed) return

        if (this.isSubscribed && this.supabase.realtime.isConnected()) {
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
            void this.trackLocalAwareness()
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
        this.ready = new Promise((resolve) => {
            this.resolveReady = resolve
        })

        this.channel = this.supabase.channel(`room:${this.roomId}`, {
            config: {
                broadcast: { ack: false },
                presence: { key: `${this.userId || 'anonymous'}:${this.awareness.clientID}` }
            }
        })

        this.setupYjs()
        this.setupSupabase()
        this.onStatus?.('connecting')

        this.channel.subscribe(async (status) => {
            if (this.isDestroyed) return

            if (status === 'SUBSCRIBED') {
                this.isSubscribed = true
                await this.loadInitialState()
                if (this.presenceEnabled) await this.trackLocalAwareness()
                this.onStatus?.('connected')
                this.resolveReady()
            } else {
                this.isSubscribed = false
                this.onStatus?.(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : 'disconnected')
            }
        })
    }

    private setupYjs() {
        this.doc.on('update', this.docUpdateHandler)
        if (this.presenceEnabled) this.awareness.on('update', this.awarenessUpdateHandler)
    }

    private setupSupabase() {
        this.channel.on('broadcast', { event: 'sync-update' }, (payload) => {
            if (this.isDestroyed) return
            const encodedUpdate = payload.payload?.update
            if (typeof encodedUpdate !== 'string') return

            const update = base64ToUint8Array(encodedUpdate)
            Y.applyUpdate(this.doc, update, this)
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
                    applyAwarenessUpdate(this.awareness, base64ToUint8Array(payload.awarenessUpdateBase64), this)
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
                void this.trackLocalAwareness()
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
            const { data, error } = await this.supabase
                .from('report_collab_docs')
                .select('snapshot_base64, base_report_version')
                .eq('occurrence_report_id', this.roomId)
                .maybeSingle()

            if (error) {
                console.error('loadInitialState db error:', error)
                this.initialState = 'error'
                return
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
                const update = base64ToUint8Array(data.snapshot_base64)
                Y.applyUpdate(this.doc, update, this)
                this.initialState = 'loaded'
            }
        } catch (err) {
            console.error('Failed to load document state:', err)
            this.initialState = 'error'
        }
    }

    private scheduleSnapshotSave() {
        if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
        this.snapshotTimer = setTimeout(() => {
            this.snapshotTimer = null
            void this.saveSnapshot().catch(err => console.error('Failed to auto-save document:', err))
        }, this.snapshotDebounceMs)
    }

    public async saveSnapshot(): Promise<boolean> {
        try {
            const stateUpdate = Y.encodeStateAsUpdate(this.doc)
            const base64State = uint8ArrayToBase64(stateUpdate)
            
            const { data, error } = await this.supabase.rpc('save_report_collab_snapshot', {
                p_occurrence_report_id: this.roomId,
                p_snapshot_base64: base64State,
                p_base_report_version: this.baseReportVersion
            })
            
            if (error) {
                console.error('Failed to save snapshot:', error)
                return false
            }
            return data === true
        } catch (err) {
            console.error('saveSnapshot exception:', err)
            return false
        }
    }

    /** Advances the canonical version used to guard future snapshot writes. */
    public setBaseReportVersion(version: number) {
        this.baseReportVersion = version
    }

    public get connected(): boolean {
        return this.isSubscribed
    }

    public getActivePeers(): Array<Record<string, any>> {
        return [...this.awareness.getStates().entries()]
            .filter(([clientId]) => clientId !== this.awareness.clientID)
            .map(([, state]) => state.user || state)
    }

    private async trackLocalAwareness() {
        if (this.isDestroyed || !this.isSubscribed || !this.supabase.realtime.isConnected()) return

        const localState = this.awareness.getLocalState()
        if (!localState) {
            await this.channel.untrack()
            return
        }

        await this.channel.track({
            clientId: this.awareness.clientID,
            user: localState.user,
            awarenessUpdateBase64: uint8ArrayToBase64(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])),
            updatedAt: new Date().toISOString()
        } satisfies ReportPresencePayload)
    }

    public async destroy() {
        if (this.isDestroyed) return

        this.isDestroyed = true
        if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
        this.snapshotTimer = null
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
        this.supabase.removeChannel(this.channel)
        this.awareness.destroy()
        this.remoteClientIds.clear()
        this.onStatus?.('disconnected')
    }
}
