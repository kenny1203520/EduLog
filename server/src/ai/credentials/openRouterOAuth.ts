import { createHash, randomBytes } from 'node:crypto'

/**
 * OpenRouter OAuth PKCE (https://openrouter.ai/docs/guides/overview/auth/oauth):
 * the teacher authorizes on openrouter.ai and comes back with `?code=`, which
 * the server exchanges for a key billed to the teacher's own OpenRouter credits.
 */

export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/api/v1/auth/keys'
const PENDING_TTL_MS = 10 * 60_000

export function createPkcePair(): { verifier: string, challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function buildAuthorizationUrl(callbackUrl: string, challenge: string): string {
  const url = new URL(OPENROUTER_AUTH_URL)
  url.searchParams.set('callback_url', callbackUrl)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/**
 * Verifiers waiting for the callback, one per user. In memory: the API runs
 * as a single process, and a restart only means the teacher clicks "connect" again.
 */
export class PendingPkceStore {
  private readonly pending = new Map<string, { verifier: string, expiresAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  put(userId: string, verifier: string): void {
    this.sweep()
    this.pending.set(userId, { verifier, expiresAt: this.now() + PENDING_TTL_MS })
  }

  /** One-time read; expired entries are treated as missing. */
  take(userId: string): string | null {
    const entry = this.pending.get(userId)
    this.pending.delete(userId)
    if (!entry || entry.expiresAt < this.now()) return null
    return entry.verifier
  }

  private sweep(): void {
    const now = this.now()
    for (const [key, entry] of this.pending) if (entry.expiresAt < now) this.pending.delete(key)
  }
}

export class OpenRouterExchangeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenRouterExchangeError'
  }
}

export async function exchangeCodeForKey(code: string, verifier: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(OPENROUTER_KEYS_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new OpenRouterExchangeError(`OpenRouter returned ${response.status}`)
  const body = await response.json().catch(() => null) as { key?: unknown } | null
  if (typeof body?.key !== 'string' || !body.key) throw new OpenRouterExchangeError('OpenRouter returned no key')
  return body.key
}
