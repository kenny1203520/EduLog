<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { RoleService } from '@/services/rbac/RoleService'
import type { RoleDTO } from '@/models/Rbac'
import { useFeedback } from '@/composables/useFeedback'
import RolePermissionEditor from '@/components/settings/RolePermissionEditor.vue'

type SystemUser = { id: string; email?: string | null; display_name?: string | null; account_status?: 'active' | 'disabled' | null }
type Assignment = { id: string; user_id: string; role_id: string; roles?: { code?: string; name?: string }; effective_from?: string; effective_to?: string | null }

const { reportError } = useFeedback()
const { t } = useI18n()
const roles = ref<RoleDTO[]>([])
const users = ref<SystemUser[]>([])
const assignments = ref<Assignment[]>([])
const selectedUserId = ref('')
const selectedRoleId = ref('')
const selectedStatus = ref<'active' | 'disabled'>('active')
const statusReason = ref('')
const epoch = ref(1)
const activeSection = ref<'permissions' | 'assignments' | 'users'>('permissions')
const loading = ref(false)
const saving = ref(false)

function roleLabel(role?: { code?: string | null; name?: string | null } | null) {
    if (!role) return ''
    return role.code ? t(`rbac.roles.${role.code}.name`, role.name ?? role.code) : (role.name ?? '')
}

async function refreshEpoch() {
    epoch.value = (await RoleService.getCapabilities()).epoch
}

async function load() {
    loading.value = true
    try {
        const [roleResult, userResult, assignmentResult] = await Promise.all([
            RoleService.getRoles({ domain: 'system' }),
            apiV1Client.get<SystemUser[]>('/users?limit=100&offset=0&sort=display_name'),
            apiV1Client.get<Assignment[]>('/system-role-assignments?limit=100&offset=0&sort=-created_at'),
        ])
        roles.value = roleResult
        users.value = userResult.data ?? []
        assignments.value = assignmentResult.data ?? []
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
        await apiV1Client.post('/system-role-assignments', { user_id: selectedUserId.value, role_id: selectedRoleId.value, expected_epoch: epoch.value })
        await load()
    } catch (error) { reportError(error) } finally { saving.value = false }
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
    if (!window.confirm('移除這個系統角色指派？')) return
    saving.value = true
    try {
        await apiV1Client.delete(`/system-role-assignments/${assignment.id}`, { expected_epoch: epoch.value })
        await load()
    } catch (error) { reportError(error) } finally { saving.value = false }
}

onMounted(load)
</script>

<template>
    <section class="space-y-6">
        <div class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 class="text-xl font-black text-gray-900">{{ t('rbac.system_title', 'System administration') }}</h2>
            <p class="mt-1 text-sm font-bold text-gray-400">{{ t('rbac.system_subtitle', 'Manage system roles, assignments and account status with version checks and audit.') }}</p>
            <nav class="mt-5 flex flex-wrap gap-2" :aria-label="t('rbac.system_sections.label', 'System settings sections')">
                <button v-for="section in ['permissions', 'assignments', 'users'] as const" :key="section" type="button" class="rounded-xl px-4 py-2 text-sm font-black" :class="activeSection === section ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'" @click="activeSection = section">
                    {{ t(`rbac.system_sections.${section}`, section) }}
                </button>
            </nav>
        </div>

        <div v-if="activeSection !== 'permissions'" class="grid gap-6 lg:grid-cols-2">
            <div v-if="activeSection === 'assignments'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 class="mb-4 font-black">角色指派</h3>
                <div class="grid gap-3">
                    <select v-model="selectedUserId" class="rounded-xl border border-gray-200 px-3 py-2" aria-label="使用者">
                        <option value="">選擇使用者</option>
                        <option v-for="user in users" :key="user.id" :value="user.id">{{ user.display_name || user.email || user.id }}</option>
                    </select>
                    <select v-model="selectedRoleId" class="rounded-xl border border-gray-200 px-3 py-2" aria-label="系統角色">
                        <option value="">選擇系統角色</option>
                        <option v-for="role in roles" :key="role.id" :value="role.id">{{ roleLabel(role) }}{{ role.is_protected ? `（${t('rbac.protected_read_only', '受保護')}）` : '' }}</option>
                    </select>
                    <button :disabled="saving || !selectedUserId || !selectedRoleId" class="rounded-xl bg-emerald-600 px-4 py-2 font-black text-white disabled:opacity-40" @click="assignRole">指派角色</button>
                </div>
                <p v-if="loading" class="mt-4 text-sm text-gray-400">載入中…</p>
                <div v-for="assignment in assignments" :key="assignment.id" class="mt-4 flex items-center justify-between gap-3 border-t border-gray-50 pt-3">
                    <div><p class="font-bold">{{ roleLabel(assignment.roles) || assignment.role_id }}</p><p class="text-xs text-gray-400">{{ assignment.user_id }}</p></div>
                    <button class="text-sm font-bold text-red-600" :disabled="saving" @click="removeAssignment(assignment)">移除</button>
                </div>
            </div>

            <div v-if="activeSection === 'users'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 class="mb-4 font-black">帳號狀態</h3>
                <select v-model="selectedUserId" class="w-full rounded-xl border border-gray-200 px-3 py-2" aria-label="狀態使用者">
                    <option value="">選擇使用者</option>
                    <option v-for="user in users" :key="user.id" :value="user.id">{{ user.display_name || user.email || user.id }}</option>
                </select>
                <div class="mt-4 flex gap-3">
                    <select v-model="selectedStatus" class="rounded-xl border border-gray-200 px-3 py-2" aria-label="帳號狀態"><option value="active">啟用</option><option value="disabled">停用</option></select>
                    <input v-if="selectedStatus === 'disabled'" v-model="statusReason" class="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2" placeholder="停用理由" />
                    <button :disabled="saving || !selectedUserId" class="rounded-xl bg-emerald-600 px-4 py-2 font-black text-white disabled:opacity-40" @click="updateStatus">儲存</button>
                </div>
                <p class="mt-4 text-xs text-gray-400">最後一位 system owner 不可被移除、降級或停用。</p>
            </div>
        </div>

        <div v-if="activeSection === 'permissions'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <RolePermissionEditor domain="system" :title="$t('rbac.system_permissions', 'System role permissions')" />
        </div>
    </section>
</template>
