import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AggregateService } from './AggregateService'

describe('AggregateService', () => {
  beforeEach(() => {
    AggregateService.clearCache()
    vi.clearAllMocks()
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getUserPreferencesAggregate calls the page API with same-origin credentials', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { preferences: { time_zone: 'UTC' }, visibility: {} }, request_id: 'request', trace_id: 'trace' }),
      text: async () => ''
    } as any)

    const result = await AggregateService.getUserPreferencesAggregate()
    expect(result.preferences?.time_zone).toBe('UTC')
    const [url, options] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toBe('/api/pages/me/preferences')
    expect(options).toEqual(expect.objectContaining({ credentials: 'include' }))
    expect((options?.headers as Headers).get('X-Request-Id')).toMatch(/^edulog-/)
    expect((options?.headers as Headers).get('traceparent')).toMatch(/^00-/)
  })

  it('getUserPreferencesAggregate uses cache on subsequent calls', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { preferences: { time_zone: 'UTC' }, visibility: {} }, request_id: 'request', trace_id: 'trace' }),
      text: async () => ''
    } as any)

    await AggregateService.getUserPreferencesAggregate()
    await AggregateService.getUserPreferencesAggregate()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('throws an error if the response is not ok', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error', request_id: 'request', trace_id: 'trace' } }),
    } as any)

    await expect(AggregateService.getUserPreferencesAggregate()).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' })
  })

  it('keeps incomplete report aggregate cache entries separated by scope', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'my-report' }], request_id: 'request', trace_id: 'trace' }),
        text: async () => ''
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'all-report' }], request_id: 'request', trace_id: 'trace' }),
        text: async () => ''
      } as any)

    await AggregateService.getIncompleteReportsAggregate(90, 'my_present')
    await AggregateService.getIncompleteReportsAggregate(90, 'all')

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toContain('/api/pages/reports/incomplete?days_back=90&scope=my_present')
    expect(vi.mocked(globalThis.fetch).mock.calls[1][0]).toContain('/api/pages/reports/incomplete?days_back=90&scope=all')
  })

  it('never caches policy-aware notification results', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], request_id: 'request', trace_id: 'trace' }),
      text: async () => ''
    } as any)

    await AggregateService.getIncompleteReportsAggregate(90, 'my_notifications')
    await AggregateService.getIncompleteReportsAggregate(90, 'my_notifications')

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(globalThis.fetch).mock.calls[0][1]).toEqual(expect.objectContaining({ cache: 'no-store' }))
    expect(vi.mocked(globalThis.fetch).mock.calls[1][1]).toEqual(expect.objectContaining({ cache: 'no-store' }))
  })

  it('loads every holiday page through the page endpoint instead of silently truncating at 100', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: Array.from({ length: 100 }, (_, index) => ({ id: `holiday-${index}` })), meta: { total: 101 }, request_id: 'request', trace_id: 'trace' }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'holiday-100' }], meta: { total: 101 }, request_id: 'request', trace_id: 'trace' }),
        text: async () => '',
      } as any)

    const holidays = await AggregateService.getHolidaysAggregate()
    expect(holidays).toHaveLength(101)
    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/pages/holidays/overview?expand=true&limit=100&offset=0',
      '/api/pages/holidays/overview?expand=true&limit=100&offset=100',
    ])
  })

  it('loads every classroom page without repeating an offset', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { classrooms: [{ id: 'classroom-0' }], count: 101 }, meta: { total: 101 }, request_id: 'request', trace_id: 'trace' }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { classrooms: [{ id: 'classroom-100' }], count: 101 }, meta: { total: 101 }, request_id: 'request', trace_id: 'trace' }),
        text: async () => '',
      } as any)

    const result = await AggregateService.getAllClassroomsOverview()

    expect(vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)).toEqual([
      '/api/pages/classrooms/overview?limit=100&offset=0&visibility=all&session_limit=1',
      '/api/pages/classrooms/overview?limit=100&offset=100&visibility=all&session_limit=1',
    ])
    expect(result.classrooms.map((classroom) => classroom.id)).toEqual(['classroom-0', 'classroom-100'])
    expect(result.count).toBe(101)
  })

  it('fails instead of returning a partial classroom collection', async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { classrooms: [{ id: 'classroom-0' }], count: 101 }, meta: { total: 101 }, request_id: 'request', trace_id: 'trace' }),
        text: async () => '',
      } as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Temporary failure', request_id: 'request', trace_id: 'trace' } }),
        text: async () => '',
      } as any)

    await expect(AggregateService.getAllClassroomsOverview()).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' })
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2)
  })

  it('does not request another classroom page for an empty result', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { classrooms: [], count: 0 }, meta: { total: 0 }, request_id: 'request', trace_id: 'trace' }),
      text: async () => '',
    } as any)

    const result = await AggregateService.getAllClassroomsOverview()

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(result.classrooms).toEqual([])
  })
})
