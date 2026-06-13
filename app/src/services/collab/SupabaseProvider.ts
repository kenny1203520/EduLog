import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import {
    Awareness,
    applyAwarenessUpdate,
    encodeAwarenessUpdate,
    removeAwarenessStates
} from 'y-protocols/awareness'

export interface CollaborativeUser {
    id: string
    name: string
    color: string
}

export interface OnlineUser extends CollaborativeUser {
    clientId: number
    lastSeenAt: string
}

export type ProviderStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface SupabaseProviderOptions {
    supabase: SupabaseClient
    doc: Y.Doc
    roomId: string
    user: CollaborativeUser
    debounceMs?: number
    tableName?: string
    channelName?: string
}

interface AwarenessChange {
    added: number[]
    updated: number[]
    removed: number[]
}

interface SupabasePresencePayload {
    clientId: number
    user: CollaborativeUser
    awarenessUpdateBase64: string
    updatedAt: string
}

type StatusListener = (status: ProviderStatus) => void
type UsersListener = (users: OnlineUser[]) => void

export const uint8ArrayToBase64 = (u8: Uint8Array): string => {
    let binary = ''
    const chunkSize = 0x8000

    for (let i = 0; i < u8.length; i += chunkSize) {
        const chunk = u8.subarray(i, i + chunkSize)
        binary += String.fromCharCode(...chunk)
    }

    return btoa(binary)
}

export const base64ToUint8Array = (base64: string): Uint8Array => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i)
    }

    return bytes
}

export class SupabaseProvider {
    public readonly awareness: Awareness
    public readonly doc: Y.Doc

    private readonly supabase: SupabaseClient
    private readonly roomId: string
    private readonly tableName: string
    private readonly channelName: string
    private readonly debounceMs: number
    private user: CollaborativeUser

    private channel: RealtimeChannel | null = null
    private status: ProviderStatus = 'idle'
    private destroyed = false
    private subscribed = false
    private saveTimer: ReturnType<typeof setTimeout> | null = null
    private readonly remoteClientIds = new Set<number>()
    private readonly lastSeenByClientId = new Map<number, string>()
    private readonly statusListeners = new Set<StatusListener>()
    private readonly usersListeners = new Set<UsersListener>()

    constructor(options: SupabaseProviderOptions) {
        this.supabase = options.supabase
        this.doc = options.doc
        this.roomId = options.roomId
        this.user = options.user
        this.debounceMs = options.debounceMs ?? 2500
        this.tableName = options.tableName ?? 'documents'
        this.channelName = options.channelName ?? `collab:${this.roomId}`
        this.awareness = new Awareness(this.doc)
        this.awareness.setLocalStateField('user', this.user)

        this.doc.on('update', this.handleDocUpdate)
        this.awareness.on('update', this.handleAwarenessUpdate)
    }

