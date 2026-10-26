<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RoleService } from '@/services/rbac/RoleService'
import type { PolicyScope, RbacDomain, RoleDTO, RolePermissionMatrixRow } from '@/models/Rbac'
import { useFeedback } from '@/composables/useFeedback'

const props = withDefaults(defineProps<{
    domain: RbacDomain
    title?: string
    canManage?: boolean
    policyScopeType?: PolicyScope
    policyScopeId?: string | null
    canManageRoleDefinitions?: boolean
}>(), { canManage: true, canManageRoleDefinitions: true })

const { t } = useI18n()
const { reportError, success } = useFeedback()
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
const permissionSearch = ref('')
const resourceJump = ref('')
const capabilityCanManage = ref<boolean | null>(null)
const targetScopeType = computed<PolicyScope>(() => props.policyScopeType ?? 'system')
const targetScopeId = computed<string | null>(() => props.policyScopeId ?? null)

const selectedRole = computed(() => roles.value.find(role => role.id === selectedRoleId.value) ?? null)
const canEdit = computed(() => props.canManage && capabilityCanManage.value !== false)
const readOnly = computed(() => !canEdit.value || Boolean(selectedRole.value?.is_protected))
const roleDetailsReadOnly = computed(() => readOnly.value || !props.canManageRoleDefinitions || Boolean(selectedRole.value?.is_builtin))
const allGroupedRows = computed(() => {
    const groups = new Map<string, RolePermissionMatrixRow[]>()
    for (const row of rows.value) {
        const group = groups.get(row.resource) ?? []
        group.push(row)
        groups.set(row.resource, group)
    }
    return [...groups.entries()]
})
const resourceOptions = computed(() => allGroupedRows.value.map(([resource]) => resource))
const groupedRows = computed(() => {
    const query = permissionSearch.value.trim().toLocaleLowerCase()
    return allGroupedRows.value
        .filter(([resource]) => !resourceJump.value || resource === resourceJump.value)
        .map(([resource, resourceRows]) => [resource, resourceRows.filter(row => {
            if (!query) return true
            const terms = [resource, resourceName(resource), resourceDescription(resource), row.action, actionName(row.action), actionDescription(row.action), row.permission_key]
            return terms.some(term => term.toLocaleLowerCase().includes(query))
        })] as [string, RolePermissionMatrixRow[]])
        .filter(([, resourceRows]) => resourceRows.length > 0)
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
    loading.value = true
    try {
        const capabilities = await RoleService.getCapabilities()
        epoch.value = capabilities.epoch
        const domainCapabilities = props.domain === 'system' ? capabilities.system : capabilities.teaching
        capabilityCanManage.value = props.policyScopeType
            ? await RoleService.canManageRoleScope(targetScopeType.value, targetScopeId.value, props.domain)
            : typeof domainCapabilities?.roles_manage === 'boolean' ? domainCapabilities.roles_manage : null
        roles.value = props.policyScopeType
            ? await RoleService.getRolesForScope({ domain: props.domain, scopeType: targetScopeType.value, scopeId: targetScopeId.value })
            : await RoleService.getRoles({ domain: props.domain })
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
        success('rbac.save_permissions_success')
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
        success('common.save_success')
    } catch (error) { reportError(error) } finally { saving.value = false }
}

async function createRole() {
    if (!newRoleName.value.trim()) return
    saving.value = true
    try {
        await RoleService.createRole(newRoleName.value, { domain: props.domain, expectedEpoch: epoch.value })
        newRoleName.value = ''
        await loadRoles()
        success('rbac.role_created')
    } catch (error) { reportError(error) } finally { saving.value = false }
}

async function deleteRole() {
    if (!selectedRole.value || selectedRole.value.is_builtin || selectedRole.value.is_protected) return
    saving.value = true
    try { await RoleService.deleteRole(selectedRole.value.id, epoch.value); await loadRoles(); success('rbac.role_deleted') } catch (error) { reportError(error) } finally { saving.value = false }
}

function jumpToResource(resource: string) {
    resourceJump.value = resource
    if (!resource) return
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    void nextTick(() => document.getElementById(`permission-resource-${resource}`)?.scrollIntoView({ behavior, block: 'start' }))
}

watch(() => [props.domain, props.policyScopeType, props.policyScopeId], () => { void loadRoles() })
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
                <span v-if="selectedRole?.is_protected" class="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{{ t('rbac.protected_read_only', 'Protected role · read only') }}</span>
            </div>
        </div>

        <div v-if="conflict" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            {{ t('rbac.version_conflict', 'The permission configuration changed. Your draft is preserved; reload before saving again.') }}
        </div>

        <div class="grid min-w-0 gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div class="max-h-64 overflow-y-auto rounded-2xl border border-gray-100 bg-white p-4 lg:sticky lg:top-20 lg:max-h-[70vh]">
                <div v-if="canEdit && canManageRoleDefinitions" class="mb-3 flex gap-2">
                    <input v-model="newRoleName" class="min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm" :placeholder="t('rbac.new_role', 'New role')"  :aria-label="t('rbac.new_role', 'New role')"/>
                    <button class="min-h-11 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-40" :disabled="saving || !newRoleName.trim()" @click="createRole">{{ t('common.add', 'Add') }}</button>
                </div>
                <p v-if="loading" class="py-4 text-sm text-gray-400">{{ t('common.loading', 'Loading…') }}</p>
                <button v-for="role in roles" :key="role.id" type="button" :aria-pressed="selectedRoleId === role.id" class="mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :class="selectedRoleId === role.id ? 'bg-emerald-50 text-emerald-700' : 'hover:bg-gray-50'" @click="selectedRoleId = role.id">
                    <span>{{ roleName(role) }}</span><span v-if="role.is_builtin" class="text-[10px] text-gray-400">{{ t('rbac.builtin', 'Built-in') }}</span>
                </button>
                <button v-if="selectedRole && !selectedRole.is_builtin && !selectedRole.is_protected && canEdit && canManageRoleDefinitions" class="mt-3 min-h-11 rounded-lg px-3 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-40" :disabled="saving" @click="deleteRole">{{ saving ? t('common.processing') : t('common.delete', 'Delete') }}</button>
            </div>

            <div class="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 sm:p-5">
                <div v-if="selectedRole" class="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input :value="selectedRole.is_builtin ? roleName(selectedRole) : draftName" :disabled="roleDetailsReadOnly" class="rounded-lg border px-3 py-2 text-sm" :aria-label="t('rbac.role_name', 'Role name')" @input="draftName = ($event.target as HTMLInputElement).value" />
                    <input :value="selectedRole.is_builtin ? roleDescription(selectedRole) : draftDescription" :disabled="roleDetailsReadOnly" class="rounded-lg border px-3 py-2 text-sm" :placeholder="roleDescription(selectedRole)" :aria-label="t('rbac.role_description', 'Role description')" @input="draftDescription = ($event.target as HTMLInputElement).value" />
                    <button :disabled="roleDetailsReadOnly || !canManageRoleDefinitions || saving" class="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-bold text-emerald-700 disabled:opacity-40" @click="saveRoleDetails">{{ t('common.save', 'Save') }}</button>
                </div>
                <div class="sticky top-0 z-10 mb-4 grid gap-2 border-b border-gray-100 bg-white/95 py-3 backdrop-blur sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)]">
                    <label class="sr-only" :for="`permission-search-${domain}`">{{ t('rbac.permission_search') }}</label>
                    <input :id="`permission-search-${domain}`" v-model="permissionSearch" type="search" class="min-h-11 min-w-0 rounded-xl border border-gray-200 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :placeholder="t('rbac.permission_search')" />
                    <label class="sr-only" :for="`permission-resource-filter-${domain}`">{{ t('rbac.permission_resource_jump') }}</label>
                    <select :id="`permission-resource-filter-${domain}`" :value="resourceJump" class="min-h-11 min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm" @change="jumpToResource(($event.target as HTMLSelectElement).value)">
                        <option value="">{{ t('rbac.permission_all_resources') }}</option>
                        <option v-for="resource in resourceOptions" :key="resource" :value="resource">{{ resourceName(resource) }}</option>
                    </select>
                </div>
                <p v-if="groupedRows.length === 0" class="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">{{ t('rbac.permission_no_results') }}</p>
                <div v-for="[resource, resourceRows] in groupedRows" :id="`permission-resource-${resource}`" :key="resource" class="mb-5 scroll-mt-24">
                    <h4 class="mb-2 border-b border-gray-100 pb-2 text-gray-700">
                        <span class="font-black">{{ resourceName(resource) }}</span>
                        <code class="ml-2 text-[10px] font-normal uppercase tracking-widest text-gray-400">{{ resource }}</code>
                        <span class="mt-1 block text-xs font-normal text-gray-400">{{ resourceDescription(resource) }}</span>
                    </h4>
                    <div v-for="row in resourceRows" :key="row.permission_id" class="grid min-w-0 grid-cols-1 items-start gap-2 border-b border-gray-50 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3">
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
                <button :disabled="readOnly || saving || !dirty" class="min-h-11 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" @click="save">{{ saving ? t('common.saving', 'Saving…') : t('rbac.save_permissions', 'Save permissions') }}</button>
            </div>
        </div>
    </section>
</template>
