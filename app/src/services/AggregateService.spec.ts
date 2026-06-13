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
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getUserPreferencesAggregate calls fetch with auth header', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'test-token' } }
    } as any)
    
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ preferences: { time_zone: 'UTC' }, visibility: {} }),
      text: async () => ''
    } as any)

    const result = await AggregateService.getUserPreferencesAggregate()
    expect(result.preferences?.time_zone).toBe('UTC')
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
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
    
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ preferences: { time_zone: 'UTC' } }),
      text: async () => ''
    } as any)

    await AggregateService.getUserPreferencesAggregate()
    await AggregateService.getUserPreferencesAggregate()
    
    // fetch should only be called once due to cache
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('throws an error if the response is not ok', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null }
    } as any)
    
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    } as any)

    await expect(AggregateService.getUserPreferencesAggregate()).rejects.toThrow('AggregateService error: 500 Internal Server Error')
  })
})
