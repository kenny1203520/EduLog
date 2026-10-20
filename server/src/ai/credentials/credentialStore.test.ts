import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { testCredential } from './credentialStore.js'

/** Just enough of the Supabase client for testCredential: one credential row and its updates. */
function fakeDb() {
  const updates: Array<Record<string, unknown>> = []
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { provider: 'openrouter', auth_type: 'none', secret_ciphertext: null, base_url: null }, error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null } } }),
    }),
  }
  return { db: db as never, updates }
}

function failingModel(statusCode: number, message: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw Object.assign(new Error('Provider returned error'), { name: 'AI_APICallError', statusCode, responseBody: JSON.stringify({ error: { message } }) })
    },
  })
}

async function run(model: MockLanguageModelV4) {
  const { db, updates } = fakeDb()
  const result = await testCredential(db, null, 'c1', 'google/gemma:free', { createModel: () => model })
  return { result, updates }
}

describe('testCredential', () => {
  it('reports why OpenRouter refused a free model without marking the key invalid', async () => {
    const { result, updates } = await run(failingModel(404, 'No endpoints found matching your data policy (Free model publication). Configure: https://openrouter.ai/settings/privacy'))
    expect(result).toMatchObject({ ok: false, failure: 'DATA_POLICY', status: 404 })
    expect(result.message).toContain('data policy')
    expect(updates).toEqual([])
  })

  it('keeps the key usable when the model is only rate limited', async () => {
    const { result, updates } = await run(failingModel(429, 'Rate limit exceeded: free-models-per-day'))
    expect(result).toMatchObject({ ok: false, failure: 'RATE_LIMITED', status: 429 })
    expect(updates).toEqual([])
  })

  it('marks the credential invalid when the provider rejects the key', async () => {
    const { result, updates } = await run(failingModel(401, 'User not found.'))
    expect(result).toMatchObject({ ok: false, failure: 'AUTH_FAILED', status: 401, message: 'User not found.' })
    expect(updates).toEqual([{ status: 'invalid' }])
  })

  it('marks the credential active on any successful reply', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: 'OK' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 1, text: 1, reasoning: undefined } },
        warnings: [],
      }),
    })
    const { result, updates } = await run(model)
    expect(result).toMatchObject({ ok: true, failure: null, status: null })
    expect(updates[0]).toMatchObject({ status: 'active' })
  })
})
