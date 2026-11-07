import type { AiProvider } from './providerRegistry.js'

/**
 * Models a credential can actually use, read from each provider's official
 * list endpoint so admins and teachers pick an id instead of typing it.
 * Only OpenRouter publishes prices in its list; other prices stay manual.
 */

export interface CatalogModel {
  id: string
  name: string
  /** Can generate text (chat/completions); embeddings, speech and image models are false. */
  textCapable: boolean
  /** USD per million tokens, when the provider lists it. */
  priceInputPerMtok?: number
  priceOutputPerMtok?: number
  /** Accepts JSON schema output, when the provider lists it (OpenRouter's supported_parameters). */
  supportsStructuredOutput?: boolean
}

/**
 * Why a list could not be read. Stable codes the app translates:
 * chatgpt_plan, no_key, auth_failed, not_found, bad_request, rate_limited,
 * provider_error, redirected, timeout, network, too_large, invalid_response.
 */
export type CatalogFailureReason =
  | 'chatgpt_plan' | 'no_key' | 'auth_failed' | 'not_found' | 'bad_request' | 'rate_limited'
  | 'provider_error' | 'redirected' | 'timeout' | 'network' | 'too_large' | 'invalid_response'

export type ModelCatalog =
  | { supported: true, models: CatalogModel[], fetchedAt: string }
  /** `detail` is a short diagnostic (HTTP status and the provider's own error text), never a secret. */
  | { supported: false, reason: CatalogFailureReason, detail?: string }

/** A failed list request, already classified. */
export class CatalogError extends Error {
  constructor(readonly reason: CatalogFailureReason, readonly detail: string) {
    super(detail)
    this.name = 'CatalogError'
  }
}

export interface CatalogTarget {
  provider: AiProvider
  authType: 'api_key' | 'oauth' | 'none'
  apiKey?: string
  baseUrl?: string | null
}

const NON_TEXT = /(embed|tts|whisper|dall-?e|image|imagen|moderation|transcri|audio|realtime|speech|veo|rerank|sora|search-preview)/i

const DEFAULT_BASE: Record<Exclude<AiProvider, 'ollama'>, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
}

function joinUrl(base: string, path: string): string {
  let baseEnd = base.length
  while (baseEnd > 0 && base[baseEnd - 1] === '/') baseEnd -= 1

  let pathStart = 0
  while (pathStart < path.length && path[pathStart] === '/') pathStart += 1

  return `${base.slice(0, baseEnd)}/${path.slice(pathStart)}`
}

/** OpenRouter lists prices as USD per token strings; store USD per million tokens. */
function perMillion(value: unknown): number | undefined {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  return Math.round(parsed * 1_000_000 * 10_000) / 10_000
}

/** Gemini's documented base includes the API version; add it when an admin entered only the host. */
export function googleBaseUrl(baseUrl: string | null | undefined): string {
  if (!baseUrl) return DEFAULT_BASE.google
  try {
    const url = new URL(baseUrl)
    // A path made only of slashes means the admin entered just the host.
    if ([...url.pathname].every((char) => char === '/')) return `${url.origin}/v1beta`
  } catch {
    return baseUrl
  }
  return baseUrl
}

const MAX_ERROR_TEXT = 160

/** Providers sometimes echo part of the key ("Incorrect API key provided: sk-ab***yz"); drop anything key-like. */
function redactSecrets(text: string): string {
  return text.replace(/\b(?:sk|rk|pk|AIza|ghp|xox[a-z])[-_A-Za-z0-9*.]{6,}/g, '[redacted]')
}

/** Reads a short, single-line error message from a failed provider response. */
async function errorText(response: Response): Promise<string> {
  try {
    const text = (await response.text()).slice(0, 4096)
    try {
      const body = JSON.parse(text) as { error?: { message?: unknown, status?: unknown, type?: unknown } | string, message?: unknown }
      const error = body.error
      const message = typeof error === 'string' ? error
        : typeof error?.message === 'string' ? [error.status ?? error.type, error.message].filter((part) => typeof part === 'string').join(': ')
          : typeof body.message === 'string' ? body.message : ''
      return redactSecrets(message.replace(/\s+/g, ' ').trim()).slice(0, MAX_ERROR_TEXT)
    } catch {
      return ''
    }
  } catch {
    return ''
  }
}

function statusReason(status: number, message: string): CatalogFailureReason {
  if (status === 401 || status === 403) return 'auth_failed'
  // Gemini answers an invalid key with 400 API_KEY_INVALID.
  if (status === 400 && /api[ _-]?key/i.test(message)) return 'auth_failed'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 300 && status < 400) return 'redirected'
  if (status >= 500) return 'provider_error'
  return 'bad_request'
}

async function getJson(url: string, headers: Record<string, string>, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15_000), redirect: 'manual' })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') throw new CatalogError('timeout', 'No response within 15 seconds')
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : error instanceof Error ? error.message : ''
    throw new CatalogError('network', cause.replace(/\s+/g, ' ').slice(0, MAX_ERROR_TEXT) || 'Could not reach the provider')
  }
  if (!response.ok) {
    const message = response.status >= 300 && response.status < 400 ? '' : await errorText(response)
    if (!response.bodyUsed) await response.body?.cancel()
    throw new CatalogError(statusReason(response.status, message), [`HTTP ${response.status}`, message].filter(Boolean).join(' '))
  }
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > 2 * 1024 * 1024) {
    await response.body?.cancel()
    throw new CatalogError('too_large', 'Model list response exceeds 2 MiB')
  }
  if (!response.body) throw new CatalogError('invalid_response', 'Model list response is empty')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 2 * 1024 * 1024) {
      await reader.cancel()
      throw new CatalogError('too_large', 'Model list response exceeds 2 MiB')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  } catch {
    throw new CatalogError('invalid_response', 'The provider did not return JSON')
  }
}

