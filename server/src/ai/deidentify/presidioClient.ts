import type { AdHocRecognizer } from './knownEntities.js'

/** One detection from Presidio `POST /analyze`. */
export interface PresidioSpan {
  entity_type: string
  start: number
  end: number
  score: number
}

export interface AnalyzeRequest {
  text: string
  language: string
  adHocRecognizers: AdHocRecognizer[]
  scoreThreshold: number
  /** Exact span texts Presidio must not report (exception words). */
  allowList?: string[]
}

/** Anything that can analyze text; lets tests substitute Presidio. */
export interface TextAnalyzer {
  analyze(request: AnalyzeRequest): Promise<PresidioSpan[]>
}

/** Languages the analyzer image can be built with (see docker/presidio). */
export const PRESIDIO_LANGUAGES = ['zh', 'en', 'ja', 'ko'] as const
export type PresidioLanguage = typeof PRESIDIO_LANGUAGES[number]

/** Presidio could not be reached or answered with an error; generation must not continue. */
export class DeidentificationUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DeidentificationUnavailableError'
  }
}

/** Presidio answered but refused the request, e.g. an ad-hoc pattern that does not compile. */
export class PresidioRequestError extends DeidentificationUnavailableError {
  constructor(readonly status: number, readonly detail: string) {
    super(`Presidio analyzer returned ${status}`)
    this.name = 'PresidioRequestError'
  }
}

/** Thin REST client for the self-hosted Presidio analyzer (see docker/presidio). */
export class PresidioClient implements TextAnalyzer {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 10_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async analyze(request: AnalyzeRequest): Promise<PresidioSpan[]> {
    if (!request.text) return []
    const response = await this.request('/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: request.text,
        language: request.language,
        ad_hoc_recognizers: request.adHocRecognizers,
        score_threshold: request.scoreThreshold,
        ...(request.allowList?.length ? { allow_list: request.allowList } : {}),
      }),
    })
    if (!response.ok) throw new PresidioRequestError(response.status, await errorDetail(response))
    const spans = await response.json() as unknown
    if (!Array.isArray(spans)) throw new DeidentificationUnavailableError('Presidio analyzer returned an unexpected body')
    return spans as PresidioSpan[]
  }

  /**
   * Languages this analyzer has an NLP model for. Presidio has no endpoint
   * listing them, so each candidate is probed with `GET /supportedentities`,
   * which fails for a language the image was not built with.
   */
  async supportedLanguages(candidates: readonly string[] = PRESIDIO_LANGUAGES): Promise<string[]> {
    const results = await Promise.all(candidates.map(async (language) => {
      const response = await this.request(`/supportedentities?language=${encodeURIComponent(language)}`, { method: 'GET' })
      return response.ok ? language : null
    }))
    return results.filter((language): language is string => language !== null)
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(new URL(path, this.baseUrl), { ...init, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (error) {
      throw new DeidentificationUnavailableError('Presidio analyzer is unreachable', { cause: error })
    }
  }
}

async function errorDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === 'string') return parsed.error.slice(0, 500)
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return body.slice(0, 500)
}
