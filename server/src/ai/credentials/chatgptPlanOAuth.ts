import { randomBytes } from 'node:crypto'

/**
 * "Sign in with ChatGPT" with plan usage
 * (https://developers.openai.com/siwc): a teacher authorizes EduLog on
 * auth.openai.com and requests then count against their own ChatGPT Plus/Pro
 * allowance. Needs an OpenAI-approved website client (OPENAI_SIWC_CLIENT_ID).
 */

export const CHATGPT_PLAN_SCOPE = 'chatgpt.tokens.use.direct'
export const CHATGPT_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'resource.invoke', CHATGPT_PLAN_SCOPE].join(' ')
export const CHATGPT_RESOURCE = 'https://api.openai.com/v1'

export interface SiwcClient {
  clientId: string
  /** Confidential website clients authenticate with client_secret_basic. */
  clientSecret?: string
  authorizeUrl: string
  tokenUrl: string
}

export interface ChatGptTokens {
  accessToken: string
  /** Rotating: every refresh may return a new one that replaces the old. */
  refreshToken: string | null
  expiresIn: number
  scope: string
}

export class ChatGptOAuthError extends Error {
  constructor(readonly code: 'invalid_grant' | 'plan_not_granted' | 'request_failed', message: string) {
    super(message)
    this.name = 'ChatGptOAuthError'
  }
}

export function createOAuthState(): string {
  return randomBytes(24).toString('base64url')
}

export function buildChatGptAuthorizationUrl(client: SiwcClient, redirectUri: string, challenge: string, state: string): string {
  const url = new URL(client.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', client.clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', CHATGPT_SCOPES)
  url.searchParams.set('resource', CHATGPT_RESOURCE)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  return url.toString()
}

async function tokenRequest(client: SiwcClient, params: Record<string, string>, fetchImpl: typeof fetch): Promise<ChatGptTokens> {
  const body = new URLSearchParams(params)
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  if (client.clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString('base64')}`
  } else {
    body.set('client_id', client.clientId)
  }
  let response: Response
  try {
    response = await fetchImpl(client.tokenUrl, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new ChatGptOAuthError('request_failed', 'OpenAI token endpoint is unreachable')
  }
  const json = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) {
    if (json?.error === 'invalid_grant') throw new ChatGptOAuthError('invalid_grant', 'The ChatGPT authorization is no longer valid')
    throw new ChatGptOAuthError('request_failed', `OpenAI token endpoint returned ${response.status}`)
  }
  if (typeof json?.access_token !== 'string') throw new ChatGptOAuthError('request_failed', 'OpenAI returned no access token')
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === 'number' ? json.expires_in : 3600,
    scope: typeof json.scope === 'string' ? json.scope : '',
  }
}

/** Exchange the callback code; refuses tokens that cannot spend the ChatGPT plan. */
export async function exchangeChatGptCode(client: SiwcClient, input: { code: string, verifier: string, redirectUri: string }, fetchImpl: typeof fetch = fetch): Promise<ChatGptTokens> {
  const tokens = await tokenRequest(client, {
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    resource: CHATGPT_RESOURCE,
  }, fetchImpl)
  if (!tokens.scope.split(/\s+/).includes(CHATGPT_PLAN_SCOPE)) {
    throw new ChatGptOAuthError('plan_not_granted', 'ChatGPT plan usage was not granted')
  }
  if (!tokens.refreshToken) throw new ChatGptOAuthError('request_failed', 'OpenAI returned no refresh token')
  return tokens
}

export function refreshChatGptToken(client: SiwcClient, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<ChatGptTokens> {
  return tokenRequest(client, { grant_type: 'refresh_token', refresh_token: refreshToken, resource: CHATGPT_RESOURCE }, fetchImpl)
}

/** OpenAI's fixed "Sign in with ChatGPT" endpoints (vendor constants, not deployment config). */
export const OPENAI_SIWC_AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize'
export const OPENAI_SIWC_TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'

/** The configured website client, or null while the feature is off. */
export function siwcClientFromConfig(config: {
  OPENAI_SIWC_CLIENT_ID?: string
  OPENAI_SIWC_CLIENT_SECRET?: string
}): SiwcClient | null {
  if (!config.OPENAI_SIWC_CLIENT_ID) return null
  return {
    clientId: config.OPENAI_SIWC_CLIENT_ID,
    clientSecret: config.OPENAI_SIWC_CLIENT_SECRET,
    authorizeUrl: OPENAI_SIWC_AUTHORIZE_URL,
    tokenUrl: OPENAI_SIWC_TOKEN_URL,
  }
}