const asArray = (value: unknown): Array<Record<string, unknown>> => (Array.isArray(value) ? value as Array<Record<string, unknown>> : [])

/** Fetch and normalise one provider's model list. Never throws: failures become `supported: false`. */
export async function fetchModelCatalog(target: CatalogTarget, fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()): Promise<ModelCatalog> {
  // ChatGPT plan tokens are only for inference; there is no list endpoint for them.
  if (target.provider === 'openai' && target.authType === 'oauth') return { supported: false, reason: 'chatgpt_plan' }
  if (target.provider !== 'ollama' && !target.apiKey) return { supported: false, reason: 'no_key' }
  try {
    const models = await listModels(target, fetchImpl)
    const unique = new Map(models.map((model) => [model.id, model]))
    return {
      supported: true,
      models: [...unique.values()].sort((a, b) => Number(b.textCapable) - Number(a.textCapable) || a.name.localeCompare(b.name)),
      fetchedAt: now().toISOString(),
    }
  } catch (error) {
    if (error instanceof CatalogError) return { supported: false, reason: error.reason, detail: error.detail }
    return { supported: false, reason: 'invalid_response', detail: error instanceof Error ? error.message.slice(0, MAX_ERROR_TEXT) : undefined }
  }
}

async function listModels(target: CatalogTarget, fetchImpl: typeof fetch): Promise<CatalogModel[]> {
  switch (target.provider) {
    case 'openai': {
      const body = await getJson(joinUrl(target.baseUrl ?? DEFAULT_BASE.openai, 'models'), { authorization: `Bearer ${target.apiKey}` }, fetchImpl)
      return asArray(body.data).map((row) => {
        const id = String(row.id)
        return { id, name: id, textCapable: !NON_TEXT.test(id) }
      })
    }
    case 'anthropic': {
      const body = await getJson(joinUrl(target.baseUrl ?? DEFAULT_BASE.anthropic, 'models?limit=1000'), { 'x-api-key': target.apiKey!, 'anthropic-version': '2023-06-01' }, fetchImpl)
      return asArray(body.data).map((row) => ({ id: String(row.id), name: String(row.display_name ?? row.id), textCapable: true }))
    }
    case 'google': {
      const body = await getJson(joinUrl(googleBaseUrl(target.baseUrl), 'models?pageSize=1000'), { 'x-goog-api-key': target.apiKey! }, fetchImpl)
      return asArray(body.models).map((row) => {
        const id = String(row.name ?? '').replace(/^models\//, '')
        const methods = asArray(row.supportedGenerationMethods as unknown).length ? row.supportedGenerationMethods as unknown[] : []
        return { id, name: String(row.displayName ?? id), textCapable: methods.includes('generateContent') && !NON_TEXT.test(id) }
      }).filter((model) => model.id)
    }
    case 'openrouter': {
      const body = await getJson(joinUrl(target.baseUrl ?? DEFAULT_BASE.openrouter, 'models'), { authorization: `Bearer ${target.apiKey}` }, fetchImpl)
      return asArray(body.data).map((row) => {
        const id = String(row.id)
        const output = (row.architecture as { output_modalities?: unknown[] } | undefined)?.output_modalities
        const pricing = (row.pricing ?? {}) as Record<string, unknown>
        const parameters = row.supported_parameters
        return {
          id,
          name: String(row.name ?? id),
          textCapable: Array.isArray(output) ? output.includes('text') : !NON_TEXT.test(id),
          priceInputPerMtok: perMillion(pricing.prompt),
          priceOutputPerMtok: perMillion(pricing.completion),
          ...(Array.isArray(parameters)
            ? { supportsStructuredOutput: parameters.includes('structured_outputs') || parameters.includes('response_format') }
            : {}),
        }
      })
    }
    case 'ollama': {
      const body = await getJson(joinUrl(target.baseUrl ?? 'http://localhost:11434', 'api/tags'), target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}, fetchImpl)
      return asArray(body.models).map((row) => {
        const id = String(row.name ?? row.model)
        // Local models cost nothing to call.
        return { id, name: id, textCapable: !NON_TEXT.test(id), priceInputPerMtok: 0, priceOutputPerMtok: 0 }
      })
    }
  }
}

const TTL_MS = 60 * 60_000

/** Per-credential cache so opening the picker does not hit the provider every time. */
export class ModelCatalogCache {
  private readonly entries = new Map<string, { catalog: ModelCatalog, expiresAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  async get(credentialId: string, refresh: boolean, load: () => Promise<ModelCatalog>): Promise<ModelCatalog> {
    const cached = this.entries.get(credentialId)
    if (!refresh && cached && cached.expiresAt > this.now()) return cached.catalog
    const catalog = await load()
    // Failures are not cached, so fixing a key works on the next try.
    if (catalog.supported) this.entries.set(credentialId, { catalog, expiresAt: this.now() + TTL_MS })
    else this.entries.delete(credentialId)
    return catalog
  }

  forget(credentialId: string): void {
    this.entries.delete(credentialId)
  }

  /**
   * Whether a model accepts JSON schema output, from the cached list the
   * picker just loaded; null when unknown (not cached or not listed).
   */
  structuredOutputSupport(credentialId: string, modelId: string): boolean | null {
    const cached = this.entries.get(credentialId)
    if (!cached || cached.expiresAt <= this.now() || !cached.catalog.supported) return null
    return cached.catalog.models.find((model) => model.id === modelId)?.supportsStructuredOutput ?? null
  }
}

export const sharedModelCatalogCache = new ModelCatalogCache()
