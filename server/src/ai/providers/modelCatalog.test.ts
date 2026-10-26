import { describe, expect, it, vi } from 'vitest'
import { fetchModelCatalog, ModelCatalogCache, type ModelCatalog } from './modelCatalog.js'

const reply = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
const ids = (catalog: ModelCatalog, onlyText = false) => catalog.supported ? catalog.models.filter((m) => !onlyText || m.textCapable).map((m) => m.id) : []

describe('fetchModelCatalog', () => {
  it('lists OpenAI models and marks non-text ones', async () => {
    const fetchImpl = reply({ data: [{ id: 'gpt-5' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'gpt-5-mini' }] })
    const catalog = await fetchModelCatalog({ provider: 'openai', authType: 'api_key', apiKey: 'sk' }, fetchImpl)
    expect(ids(catalog, true)).toEqual(['gpt-5', 'gpt-5-mini'])
    expect(ids(catalog)).toHaveLength(4)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.openai.com/v1/models')
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer sk')
  })

  it('reads Anthropic display names with the API key header', async () => {
    const fetchImpl = reply({ data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }] })
    const catalog = await fetchModelCatalog({ provider: 'anthropic', authType: 'api_key', apiKey: 'k' }, fetchImpl)
    expect(catalog.supported && catalog.models[0]).toEqual({ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', textCapable: true })
    expect(fetchImpl.mock.calls[0][1].headers['x-api-key']).toBe('k')
  })

  it('keeps Gemini models that can generate content', async () => {
    const fetchImpl = reply({ models: [
      { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
    ] })
    const catalog = await fetchModelCatalog({ provider: 'google', authType: 'api_key', apiKey: 'g' }, fetchImpl)
    expect(ids(catalog, true)).toEqual(['gemini-3-pro'])
  })

  it('converts OpenRouter per-token prices to USD per million tokens', async () => {
    const fetchImpl = reply({ data: [
      { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { output_modalities: ['text'] } },
      { id: 'openai/gpt-image-2', name: 'GPT Image', pricing: { prompt: '0.00001' }, architecture: { output_modalities: ['image'] } },
    ] })
    const catalog = await fetchModelCatalog({ provider: 'openrouter', authType: 'oauth', apiKey: 'or' }, fetchImpl)
    expect(catalog.supported && catalog.models[0]).toMatchObject({ id: 'anthropic/claude-sonnet-5.5', textCapable: true, priceInputPerMtok: 3, priceOutputPerMtok: 15 })
    expect(ids(catalog, true)).toEqual(['anthropic/claude-sonnet-5.5'])
  })

  it('lists Ollama models with full IDs, free prices, and the optional Bearer token', async () => {
    const fetchImpl = reply({ models: [{ name: 'qwen3.5:9b' }, { name: 'nomic-embed-text' }] })
    const catalog = await fetchModelCatalog({ provider: 'ollama', authType: 'api_key', apiKey: 'ollama-token', baseUrl: 'https://ollama.example.test/prefix////' }, fetchImpl)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://ollama.example.test/prefix/api/tags')
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer ollama-token')
    expect(catalog.supported && catalog.models.find((m) => m.id === 'qwen3.5:9b')).toMatchObject({ textCapable: true, priceInputPerMtok: 0 })
    expect(ids(catalog, true)).toEqual(['qwen3.5:9b'])
  })

  it('does not send Authorization for tokenless Ollama and caps catalog responses', async () => {
    const noTokenFetch = reply({ models: [{ name: 'qwen3:8b' }] })
    await fetchModelCatalog({ provider: 'ollama', authType: 'none', baseUrl: 'http://ollama:11434' }, noTokenFetch)
    expect(noTokenFetch.mock.calls[0][1].headers.authorization).toBeUndefined()

    const largeFetch = vi.fn().mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 }))
    const result = await fetchModelCatalog({ provider: 'ollama', authType: 'none', baseUrl: 'http://ollama:11434' }, largeFetch)
    expect(result).toEqual({ supported: false, reason: 'Model list response exceeds 2 MiB' })
  })

  it('returns safe manual-entry outcomes for TLS and timeout failures', async () => {
    for (const message of ['certificate verify failed', 'request timed out']) {
      const failedFetch = vi.fn().mockRejectedValue(new Error(message))
      expect(await fetchModelCatalog({ provider: 'ollama', authType: 'none', baseUrl: 'https://ollama.example.com' }, failedFetch)).toEqual({ supported: false, reason: message })
    }
  })

  it('falls back to manual entry for ChatGPT plans, missing keys and errors', async () => {
    expect(await fetchModelCatalog({ provider: 'openai', authType: 'oauth', apiKey: 'token' }, vi.fn())).toEqual({ supported: false, reason: 'chatgpt_plan' })
    expect(await fetchModelCatalog({ provider: 'anthropic', authType: 'api_key' }, vi.fn())).toEqual({ supported: false, reason: 'no_key' })
    expect(await fetchModelCatalog({ provider: 'openai', authType: 'api_key', apiKey: 'bad' }, reply({}, 401))).toEqual({ supported: false, reason: 'HTTP 401' })
  })
})

describe('ModelCatalogCache', () => {
  it('reuses a catalog for an hour, refreshes on demand and never caches failures', async () => {
    let now = 0
    const cache = new ModelCatalogCache(() => now)
    const ok: ModelCatalog = { supported: true, models: [], fetchedAt: 'x' }
    const load = vi.fn().mockResolvedValue(ok)
    await cache.get('c1', false, load)
    await cache.get('c1', false, load)
    expect(load).toHaveBeenCalledTimes(1)
    await cache.get('c1', true, load)
    expect(load).toHaveBeenCalledTimes(2)
    now = 61 * 60_000
    await cache.get('c1', false, load)
    expect(load).toHaveBeenCalledTimes(3)

    const failing = vi.fn().mockResolvedValue({ supported: false, reason: 'HTTP 500' })
    await cache.get('c2', false, failing)
    await cache.get('c2', false, failing)
    expect(failing).toHaveBeenCalledTimes(2)
  })
})
