<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RoleService } from '@/services/rbac/RoleService'
import type { PolicyScope, RbacDomain, RoleDTO, RolePermissionMatrixRow } from '@/models/Rbac'
import { useFeedback } from '@/composables/useFeedback'

const props = withDefaults(defineProps<{
    domain: RbacDomain
    teachings?: Array<{ id: string; name: string }>
    teachingId?: string
    title?: string
    canManage?: boolean
    policyScopeType?: PolicyScope
    policyScopeId?: string | null
    canManageRoleDefinitions?: boolean
}>(), { canManage: true, canManageRoleDefinitions: true })

const { t } = useI18n()
const { reportError } = useFeedback()
const roles = ref<RoleDTO[]>([])
const rows = ref<RolePermissionMatrixRow[]>([])
const selectedRoleId = ref('')
const newRoleName = ref('')
const draftName = ref('')
const draftDescription = ref('')
const epoch = ref(1)
const loading = ref(false)
const saving = ref(false)
const dirty = ref(false)
const conflict = ref(false)
const capabilityCanManage = ref<boolean | null>(null)
const selectedTeachingId = ref(props.teachingId ?? props.teachings?.[0]?.id ?? '')
const targetScopeType = computed<PolicyScope>(() => props.policyScopeType ?? props.domain)
const targetScopeId = computed<string | null>(() => props.policyScopeType
    ? props.policyScopeId ?? null
    : props.domain === 'teaching' ? selectedTeachingId.value || null : null)

const selectedRole = computed(() => roles.value.find(role => role.id === selectedRoleId.value) ?? null)
const canEdit = computed(() => props.canManage && capabilityCanManage.value !== false)
const readOnly = computed(() => !canEdit.value || Boolean(selectedRole.value?.is_protected))
const roleDetailsReadOnly = computed(() => readOnly.value || !props.canManageRoleDefinitions || Boolean(selectedRole.value?.is_builtin))
const groupedRows = computed(() => {
    const groups = new Map<string, RolePermissionMatrixRow[]>()
    for (const row of rows.value) {
        const group = groups.get(row.resource) ?? []
        group.push(row)
        groups.set(row.resource, group)
    }
    return [...groups.entries()]
})

function roleName(role: RoleDTO) {
    return role.code ? t(`rbac.roles.${role.code}.name`, role.name) : role.name
}

function roleDescription(role: RoleDTO | null) {
    if (!role) return ''
    return role.code ? t(`rbac.roles.${role.code}.description`, role.description ?? '') : (role.description ?? '')
}

function resourceName(resource: string) {
    return t(`rbac.resources.${resource}.name`, resource.replaceAll('_', ' '))
}

function resourceDescription(resource: string) {
    return t(`rbac.resources.${resource}.description`, resource.replaceAll('_', ' '))
}

function actionName(action: string) {
    return t(`rbac.actions.${action}.name`, action.replaceAll('_', ' '))
}

function actionDescription(action: string) {
    return t(`rbac.actions.${action}.description`, action.replaceAll('_', ' '))
}

function effectLabel(effect: string | null) {
    if (!effect) return t('rbac.permission.inherit', 'Inherit')
    return effect === 'allow' ? t('rbac.permission.allow', 'Allow') : t('rbac.permission.deny', 'Deny')
}

function inheritedSource(row: RolePermissionMatrixRow) {
    const inheritedRole = roles.value.find(role => role.id === row.inherited_from_role_id)
    const scope = row.inherited_from_scope_type
        ? t(`rbac.scope.${row.inherited_from_scope_type}`, row.inherited_from_scope_type)
        : ''
    const role = inheritedRole ? roleName(inheritedRole) : ''
    return [role, scope].filter(Boolean).join(' · ')
}

async function loadRoles() {
    if (props.domain === 'teaching' && !selectedTeachingId.value && !props.policyScopeType) return
    loading.value = true
    try {
        const capabilities = await RoleService.getCapabilities(props.domain === 'teaching' ? selectedTeachingId.value : undefined)
        epoch.value = capabilities.epoch
        const domainCapabilities = props.domain === 'system' ? capabilities.system : capabilities.teaching
        capabilityCanManage.value = props.policyScopeType
            ? await RoleService.canManageRoleScope(targetScopeType.value, targetScopeId.value)
            : typeof domainCapabilities?.roles_manage === 'boolean' ? domainCapabilities.roles_manage : null
        roles.value = props.policyScopeType
            ? await RoleService.getRolesForScope({ domain: props.domain, teachingId: selectedTeachingId.value || undefined, scopeType: targetScopeType.value, scopeId: targetScopeId.value })
            : await RoleService.getRoles({ domain: props.domain, teachingId: selectedTeachingId.value })
        if (!roles.value.some(role => role.id === selectedRoleId.value)) selectedRoleId.value = roles.value[0]?.id ?? ''
        await loadPermissions()
    } catch (error) { reportError(error) } finally { loading.value = false }
}

