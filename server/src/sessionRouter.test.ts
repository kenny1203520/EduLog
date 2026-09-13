import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { Request } from 'express'
import { authorizeRelatedRead } from './sessionRouter.js'
import { readDetails } from './sessionRouter.js'

describe('class session API contract', () => {
  it('uses the guarded schedule RPC and explicit mutation contract', () => {
    const source = readFileSync(new URL('./sessionRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("rpc('has_api_permission'")
    expect(source).toContain("teaching.class_sessions.${action}")
    expect(source).toContain("rpc('save_class_session_with_schedule'")
    expect(source).toContain('authorizeSaveScope')
    expect(source).toContain('Schedule rule kind must match schedule_mode')
    expect(source).toContain('idempotency(req')
    expect(source.indexOf("rpc('has_api_permission'")).toBeLessThan(source.indexOf('const replay'))
  })

  it('does not trust client ownership fields or expose wildcard selects', () => {
    const source = readFileSync(new URL('./sessionRouter.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('select(\'*\')')
    expect(source).not.toContain('p_session: { ...req.body')
  })

  it('provides server-side session details and enrollment peak contracts', () => {
    const source = readFileSync(new URL('./sessionRouter.ts', import.meta.url), 'utf8')
    expect(source).toContain("router.get('/class-sessions/:id/details'")
    expect(source).toContain("router.get('/class-sessions/:id/enrollment-peak'")
    expect(source).toContain("select('id', { count: 'exact', head: true })")
    expect(source).toContain("from('occurrence_reports').select('class_occurrence_id')")
    expect(source).not.toContain("from('occurrence_reports').select('*')")
  })

  it('denies a missing related permission before any aggregate data query', async () => {
    const from = vi.fn()
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const req = { db: { rpc, from }, user: { id: '00000000-0000-4000-8000-000000000001' } } as unknown as Request
    await expect(authorizeRelatedRead(req, 'teaching.reports.list', '10000000-0000-4000-8000-000000000001')).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' })
    expect(rpc).toHaveBeenCalledOnce()
    expect(from).not.toHaveBeenCalled()
  })

  it('allows a related permission through the same canonical RPC boundary', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const req = { db: { rpc }, user: { id: '00000000-0000-4000-8000-000000000001' } } as unknown as Request
    await expect(authorizeRelatedRead(req, 'teaching.enrollments.list', '10000000-0000-4000-8000-000000000001')).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('has_api_permission', expect.objectContaining({ p_permission_key: 'teaching.enrollments.list', p_class_session_id: '10000000-0000-4000-8000-000000000001' }))
  })

  it('stops the details endpoint before aggregate queries when a related permission is denied', async () => {
    const from = vi.fn()
    const rpc = vi.fn().mockImplementation(async (_name: string, args: { p_permission_key: string }) => ({
      data: args.p_permission_key === 'teaching.class_sessions.read', error: null,
    }))
    const req = {
      params: { id: '10000000-0000-4000-8000-000000000001' },
      db: { rpc, from }, user: { id: '00000000-0000-4000-8000-000000000001' }, auditContext: {},
    } as unknown as Request
    const response = { json: vi.fn() } as never

    await expect(readDetails(req, response)).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' })
    expect(from).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
