<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { RoleService } from '@/services/rbac/RoleService'
import {
    DASHBOARD_SCHEDULE_ALL_PERMISSION,
    PermissionPolicyService
} from '@/services/rbac/PermissionPolicyService'
import type { PermissionDTO, RoleDTO, RolePermissionPolicyDTO } from '@/models/Rbac'
import ScopedRolePolicyEditor, { type PolicySelection } from '@/components/settings/ScopedRolePolicyEditor.vue'

// The dashboard checks this permission platform-wide, so only system-scope
// policies affect it; classroom and class overrides are intentionally not offered.
const { t } = useI18n()
const toast = useToast()
const { reportError } = useFeedback()
const roles = ref<RoleDTO[]>([])
const permission = ref<PermissionDTO | null>(null)
const policies = ref<RolePermissionPolicyDTO[]>([])
const selections = ref<Record<string, PolicySelection>>({})
const loading = ref(false)
const saving = ref(false)
const canManageRbac = ref(false)

function syncSelections() {
    selections.value = Object.fromEntries(roles.value.map(role => {
        const current = policies.value.find(policy => policy.role_id === role.id && policy.scope_type === 'system')
        return [role.id, current?.effect || 'inherit']
    }))
}

async function load() {
    loading.value = true
    try {
        canManageRbac.value = await PermissionPolicyService.canManageRbac()
        const [roleData, permissionData] = await Promise.all([
            RoleService.getRoles(),
            PermissionPolicyService.getPermission(DASHBOARD_SCHEDULE_ALL_PERMISSION)
        ])
        roles.value = roleData
        permission.value = permissionData
        policies.value = await PermissionPolicyService.getPolicies(permissionData.id)
        syncSelections()
    } catch (error: any) {
        reportError(error)
    } finally {
        loading.value = false
    }
}

async function save() {
    if (!canManageRbac.value) return
    saving.value = true
    try {
        const overrides = roles.value.flatMap(role => {
            const effect = selections.value[role.id]
            return effect === 'allow' || effect === 'deny' ? [{ role_id: role.id, effect }] : []
        })
        await PermissionPolicyService.replacePolicies(DASHBOARD_SCHEDULE_ALL_PERMISSION, { type: 'system', id: null }, overrides)
        if (permission.value) policies.value = await PermissionPolicyService.getPolicies(permission.value.id)
        syncSelections()
        toast.success(t('settings.dashboard_schedule.saved'))
    } catch (error: any) {
        reportError(error)
    } finally {
        saving.value = false
    }
}

onMounted(load)
</script>

<template>
    <section id="dashboard-schedule-visibility" class="overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
        <div class="border-b border-gray-50 p-6 sm:p-8">
            <h3 class="text-2xl font-black tracking-tight text-gray-900">{{ $t('settings.dashboard_schedule.title') }}</h3>
            <p class="mt-1 text-sm font-bold text-gray-400">{{ $t('settings.dashboard_schedule.description') }}</p>
        </div>
        <div class="space-y-6 p-6 sm:p-8">
            <p class="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs font-bold leading-5 text-gray-500">
                {{ $t('settings.dashboard_schedule.system_roles_hint') }}
            </p>
            <div v-if="loading" class="py-8 text-center font-bold text-gray-400">{{ $t('common.loading') }}</div>
            <template v-else>
                <p v-if="!canManageRbac" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                    {{ $t('errors.permission_required_for_settings') }}
                </p>
                <ScopedRolePolicyEditor v-model="selections" :roles="roles" :policies="policies"
                    scope-type="system" :scope-id="null" label-namespace="settings.dashboard_schedule"
                    :disabled="!canManageRbac || saving" />
            </template>

            <div class="flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs font-bold leading-5 text-amber-800">{{ $t('settings.dashboard_schedule.inheritance_hint') }}</p>
                <button v-if="canManageRbac" type="button" @click="save" :disabled="saving"
                    class="shrink-0 rounded-xl bg-emerald-600 px-6 py-3 font-black text-white transition hover:bg-emerald-700 disabled:opacity-40">
                    {{ saving ? $t('common.loading') : $t('common.save') }}
                </button>
            </div>
        </div>
    </section>
</template>
