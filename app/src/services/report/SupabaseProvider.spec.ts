import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
    SupabaseProvider,
    uint8ArrayToBase64
} from './SupabaseProvider'

function createSupabaseMock(row: Record<string, unknown> | null = null) {
    const query = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null })
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)

    const channel = {
        on: vi.fn(),
        subscribe: vi.fn(),
        send: vi.fn().mockResolvedValue(undefined),
        track: vi.fn().mockResolvedValue(undefined),
        untrack: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        presenceState: vi.fn().mockReturnValue({})
    }
    channel.on.mockReturnValue(channel)
    channel.subscribe.mockImplementation((callback: (status: string) => void) => {
        queueMicrotask(() => callback('SUBSCRIBED'))
        return channel
    })

    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const supabase = {
        channel: vi.fn().mockReturnValue(channel),
        from: vi.fn().mockReturnValue(query),
        rpc,
        removeChannel: vi.fn(),
        realtime: { isConnected: vi.fn().mockReturnValue(true) }
    }

    return { supabase, channel, query, rpc }
}

function encodedTextSnapshot(value: string) {
    const source = new Y.Doc()
    source.getText('content').insert(0, value)
    const encoded = uint8ArrayToBase64(Y.encodeStateAsUpdate(source))
    source.destroy()
    return encoded
}

afterEach(() => {
    vi.restoreAllMocks()
})
describe('report SupabaseProvider snapshot versioning', () => {
    it('loads a snapshot only when its base report version matches', async () => {
        const { supabase } = createSupabaseMock({
            snapshot_base64: encodedTextSnapshot('matching draft'),
            base_report_version: 7
        })
        const doc = new Y.Doc()
        const provider = new SupabaseProvider(supabase as any, doc, 'report-1', 7, 'user-1')

        await provider.ready

        expect(provider.initialState).toBe('loaded')
        expect(doc.getText('content').toString()).toBe('matching draft')
        await provider.destroy()
    })

    it('ignores stale snapshots', async () => {
        const { supabase } = createSupabaseMock({
            snapshot_base64: encodedTextSnapshot('stale draft'),
            base_report_version: 6
        })
        const doc = new Y.Doc()
        const provider = new SupabaseProvider(supabase as any, doc, 'report-1', 7, 'user-1')

        await provider.ready

        expect(provider.initialState).toBe('stale')
        expect(doc.getText('content').toString()).toBe('')
        await provider.destroy()
    })

    it('ignores legacy snapshots without a base version', async () => {
        const { supabase } = createSupabaseMock({
            snapshot_base64: encodedTextSnapshot('legacy draft'),
            base_report_version: null
        })
        const doc = new Y.Doc()
        const provider = new SupabaseProvider(supabase as any, doc, 'report-1', 7, 'user-1')

        await provider.ready

        expect(provider.initialState).toBe('legacy')
        expect(doc.getText('content').toString()).toBe('')
        await provider.destroy()
    })

    it('saves through the version-gated RPC using the latest canonical version', async () => {
        const { supabase, rpc } = createSupabaseMock()
        const doc = new Y.Doc()
        const provider = new SupabaseProvider(supabase as any, doc, 'report-1', 7, 'user-1')
        await provider.ready
        provider.setBaseReportVersion(8)

        await expect(provider.saveSnapshot()).resolves.toBe(true)

        expect(rpc).toHaveBeenCalledWith('save_report_collab_snapshot', expect.objectContaining({
            p_occurrence_report_id: 'report-1',
            p_base_report_version: 8,
            p_snapshot_base64: expect.any(String)
        }))
        await provider.destroy()
    })
    it('rejects ready when the collaboration document cannot be loaded', async () => {
        const { supabase, query } = createSupabaseMock()
        query.maybeSingle.mockResolvedValue({ data: null, error: { message: 'permission denied' } })
        const statuses: string[] = []
        const provider = new SupabaseProvider(supabase as any, new Y.Doc(), 'report-1', 7, 'user-1', {
            onStatus: status => statuses.push(status)
        })

        await expect(provider.ready).rejects.toThrow('permission denied')
        expect(provider.initialState).toBe('error')
        expect(statuses).toContain('error')
        await provider.destroy()
    })


})