    public connect(): void {
        if (this.destroyed || this.channel) return

        this.setStatus('connecting')

        const channel = this.supabase.channel(this.channelName, {
            config: {
                broadcast: { ack: false, self: false },
                presence: { key: `${this.user.id}:${this.doc.clientID}` }
            }
        })

        channel.on('broadcast', { event: 'yjs-update' }, this.handleBroadcastUpdate)
        channel.on('presence', { event: 'sync' }, this.handlePresenceSync)
        channel.on('presence', { event: 'join' }, this.handlePresenceSync)
        channel.on('presence', { event: 'leave' }, this.handlePresenceSync)

        this.channel = channel

        channel.subscribe((status) => {
            if (this.destroyed) return

            if (status === 'SUBSCRIBED') {
                this.subscribed = true
                void this.handleSubscribed()
                return
            }

            this.subscribed = false

            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                this.setStatus('error')
                return
            }

            if (status === 'CLOSED') {
                this.setStatus('disconnected')
            }
        })
    }

    public async disconnect(): Promise<void> {
        this.clearSaveTimer()

        if (!this.channel) {
            this.subscribed = false
            this.setStatus('disconnected')
            return
        }

        const channel = this.channel
        this.channel = null
        this.subscribed = false

        try {
            await channel.untrack()
        } catch (error) {
            console.warn('Failed to untrack collaboration presence:', error)
        }

        try {
            await channel.unsubscribe()
        } catch (error) {
            console.warn('Failed to unsubscribe collaboration channel:', error)
        }

        this.supabase.removeChannel(channel)
        this.removeRemoteAwarenessStates()
        this.setStatus('disconnected')
    }

    public async destroy(): Promise<void> {
        if (this.destroyed) return

        this.destroyed = true
        this.doc.off('update', this.handleDocUpdate)
        this.awareness.off('update', this.handleAwarenessUpdate)

        this.clearSaveTimer()
        await this.saveSnapshot()
        await this.disconnect()

        this.awareness.destroy()
        this.statusListeners.clear()
        this.usersListeners.clear()
        this.remoteClientIds.clear()
        this.lastSeenByClientId.clear()
    }

    public async saveSnapshot(): Promise<boolean> {
        if (!this.roomId) return false

        try {
            const content = uint8ArrayToBase64(Y.encodeStateAsUpdate(this.doc))
            const { error } = await this.supabase
                .from(this.tableName)
                .upsert(
                    {
                        room_id: this.roomId,
                        content,
                        updated_by: this.user.id
                    },
                    { onConflict: 'room_id' }
                )

            if (error) {
                console.error('Failed to save collaborative document snapshot:', error)
                return false
            }

            return true
        } catch (error) {
            console.error('Unexpected collaborative document snapshot error:', error)
            return false
        }
    }

    public updateUser(user: CollaborativeUser): void {
        this.user = user
        this.awareness.setLocalStateField('user', user)
        void this.trackLocalAwareness()
        this.emitUsersChange()
    }

    public onStatusChange(listener: StatusListener): () => void {
        this.statusListeners.add(listener)
        listener(this.status)

        return () => {
            this.statusListeners.delete(listener)
        }
    }

    public onUsersChange(listener: UsersListener): () => void {
        this.usersListeners.add(listener)
        listener(this.getOnlineUsers())

        return () => {
            this.usersListeners.delete(listener)
        }
    }

    private readonly handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
        if (this.destroyed || origin === this) return

        if (this.subscribed && this.channel) {
            void this.channel.send({
                type: 'broadcast',
                event: 'yjs-update',
                payload: {
                    update: uint8ArrayToBase64(update)
                }
            })
        }

        this.scheduleSave()
    }

    private readonly handleAwarenessUpdate = (changes: AwarenessChange, origin: unknown): void => {
        if (this.destroyed || origin === this) return

        const localClientId = this.awareness.clientID
        const changedLocalState = [...changes.added, ...changes.updated, ...changes.removed].includes(localClientId)

        if (changedLocalState) {
            void this.trackLocalAwareness()
        }

        this.emitUsersChange()
    }

    private readonly handleBroadcastUpdate = (message: { payload?: unknown }): void => {
        if (this.destroyed) return

        const payload = message.payload as { update?: unknown } | undefined

        if (typeof payload?.update !== 'string') return

        try {
            Y.applyUpdate(this.doc, base64ToUint8Array(payload.update), this)
        } catch (error) {
            console.error('Failed to apply remote Yjs update:', error)
        }
    }

    private readonly handlePresenceSync = (): void => {
        if (this.destroyed || !this.channel) return

        const presenceState = this.channel.presenceState()
        const seenRemoteClientIds = new Set<number>()

        Object.values(presenceState).forEach((presences) => {
            presences.forEach((presence) => {
                const payload = presence as Partial<SupabasePresencePayload>

                if (
                    typeof payload.clientId !== 'number' ||
                    payload.clientId === this.awareness.clientID ||
                    typeof payload.awarenessUpdateBase64 !== 'string'
                ) {
                    return
                }

                seenRemoteClientIds.add(payload.clientId)
                this.remoteClientIds.add(payload.clientId)

                if (typeof payload.updatedAt === 'string') {
                    this.lastSeenByClientId.set(payload.clientId, payload.updatedAt)
                }

                try {
                    applyAwarenessUpdate(this.awareness, base64ToUint8Array(payload.awarenessUpdateBase64), this)
                } catch (error) {
                    console.error('Failed to apply remote awareness update:', error)
                }
            })
        })

        const removedClientIds = [...this.remoteClientIds].filter((clientId) => !seenRemoteClientIds.has(clientId))

        if (removedClientIds.length > 0) {
            removeAwarenessStates(this.awareness, removedClientIds, this)
            removedClientIds.forEach((clientId) => {
                this.remoteClientIds.delete(clientId)
                this.lastSeenByClientId.delete(clientId)
            })
        }

        this.emitUsersChange()
    }

    private async handleSubscribed(): Promise<void> {
        await this.loadInitialState()
        this.setStatus('connected')
        await this.trackLocalAwareness()
    }

    private async loadInitialState(): Promise<void> {
        try {
            const { data, error } = await this.supabase
                .from(this.tableName)
                .select('content')
                .eq('room_id', this.roomId)
                .maybeSingle()

            if (error) {
                console.error('Failed to load collaborative document snapshot:', error)
                return
            }

            const row = data as { content?: string | null } | null

            if (row?.content) {
                Y.applyUpdate(this.doc, base64ToUint8Array(row.content), this)
            }
        } catch (error) {
            console.error('Unexpected collaborative document load error:', error)
        }
    }

    private async trackLocalAwareness(): Promise<void> {
        if (!this.channel || !this.subscribed || this.destroyed) return

        const localState = this.awareness.getLocalState()

        if (!localState) {
            await this.channel.untrack()
            return
        }

        const updatedAt = new Date().toISOString()
        this.lastSeenByClientId.set(this.awareness.clientID, updatedAt)

        await this.channel.track({
            clientId: this.awareness.clientID,
            user: this.user,
            awarenessUpdateBase64: uint8ArrayToBase64(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])),
            updatedAt
        } satisfies SupabasePresencePayload)
    }

    private scheduleSave(): void {
        this.clearSaveTimer()
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null
            void this.saveSnapshot()
        }, this.debounceMs)
    }

    private clearSaveTimer(): void {
        if (!this.saveTimer) return

        clearTimeout(this.saveTimer)
        this.saveTimer = null
    }

    private setStatus(status: ProviderStatus): void {
        if (this.status === status) return

        this.status = status
        this.statusListeners.forEach((listener) => listener(status))
    }

    private getOnlineUsers(): OnlineUser[] {
        return [...this.awareness.getStates().entries()]
            .map(([clientId, state]) => {
                const user = state.user as CollaborativeUser | undefined

                if (!user?.id || !user.name || !user.color) return null

                return {
                    ...user,
                    clientId,
                    lastSeenAt: this.lastSeenByClientId.get(clientId) ?? new Date().toISOString()
                }
            })
            .filter((user): user is OnlineUser => user !== null)
            .sort((left, right) => left.name.localeCompare(right.name))
    }

    private emitUsersChange(): void {
        const users = this.getOnlineUsers()
        this.usersListeners.forEach((listener) => listener(users))
    }

    private removeRemoteAwarenessStates(): void {
        const clientIds = [...this.remoteClientIds]

        if (clientIds.length > 0) {
            removeAwarenessStates(this.awareness, clientIds, this)
        }

        this.remoteClientIds.clear()
        this.emitUsersChange()
    }
}
