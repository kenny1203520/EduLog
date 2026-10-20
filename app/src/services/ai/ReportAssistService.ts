import { apiV1Client, ApiV1Error, createRequestId, createTraceparent, readCsrfToken, type ApiErrorBody } from '@/services/api/ApiV1Client'

/** Client for /api/ai/report-assist (see server/src/routes/rest/aiReportAssistRouter.ts). */

export type ReportTone = 'warm' | 'formal' | 'concise'
export type ReportLength = 'short' | 'medium' | 'long'
export type ReportSectionKey = 'today' | 'performance' | 'home'
export type ContextWarningCode = 'missing_lesson_title' | 'thin_class_notes' | 'attendance_not_recorded'

export interface ReportAssistSource {
    model_row_id: string
    model_id: string
    display_name: string
    provider: 'anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama'
    credential_scope: 'site' | 'user'
    credential_label: string
    /** Generations this model costs on the site quota; 0 for personal credentials. */
    quota_weight: number
    is_default: boolean
}

export interface ReportAssistPreferences {
    tone?: ReportTone
    length?: ReportLength
    last_model_row_id?: string | null
}

export interface ReportAssistBootstrap {
    enabled: boolean
    notice: { version: number, acknowledged: boolean }
    default_model_row_id: string | null
    sources: ReportAssistSource[]
    quota: {
        remaining: number
        periodic: { limit: number, used: number, remaining: number, window: string } | null
        one_time: { total: number, used: number, remaining: number }
    }
    warnings: ContextWarningCode[]
    kept_suggestions: Array<{ generationId: string, date: string | null, suggestions: string[] }>
    /** The newest succeeded or still running generation, so the panel reopens where it was. */
    latest: GenerationHistoryEntry | null
    /** 學習報告 already has text: the AI keeps its voice and structure. */
    has_draft?: boolean
    preferences: ReportAssistPreferences
}

export type GenerationStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

/** One of the teacher's generations on a report, restored for display. */
export interface GenerationHistoryEntry {
    generation_id: string
    status: GenerationStatus
    created_at: string
    completed_at: string | null
    provider: ReportAssistSource['provider']
    model_id: string
    error_code: string | null
    quota_charged: number
    /** Only for succeeded generations. */
    draft: ReportDraft | null
    unresolved_placeholders: string[]
    suggestion_states: Record<number, 'kept' | 'dismissed'>
    adoption_count: number
    /** What was sent, already de-identified; system_prompt is null on generations from before it was recorded. */
    input: { system_prompt: string | null, prompt_version: string | null, prompt: string | null }
    /** Provider HTTP status and short message, for failures. */
    error_detail: { status: number | null, message: string | null } | null
}

export interface ReportAssistOptions {
    tone: ReportTone
    length: ReportLength
    extra_instructions?: string
    focus?: string
    template_id?: string
}

export interface ReportDraftSection { key: ReportSectionKey, title: string, body: string }
export interface ReportDraft { sections: ReportDraftSection[], teachingSuggestions: string[] }
export interface PartialReportDraft {
    sections?: Array<Partial<ReportDraftSection> | undefined>
    teachingSuggestions?: Array<string | undefined>
}

export interface ReportAssistPreview {
    fields: Record<string, string>
    prompt: string
    replacement_counts: Record<string, number>
    warnings: ContextWarningCode[]
}

export interface GenerationResult {
    generation_id: string
    draft: ReportDraft
    unresolved_placeholders: string[]
    quota_charged: number
    quota_remaining: number | null
}

export interface ServerSentEvent { event: string, data: string }

/**
 * Incrementally split a text/event-stream body into events. Returns the
 * complete events and the unparsed remainder to prepend to the next chunk.
 */
export function parseServerSentEvents(buffer: string): { events: ServerSentEvent[], rest: string } {
    const normalized = buffer.replace(/\r\n/g, '\n')
    const blocks = normalized.split('\n\n')
    const rest = blocks.pop() ?? ''
    const events = blocks.flatMap((block) => {
        let event = 'message'
        const data: string[] = []
        for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
        }
        return data.length ? [{ event, data: data.join('\n') }] : []
    })
    return { events, rest }
}

