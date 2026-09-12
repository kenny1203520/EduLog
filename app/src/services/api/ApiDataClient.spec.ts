import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getMock, postMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(), postMock: vi.fn(), patchMock: vi.fn(), deleteMock: vi.fn(),
}))

vi.mock('./ApiV1Client', () => ({
  apiV1Client: { get: getMock, post: postMock, patch: patchMock, delete: deleteMock },
}))

import { apiDataClient } from './ApiDataClient'

describe('ApiDataClient server-side query compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getMock.mockResolvedValue({ data: [{ id: '1' }, { id: '2' }], meta: { total: 8 } })
    postMock.mockResolvedValue({ data: { id: 'created' } })
  })

  it('preserves ilike/or/contains filters and range offset in the API request', async () => {
    await apiDataClient.from('teachers')
      .select('*')
      .ilike('name', '%Ada%')
      .contains('teacher_ids', ['teacher-1'])
      .or('name.ilike.%Ada%,email.ilike.%example.test%')
      .range(20, 24)

    const path = String(getMock.mock.calls[0][0])
    const query = new URL(path, 'http://localhost').searchParams
    expect(query.get('offset')).toBe('20')
    expect(query.get('limit')).toBe('5')
    expect(JSON.parse(query.get('filters') ?? '')).toEqual([
      { field: 'name', operator: 'ilike', value: '%Ada%' },
      { field: 'teacher_ids', operator: 'contains', value: ['teacher-1'] },
    ])
    expect(query.get('or')).toBe('name.ilike.%Ada%,email.ilike.%example.test%')
  })

  it('uses the server total instead of a client-side filtered row count', async () => {
    const result = await apiDataClient.from('teachers').select('*')
    expect(result.count).toBe(8)
  })

  it('submits every row for a bulk insert', async () => {
    const result = await apiDataClient.from('teachers').insert([{ name: 'A' }, { name: 'B' }])
    expect(postMock).toHaveBeenCalledTimes(2)
    expect(result.data).toEqual([{ id: 'created' }, { id: 'created' }])
  })

  it('maps known compatibility RPCs to scoped REST operations', async () => {
    getMock.mockResolvedValueOnce({ data: ['enrollment-1'], meta: {}, request_id: 'r', trace_id: 't' })
    const result = await apiDataClient.rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: 'occurrence-1' })
    expect(getMock).toHaveBeenCalledWith('/occurrences/occurrence-1/roster')
    expect(result.data).toEqual(['enrollment-1'])
  })
})
