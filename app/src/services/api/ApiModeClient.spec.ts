import { describe, expect, it, vi } from 'vitest'
import { ApiModeClient } from './ApiModeClient'

describe('ApiModeClient', () => {
  it('uses a deterministic contract envelope in mock mode without network access', async () => {
    const request = vi.fn()
    const client = new ApiModeClient({ request }, { request }, undefined)
    const result = await client.get('/teachings', undefined, 'mock')
    expect(result.meta).toMatchObject({ mode: 'mock' })
    expect(request).not.toHaveBeenCalled()
  })

  it('routes legacy and v1 modes through their respective transports', async () => {
    const v1 = { request: vi.fn().mockResolvedValue({ data: 'v1' }) }
    const legacy = { request: vi.fn().mockResolvedValue({ data: 'legacy' }) }
    const client = new ApiModeClient(v1, legacy)
    await expect(client.get('/teachings', undefined, 'legacy')).resolves.toMatchObject({ data: 'legacy' })
    await expect(client.get('/teachings', undefined, 'v1')).resolves.toMatchObject({ data: 'v1' })
    expect(legacy.request).toHaveBeenCalled()
    expect(v1.request).toHaveBeenCalled()
  })
})
