import { supabase } from '@/lib/supabase'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { getApiV1Mode } from '@/services/api/ApiModeClient'
import type { RoleDTO } from '@/models/Rbac'

export class RoleService {
    static async getRoles(): Promise<RoleDTO[]> {
        if (getApiV1Mode() === 'v1') { return (await apiResourceClient.list<RoleDTO>('roles', { mode: 'v1', sort: 'sort_order' })).data || []
        }
        const { data, error } = await supabase.from('roles').select('*').order('sort_order').order('name')
        if (error) throw new Error(error.message)
        return (data as RoleDTO[]) || []
    }

    static async createRole(name: string): Promise<RoleDTO> {
        if (getApiV1Mode() === 'v1') { const normalizedName = name.trim(); if (!normalizedName) throw new Error('ROLE_NAME_REQUIRED'); return (await apiResourceClient.create<RoleDTO>('roles', { name: normalizedName }, 'v1')).data
        }
        const normalizedName = name.trim()
        if (!normalizedName) throw new Error('ROLE_NAME_REQUIRED')
        const { data, error } = await supabase
            .from('roles')
            .insert({ name: normalizedName, is_system: false })
            .select()
            .single()
        if (error) throw new Error(error.message)
        return data as RoleDTO
    }

    static async deleteRole(id: string): Promise<void> {
        if (getApiV1Mode() === 'v1') { await apiResourceClient.remove('roles', id, 'v1'); return
        }
        const { error } = await supabase.from('roles').delete().eq('id', id).eq('is_system', false)
        if (error) throw new Error(error.message)
    }
}