const base = '/ai/report-assist'

export const ReportAssistService = {
    async bootstrap(reportId: string): Promise<ReportAssistBootstrap> {
        return (await apiV1Client.get<ReportAssistBootstrap>(`${base}/reports/${reportId}`)).data
    },

    async preview(reportId: string, options: ReportAssistOptions): Promise<ReportAssistPreview> {
        return (await apiV1Client.post<ReportAssistPreview>(`${base}/reports/${reportId}/preview`, { options })).data
    },

    async acknowledgeNotice(): Promise<void> {
        await apiV1Client.post(`${base}/notice/acknowledge`, {})
    },

    async savePreferences(preferences: ReportAssistPreferences): Promise<void> {
        await apiV1Client.put(`${base}/preferences`, preferences)
    },

    async setSuggestionState(generationId: string, index: number, state: 'kept' | 'dismissed'): Promise<void> {
        await apiV1Client.put(`${base}/generations/${generationId}/suggestions/${index}`, { state })
    },

    async history(reportId: string): Promise<GenerationHistoryEntry[]> {
        return (await apiV1Client.get<GenerationHistoryEntry[]>(`${base}/reports/${reportId}/generations`)).data
    },

    /** Stop a running generation. Closing the stream does not stop it; this does. */
    async cancel(generationId: string): Promise<boolean> {
        return (await apiV1Client.post<{ cancelled: boolean }>(`${base}/generations/${generationId}/cancel`, {})).data.cancelled
    },

    async recordAdoption(generationId: string, sectionKey: ReportSectionKey | 'all', action: 'insert' | 'replace' | 'copy' | 'adopt_all'): Promise<void> {
        await apiV1Client.post(`${base}/generations/${generationId}/adoptions`, { section_key: sectionKey, action })
    },

    /**
     * Start a generation and stream it. Refusals before the model runs (quota,
     * notice, de-identification…) reject with ApiV1Error; failures mid-stream
     * arrive as an `error` event and also reject with ApiV1Error. If the
     * connection drops after `onStarted`, the server keeps generating and the
     * result appears in the history.
     */
    async generate(
        reportId: string,
        body: { model_row_id: string, options: ReportAssistOptions, session_seq: number },
        hooks: { signal?: AbortSignal, onStarted?: (generationId: string) => void, onPartial?: (draft: PartialReportDraft) => void } = {},
    ): Promise<GenerationResult> {
        const requestId = createRequestId()
        const response = await fetch(`/api${base}/reports/${reportId}/generations`, {
            method: 'POST',
            credentials: 'include',
            signal: hooks.signal,
            headers: {
                Accept: 'text/event-stream',
                'Content-Type': 'application/json',
                'X-CSRF-Token': readCsrfToken(),
                'X-Request-Id': requestId,
                traceparent: createTraceparent(),
            },
            body: JSON.stringify(body),
        })
        if (!response.ok || !response.body) {
            const errorBody = await response.json().catch(() => null) as ApiErrorBody | null
            if (errorBody?.error) throw new ApiV1Error(response.status, errorBody)
            throw new Error(`AI generation failed with status ${response.status}`)
        }

        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            const parsed = parseServerSentEvents(buffer + value)
            buffer = parsed.rest
            for (const event of parsed.events) {
                const data = JSON.parse(event.data)
                if (event.event === 'start' && data.generation_id) hooks.onStarted?.(data.generation_id as string)
                else if (event.event === 'partial') hooks.onPartial?.(data as PartialReportDraft)
                else if (event.event === 'done') return data as GenerationResult
                else if (event.event === 'error') {
                    throw new ApiV1Error(502, { error: { code: data.code, message: data.message, request_id: data.request_id ?? requestId, trace_id: '', details: data.reason ? { reason: data.reason } : undefined } })
                }
            }
        }
        throw new ApiV1Error(502, { error: { code: 'AI_STREAM_INTERRUPTED', message: 'The generation stream ended unexpectedly', request_id: requestId, trace_id: '' } })
    },
}
