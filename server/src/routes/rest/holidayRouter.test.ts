import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Request } from 'express'
import { vi } from 'vitest'
import { permission } from './holidayRouter.js'

const source = readFileSync(resolve(process.cwd(), 'src/routes/rest/holidayRouter.ts'), 'utf8')

describe('holiday API contract', () => {
  it('keeps holiday mutations behind the canonical permission RPC and idempotency', () => {
    expect(source).toContain("has_api_permission")
    expect(source).toContain("teaching.holidays.${action}")
    expect(source).toContain('idempotency(req, 201, null)')
    expect(source).toContain("idempotency(req, 200, null)")
  })

  it('applies report changes without overwriting teacher attendance', () => {
    expect(source).toContain('updateReports')
    expect(source).not.toContain('teacher_attendance')
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

  it('checks empty-scope holiday actions against platform teaching permissions', async () => {
    const userId = '00000000-0000-4000-8000-000000000010'
    for (const action of ['create', 'update', 'delete', 'list'] as const) {
      const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
      const req = { user: { id: userId }, db: { rpc } } as unknown as Request

      await permission(req, action, {})

      expect(rpc).toHaveBeenCalledWith('has_api_permission', {
        p_user_id: userId,
        p_permission_key: `teaching.holidays.${action}`,
        p_classroom_id: null,
        p_class_session_id: null,
      })
      expect(req.auditContext?.domain).toBe('teaching')
    }
  })

  it('denies global teaching holidays when the teaching permission is absent', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const req = { user: { id: '00000000-0000-4000-8000-000000000010' }, db: { rpc } } as unknown as Request

    await expect(permission(req, 'create', {})).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED' })
    expect(rpc).toHaveBeenCalledWith('has_api_permission', expect.objectContaining({
      p_permission_key: 'teaching.holidays.create',
      p_classroom_id: null,
      p_class_session_id: null,
    }))
  })
})
