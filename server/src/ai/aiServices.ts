import type { ApiConfig } from '../config/config.js'
import { SecretCipher } from './credentials/secretCipher.js'
import { PresidioClient } from './deidentify/presidioClient.js'
import { siwcClientFromConfig, type SiwcClient } from './credentials/chatgptPlanOAuth.js'
import { ChatGptPlanTokens } from './credentials/chatgptPlanTokens.js'

export type AiServicesConfig = Pick<ApiConfig, 'AI_SECRET_KEY' | 'PRESIDIO_ANALYZER_URL' | 'OPENAI_SIWC_CLIENT_ID' | 'OPENAI_SIWC_CLIENT_SECRET'>

/**
 * The AI building blocks derived from config, built once per app so every
 * router shares one cipher, one Presidio client and one ChatGPT token cache.
 * Each is null when its config is absent.
 */
export interface AiServices {
  cipher: SecretCipher | null
  presidio: PresidioClient | null
  /** "Sign in with ChatGPT" stays hidden until an OpenAI-approved client is configured. */
  siwc: SiwcClient | null
  chatgptTokens: ChatGptPlanTokens | null
}

export function createAiServices(config: AiServicesConfig): AiServices {
  const cipher = config.AI_SECRET_KEY ? SecretCipher.fromBase64(config.AI_SECRET_KEY) : null
  const siwc = siwcClientFromConfig(config)
  return {
    cipher,
    presidio: config.PRESIDIO_ANALYZER_URL ? new PresidioClient(config.PRESIDIO_ANALYZER_URL) : null,
    siwc,
    chatgptTokens: siwc && cipher ? new ChatGptPlanTokens(siwc, cipher) : null,
  }
}
