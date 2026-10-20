import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { buildAuthorizationUrl, createPkcePair, exchangeCodeForKey, OpenRouterExchangeError, PendingPkceStore } from './openRouterOAuth.js'

describe('OpenRouter PKCE', () => {
  it('derives an S256 challenge and builds the authorization URL', () => {
    const { verifier, challenge } = createPkcePair()
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    const url = new URL(buildAuthorizationUrl('https://edulog.example/dashboard/settings?tab=personal&ai_oauth=openrouter', challenge))
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('callback_url')).toContain('ai_oauth=openrouter')
  })

  it('hands out a pending verifier once and forgets expired ones', () => {
    let now = 0
    const store = new PendingPkceStore(() => now)
    store.put('u1', 'v1')
    expect(store.take('u1')).toBe('v1')
    expect(store.take('u1')).toBeNull()
    store.put('u1', 'v2')
    now = 11 * 60_000
    expect(store.take('u1')).toBeNull()
  })

  it('exchanges the code with the verifier and rejects bad responses', async () => {
    const fetchOk = vi.fn().mockResolvedValue(new Response(JSON.stringify({ key: 'sk-or-v1-abc' }), { status: 200 }))
    expect(await exchangeCodeForKey('code-1', 'verifier-1', fetchOk)).toBe('sk-or-v1-abc')
    expect(JSON.parse(fetchOk.mock.calls[0][1].body)).toEqual({ code: 'code-1', code_verifier: 'verifier-1', code_challenge_method: 'S256' })

    const fetchBad = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }))
    await expect(exchangeCodeForKey('code-1', 'verifier-1', fetchBad)).rejects.toBeInstanceOf(OpenRouterExchangeError)
  })
})
