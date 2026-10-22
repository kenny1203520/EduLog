/**
 * What a provider said when a call failed, kept short and without secrets so
 * it can be logged, stored with the generation and shown to the teacher.
 */
export interface ProviderErrorDetail {
  status: number | null
  message: string | null
}

/** Why a model call failed, as recorded in ai_generations.error_code. */
export type ProviderFailure = 'RATE_LIMITED' | 'MODEL_UNSUPPORTED' | 'DATA_POLICY' | 'AUTH_FAILED' | 'PROVIDER_ERROR'

const MESSAGE_LIMIT = 500

/** The model or its route rejected JSON schema output ("No endpoints found that support response_format", …). */
const UNSUPPORTED_OUTPUT = /response[_ ]format|json[_ ]schema|structured[_ ]output|No endpoints found that (support|can handle)/i

/** OpenRouter: the account's privacy settings exclude every provider of this (often free) model. */
const DATA_POLICY = /data policy|privacy settings/i

/** Walk wrapped causes (AI SDK RetryError → APICallError) up to a few levels. */
function* causes(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    yield current as Record<string, unknown>
    const next = current as { cause?: unknown, lastError?: unknown }
    current = next.cause ?? next.lastError
  }
}

/** HTTP status of a provider error, looking through wrapped causes (AI SDK APICallError). */
export function providerStatus(error: unknown): number | null {
  for (const item of causes(error)) {
    if (typeof item.statusCode === 'number') return item.statusCode
  }
  return null
}

/** Remove API keys and bearer tokens a provider may echo back. */
export function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [redacted]')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
}

/** OpenAI-style bodies: {"error":{"message":"…","metadata":{"raw":"…"}}}. */
function bodyMessage(body: unknown): string | null {
  if (typeof body !== 'string' || !body.trim()) return null
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown, metadata?: { raw?: unknown } } | string, message?: unknown }
    const error = parsed.error
    if (typeof error === 'string') return error
    const message = typeof error?.message === 'string' ? error.message : typeof parsed.message === 'string' ? parsed.message : null
    const raw = typeof error?.metadata?.raw === 'string' ? error.metadata.raw : null
    if (message && raw && !message.includes(raw)) return `${message} (${raw})`
    return message ?? raw
  } catch {
    return body
  }
}

export function providerErrorDetail(error: unknown): ProviderErrorDetail {
  let message: string | null = null
  for (const item of causes(error)) {
    message = bodyMessage(item.responseBody) ?? message
    if (message) break
  }
  if (!message && error instanceof Error && error.message) message = error.message
  const cleaned = message ? redactSecrets(message.replace(/\s+/g, ' ').trim()).slice(0, MESSAGE_LIMIT) : null
  return { status: providerStatus(error), message: cleaned || null }
}

export function classifyProviderFailure(detail: ProviderErrorDetail): ProviderFailure {
  if (detail.status === 429) return 'RATE_LIMITED'
  if (detail.status === 401 || detail.status === 403) return 'AUTH_FAILED'
  if (detail.message && DATA_POLICY.test(detail.message)) return 'DATA_POLICY'
  if ((detail.status === null || [400, 404, 422].includes(detail.status)) && detail.message && UNSUPPORTED_OUTPUT.test(detail.message)) {
    return 'MODEL_UNSUPPORTED'
  }
  return 'PROVIDER_ERROR'
}

/** One line for the teacher: "HTTP 429 – Rate limit exceeded". */
export function describeProviderError(detail: ProviderErrorDetail): string | undefined {
  const parts = [detail.status ? `HTTP ${detail.status}` : null, detail.message].filter(Boolean)
  return parts.length ? parts.join(' – ').slice(0, 300) : undefined
}
