import { describe, expect, it, vi } from 'vitest'
import { credentialAssociatedData } from '../report/reportGenerationService.js'
import {
  buildChatGptAuthorizationUrl,
  ChatGptOAuthError,
  CHATGPT_PLAN_SCOPE,
  exchangeChatGptCode,
  siwcClientFromConfig,
  type SiwcClient,
} from './chatgptPlanOAuth.js'
import { ChatGptPlanTokens, isChatGptPlanCredential } from './chatgptPlanTokens.js'
import { SecretCipher } from './secretCipher.js'

const client: SiwcClient = { clientId: 'oaiapp_test', clientSecret: 's3cret', authorizeUrl: 'https://auth.openai.com/api/accounts/authorize', tokenUrl: 'https://auth.openai.com/api/accounts/oauth/token' }
const cipher = SecretCipher.fromBase64(Buffer.alloc(32, 9).toString('base64'))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('ChatGPT OAuth', () => {
  it('stays off without a client id', () => {
    expect(siwcClientFromConfig({ OPENAI_SIWC_AUTHORIZE_URL: client.authorizeUrl, OPENAI_SIWC_TOKEN_URL: client.tokenUrl })).toBeNull()
  })

  it('asks for plan usage on the OpenAI API resource with PKCE', () => {
    const url = new URL(buildChatGptAuthorizationUrl(client, 'https://edulog.example/cb', 'challenge', 'state-1'))
    expect(url.searchParams.get('scope')).toContain(CHATGPT_PLAN_SCOPE)
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('resource')).toBe('https://api.openai.com/v1')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('state-1')
  })

  it('exchanges the code with client_secret_basic and refuses tokens without plan usage', async () => {
    const ok = vi.fn().mockResolvedValue(json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: `openid ${CHATGPT_PLAN_SCOPE}` }))
    const tokens = await exchangeChatGptCode(client, { code: 'c', verifier: 'v', redirectUri: 'https://edulog.example/cb' }, ok)
    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
    const init = ok.mock.calls[0][1]
    expect(init.headers.authorization).toBe(`Basic ${Buffer.from('oaiapp_test:s3cret').toString('base64')}`)
    expect(String(init.body)).toContain('code_verifier=v')

    const identityOnly = vi.fn().mockResolvedValue(json({ access_token: 'at', refresh_token: 'rt', scope: 'openid profile email' }))
    await expect(exchangeChatGptCode(client, { code: 'c', verifier: 'v', redirectUri: 'x' }, identityOnly))
      .rejects.toMatchObject({ code: 'plan_not_granted' })
  })

  it('recognises ChatGPT plan credentials', () => {
    expect(isChatGptPlanCredential({ provider: 'openai', authType: 'oauth' })).toBe(true)
    expect(isChatGptPlanCredential({ provider: 'openai', auth_type: 'api_key' })).toBe(false)
    expect(isChatGptPlanCredential({ provider: 'openrouter', authType: 'oauth' })).toBe(false)
  })
})

/** A single ai_credentials row behind the Supabase query-builder calls the manager uses. */
function credentialDb(row: { secret_ciphertext: string, status: string }) {
  const updates: Record<string, unknown>[] = []
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...row }, error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); Object.assign(row, patch); return { error: null } } }),
    }),
  }
  return { db: db as never, row, updates }
}

describe('ChatGptPlanTokens', () => {
  const id = 'c1000000-0000-4000-8000-000000000001'

  it('refreshes once for concurrent requests and stores the rotated refresh token encrypted', async () => {
    const { db, row, updates } = credentialDb({ secret_ciphertext: cipher.encrypt('rt-1', credentialAssociatedData(id)), status: 'active' })
    let release!: () => void
    const fetchImpl = vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      release = () => resolve(json({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 }))
    }))
    let now = 1_000_000
    const tokens = new ChatGptPlanTokens(client, cipher, fetchImpl, () => now)

    const first = tokens.getAccessToken(db, id)
    const second = tokens.getAccessToken(db, id)
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1))
    release()
    expect(await Promise.all([first, second])).toEqual(['at-2', 'at-2'])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][1].body)).toContain('refresh_token=rt-1')
    expect(cipher.decrypt(row.secret_ciphertext, credentialAssociatedData(id))).toBe('rt-2')
    expect(JSON.stringify(updates)).not.toContain('rt-2')

    // Cached until a minute before expiry.
    now += 3500_000
    expect(await tokens.getAccessToken(db, id)).toBe('at-2')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('marks the credential invalid when the refresh token is rejected', async () => {
    const { db, row } = credentialDb({ secret_ciphertext: cipher.encrypt('rt-old', credentialAssociatedData(id)), status: 'active' })
    const fetchImpl = vi.fn().mockResolvedValue(json({ error: 'invalid_grant' }, 400))
    const tokens = new ChatGptPlanTokens(client, cipher, fetchImpl)
    await expect(tokens.getAccessToken(db, id)).rejects.toMatchObject({ code: 'AI_CREDENTIAL_INVALID' })
    expect(row.status).toBe('invalid')
  })

  it('reports an unreachable token endpoint as a provider error', async () => {
    const { db } = credentialDb({ secret_ciphertext: cipher.encrypt('rt', credentialAssociatedData(id)), status: 'active' })
    const tokens = new ChatGptPlanTokens(client, cipher, vi.fn().mockRejectedValue(new Error('offline')))
    await expect(tokens.getAccessToken(db, id)).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    expect(ChatGptOAuthError).toBeDefined()
  })
})
