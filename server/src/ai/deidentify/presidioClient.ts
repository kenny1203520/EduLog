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
}

/** Anything that can analyze text; lets tests substitute Presidio. */
export interface TextAnalyzer {
  analyze(request: AnalyzeRequest): Promise<PresidioSpan[]>
}

/** Presidio could not be reached or answered with an error; generation must not continue. */
export class DeidentificationUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DeidentificationUnavailableError'
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
    let response: Response
    try {
      response = await this.fetchImpl(new URL('/analyze', this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: request.text,
          language: request.language,
          ad_hoc_recognizers: request.adHocRecognizers,
          score_threshold: request.scoreThreshold,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new DeidentificationUnavailableError('Presidio analyzer is unreachable', { cause: error })
    }
    if (!response.ok) {
      throw new DeidentificationUnavailableError(`Presidio analyzer returned ${response.status}`)
    }
    const spans = await response.json() as unknown
    if (!Array.isArray(spans)) throw new DeidentificationUnavailableError('Presidio analyzer returned an unexpected body')
    return spans as PresidioSpan[]
  }
}
