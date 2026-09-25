import type { PermissionDTO, RoleDTO, RolePermissionMatrixRow, RbacDomain, PolicyScope } from '@/models/Rbac'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { apiV1Client } from '@/services/api/ApiV1Client'

export class RoleService {
    static async getCapabilities(): Promise<{ epoch: number; system?: Record<string, boolean>; teaching?: Record<string, boolean> }> {
        const data = (await apiV1Client.get<{ epoch?: number; system?: Record<string, boolean>; teaching?: Record<string, boolean> }>('/rbac/capabilities')).data
        return { epoch: typeof data?.epoch === 'number' ? data.epoch : 1, system: data?.system, teaching: data?.teaching }
    }

    private static async epoch() {
        return (await this.getCapabilities()).epoch
    }

    static async getRoles(options: { domain?: RbacDomain; search?: string } = {}): Promise<RoleDTO[]> {
        const params = new URLSearchParams({ domain: options.domain ?? 'teaching', limit: '100', offset: '0', sort: 'sort_order' })
        if (options.search) params.set('search', options.search)
        return (await apiV1Client.get<RoleDTO[]>(`/roles?${params}`)).data || []
    }
    static async getRolesForScope(options: { domain?: RbacDomain; scopeType: PolicyScope; scopeId?: string | null }): Promise<RoleDTO[]> {
        const params = new URLSearchParams({ domain: options.domain ?? 'teaching', limit: '100', offset: '0', sort: 'sort_order', scope_type: options.scopeType })
        if (options.scopeId) params.set('scope_id', options.scopeId)
        return (await apiV1Client.get<RoleDTO[]>(`/roles?${params}`)).data ?? []
    }
    static async createRole(name: string, options: { domain?: RbacDomain; parentRoleId?: string | null; expectedEpoch?: number } = {}): Promise<RoleDTO> {
        const normalizedName = name.trim()
        if (!normalizedName) throw new Error('ROLE_NAME_REQUIRED')
        const domain = options.domain ?? 'teaching'
        const expected_epoch = options.expectedEpoch ?? await this.epoch()
        return (await apiV1Client.post<RoleDTO>('/roles', { name: normalizedName, domain, parent_role_id: options.parentRoleId ?? null, expected_epoch })).data
    }
    static async deleteRole(id: string, expectedEpoch?: number): Promise<void> {
        await apiV1Client.get<RoleDTO>(`/roles/${id}`)
        const epoch = expectedEpoch ?? await this.epoch()
        await apiV1Client.delete(`/roles/${id}`, { expected_epoch: epoch })
    }
    static async updateRole(id: string, input: Pick<RoleDTO, 'name' | 'description' | 'code'> & { expected_epoch?: number }): Promise<RoleDTO> {
        await apiV1Client.get<RoleDTO>(`/roles/${id}`)
        const expected_epoch = input.expected_epoch ?? await this.epoch()
        return (await apiV1Client.patch<RoleDTO>(`/roles/${id}`, { ...input, expected_epoch })).data
    }
    static async getRolePermissions(id: string, scopeType: PolicyScope, scopeId?: string | null): Promise<{ rows: RolePermissionMatrixRow[]; epoch: number | null }> {
        const params = new URLSearchParams({ scope_type: scopeType })
        if (scopeId) params.set('scope_id', scopeId)
        const result = await apiV1Client.get<RolePermissionMatrixRow[]>(`/roles/${id}/permissions?${params}`)
        return { rows: result.data ?? [], epoch: typeof result.meta?.epoch === 'number' ? result.meta.epoch : null }
    }
    static async replaceRolePermissions(id: string, input: { scope_type: PolicyScope; scope_id?: string | null; expected_epoch: number; policies: Array<{ permission_id: string; effect: 'allow' | 'deny' }> }) {
        return apiV1Client.put(`/roles/${id}/permissions`, input)
    }
    static async canManageRoleScope(scopeType: PolicyScope, scopeId?: string | null, domain: RbacDomain = 'teaching'): Promise<boolean> {
        const params = new URLSearchParams({ scope_type: scopeType, domain })
        if (scopeId) params.set('scope_id', scopeId)
        return (await apiV1Client.get<{ allowed?: boolean }>(`/rbac/scoped-capability?${params}`)).data?.allowed === true
    }
    static async listPermissions(search?: string): Promise<PermissionDTO[]> {
        return (await apiResourceClient.list<PermissionDTO>('permissions', { search, perPage: 100 })).data ?? []
    }
}
