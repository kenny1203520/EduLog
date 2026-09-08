import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthorizationError } from '@/services/errors/AppError'
import { PermissionPolicyService } from './PermissionPolicyService'

const { authGetUser, rpcMock } = vi.hoisted(() => ({
    authGetUser: vi.fn(),
    rpcMock: vi.fn()
}))

vi.mock('@/services/api/ApiDataClient', () => ({
    apiDataClient: {
        auth: { getUser: authGetUser },
        rpc: rpcMock
    }
}))

describe('PermissionPolicyService RBAC boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    })

    it('allows policy editing only when the system permission resolves to allow', async () => {
        rpcMock.mockResolvedValue({ data: [{ is_allowed: true, is_denied: false }], error: null })
        await expect(PermissionPolicyService.canManageRbac()).resolves.toBe(true)
        expect(rpcMock).toHaveBeenCalledWith('resolve_user_permission', expect.objectContaining({
            p_user_id: 'user-1',
            p_permission_key: 'rbac.manage'
        }))
    })

    it('fails closed when permission lookup fails or is denied', async () => {
        rpcMock.mockResolvedValueOnce({ data: null, error: { code: '42501' } })
        await expect(PermissionPolicyService.canManageRbac()).resolves.toBe(false)

        rpcMock.mockResolvedValueOnce({ data: [{ is_allowed: false, is_denied: true }], error: null })
        await expect(PermissionPolicyService.canManageRbac()).resolves.toBe(false)
    })

    it('maps policy RPC RLS rejection to a public AuthorizationError', async () => {
        rpcMock.mockResolvedValue({ error: { code: '42501', message: 'new row violates row-level security policy' } })
        await expect(PermissionPolicyService.replacePolicies('reports.incomplete.receive', { type: 'system' }, []))
            .rejects.toMatchObject({ name: 'AuthorizationError', i18nKey: 'errors.permission_denied' })
        await expect(PermissionPolicyService.replacePolicies('reports.incomplete.receive', { type: 'system' }, []))
            .rejects.not.toThrow('row-level security')
        expect(AuthorizationError).toBeDefined()
    })
})
