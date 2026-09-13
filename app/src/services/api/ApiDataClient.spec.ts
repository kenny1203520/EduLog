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

  it('does not forward client-controlled ownership on child writes', async () => {
    await apiDataClient.from('student_contacts').insert({
      student_id: '00000000-0000-4000-8000-000000000001',
      name: 'Parent',
      user_id: '00000000-0000-4000-8000-000000000099',
    })

    expect(postMock).toHaveBeenCalledWith('/student-contacts', {
      student_id: '00000000-0000-4000-8000-000000000001',
      name: 'Parent',
    })
  })

  it('exposes the BFF session instead of returning a permanent null session', async () => {
    getMock.mockResolvedValueOnce({ data: { id: 'user-1' }, meta: {}, request_id: 'r', trace_id: 't' })
    const result = await apiDataClient.auth.getSession()
    expect(getMock).toHaveBeenCalledWith('/auth/me')
    expect(result.data.session).toEqual({ user: { id: 'user-1' } })
    expect(result.error).toBeNull()
  })

  it('maps known compatibility RPCs to scoped REST operations', async () => {
    getMock.mockResolvedValueOnce({ data: ['enrollment-1'], meta: {}, request_id: 'r', trace_id: 't' })
    const result = await apiDataClient.rpc('get_effective_occurrence_enrollment_ids', { p_occurrence_id: 'occurrence-1' })
    expect(getMock).toHaveBeenCalledWith('/occurrences/occurrence-1/roster')
    expect(result.data).toEqual(['enrollment-1'])
  })

  it('maps RBAC policy replacement to the permission policy REST route', async () => {
    const permissionId = '00000000-0000-4000-8000-000000000010'
    getMock.mockResolvedValueOnce({ data: [{ id: permissionId, key: 'rbac.manage' }], meta: {}, request_id: 'r', trace_id: 't' })
    patchMock.mockResolvedValueOnce({ data: { permission_id: permissionId }, meta: {}, request_id: 'r2', trace_id: 't2' })
    const result = await apiDataClient.rpc('replace_role_permission_policies', {
      p_permission_key: 'rbac.manage',
      p_scope_type: 'teaching',
      p_scope_id: '00000000-0000-4000-8000-000000000011',
      p_policies: [{ role_id: '00000000-0000-4000-8000-000000000012', effect: 'allow' }],
    })
    expect(getMock).toHaveBeenCalledWith('/permissions?search=rbac.manage&limit=100&offset=0&sort=key')
    expect(patchMock).toHaveBeenCalledWith(`/permissions/${permissionId}/policies`, {
      scope: { type: 'teaching', id: '00000000-0000-4000-8000-000000000011' },
      policies: [{ role_id: '00000000-0000-4000-8000-000000000012', effect: 'allow' }],
    })
    expect(result.error).toBeNull()
  })

  it('maps collaboration document reads to the report collaboration route', async () => {
    getMock.mockResolvedValueOnce({ data: { snapshot_base64: null, base_report_version: null }, meta: {}, request_id: 'r', trace_id: 't' })
    const result = await apiDataClient.from('report_collab_docs')
      .select('snapshot_base64, base_report_version')
      .eq('occurrence_report_id', 'report-1')
      .maybeSingle()
    expect(getMock).toHaveBeenCalledWith('/reports/report-1/collaboration')
    expect(result.data).toEqual({ snapshot_base64: null, base_report_version: null })
  })

  it('maps collaboration snapshot writes using the canonical report id argument', async () => {
    postMock.mockResolvedValueOnce({ data: { saved: true }, meta: {}, request_id: 'r', trace_id: 't' })
    const result = await apiDataClient.rpc('save_report_collab_snapshot', {
      p_occurrence_report_id: 'report-1',
      p_snapshot_base64: 'c25hcHNob3Q=',
      p_base_report_version: 3,
    })

    expect(postMock).toHaveBeenCalledWith('/reports/report-1/collaboration', {
      snapshot_base64: 'c25hcHNob3Q=',
      base_report_version: 3,
    })
    expect(result.data).toEqual(true)
    expect(result.error).toBeNull()
  })

  it('maps teaching member table compatibility to the nested scoped route', async () => {
    getMock.mockResolvedValueOnce({ data: { teaching_id: 'teaching-1', user_id: 'user-1' }, meta: {}, request_id: 'r', trace_id: 't' })
    const result = await apiDataClient.from('teaching_members')
      .select('*')
      .eq('teaching_id', 'teaching-1')
      .eq('user_id', 'user-1')
      .maybeSingle()
    expect(getMock).toHaveBeenCalledWith('/teachings/teaching-1/members/user-1')
    expect(result.data.user_id).toBe('user-1')
  })
})
