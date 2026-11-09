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

const NOTIFY = 'reports.incomplete.receive'
const VIEW = 'teaching.dashboard.schedule.view'
const ALL = 'teaching.dashboard.schedule.all'

function snapshot(policies: unknown[], epoch: number) {
    return { data: policies, meta: { epoch, permissions: [{ id: 'p-notify', key: NOTIFY }, { id: 'p-view', key: VIEW }, { id: 'p-all', key: ALL }] } }
}

function conflict() {
    return new ApiV1Error(409, { error: { code: 'RBAC_VERSION_CONFLICT', message: 'changed', request_id: 'r', trace_id: 't' } })
}

describe('PermissionPolicyService RBAC boundary', () => {
    beforeEach(() => {
        vi.resetAllMocks()
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

    it('reads every scope of the requested permissions with the RBAC epoch', async () => {
        getMock.mockResolvedValue(snapshot([{ role_id: 'teacher', permission_id: 'p-notify', permission_key: NOTIFY, scope_type: 'system', effect: 'allow' }], 5))

        await expect(PermissionPolicyService.getPolicySnapshot([NOTIFY, VIEW])).resolves.toMatchObject({
            epoch: 5,
            permissionIds: { [NOTIFY]: 'p-notify', [VIEW]: 'p-view' },
            policies: [{ role_id: 'teacher', effect: 'allow' }]
        })
        expect(getMock).toHaveBeenCalledWith('/roles/permission-policies?permission_key=reports.incomplete.receive&permission_key=teaching.dashboard.schedule.view')
    })

    it('patches only edited cells, once per role, passing each new epoch on', async () => {
        const baseline = [{ role_id: 'manager', permission_id: 'p-notify', permission_key: NOTIFY, scope_type: 'class_session' as const, scope_id: 's1', effect: 'allow' as const }]
        getMock.mockResolvedValue(snapshot(baseline, 7))
        patchMock.mockResolvedValueOnce({ data: { epoch: 8 } }).mockResolvedValueOnce({ data: { epoch: 9 } })

        await PermissionPolicyService.applyPolicyChanges({ type: 'class_session', id: 's1' }, [
            { role_id: 'manager', permission_key: NOTIFY, effect: 'allow' },
            { role_id: 'teacher', permission_key: NOTIFY, effect: 'deny' },
            { role_id: 'teacher', permission_key: VIEW, effect: 'deny' },
            { role_id: 'assistant', permission_key: VIEW, effect: null }
        ], baseline)

        expect(patchMock).toHaveBeenCalledTimes(1)
        expect(patchMock).toHaveBeenCalledWith('/roles/teacher/permissions', {
            scope_type: 'class_session', scope_id: 's1', expected_epoch: 7,
            changes: [{ permission_id: 'p-notify', effect: 'deny' }, { permission_id: 'p-view', effect: 'deny' }]
        })
    })

    it('chains the epoch returned by each role patch', async () => {
        getMock.mockResolvedValue(snapshot([], 3))
        patchMock.mockResolvedValueOnce({ data: { epoch: 4 } }).mockResolvedValueOnce({ data: { epoch: 5 } })

        await PermissionPolicyService.applyPolicyChanges({ type: 'system' }, [
            { role_id: 'a', permission_key: NOTIFY, effect: 'allow' },
            { role_id: 'b', permission_key: NOTIFY, effect: 'deny' }
        ], [])

        expect(patchMock.mock.calls.map(call => call[1].expected_epoch)).toEqual([3, 4])
        expect(patchMock.mock.calls[0]![1].scope_id).toBeNull()
    })

    it('retries with a fresh epoch when another unrelated RBAC change wins the race', async () => {
        getMock.mockResolvedValueOnce(snapshot([], 3)).mockResolvedValueOnce(snapshot([], 10))
        patchMock.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ data: { epoch: 11 } })

        await PermissionPolicyService.applyPolicyChanges({ type: 'system' }, [{ role_id: 'a', permission_key: NOTIFY, effect: 'allow' }], [])

        expect(patchMock.mock.calls.map(call => call[1].expected_epoch)).toEqual([3, 10])
    })

    it('stops with a ConflictError when someone else changed an edited cell', async () => {
        getMock.mockResolvedValue(snapshot([{ role_id: 'a', permission_id: 'p-notify', permission_key: NOTIFY, scope_type: 'system', effect: 'deny' }], 4))

        await expect(PermissionPolicyService.applyPolicyChanges({ type: 'system' }, [{ role_id: 'a', permission_key: NOTIFY, effect: 'allow' }], []))
            .rejects.toMatchObject({ name: 'ConflictError', i18nKey: 'errors.conflict' })
        expect(patchMock).not.toHaveBeenCalled()
    })

    it('gives up with a ConflictError after repeated epoch conflicts', async () => {
        getMock.mockResolvedValue(snapshot([], 3))
        patchMock.mockRejectedValue(conflict())

        await expect(PermissionPolicyService.applyPolicyChanges({ type: 'system' }, [{ role_id: 'a', permission_key: NOTIFY, effect: 'allow' }], []))
            .rejects.toMatchObject({ name: 'ConflictError' })
        expect(patchMock).toHaveBeenCalledTimes(3)
    })

    it('sends nothing when no cell changed', async () => {
        await PermissionPolicyService.applyPolicyChanges({ type: 'system' }, [{ role_id: 'a', permission_key: NOTIFY, effect: null }], [])
        expect(getMock).not.toHaveBeenCalled()
        expect(patchMock).not.toHaveBeenCalled()
    })

    it('maps a rejected policy write to a public AuthorizationError', async () => {
        getMock.mockResolvedValue(snapshot([], 1))
        patchMock.mockRejectedValue(new ApiV1Error(403, { error: { code: 'FORBIDDEN', message: 'new row violates row-level security policy', request_id: 'r', trace_id: 't' } }))

        const save = () => PermissionPolicyService.applyPolicyChanges({ type: 'system' }, [{ role_id: 'a', permission_key: NOTIFY, effect: 'allow' }], [])
        await expect(save()).rejects.toMatchObject({ name: 'AuthorizationError', i18nKey: 'errors.permission_denied' })
        await expect(save()).rejects.not.toThrow('row-level security')
    })

    it('builds schedule mode changes from the four-state selection', () => {
        expect(PermissionPolicyService.scheduleModeChanges({ a: 'all', b: 'assigned', c: 'hidden', d: 'inherit' })).toEqual([
            { role_id: 'a', permission_key: VIEW, effect: 'allow' }, { role_id: 'a', permission_key: ALL, effect: 'allow' },
            { role_id: 'b', permission_key: VIEW, effect: 'allow' }, { role_id: 'b', permission_key: ALL, effect: 'deny' },
            { role_id: 'c', permission_key: VIEW, effect: 'deny' }, { role_id: 'c', permission_key: ALL, effect: null },
            { role_id: 'd', permission_key: VIEW, effect: null }, { role_id: 'd', permission_key: ALL, effect: null }
        ])
    })
})