async function loadPermissions() {
    if (!selectedRoleId.value) { rows.value = []; return }
    try {
        const result = await RoleService.getRolePermissions(selectedRoleId.value, targetScopeType.value, targetScopeId.value)
        rows.value = result.rows
        epoch.value = result.epoch ?? epoch.value
        dirty.value = false
        conflict.value = false
        draftName.value = selectedRole.value?.name ?? ''
        draftDescription.value = selectedRole.value?.description ?? ''
    } catch (error) { reportError(error) }
}

function setLocalEffect(row: RolePermissionMatrixRow, value: string) {
    if (readOnly.value) return
    row.local_effect = value === 'inherit' ? null : value as 'allow' | 'deny'
    dirty.value = true
}

async function save() {
    if (!selectedRole.value || readOnly.value || !dirty.value) return
    saving.value = true
    conflict.value = false
    try {
        await RoleService.replaceRolePermissions(selectedRole.value.id, {
            scope_type: targetScopeType.value,
            scope_id: targetScopeId.value,
            expected_epoch: epoch.value,
            policies: rows.value.filter(row => row.local_effect).map(row => ({ permission_id: row.permission_id, effect: row.local_effect as 'allow' | 'deny' })),
        })
        await loadRoles()
        await loadPermissions()
    } catch (error) {
        if (error instanceof Error && error.message.includes('RBAC_VERSION_CONFLICT')) conflict.value = true
        reportError(error)
    } finally { saving.value = false }
}

async function saveRoleDetails() {
    if (!selectedRole.value || readOnly.value || !draftName.value.trim()) return
    saving.value = true
    try {
        await RoleService.updateRole(selectedRole.value.id, { name: draftName.value.trim(), description: draftDescription.value.trim() || null, code: selectedRole.value.code ?? null, expected_epoch: epoch.value })
        await loadRoles()
        await loadPermissions()
    } catch (error) { reportError(error) } finally { saving.value = false }
}

async function createRole() {
    if (!newRoleName.value.trim() || (props.domain === 'teaching' && !selectedTeachingId.value)) return
    try {
        await RoleService.createRole(newRoleName.value, { domain: props.domain, teachingId: selectedTeachingId.value, expectedEpoch: epoch.value })
        newRoleName.value = ''
        await loadRoles()
    } catch (error) { reportError(error) }
}

async function deleteRole() {
    if (!selectedRole.value || selectedRole.value.is_builtin || selectedRole.value.is_protected) return
    try { await RoleService.deleteRole(selectedRole.value.id, epoch.value); await loadRoles() } catch (error) { reportError(error) }
}

watch(() => [props.domain, props.teachingId, props.policyScopeType, props.policyScopeId], () => { selectedTeachingId.value = props.teachingId ?? props.teachings?.[0]?.id ?? ''; void loadRoles() })
watch(selectedTeachingId, () => { if (props.domain === 'teaching') void loadRoles() })
watch(selectedRoleId, loadPermissions)
onMounted(loadRoles)
</script>

