import type { RoleDTO } from '@/models/Rbac'
import { apiResourceClient } from '@/services/api/ApiResourceClient'

export class RoleService {
    static async getRoles(): Promise<RoleDTO[]> {
        return (await apiResourceClient.list<RoleDTO>('roles', { sort: 'sort_order' })).data || []
    }
    static async createRole(name: string): Promise<RoleDTO> {
        const normalizedName = name.trim()
        if (!normalizedName) throw new Error('ROLE_NAME_REQUIRED')
        return (await apiResourceClient.create<RoleDTO>('roles', { name: normalizedName, is_system: false })).data
    }
    static async deleteRole(id: string): Promise<void> {
        await apiResourceClient.remove('roles', id)
    }
}