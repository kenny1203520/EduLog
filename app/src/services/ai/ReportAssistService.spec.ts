import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import { parseServerSentEvents, ReportAssistService } from './ReportAssistService'

function streamOf(chunks: string[]) {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
        start(controller) {
            chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
            controller.close()
        },
    })
}

afterEach(() => vi.unstubAllGlobals())

describe('parseServerSentEvents', () => {
    it('returns complete events and keeps a partial block for the next chunk', () => {
        const parsed = parseServerSentEvents('event: partial\ndata: {"a":1}\n\nevent: done\ndata: {"b"')
        expect(parsed.events).toEqual([{ event: 'partial', data: '{"a":1}' }])
        expect(parsed.rest).toBe('event: done\ndata: {"b"')
    })
})

describe('ReportAssistService.generate', () => {
    it('streams partial drafts and resolves with the done payload, even when events split across chunks', async () => {
        const done = { generation_id: 'g1', draft: { sections: [], teachingSuggestions: [] }, unresolved_placeholders: [], quota_charged: 1, quota_remaining: 4 }
        const body = `event: start\ndata: {"warnings":[]}\n\nevent: partial\ndata: {"sections":[{"body":"王"}]}\n\nevent: done\ndata: ${JSON.stringify(done)}\n\n`
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(streamOf([body.slice(0, 40), body.slice(40)]), { status: 200 })))
        const partials: unknown[] = []

        const result = await ReportAssistService.generate('r1', { model_row_id: 'm1', options: { tone: 'warm', length: 'short' }, session_seq: 1 }, { onPartial: (draft) => partials.push(draft) })

        expect(result).toEqual(done)
        expect(partials).toEqual([{ sections: [{ body: '王' }] }])
        const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
        expect(url).toBe('/api/ai/report-assist/reports/r1/generations')
        expect(init.headers['X-CSRF-Token']).toBeDefined()
    })

    it('rejects with the API error code for refusals and stream errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'AI_QUOTA_EXHAUSTED', message: 'x', request_id: 'r', trace_id: 't' } }), { status: 429 })))
        await expect(ReportAssistService.generate('r1', { model_row_id: 'm1', options: { tone: 'warm', length: 'short' }, session_seq: 1 }))
            .rejects.toMatchObject({ code: 'AI_QUOTA_EXHAUSTED', status: 429 })

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(streamOf(['event: error\ndata: {"code":"AI_PROVIDER_ERROR","message":"bad"}\n\n']), { status: 200 })))
        const error = await ReportAssistService.generate('r1', { model_row_id: 'm1', options: { tone: 'warm', length: 'short' }, session_seq: 1 }).catch((e) => e)
        expect(error).toBeInstanceOf(ApiV1Error)
        expect(error.code).toBe('AI_PROVIDER_ERROR')
    })
})