<template>
    <section class="space-y-4">
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h3 class="font-black text-gray-900">{{ title || t('rbac.permissions.title', 'Role permissions') }}</h3>
                <p class="text-xs text-gray-500">{{ t('rbac.permissions.subtitle', 'Configure local policy and review inherited access.') }}</p>
            </div>
            <div class="flex items-center gap-3">
                <select v-if="domain === 'teaching' && teachings?.length" v-model="selectedTeachingId" class="rounded-lg border px-3 py-2 text-sm">
                    <option v-for="teaching in teachings" :key="teaching.id" :value="teaching.id">{{ teaching.name }}</option>
                </select>
                <span v-if="selectedRole?.is_protected" class="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{{ t('rbac.protected_read_only', 'Protected role · read only') }}</span>
            </div>
        </div>

        <div v-if="conflict" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            {{ t('rbac.version_conflict', 'The permission configuration changed. Your draft is preserved; reload before saving again.') }}
        </div>

        <div class="grid gap-5 lg:grid-cols-[18rem_1fr]">
            <div class="rounded-2xl border border-gray-100 bg-white p-4">
                <div v-if="canEdit && canManageRoleDefinitions" class="mb-3 flex gap-2">
                    <input v-model="newRoleName" class="min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm" :placeholder="t('rbac.new_role', 'New role')" />
                    <button class="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white" @click="createRole">{{ t('common.add', 'Add') }}</button>
                </div>
                <p v-if="loading" class="py-4 text-sm text-gray-400">{{ t('common.loading', 'Loading…') }}</p>
                <button v-for="role in roles" :key="role.id" type="button" :aria-pressed="selectedRoleId === role.id" class="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :class="selectedRoleId === role.id ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50'" @click="selectedRoleId = role.id">
                    <span>{{ roleName(role) }}</span><span v-if="role.is_builtin" class="text-[10px] text-gray-400">{{ t('rbac.builtin', 'Built-in') }}</span>
                </button>
                <button v-if="selectedRole && !selectedRole.is_builtin && !selectedRole.is_protected && canEdit && canManageRoleDefinitions" class="mt-3 text-sm font-bold text-red-600" @click="deleteRole">{{ t('common.delete', 'Delete') }}</button>
            </div>

            <div class="rounded-2xl border border-gray-100 bg-white p-5">
                <div v-if="selectedRole" class="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input :value="selectedRole.is_builtin ? roleName(selectedRole) : draftName" :disabled="roleDetailsReadOnly" class="rounded-lg border px-3 py-2 text-sm" :aria-label="t('rbac.role_name', 'Role name')" @input="draftName = ($event.target as HTMLInputElement).value" />
                    <input :value="selectedRole.is_builtin ? roleDescription(selectedRole) : draftDescription" :disabled="roleDetailsReadOnly" class="rounded-lg border px-3 py-2 text-sm" :placeholder="roleDescription(selectedRole)" :aria-label="t('rbac.role_description', 'Role description')" @input="draftDescription = ($event.target as HTMLInputElement).value" />
                    <button :disabled="roleDetailsReadOnly || !canManageRoleDefinitions || saving" class="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700 disabled:opacity-40" @click="saveRoleDetails">{{ t('common.save', 'Save') }}</button>
                </div>
                <div v-for="[resource, resourceRows] in groupedRows" :key="resource" class="mb-5">
                    <h4 class="mb-2 border-b border-gray-100 pb-2 text-gray-700">
                        <span class="font-black">{{ resourceName(resource) }}</span>
                        <code class="ml-2 text-[10px] font-normal uppercase tracking-widest text-gray-400">{{ resource }}</code>
                        <span class="mt-1 block text-xs font-normal text-gray-400">{{ resourceDescription(resource) }}</span>
                    </h4>
                    <div v-for="row in resourceRows" :key="row.permission_id" class="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-gray-50 py-2 text-sm">
                        <div>
                            <p class="font-bold text-gray-800">{{ actionName(row.action) }} <code class="ml-1 text-[10px] font-normal text-gray-400">{{ row.action }}</code></p>
                            <p class="text-[11px] text-gray-400">{{ actionDescription(row.action) }} · <code>{{ row.permission_key }}</code></p>
                            <p class="text-xs text-gray-400">
                                {{ row.action }} · {{ t('rbac.inherited', 'inherited') }}: {{ effectLabel(row.inherited_effect) }} ·
                                {{ t('rbac.effective', 'effective') }}: {{ effectLabel(row.effective_effect) }}
                            </p>
                            <p v-if="row.inherited_effect" class="text-[11px] text-gray-400">{{ t('rbac.inherited_from', 'Inherited from') }}: {{ inheritedSource(row) }}</p>
                        </div>
                        <span v-if="row.denied" class="text-xs font-bold text-red-600">{{ t('rbac.denied', 'Denied') }}</span>
                        <select :value="row.local_effect ?? 'inherit'" :disabled="readOnly" :aria-label="`${resourceName(resource)}: ${actionName(row.action)}`" class="rounded-lg border px-2 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :class="row.denied ? 'border-red-300 text-red-700' : ''" @change="setLocalEffect(row, ($event.target as HTMLSelectElement).value)">
                            <option value="inherit">{{ t('rbac.permission.inherit', 'Inherit') }}</option><option value="allow">{{ t('rbac.permission.allow', 'Allow') }}</option><option value="deny">{{ t('rbac.permission.deny', 'Deny') }}</option>
                        </select>
                    </div>
                </div>
                <button :disabled="readOnly || saving || !dirty" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" @click="save">{{ saving ? t('common.saving', 'Saving…') : t('rbac.save_permissions', 'Save permissions') }}</button>
            </div>
        </div>
    </section>
</template>
