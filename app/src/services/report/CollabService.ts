import * as Y from 'yjs'
import { supabase } from '@/lib/supabase'

function uint8ArrayToBase64(u8: Uint8Array): string {
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < u8.length; i += chunkSize) {
        const chunk = u8.subarray(i, i + chunkSize)
        binary += String.fromCharCode.apply(null, Array.from(chunk))
    }
    return btoa(binary)
}

function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

export class CollabService {
    private static docs: Map<string, Y.Doc> = new Map()
    private static channels: Map<string, any> = new Map()
    private static awarenessCallbacks: Map<string, Array<(arr: any[]) => void>> = new Map()

    static async init(reportId: string, userId: string): Promise<Y.Doc> {
        if (this.docs.has(reportId)) return this.docs.get(reportId)!

        const doc = new Y.Doc()

        // Load snapshot if exists
        try {
            const { data, error } = await supabase
                .from('report_collab_docs')
                .select('snapshot_base64')
                .eq('occurrence_report_id', reportId)
                .single()

            if (!error && data && data.snapshot_base64) {
                const bytes = base64ToUint8Array(data.snapshot_base64)
                Y.applyUpdate(doc, bytes, 'remote')
            }
        } catch (err) {
            console.error('Failed to load collab snapshot', err)
        }

        // Subscribe to ops table for remote updates
        const channelName = `collab:report:${reportId}`
        const channel = supabase
            .channel(channelName)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'report_collab_ops',
                    filter: `occurrence_report_id=eq.${reportId}`
                },
                (payload: any) => {
                    const newRow = payload.new
                    if (!newRow || !newRow.op_payload) return

                    try {
                        const updateBytes = base64ToUint8Array(newRow.op_payload)
                        // avoid rebroadcast by using origin
                        Y.applyUpdate(doc, updateBytes, 'remote')
                    } catch (e) {
                        console.error('Failed to apply remote update', e)
                    }
                }
            )
            .subscribe()

        this.channels.set(channelName, channel)

        // Subscribe to awareness table updates
        const awarenessChannelName = `collab:awareness:${reportId}`
        const awarenessChannel = supabase.channel(awarenessChannelName)

        const handleAwarenessRow = (newRow: any) => {
            if (!newRow || !newRow.awareness_payload) return
            try {
                const parsed = JSON.parse(newRow.awareness_payload)
                const callbacks = this.awarenessCallbacks.get(reportId) || []
                callbacks.forEach((cb) => {
                    try { cb(parsed) } catch (e) { console.error(e) }
                })
            } catch (e) {
                console.error('Failed to parse awareness payload', e)
            }
        }

        // listen for INSERT
        awarenessChannel.on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'report_collab_awareness',
                filter: `occurrence_report_id=eq.${reportId}`
            },
            (payload: any) => handleAwarenessRow(payload.new)
        )

        // listen for UPDATE (heartbeat/upsert)
        awarenessChannel.on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'report_collab_awareness',
                filter: `occurrence_report_id=eq.${reportId}`
            },
            (payload: any) => handleAwarenessRow(payload.new)
        )

        awarenessChannel.subscribe()
        this.channels.set(awarenessChannelName, awarenessChannel)

        // Broadcast local updates to ops table
        doc.on('update', async (update: Uint8Array, origin: any) => {
            // skip updates that come from remote applies
            if (origin === 'remote') return

            try {
                const base64 = uint8ArrayToBase64(update)
                await supabase.from('report_collab_ops').insert({
                    occurrence_report_id: reportId,
                    op_payload: base64,
                    origin_user_id: userId
                })
            } catch (err) {
                console.error('Failed to broadcast local update', err)
            }
        })

        this.docs.set(reportId, doc)

        return doc
    }

    static async saveSnapshot(reportId: string, userId: string): Promise<boolean> {
        const doc = this.docs.get(reportId)
        if (!doc) return false

        try {
            const state = Y.encodeStateAsUpdate(doc)
            const base64 = uint8ArrayToBase64(state)

            // Upsert snapshot
            const { error } = await supabase.from('report_collab_docs').upsert({
                occurrence_report_id: reportId,
                snapshot_base64: base64,
                last_updated_by: userId
            }, { onConflict: 'occurrence_report_id' })

            if (error) throw error
            return true
        } catch (err) {
            console.error('Failed to save snapshot', err)
            return false
        }
    }

    /**
     * Send awareness payload (cursor/selection/state)
     */
    static async sendAwareness(reportId: string, userId: string, payload: object): Promise<void> {
        try {
            // Try to update existing row (heartbeat), otherwise insert
            const now = new Date().toISOString()
            const awarenessPayload = JSON.stringify({ ...payload, updatedAt: now })

            const { data: existing, error: selectErr } = await supabase
                .from('report_collab_awareness')
                .select('id')
                .eq('occurrence_report_id', reportId)
                .eq('origin_user_id', userId)
                .maybeSingle()

            if (selectErr) {
                // fallback to insert
                await supabase.from('report_collab_awareness').insert({
                    occurrence_report_id: reportId,
                    origin_user_id: userId,
                    awareness_payload: awarenessPayload,
                    last_heartbeat: now
                })
                return
            }

            if (existing && existing.id) {
                await supabase.from('report_collab_awareness').update({
                    awareness_payload: awarenessPayload,
                    last_heartbeat: now
                }).match({ id: existing.id })
            } else {
                await supabase.from('report_collab_awareness').insert({
                    occurrence_report_id: reportId,
                    origin_user_id: userId,
                    awareness_payload: awarenessPayload,
                    last_heartbeat: now
                })
            }
        } catch (err) {
            console.error('Failed to send awareness', err)
        }
    }

    /**
     * Register a callback to receive awareness updates
     */
    static onAwareness(reportId: string, cb: (arr: any[]) => void) {
        if (!this.awarenessCallbacks.has(reportId)) this.awarenessCallbacks.set(reportId, [])
        this.awarenessCallbacks.get(reportId)!.push(cb)
        return () => {
            const list = this.awarenessCallbacks.get(reportId) || []
            this.awarenessCallbacks.set(reportId, list.filter(f => f !== cb))
        }
    }

    static getDoc(reportId: string): Y.Doc | null {
        return this.docs.get(reportId) || null
    }

    static async destroy(reportId: string) {
        const doc = this.docs.get(reportId)
        if (doc) {
            doc.destroy()
            this.docs.delete(reportId)
        }

        const channelName = `collab:report:${reportId}`
        const channel = this.channels.get(channelName)
        if (channel) {
            try {
                supabase.removeChannel(channel)
            } catch (err) {
                console.warn('Failed to remove collab channel', err)
            }
            this.channels.delete(channelName)
        }
    }
}

export default CollabService
