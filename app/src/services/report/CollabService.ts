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
            .subscribe((status: any) => {
                // console.log('Collab channel status', status)
            })

        this.channels.set(channelName, channel)

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
