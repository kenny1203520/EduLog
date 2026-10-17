<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { RoleService } from '@/services/rbac/RoleService'
import { PermissionPolicyService } from '@/services/rbac/PermissionPolicyService'
import type { RoleDTO } from '@/models/Rbac'
import { scheduleSelectionsAt, type DashboardSchedulePolicies, type DashboardScheduleSelections } from '@/models/DashboardScheduleMode'
import DashboardScheduleModeEditor from '@/components/settings/DashboardScheduleModeEditor.vue'

// System-wide defaults per teaching role; classrooms and classes override them
// in Classroom management.
const { t } = useI18n()
const toast = useToast()
const { reportError } = useFeedback()
const roles = ref<RoleDTO[]>([])
const policies = ref<DashboardSchedulePolicies>({ all: [], view: [] })
const selections = ref<DashboardScheduleSelections>({})
const loading = ref(false)
const saving = ref(false)
const canManageRbac = ref(false)

function syncSelections() {
    selections.value = scheduleSelectionsAt(policies.value, roles.value.map(role => role.id), { type: 'system' })
}

async function load() {
    loading.value = true
    try {
        canManageRbac.value = await PermissionPolicyService.canManageRbac()
        const [roleData, policyData] = await Promise.all([
            RoleService.getRoles(),
            PermissionPolicyService.getDashboardSchedulePolicies()
        ])
        roles.value = roleData
        policies.value = policyData
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
        await PermissionPolicyService.replaceDashboardScheduleModes({ type: 'system', id: null }, selections.value)
        policies.value = await PermissionPolicyService.getDashboardSchedulePolicies()
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
            <div v-if="loading" class="py-8 text-center font-bold text-gray-400">{{ $t('common.loading') }}</div>
            <template v-else>
                <p v-if="!canManageRbac" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                    {{ $t('errors.permission_required_for_settings') }}
                </p>
                <DashboardScheduleModeEditor v-model="selections" :roles="roles" :policies="policies"
                    scope-type="system" :scope-id="null" :disabled="!canManageRbac || saving" />
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
