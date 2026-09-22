import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageApiService } from './PageApiService'
import { StudentCredentialsQueryService } from '@/services/student/StudentCredentialsQueryService'

describe('PageApiService', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], meta: { limit: 12, offset: 12, total: 30, sort: 'name' }, request_id: 'request', trace_id: 'trace' }),
    } as Response)
  })

  afterEach(() => vi.restoreAllMocks())

  it('uses same-origin page endpoints with search and server pagination', async () => {
    const result = await PageApiService.getStudentsOverview({ limit: 12, offset: 12, search: 'Alex Chen', sort: 'name' })
    expect(result.meta?.total).toBe(30)
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/pages/students/overview?limit=12&offset=12&search=Alex+Chen&sort=name',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('normalizes page and nested session sizes to the server maximum', async () => {
    await PageApiService.getClassroomsOverview({ limit: 1000, offset: -3, visibility: 'all', session_limit: 500, session_offset: -4 })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/pages/classrooms/overview?limit=100&offset=0&visibility=all&session_limit=100&session_offset=0',
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('encodes page resource identifiers and keeps profile and workspace reads on page routes', async () => {
    await PageApiService.getStudentProfile('student/id')
    await PageApiService.getClassSessionWorkspace('session/id')
    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => url)
    expect(urls).toEqual([
      '/api/pages/students/student%2Fid/profile',
      '/api/pages/class-sessions/session%2Fid/workspace',
    ])
  })

  it('loads sensitive credentials through their separately authorized REST route', async () => {
    await StudentCredentialsQueryService.getForStudent('student-1')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/students/student-1/credentials',
      expect.objectContaining({ credentials: 'include' }),
    )
  })
})
