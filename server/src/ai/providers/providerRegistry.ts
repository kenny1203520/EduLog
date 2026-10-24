import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import { createOllama } from 'ai-sdk-ollama'
import { createPublicOllamaFetch } from './publicOllamaTransport.js'

export const AI_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter', 'ollama'] as const
export type AiProvider = typeof AI_PROVIDERS[number]

/** Everything needed to call one model; the secret is decrypted by the caller just before use. */
export interface ModelTarget {
  provider: AiProvider
  modelId: string
  /** Not used by Ollama. */
  apiKey?: string
  /** Optional override (proxy, self-hosted endpoint); required for Ollama outside localhost. */
  baseUrl?: string
  /** Personal credentials are restricted to public HTTPS; site credentials retain administrator network access. */
  credentialScope?: 'site' | 'user'
}

export class ModelTargetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelTargetError'
  }
}

/**
 * Build an AI SDK language model for a credential.
 *
 * Ollama uses `ai-sdk-ollama`: the OpenAI-compatible route returned no token
 * usage and reformatted placeholder tokens in the spike (see the design plan).
 */
export function createLanguageModel(target: ModelTarget): LanguageModel {
  const { provider, modelId, apiKey, baseUrl } = target
  if (provider !== 'ollama' && !apiKey) throw new ModelTargetError(`${provider} requires an API key`)
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, baseURL: baseUrl })(modelId)
    case 'openai':
      return createOpenAI({ apiKey, baseURL: baseUrl })(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl })(modelId)
    case 'openrouter':
      return createOpenRouter({ apiKey, baseURL: baseUrl })(modelId)
    case 'ollama':
      return createOllama({
        baseURL: baseUrl ?? 'http://localhost:11434',
        apiKey,
        ...(target.credentialScope === 'user' && baseUrl ? { fetch: createPublicOllamaFetch(baseUrl) } : {}),
      })(modelId)
  }
}
