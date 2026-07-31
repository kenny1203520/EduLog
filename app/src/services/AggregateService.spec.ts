import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AggregateService } from './AggregateService'
import { supabase } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn()
    }
  }
}))

describe('AggregateService', () => {
  beforeEach(() => {
    AggregateService.clearCache()
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getUserPreferencesAggregate calls fetch with auth header', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'test-token' } }
    } as any)
    
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ preferences: { time_zone: 'UTC' }, visibility: {} }),
      text: async () => ''
    } as any)

    const result = await AggregateService.getUserPreferencesAggregate()
    expect(result.preferences?.time_zone).toBe('UTC')
    expect(globalThis.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      }
    }))
  })

  it('getUserPreferencesAggregate uses cache on subsequent calls', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null }
    } as any)
    
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ preferences: { time_zone: 'UTC' } }),
      text: async () => ''
    } as any)

    await AggregateService.getUserPreferencesAggregate()
    await AggregateService.getUserPreferencesAggregate()
    
    // fetch should only be called once due to cache
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('throws an error if the response is not ok', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null }
    } as any)
    
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    } as any)

    await expect(AggregateService.getUserPreferencesAggregate()).rejects.toThrow('AggregateService error: 500 Internal Server Error')
  })

  it('keeps incomplete report aggregate cache entries separated by scope', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'test-token' } }
    } as any)

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'my-report' }],
        text: async () => ''
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'all-report' }],
        text: async () => ''
      } as any)

    await AggregateService.getIncompleteReportsAggregate(90, 'my_present')
    await AggregateService.getIncompleteReportsAggregate(90, 'all')

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toContain('scope=my_present')
    expect(vi.mocked(globalThis.fetch).mock.calls[1][0]).toContain('scope=all')
  })

  it('never caches policy-aware notification results', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'yuan-token' } }
    } as any)

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => [],
      text: async () => ''
    } as any)

    await AggregateService.getIncompleteReportsAggregate(90, 'my_notifications')
    await AggregateService.getIncompleteReportsAggregate(90, 'my_notifications')

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toEqual(expect.objectContaining({ cache: 'no-store' }))
    expect(vi.mocked(globalThis.fetch).mock.calls[1][1]).toEqual(expect.objectContaining({ cache: 'no-store' }))
  })
})
