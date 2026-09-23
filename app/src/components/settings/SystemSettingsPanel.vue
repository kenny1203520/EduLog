<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { RoleService } from '@/services/rbac/RoleService'
import type { RoleDTO } from '@/models/Rbac'
import { useFeedback } from '@/composables/useFeedback'
import RolePermissionEditor from '@/components/settings/RolePermissionEditor.vue'
import TeachingRolePermissionsPanel from '@/components/settings/TeachingRolePermissionsPanel.vue'
import SearchableSelect from '@/components/common/SearchableSelect.vue'

type SystemUser = { id: string; email?: string | null; display_name?: string | null; account_status?: 'active' | 'disabled' | null }
type Assignment = { id: string; user_id: string; role_id: string; roles?: { code?: string; name?: string }; effective_from?: string; effective_to?: string | null }
type AuditEvent = { id: string; action?: string | null; outcome?: string | null; route?: string | null; status?: number | null; created_at?: string | null }

const { errorKey, reportError } = useFeedback()
const { t } = useI18n()
const roles = ref<RoleDTO[]>([])
const users = ref<SystemUser[]>([])
const assignments = ref<Assignment[]>([])
const selectedUserId = ref('')
const selectedRoleId = ref('')
const selectedStatus = ref<'active' | 'disabled'>('active')
const statusReason = ref('')
const epoch = ref(1)
const activeSection = ref<'permissions' | 'teaching_permissions' | 'assignments' | 'users' | 'audit'>('permissions')
const auditEvents = ref<AuditEvent[]>([])
const auditLoaded = ref(false)
const auditLoading = ref(false)
const loading = ref(false)
const saving = ref(false)
const effectiveFrom = ref(todayLocal())
const effectiveTo = ref('')

