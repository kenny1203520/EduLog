<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RoleService } from '@/services/rbac/RoleService'
import type { PermissionDTO, RoleDTO, RolePermissionPolicyDTO } from '@/models/Rbac'
import { useFeedback } from '@/composables/useFeedback'

const props = defineProps<{ teachings: Array<{ id: string; name: string }>; teachingId?: string }>()
const { reportError } = useFeedback()
const selectedTeachingId = ref(props.teachingId ?? props.teachings[0]?.id ?? '')
const roles = ref<RoleDTO[]>([])
const permissions = ref<PermissionDTO[]>([])
const selectedRoleId = ref('')
const policies = ref<RolePermissionPolicyDTO[]>([])
const epoch = ref(1)
const newRoleName = ref('')
const loading = ref(false)
const saving = ref(false)

const teachingPermissions = computed(() => permissions.value.filter(permission => permission.key.startsWith('teaching.')))
const selectedRole = computed(() => roles.value.find(role => role.id === selectedRoleId.value))
const policyByPermission = computed(() => new Map(policies.value.map(policy => [policy.permission_id, policy.effect])))

async function loadRoles() {
    if (!selectedTeachingId.value) return
    loading.value = true
    try {
        const capabilities = await RoleService.getCapabilities(selectedTeachingId.value)
        if (capabilities.epoch) epoch.value = capabilities.epoch
        roles.value = await RoleService.getRoles({ domain: 'teaching', teachingId: selectedTeachingId.value })
        permissions.value = await RoleService.listPermissions()
        selectedRoleId.value = roles.value[0]?.id ?? ''
    } catch (error) { reportError(error) } finally { loading.value = false }
}

async function loadPolicies() {
    if (!selectedRoleId.value || !selectedTeachingId.value) return
    try {
        const result = await RoleService.getRolePermissions(selectedRoleId.value, 'teaching', selectedTeachingId.value)
        policies.value = result.rows
        if (result.epoch) epoch.value = result.epoch
        else epoch.value = (await RoleService.getCapabilities(selectedTeachingId.value)).epoch
    } catch (error) { reportError(error) }
}

function effect(permissionId: string): 'allow' | 'deny' | 'inherit' {
    return policyByPermission.value.get(permissionId) ?? 'inherit'
}

function setEffect(permissionId: string, value: string) {
    const index = policies.value.findIndex(policy => policy.permission_id === permissionId)
    if (value === 'inherit') { if (index >= 0) policies.value.splice(index, 1); return }
    const next = { role_id: selectedRoleId.value, permission_id: permissionId, scope_type: 'teaching' as const, scope_id: selectedTeachingId.value, effect: value as 'allow' | 'deny' }
    if (index >= 0) policies.value[index] = next
    else policies.value.push(next)
}

async function savePolicies() {
    if (!selectedRoleId.value || !selectedTeachingId.value) return
    saving.value = true
    try {
        await RoleService.replaceRolePermissions(selectedRoleId.value, { scope_type: 'teaching', scope_id: selectedTeachingId.value, expected_epoch: epoch.value, policies: policies.value.map(policy => ({ permission_id: policy.permission_id, effect: policy.effect })) })
        await loadPolicies()
    } catch (error) { reportError(error) } finally { saving.value = false }
}

async function createRole() {
    if (!newRoleName.value.trim() || !selectedTeachingId.value) return
    try { await RoleService.createRole(newRoleName.value, { domain: 'teaching', teachingId: selectedTeachingId.value }); newRoleName.value = ''; await loadRoles() } catch (error) { reportError(error) }
}

async function deleteRole() {
    if (!selectedRole.value || selectedRole.value.is_protected || selectedRole.value.is_builtin) return
    try { await RoleService.deleteRole(selectedRole.value.id); await loadRoles() } catch (error) { reportError(error) }
}

watch(() => props.teachingId, value => { if (value) selectedTeachingId.value = value })
watch(selectedTeachingId, loadRoles)
watch(selectedRoleId, loadPolicies)
onMounted(loadRoles)
</script>

<template>
    <section class="space-y-6">
        <div class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <div class="flex flex-wrap items-end justify-between gap-4">
                <div><h2 class="text-xl font-black text-gray-900">教學管理</h2><p class="mt-1 text-sm font-bold text-gray-400">成員、教學角色與權限矩陣</p></div>
                <label class="text-sm font-bold text-gray-500">教學
                    <select v-model="selectedTeachingId" class="ml-2 rounded-xl border border-gray-200 px-3 py-2"><option v-for="teaching in teachings" :key="teaching.id" :value="teaching.id">{{ teaching.name }}</option></select>
                </label>
            </div>
        </div>
        <div class="grid gap-6 lg:grid-cols-[18rem_1fr]">
            <div class="rounded-3xl border border-gray-100 bg-white p-5 shadow-sm">
                <div class="mb-4 flex gap-2"><input v-model="newRoleName" class="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm" placeholder="新增教學角色"><button class="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-black text-white" @click="createRole">新增</button></div>
                <p v-if="loading" class="py-4 text-sm text-gray-400">載入中…</p>
                <button v-for="role in roles" :key="role.id" class="mb-2 flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-bold" :class="selectedRoleId === role.id ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50'" @click="selectedRoleId = role.id"><span>{{ role.name }}</span><span v-if="role.is_builtin" class="text-[10px] text-gray-400">模板</span></button>
                <button v-if="selectedRole && !selectedRole.is_protected && !selectedRole.is_builtin" class="mt-3 text-sm font-bold text-red-600" @click="deleteRole">刪除角色</button>
            </div>
            <div class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <div class="mb-5 flex items-center justify-between"><div><h3 class="font-black text-gray-900">{{ selectedRole?.name || '選擇角色' }} 權限</h3><p class="text-xs text-gray-400">deny 優先於 allow；未設定會繼承父角色</p></div><button :disabled="saving || !selectedRoleId" class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40" @click="savePolicies">{{ saving ? '儲存中…' : '儲存權限' }}</button></div>
                <div v-if="!selectedRoleId" class="py-12 text-center text-sm text-gray-400">尚無可管理的角色</div>
                <div v-else class="divide-y divide-gray-100">
                    <div v-for="permission in teachingPermissions" :key="permission.id" class="flex items-center justify-between gap-4 py-3"><div><p class="text-sm font-bold text-gray-800">{{ permission.name || permission.key }}</p><p class="text-xs text-gray-400">{{ permission.key }}</p></div><select :value="effect(permission.id)" class="rounded-xl border border-gray-200 px-3 py-2 text-sm" :class="effect(permission.id) === 'deny' ? 'border-red-300 text-red-700' : ''" @change="setEffect(permission.id, ($event.target as HTMLSelectElement).value)"><option value="inherit">繼承</option><option value="allow">允許</option><option value="deny">拒絕</option></select></div>
                </div>
            </div>
        </div>
    </section>
</template>
