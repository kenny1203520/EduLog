import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiV1Error } from '@/services/api/ApiV1Client'
import { PermissionPolicyService } from './PermissionPolicyService'

const { getMock, patchMock, listMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    patchMock: vi.fn(),
    listMock: vi.fn()
}))

vi.mock('@/services/api/ApiV1Client', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiV1Client')>(),
    apiV1Client: { get: getMock, patch: patchMock }
}))
vi.mock('@/services/api/ApiResourceClient', async importOriginal => ({
    ...await importOriginal<typeof import('@/services/api/ApiResourceClient')>(),
    apiResourceClient: { list: listMock }
}))

describe('PermissionPolicyService RBAC boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('allows policy editing only when the system permission resolves to allow', async () => {
        getMock.mockResolvedValue({ data: { allowed: true } })
        await expect(PermissionPolicyService.canManageRbac()).resolves.toBe(true)
        expect(getMock).toHaveBeenCalledWith('/rbac/capability?permission=teaching.roles.manage')
    })

    it('fails closed when permission lookup fails or is denied', async () => {
        getMock.mockRejectedValueOnce(new Error('forbidden'))
        await expect(PermissionPolicyService.canManageRbac()).resolves.toBe(false)

        getMock.mockResolvedValueOnce({ data: { allowed: false } })
        await expect(PermissionPolicyService.canManageRbac()).resolves.toBe(false)
    })

    it('checks occurrence update capability at the requested class-session scope', async () => {
        getMock.mockResolvedValue({ data: { allowed: true } })
        await expect(PermissionPolicyService.canUpdateOccurrence('session-1')).resolves.toBe(true)
        expect(getMock).toHaveBeenCalledWith('/rbac/capability?permission=teaching.occurrences.update&class_session_id=session-1')
    })

    it('maps a rejected policy write to a public AuthorizationError', async () => {
        listMock.mockResolvedValue({ data: [{ id: 'permission-1', key: 'reports.incomplete.receive' }] })
        patchMock.mockRejectedValue(new ApiV1Error(403, { error: { code: 'FORBIDDEN', message: 'new row violates row-level security policy', request_id: 'r', trace_id: 't' } }))

        await expect(PermissionPolicyService.replacePolicies('reports.incomplete.receive', { type: 'system' }, []))
            .rejects.toMatchObject({ name: 'AuthorizationError', i18nKey: 'errors.permission_denied' })
        await expect(PermissionPolicyService.replacePolicies('reports.incomplete.receive', { type: 'system' }, []))
            .rejects.not.toThrow('row-level security')
        expect(patchMock).toHaveBeenCalledWith('/permissions/permission-1/policies', { scope: { type: 'system' }, policies: [] })
    })
})
