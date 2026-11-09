import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import {
    CollaborationProvider,
    uint8ArrayToBase64
} from './CollaborationProvider'

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }))
vi.mock('@/services/api/ApiV1Client', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiV1Client')>(),
    apiV1Client: { get: getMock, post: postMock }
}))

function createTransportMock(row: Record<string, unknown> | null = null) {
    getMock.mockReset().mockResolvedValue({ data: row })
    postMock.mockReset().mockResolvedValue({ data: { saved: true } })

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

    const transport = {
        channel: vi.fn().mockReturnValue(channel),
        removeChannel: vi.fn()
    }

    return { transport, channel }
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
describe('report CollaborationProvider snapshot versioning', () => {
    it('loads a snapshot only when its base report version matches', async () => {
        const { transport } = createTransportMock({
            snapshot_base64: encodedTextSnapshot('matching draft'),
            base_report_version: 7
        })
        const doc = new Y.Doc()
        const provider = new CollaborationProvider(transport as any, doc, 'report-1', 7, 'user-1')

        await provider.ready

        expect(provider.initialState).toBe('loaded')
        expect(doc.getText('content').toString()).toBe('matching draft')
        await provider.destroy()
    })

    it('ignores stale snapshots', async () => {
        const { transport } = createTransportMock({
            snapshot_base64: encodedTextSnapshot('stale draft'),
            base_report_version: 6
        })
        const doc = new Y.Doc()
        const provider = new CollaborationProvider(transport as any, doc, 'report-1', 7, 'user-1')

        await provider.ready

        expect(provider.initialState).toBe('stale')
        expect(doc.getText('content').toString()).toBe('')
        await provider.destroy()
    })

    it('ignores legacy snapshots without a base version', async () => {
        const { transport } = createTransportMock({
            snapshot_base64: encodedTextSnapshot('legacy draft'),
            base_report_version: null
        })
        const doc = new Y.Doc()
        const provider = new CollaborationProvider(transport as any, doc, 'report-1', 7, 'user-1')

        await provider.ready

        expect(provider.initialState).toBe('legacy')
        expect(doc.getText('content').toString()).toBe('')
        await provider.destroy()
    })

    it('saves through the version-gated endpoint using the latest canonical version', async () => {
        const { transport } = createTransportMock()
        const doc = new Y.Doc()
        const provider = new CollaborationProvider(transport as any, doc, 'report-1', 7, 'user-1')
        await provider.ready
        provider.setBaseReportVersion(8)

        await expect(provider.saveSnapshot()).resolves.toBe(true)

        expect(postMock).toHaveBeenCalledWith('/reports/report-1/collaboration', {
            snapshot_base64: expect.any(String),
            base_report_version: 8
        })
        await provider.destroy()
    })
    it('does not mark a stale snapshot as saved or advance its guarded report version', async () => {
        const { transport } = createTransportMock()
        postMock.mockResolvedValue({ data: { saved: false } })
        const doc = new Y.Doc()
        const provider = new CollaborationProvider(transport as any, doc, 'report-1', 7, 'user-1')
        await provider.ready
        doc.getText('content').insert(0, 'local draft')

        await expect(provider.saveSnapshot()).resolves.toBe(false)
        await expect(provider.saveSnapshot()).resolves.toBe(false)

        expect(postMock).toHaveBeenCalledTimes(2)
        expect(postMock).toHaveBeenLastCalledWith('/reports/report-1/collaboration', {
            snapshot_base64: expect.any(String),
            base_report_version: 7
        })
        expect(doc.getText('content').toString()).toBe('local draft')
        await provider.destroy()
    })
    it('rejects ready when the collaboration document cannot be loaded', async () => {
        const { transport } = createTransportMock()
        getMock.mockRejectedValue(new Error('permission denied'))
        const statuses: string[] = []
        const provider = new CollaborationProvider(transport as any, new Y.Doc(), 'report-1', 7, 'user-1', {
            onStatus: status => statuses.push(status)
        })

        await expect(provider.ready).rejects.toThrow('permission denied')
        expect(provider.initialState).toBe('error')
        expect(statuses).toContain('error')
        await provider.destroy()
    })

    it('keeps transient channel recovery alive and reloads the snapshot and presence after resubscribe', async () => {
        const { transport, channel } = createTransportMock({ snapshot_base64: encodedTextSnapshot('recovered draft'), base_report_version: 7 })
        let notify: ((status: string, detail?: string) => void) | undefined
        channel.subscribe.mockImplementation((callback: (status: string, detail?: string) => void) => {
            notify = callback
            return channel
        })
        const statuses: string[] = []
        const provider = new CollaborationProvider(transport as any, new Y.Doc(), 'report-1', 7, 'user-1', {
            onStatus: status => statuses.push(status)
        })

        notify?.('CHANNEL_ERROR', 'upstream interrupted')
        notify?.('RECONNECTING')
        expect(statuses).toContain('reconnecting')
        notify?.('SUBSCRIBED')
        await provider.ready
        expect(getMock).toHaveBeenCalledOnce()
        expect(channel.track).toHaveBeenCalledOnce()

        notify?.('OFFLINE')
        notify?.('SUBSCRIBED')
        await Promise.resolve()
        await Promise.resolve()
        expect(getMock).toHaveBeenCalledTimes(2)
        expect(channel.track).toHaveBeenCalledTimes(2)
        await provider.destroy()
    })


})
