import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Request } from 'express'
import { vi } from 'vitest'
import { permission } from './holidayRouter.js'

const source = readFileSync(resolve(process.cwd(), 'src/holidayRouter.ts'), 'utf8')

describe('holiday API contract', () => {
  it('keeps holiday mutations behind the canonical permission RPC and idempotency', () => {
    expect(source).toContain("has_api_permission")
    expect(source).toContain("teaching.holidays.${action}")
    expect(source).toContain('idempotency(req, 201, null)')
    expect(source).toContain("idempotency(req, 200, null)")
  })

  it('keeps report and teacher attendance side effects explicit', () => {
    expect(source).toContain('updateReports')
    expect(source).toContain('teacher_attendance')
    expect(source).toContain("'/holidays/check'")
  })

  it('authorizes every referenced scope before holiday mutation work', async () => {
    const allowed = '00000000-0000-4000-8000-000000000001'
    const denied = '00000000-0000-4000-8000-000000000002'
    const rpc = vi.fn().mockImplementation(async (_name: string, args: { p_classroom_id: string | null }) => ({
      data: args.p_classroom_id === allowed,
      error: null,
    }))
    const req = { user: { id: '00000000-0000-4000-8000-000000000010' }, db: { rpc } } as unknown as Request
    await expect(permission(req, 'create', { classroom_ids: [allowed, denied] })).rejects.toMatchObject({ status: 403 })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('uses a global permission for empty-scope holidays', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const req = { user: { id: '00000000-0000-4000-8000-000000000010' }, db: { rpc } } as unknown as Request
    await permission(req, 'list', {})
    expect(rpc).toHaveBeenCalledWith('has_api_permission', expect.objectContaining({
      p_classroom_id: null,
      p_class_session_id: null,
    }))
  })

  it('requires a system permission for global holiday mutations', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const req = { user: { id: '00000000-0000-4000-8000-000000000010' }, db: { rpc } } as unknown as Request
    await permission(req, 'create', {})
    expect(rpc).toHaveBeenCalledWith('has_system_permission', {
      p_user_id: '00000000-0000-4000-8000-000000000010',
      p_permission_key: 'teaching.holidays.create',
    })
  })
})