function todayLocal() {
    const now = new Date()
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function roleLabel(role?: { code?: string | null; name?: string | null } | null) {
    if (!role) return ''
    return role.code ? t(`rbac.roles.${role.code}.name`, role.name ?? role.code) : (role.name ?? '')
}

const userOptions = computed(() => users.value.map(user => ({
    value: user.id,
    label: user.display_name?.trim() || user.email || user.id,
    description: user.email || '',
    searchText: `${user.display_name ?? ''} ${user.email ?? ''}`,
})))
const roleOptions = computed(() => roles.value.map(role => ({
    value: role.id,
    label: roleLabel(role),
    description: role.description || '',
    searchText: `${role.name} ${role.code ?? ''} ${role.description ?? ''}`,
})))
const assignmentConflict = computed(() => {
    if (!selectedUserId.value || !selectedRoleId.value || !effectiveFrom.value) return false
    const end = effectiveTo.value || '9999-12-31'
    return assignments.value.some(assignment => assignment.user_id === selectedUserId.value
        && assignment.role_id === selectedRoleId.value
        && Boolean(assignment.effective_from)
        && (assignment.effective_from as string) <= end
        && (assignment.effective_to ?? '9999-12-31') >= effectiveFrom.value)
})

function userName(userId: string) {
    const user = users.value.find(user => user.id === userId)
    return user?.display_name?.trim() || user?.email || t('rbac.system_ui.unknown_user')
}

function userEmail(userId: string) {
    return users.value.find(user => user.id === userId)?.email || ''
}

async function loadAllPages<T>(resource: string) {
    const limit = 100
    const rows: T[] = []
    let offset = 0
    let total = Number.POSITIVE_INFINITY
    while (offset < total) {
        const result = await apiV1Client.get<T[]>(`/${resource}?limit=${limit}&offset=${offset}&sort=${resource === 'users' ? 'display_name' : '-created_at'}`)
        const page = result.data ?? []
        rows.push(...page)
        total = Number(result.meta?.total ?? rows.length)
        if (page.length === 0) break
        offset += page.length
    }
    return rows
}

async function refreshEpoch() {
    epoch.value = (await RoleService.getCapabilities()).epoch
}

async function load() {
    loading.value = true
    try {
        const [roleResult, allUsers, allAssignments] = await Promise.all([
            RoleService.getRoles({ domain: 'system' }),
            loadAllPages<SystemUser>('users'),
            loadAllPages<Assignment>('system-role-assignments'),
        ])
        roles.value = roleResult
        users.value = allUsers
        assignments.value = allAssignments
        selectedRoleId.value ||= roles.value.find(role => role.code === 'auditor')?.id ?? roles.value[0]?.id ?? ''
        selectedUserId.value ||= users.value[0]?.id ?? ''
        if (selectedUserId.value) selectedStatus.value = users.value.find(user => user.id === selectedUserId.value)?.account_status === 'disabled' ? 'disabled' : 'active'
        await refreshEpoch()
    } catch (error) { reportError(error) } finally { loading.value = false }
}

async function assignRole() {
    if (!selectedUserId.value || !selectedRoleId.value) return
    saving.value = true
    try {
        await apiV1Client.post('/system-role-assignments', {
            user_id: selectedUserId.value,
            role_id: selectedRoleId.value,
            effective_from: effectiveFrom.value,
            effective_to: effectiveTo.value || null,
            expected_epoch: epoch.value,
        })
        await load()
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP') errorKey('errors.system_role_assignment_overlap')
        else reportError(error)
    } finally { saving.value = false }
}

async function updateStatus() {
    if (!selectedUserId.value) return
    if (selectedStatus.value === 'disabled' && statusReason.value.trim().length < 3) return
    saving.value = true
    try {
        await apiV1Client.patch(`/users/${selectedUserId.value}/status`, { status: selectedStatus.value, reason: selectedStatus.value === 'disabled' ? statusReason.value.trim() : null, expected_epoch: epoch.value })
        statusReason.value = ''
        await load()
    } catch (error) { reportError(error) } finally { saving.value = false }
}

async function removeAssignment(assignment: Assignment) {
    if (!window.confirm(t('rbac.system_ui.remove_assignment_confirm'))) return
    saving.value = true
    try {
        await apiV1Client.delete(`/system-role-assignments/${assignment.id}`, { expected_epoch: epoch.value })
        await load()
    } catch (error) { reportError(error) } finally { saving.value = false }
}

async function selectSection(section: typeof activeSection.value) {
    activeSection.value = section
    if (section !== 'audit' || auditLoaded.value || auditLoading.value) return
    auditLoading.value = true
    try {
        auditEvents.value = (await apiV1Client.get<AuditEvent[]>('/audit-events?limit=50&offset=0&sort=-created_at')).data ?? []
        auditLoaded.value = true
    } catch (error) { reportError(error) } finally { auditLoading.value = false }
}

onMounted(load)
</script>

<template>
    <section class="space-y-6">
        <div class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 class="text-xl font-black text-gray-900">{{ t('rbac.system_title') }}</h2>
            <p class="mt-1 text-sm font-bold text-gray-400">{{ t('rbac.system_subtitle') }}</p>
            <nav class="mt-5 flex flex-wrap gap-2" :aria-label="t('rbac.system_sections.label')">
                <button v-for="section in ['permissions', 'teaching_permissions', 'assignments', 'users', 'audit'] as const" :key="section" type="button" class="rounded-xl px-4 py-2 text-sm font-black" :class="activeSection === section ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'" @click="selectSection(section)">
                    {{ t(`rbac.system_sections.${section}`) }}
                </button>
            </nav>
        </div>

        <div v-if="activeSection === 'assignments' || activeSection === 'users'" class="grid gap-6 lg:grid-cols-2">
            <div v-if="activeSection === 'assignments'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 class="mb-4 font-black">{{ t('rbac.system_ui.role_assignments') }}</h3>
                <div class="grid gap-3">
                    <SearchableSelect v-model="selectedUserId" :options="userOptions" :placeholder="t('rbac.system_ui.select_user')" :aria-label="t('rbac.system_ui.user_search')" />
                    <SearchableSelect v-model="selectedRoleId" :options="roleOptions" :placeholder="t('rbac.system_ui.select_system_role')" :aria-label="t('rbac.system_ui.system_role_search')" />
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="space-y-1 text-xs font-bold text-gray-500"><span>{{ t('rbac.system_ui.effective_from') }}</span><input v-model="effectiveFrom" type="date" required class="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800" /></label>
                        <label class="space-y-1 text-xs font-bold text-gray-500"><span>{{ t('rbac.system_ui.effective_to') }}</span><input v-model="effectiveTo" type="date" :min="effectiveFrom" class="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800" /></label>
                    </div>
                    <p v-if="assignmentConflict" role="alert" class="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{{ t('rbac.system_ui.assignment_overlap') }}</p>
                    <button :disabled="saving || !selectedUserId || !selectedRoleId || !effectiveFrom || assignmentConflict || Boolean(effectiveTo && effectiveTo < effectiveFrom)" class="rounded-xl bg-emerald-600 px-4 py-2 font-black text-white disabled:opacity-40" @click="assignRole">{{ t('rbac.system_ui.assign_role') }}</button>
                </div>
                <p v-if="loading" class="mt-4 text-sm text-gray-400">{{ t('common.loading') }}</p>
                <div v-for="assignment in assignments" :key="assignment.id" class="mt-4 flex items-center justify-between gap-3 border-t border-gray-50 pt-3">
                    <div class="min-w-0"><p class="truncate font-bold">{{ userName(assignment.user_id) }}</p><p v-if="userEmail(assignment.user_id)" class="truncate text-xs text-gray-500">{{ userEmail(assignment.user_id) }}</p><p class="mt-1 text-xs font-semibold text-gray-700">{{ roleLabel(assignment.roles) || t('rbac.system_ui.system_role') }}</p><p class="text-xs text-gray-400">{{ assignment.effective_from }} - {{ assignment.effective_to || t('rbac.system_ui.no_end_date') }}</p></div>
                    <button class="text-sm font-bold text-red-600" :disabled="saving" @click="removeAssignment(assignment)">{{ t('common.delete') }}</button>
                </div>
            </div>

            <div v-if="activeSection === 'users'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 class="mb-4 font-black">{{ t('rbac.system_ui.account_status') }}</h3>
                <SearchableSelect v-model="selectedUserId" :options="userOptions" :placeholder="t('rbac.system_ui.select_user')" :aria-label="t('rbac.system_ui.status_user')" />
                <div class="mt-4 flex gap-3">
                    <select v-model="selectedStatus" class="rounded-xl border border-gray-200 px-3 py-2" :aria-label="t('rbac.system_ui.account_status')"><option value="active">{{ t('rbac.system_ui.active') }}</option><option value="disabled">{{ t('rbac.system_ui.disabled') }}</option></select>
                    <input v-if="selectedStatus === 'disabled'" v-model="statusReason" class="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2" :placeholder="t('rbac.system_ui.disable_reason')" />
                    <button :disabled="saving || !selectedUserId" class="rounded-xl bg-emerald-600 px-4 py-2 font-black text-white disabled:opacity-40" @click="updateStatus">{{ t('common.save') }}</button>
                </div>
                <p class="mt-4 text-xs text-gray-400">{{ t('rbac.system_ui.last_owner_guard') }}</p>
            </div>
        </div>

        <div v-if="activeSection === 'permissions'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <RolePermissionEditor domain="system" :title="$t('rbac.system_permissions')" />
        </div>

        <TeachingRolePermissionsPanel v-else-if="activeSection === 'teaching_permissions'" />

        <div v-if="activeSection === 'audit'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h3 class="mb-4 font-black">{{ t('rbac.audit_title') }}</h3>
            <p v-if="auditLoading" class="text-sm text-gray-400">{{ t('common.loading') }}</p>
            <div v-else class="overflow-auto">
                <table class="min-w-full text-left text-sm">
                    <thead><tr class="border-b text-xs uppercase text-gray-400"><th class="px-3 py-2">{{ t('rbac.audit_action') }}</th><th class="px-3 py-2">{{ t('rbac.audit_outcome') }}</th><th class="px-3 py-2">{{ t('rbac.audit_route') }}</th><th class="px-3 py-2">{{ t('rbac.audit_time') }}</th></tr></thead>
                    <tbody><tr v-for="event in auditEvents" :key="event.id" class="border-b border-gray-50"><td class="px-3 py-2 font-bold">{{ event.action || '—' }}</td><td class="px-3 py-2">{{ event.outcome || event.status || '—' }}</td><td class="px-3 py-2">{{ event.route || '—' }}</td><td class="px-3 py-2 text-gray-500">{{ event.created_at || '—' }}</td></tr></tbody>
                </table>
                <p v-if="!auditEvents.length" class="py-6 text-center text-sm text-gray-400">{{ t('rbac.audit_empty') }}</p>
            </div>
        </div>
    </section>
</template>
