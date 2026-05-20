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

        const isDev = (typeof window !== 'undefined' && window.location.hostname.includes('localhost'))

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
                if (isDev) console.log(`[collab] loaded snapshot for ${reportId} (${bytes.length} bytes)`) 
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
                        if (isDev) console.log(`[collab] received op for ${reportId} from ${newRow.origin_user_id || 'unknown'} (${updateBytes.length} bytes)`) 
                        Y.applyUpdate(doc, updateBytes, 'remote')
                        if (isDev) console.log(`[collab] applied remote update for ${reportId}`)
                    } catch (e) {
                        console.error('Failed to apply remote update', e)
                    }
                }
            )
            .subscribe()

        if (isDev) console.log(`[collab] subscribed ops channel ${channelName}`)

        this.channels.set(channelName, channel)

        // Subscribe to awareness table updates
        const awarenessChannelName = `collab:awareness:${reportId}`
        const awarenessChannel = supabase.channel(awarenessChannelName)

        const handleAwarenessRow = (newRow: any) => {
            if (!newRow || !newRow.awareness_payload) return
            try {
                const parsed = JSON.parse(newRow.awareness_payload)
                const callbacks = this.awarenessCallbacks.get(reportId) || []
                if (isDev) console.log(`[collab] received awareness for ${reportId}:`, parsed)
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
        if (isDev) console.log(`[collab] subscribed awareness channel ${awarenessChannelName}`)
        this.channels.set(awarenessChannelName, awarenessChannel)

        // Broadcast local updates to ops table
        doc.on('update', async (update: Uint8Array, origin: any) => {
            // skip updates that come from remote applies
            if (origin === 'remote') return

            try {
                const base64 = uint8ArrayToBase64(update)
                if (isDev) console.log(`[collab] broadcasting local update for ${reportId} by ${userId} (${update.length} bytes) origin:`, origin)
                const { error } = await supabase.from('report_collab_ops').insert({
                    occurrence_report_id: reportId,
                    op_payload: base64,
                    origin_user_id: userId
                })
                if (error) {
                    console.error('[collab] failed to insert op row', error)
                } else if (isDev) {
                    console.log(`[collab] inserted op row for ${reportId}`)
                }
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
            const isDev = (typeof window !== 'undefined' && window.location.hostname.includes('localhost'))
            if (isDev) console.log(`[collab] saved snapshot for ${reportId} (${state.length} bytes) by ${userId}`)
            return true
        } catch (err) {
            console.error('Failed to save snapshot', err)
            // Additional dev-only debugging: dump known root ytexts to help diagnose "Unexpected case"
            try {
                const isDev = (typeof window !== 'undefined' && window.location.hostname.includes('localhost'))
                if (isDev) {
                    const docSample: Record<string, number | string> = {}
                    try {
                        const t = doc.getText && doc.getText('content')
                        docSample['content_len'] = t ? t.toString().length : 0
                    } catch (e) {
                        docSample['content_len'] = -1
                    }
                    try {
                        const tc = doc.getText && doc.getText('contactNotes')
                        docSample['contactNotes_len'] = tc ? tc.toString().length : 0
                    } catch (e) {
                        docSample['contactNotes_len'] = -1
                    }
                    try {
                        const tg = doc.getText && doc.getText('classNotes')
                        docSample['classNotes_len'] = tg ? tg.toString().length : 0
                    } catch (e) {
                        docSample['classNotes_len'] = -1
                    }
                    console.error('[collab][debug] doc sample for snapshot error', docSample)
                }
            } catch (logErr) {
                console.error('[collab][debug] failed to collect doc sample', logErr)
            }
            return false
        }
    }

    /**
     * Send awareness payload (cursor/selection/state)
     */
    static async sendAwareness(reportId: string, userId: string, payload: object): Promise<void> {
        const isDev = (typeof window !== 'undefined' && window.location.hostname.includes('localhost'))
        try {
            if (isDev) console.log(`[collab] sendAwareness for ${reportId} by ${userId}:`, payload)
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
                const { error: insertErr } = await supabase.from('report_collab_awareness').insert({
                    occurrence_report_id: reportId,
                    origin_user_id: userId,
                    awareness_payload: awarenessPayload,
                    last_heartbeat: now
                })
                if (insertErr) console.error('[collab] failed to insert awareness row', insertErr)
                return
            }

            if (existing && existing.id) {
                const { error: updateErr } = await supabase.from('report_collab_awareness').update({
                    awareness_payload: awarenessPayload,
                    last_heartbeat: now
                }).match({ id: existing.id })
                if (updateErr) console.error('[collab] failed to update awareness row', updateErr)
            } else {
                const { error: insertErr } = await supabase.from('report_collab_awareness').insert({
                    occurrence_report_id: reportId,
                    origin_user_id: userId,
                    awareness_payload: awarenessPayload,
                    last_heartbeat: now
                })
                if (insertErr) console.error('[collab] failed to insert awareness row', insertErr)
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
