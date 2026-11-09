import type { LanguageModel } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ollama = vi.hoisted(() => ({ createOllama: vi.fn() }))
vi.mock('ai-sdk-ollama', () => ({ createOllama: ollama.createOllama }))

import { createLanguageModel } from './providerRegistry.js'

describe('Ollama model configuration', () => {
  const model = {} as LanguageModel
  const instance = vi.fn(() => model)

  beforeEach(() => {
    vi.clearAllMocks()
    ollama.createOllama.mockReturnValue(instance)
  })

  it('uses the stored Bearer token and guarded fetch for personal Ollama', () => {
    expect(createLanguageModel({ provider: 'ollama', modelId: 'qwen3:8b-instruct-q4_K_M', apiKey: 'token-value', baseUrl: 'https://ollama.example.com/prefix', credentialScope: 'user' })).toBe(model)
    expect(ollama.createOllama).toHaveBeenCalledOnce()
    const settings = ollama.createOllama.mock.calls[0][0]
    expect(settings).toMatchObject({ apiKey: 'token-value', baseURL: 'https://ollama.example.com/prefix' })
    expect(typeof settings.fetch).toBe('function')
    expect(instance).toHaveBeenCalledWith('qwen3:8b-instruct-q4_K_M')
  })

  it('keeps site-managed internal Ollama on its configured endpoint without the public transport', () => {
    createLanguageModel({ provider: 'ollama', modelId: 'llama3', baseUrl: 'http://ollama:11434', credentialScope: 'site' })
    expect(ollama.createOllama.mock.calls[0][0]).toMatchObject({ baseURL: 'http://ollama:11434', apiKey: undefined })
    expect(ollama.createOllama.mock.calls[0][0].fetch).toBeUndefined()
  })
})
