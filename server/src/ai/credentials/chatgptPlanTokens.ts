import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError, mapDatabaseError } from '../../http/errors.js'
import { credentialAssociatedData } from '../report/reportGenerationService.js'
import { ChatGptOAuthError, refreshChatGptToken, type SiwcClient } from './chatgptPlanOAuth.js'
import type { SecretCipher } from './secretCipher.js'

/** Refresh this long before expiry so a request never starts with a dying token. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * Access tokens for "Sign in with ChatGPT" credentials. The rotating refresh
 * token is stored encrypted in ai_credentials.secret_ciphertext; access tokens
 * (about an hour) live only in memory. Refreshes are single-flight per
 * credential, because a rotated refresh token cannot be used twice.
 */
export class ChatGptPlanTokens {
  private readonly cache = new Map<string, { token: string, expiresAt: number }>()
  private readonly inflight = new Map<string, Promise<string>>()

  constructor(
    private readonly client: SiwcClient,
    private readonly cipher: SecretCipher,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Keep the access token returned by the initial code exchange. */
  remember(credentialId: string, accessToken: string, expiresIn: number): void {
    this.cache.set(credentialId, { token: accessToken, expiresAt: this.now() + expiresIn * 1000 })
  }

  forget(credentialId: string): void {
    this.cache.delete(credentialId)
  }

  async getAccessToken(db: SupabaseClient, credentialId: string): Promise<string> {
    const cached = this.cache.get(credentialId)
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > this.now()) return cached.token
    let pending = this.inflight.get(credentialId)
    if (!pending) {
      pending = this.refresh(db, credentialId).finally(() => this.inflight.delete(credentialId))
      this.inflight.set(credentialId, pending)
    }
    return pending
  }

  private async refresh(db: SupabaseClient, credentialId: string): Promise<string> {
    const row = await db.from('ai_credentials').select('secret_ciphertext,status').eq('id', credentialId).maybeSingle()
    if (row.error) throw mapDatabaseError(row.error)
    if (!row.data?.secret_ciphertext || row.data.status !== 'active') {
      throw new ApiError(409, 'AI_CREDENTIAL_INVALID', 'Reconnect your ChatGPT account')
    }
    const refreshToken = this.cipher.decrypt(row.data.secret_ciphertext, credentialAssociatedData(credentialId))

    let tokens
    try {
      tokens = await refreshChatGptToken(this.client, refreshToken, this.fetchImpl)
    } catch (error) {
      if (error instanceof ChatGptOAuthError && error.code === 'invalid_grant') {
        this.forget(credentialId)
        const marked = await db.from('ai_credentials').update({ status: 'invalid' }).eq('id', credentialId)
        if (marked.error) throw mapDatabaseError(marked.error)
        throw new ApiError(409, 'AI_CREDENTIAL_INVALID', 'Reconnect your ChatGPT account')
      }
      throw new ApiError(502, 'AI_PROVIDER_ERROR', 'Could not renew the ChatGPT authorization')
    }

    if (tokens.refreshToken && tokens.refreshToken !== refreshToken) {
      const saved = await db.from('ai_credentials')
        .update({ secret_ciphertext: this.cipher.encrypt(tokens.refreshToken, credentialAssociatedData(credentialId)), last_verified_at: new Date(this.now()).toISOString() })
        .eq('id', credentialId)
      if (saved.error) throw mapDatabaseError(saved.error)
    }
    this.remember(credentialId, tokens.accessToken, tokens.expiresIn)
    return tokens.accessToken
  }
}

/** True for credentials created by "Sign in with ChatGPT" (OpenAI + OAuth). */
export function isChatGptPlanCredential(credential: { provider: string, authType?: string, auth_type?: string }): boolean {
  return credential.provider === 'openai' && (credential.authType ?? credential.auth_type) === 'oauth'
}
