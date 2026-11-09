<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RoleAssignmentService } from '@/services/rbac/RoleAssignmentService'
import { UserAccountService } from '@/services/auth/UserAccountService'
import { RoleService } from '@/services/rbac/RoleService'
import type { RoleDTO } from '@/models/Rbac'
import { useFeedback } from '@/composables/useFeedback'
import RolePermissionEditor from '@/components/settings/RolePermissionEditor.vue'
import TeachingRolePermissionsPanel from '@/components/settings/TeachingRolePermissionsPanel.vue'
import PlatformTeachingRoleAssignmentsPanel from '@/components/settings/PlatformTeachingRoleAssignmentsPanel.vue'
import AuditLogPanel from '@/components/settings/AuditLogPanel.vue'
import AiAdminPanel from '@/components/settings/ai/AiAdminPanel.vue'
import IncompleteReportNotificationSettings from '@/components/settings/IncompleteReportNotificationSettings.vue'
import DashboardScheduleVisibilitySettings from '@/components/settings/DashboardScheduleVisibilitySettings.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import Pagination from '@/components/ui/Pagination.vue'
import { AuthUserSearchService, type AuthUserSearchResultDTO } from '@/services/auth/AuthUserSearchService'
import { roleDisplayDescription } from '@/utils/roleDisplay'
import { DateUtils } from '@/utils/dateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'

type Assignment = { id: string; user_id: string; role_id: string; roles?: { code?: string; name?: string }; effective_from?: string; effective_to?: string | null }
type SystemSection = 'permissions' | 'teaching_permissions' | 'assignments' | 'teaching_assignments' | 'users' | 'notifications' | 'dashboard_schedule' | 'audit' | 'ai'

const ALL_SECTIONS: readonly SystemSection[] = ['permissions', 'teaching_permissions', 'assignments', 'teaching_assignments', 'users', 'notifications', 'dashboard_schedule', 'audit', 'ai']

/** Settings overview capability flags; absent means "show every section" (older API). */
const props = defineProps<{ sections?: Record<string, Record<string, boolean>> }>()

const { errorKey, reportError, success } = useFeedback()
const { t } = useI18n()
const preferences = usePreferencesStore()
const roles = ref<RoleDTO[]>([])
const users = ref<AuthUserSearchResultDTO[]>([])
const selectedUser = ref<AuthUserSearchResultDTO | null>(null)
const assignments = ref<Assignment[]>([])
const assignmentTotal = ref(0)
const assignmentPage = ref(1)
const assignmentPageSize = ref(20)
const selectedUserId = ref('')
const selectedRoleId = ref('')
const selectedStatus = ref<'active' | 'disabled'>('active')
const statusReason = ref('')
const epoch = ref(1)
const visibleSections = computed<SystemSection[]>(() => {
    if (!props.sections) return [...ALL_SECTIONS]
    const system = props.sections.system ?? {}
    const teaching = props.sections.teaching ?? {}
    const owner = system.is_owner === true
    const allowed: Record<SystemSection, boolean> = {
        permissions: owner || system.roles_manage === true || system.permissions_read === true,
        teaching_permissions: teaching.roles === true || teaching.permissions === true,
        assignments: owner || system.assignments_manage === true,
        teaching_assignments: teaching.roles === true,
        users: owner || system.users_manage === true,
        // Both edit teaching-role policies.
        notifications: teaching.roles === true,
        dashboard_schedule: teaching.roles === true,
        audit: owner || system.audit_read === true,
        ai: system.ai_manage === true || system.ai_logs_view_all === true,
    }
    return ALL_SECTIONS.filter(section => allowed[section])
})
/** System role data is only loaded for the sections that use it. */
const needsSystemRoles = computed(() => visibleSections.value.includes('assignments') || visibleSections.value.includes('users'))
const activeSection = ref<SystemSection>(visibleSections.value[0] ?? 'permissions')
const loading = ref(false)
const userLoading = ref(false)
const assignmentLoading = ref(false)
const assignmentLoadError = ref(false)
const userQuery = ref('')
const saving = ref(false)
const effectiveFrom = ref(todayLocal())
const effectiveTo = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSequence = 0
let assignmentSequence = 0

const currentStatus = computed<'active' | 'disabled'>(() => selectedUser.value?.account_status === 'disabled' ? 'disabled' : 'active')
const statusChanged = computed(() => selectedStatus.value !== currentStatus.value)

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
    description: roleDisplayDescription(role, t),
    searchText: `${role.name} ${role.code ?? ''} ${role.description ?? ''} ${roleLabel(role)} ${roleDisplayDescription(role, t)}`,
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
    const user = selectedUser.value?.id === userId ? selectedUser.value : users.value.find(user => user.id === userId)
    return user?.display_name?.trim() || user?.email || t('rbac.system_ui.unknown_user')
}

function userEmail(userId: string) {
    return (selectedUser.value?.id === userId ? selectedUser.value.email : users.value.find(user => user.id === userId)?.email) || ''
}

async function refreshEpoch() {
    epoch.value = (await RoleService.getCapabilities()).epoch
}

async function load() {
    if (!needsSystemRoles.value) return
    loading.value = true
    try {
        const [roleResult] = await Promise.all([
            RoleService.getRoles({ domain: 'system' }),
        ])
        roles.value = roleResult
        await loadAssignments()
        selectedRoleId.value ||= roles.value.find(role => role.code === 'auditor')?.id ?? roles.value[0]?.id ?? ''
        await refreshEpoch()
    } catch (error) { reportError(error) } finally { loading.value = false }
}

function assignmentStatus(assignment: Assignment) {
    const today = todayLocal()
    if (assignment.effective_from && assignment.effective_from > today) return t('rbac.system_ui.scheduled')
    if (assignment.effective_to && assignment.effective_to < today) return t('rbac.system_ui.expired')
    return t('rbac.system_ui.active')
}

function searchUsers(query: string) {
    if (searchTimer) clearTimeout(searchTimer)
    const sequence = ++searchSequence
    userQuery.value = query.trim()
    if (!userQuery.value) { users.value = []; userLoading.value = false; return }
    userLoading.value = true
    searchTimer = setTimeout(async () => {
        try {
            const results = await AuthUserSearchService.searchUsers(userQuery.value)
            if (sequence === searchSequence) users.value = results
        } catch (error) {
            if (sequence === searchSequence) { users.value = []; reportError(error) }
        } finally { if (sequence === searchSequence) userLoading.value = false }
    }, 250)
}

function onUserSelected(userId: string) {
    selectedUserId.value = userId
    selectedUser.value = users.value.find(user => user.id === userId) ?? null
    if (selectedUser.value?.id === userId) selectedStatus.value = selectedUser.value.account_status === 'disabled' ? 'disabled' : 'active'
    else selectedStatus.value = 'active'
    statusReason.value = ''
    assignmentPage.value = 1
    void loadAssignments()
}

async function loadAssignments() {
    const sequence = ++assignmentSequence
    const userId = selectedUserId.value
    assignments.value = []
    assignmentTotal.value = 0
    assignmentLoadError.value = false
    if (!userId) { assignmentLoading.value = false; return }
    assignmentLoading.value = true
    try {
        const result = await RoleAssignmentService.listSystemAssignments<Assignment>(userId, assignmentPage.value, assignmentPageSize.value)
        if (sequence !== assignmentSequence || selectedUserId.value !== userId) return
        assignments.value = result.rows
        assignmentTotal.value = result.total
    } catch (error) {
        if (sequence === assignmentSequence && selectedUserId.value === userId) { assignmentLoadError.value = true; reportError(error) }
    } finally { if (sequence === assignmentSequence) assignmentLoading.value = false }
}

async function assignRole() {
    if (!selectedUserId.value || !selectedRoleId.value) return
    saving.value = true
    try {
        await RoleAssignmentService.createSystemAssignment({
            user_id: selectedUserId.value,
            role_id: selectedRoleId.value,
            effective_from: effectiveFrom.value,
            effective_to: effectiveTo.value || null,
            expected_epoch: epoch.value,
        })
        await loadAssignments()
        success('rbac.system_assignment_saved')
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'SYSTEM_ROLE_ASSIGNMENT_OVERLAP') errorKey('errors.system_role_assignment_overlap')
        else reportError(error)
    } finally { saving.value = false }
}

async function updateStatus() {
    const targetUserId = selectedUserId.value
    const targetStatus = selectedStatus.value
    if (!targetUserId) return
    if (!statusChanged.value) return
    if (targetStatus === 'disabled' && statusReason.value.trim().length < 3) return
    saving.value = true
    try {
        const reason = targetStatus === 'disabled' ? statusReason.value.trim() : null
        const result = await UserAccountService.updateStatus(targetUserId, targetStatus, reason, epoch.value)
        const updated = {
            account_status: result.account_status,
            disabled_at: result.disabled_at,
            disabled_reason: result.account_status === 'disabled' ? reason : null,
        }
        if (selectedUser.value?.id === targetUserId) {
            selectedUser.value = { ...selectedUser.value, ...updated }
            selectedStatus.value = result.account_status
            statusReason.value = ''
        }
        users.value = users.value.map(user => user.id === targetUserId ? { ...user, ...updated } : user)
        success('common.save_success')
    } catch (error) { reportError(error) } finally { saving.value = false }
}

async function removeAssignment(assignment: Assignment) {
    if (!window.confirm(t('rbac.system_ui.remove_assignment_confirm'))) return
    saving.value = true
    try {
        await RoleAssignmentService.deleteSystemAssignment(assignment.id, epoch.value)
        await loadAssignments()
        success('common.deleted')
    } catch (error) { reportError(error) } finally { saving.value = false }
}

function selectSection(section: SystemSection) {
    activeSection.value = section
}

watch(visibleSections, (sections) => {
    if (!sections.includes(activeSection.value) && sections[0]) activeSection.value = sections[0]
})

onMounted(load)
watch(assignmentPage, loadAssignments)
watch(assignmentPageSize, () => { assignmentPage.value = 1; void loadAssignments() })
</script>

<template>
    <section class="space-y-6">
        <div class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <h2 class="text-xl font-black text-gray-900">{{ t('rbac.system_title') }}</h2>
            <p class="mt-1 text-sm font-bold text-gray-400">{{ t('rbac.system_subtitle') }}</p>
            <nav class="mt-5 flex flex-wrap gap-2" role="group" :aria-label="t('rbac.system_sections.label')">
                <button v-for="section in visibleSections" :key="section" type="button" :aria-pressed="activeSection === section" class="min-h-11 rounded-xl px-4 py-2 text-sm font-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600" :class="activeSection === section ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'" @click="selectSection(section)">
                    {{ t(`rbac.system_sections.${section}`) }}
                </button>
            </nav>
        </div>

        <div v-if="activeSection === 'assignments' || activeSection === 'users'" class="grid gap-6">
            <div v-if="activeSection === 'assignments'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 class="mb-4 font-black">{{ t('rbac.system_ui.role_assignments') }}</h3>
                <div class="grid gap-3">
                    <SearchableSelect :model-value="selectedUserId" :options="userOptions" remote-search :loading="userLoading" :placeholder="t('rbac.system_ui.select_user')" :aria-label="t('rbac.system_ui.user_search')" :no-results-text="!userQuery ? t('rbac.system_ui.user_search_hint') : t('rbac.system_ui.no_users_found')" :loading-text="t('common.loading')" @search="searchUsers" @update:model-value="onUserSelected" />
                    <SearchableSelect v-model="selectedRoleId" :options="roleOptions" :placeholder="t('rbac.system_ui.select_system_role')" :aria-label="t('rbac.system_ui.system_role_search')" :disabled="assignmentLoading || loading" />
                    <div class="grid gap-3 sm:grid-cols-2">
                        <label class="space-y-1 text-xs font-bold text-gray-500"><span>{{ t('rbac.system_ui.effective_from') }}</span><input v-model="effectiveFrom" type="date" required class="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800" /></label>
                        <label class="space-y-1 text-xs font-bold text-gray-500"><span>{{ t('rbac.system_ui.effective_to') }}</span><input v-model="effectiveTo" type="date" :min="effectiveFrom" class="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800" /></label>
                    </div>
                    <p v-if="assignmentConflict" role="alert" class="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{{ t('rbac.system_ui.assignment_overlap') }}</p>
                    <button :disabled="saving || assignmentLoading || !selectedUserId || !selectedRoleId || !effectiveFrom || assignmentConflict || Boolean(effectiveTo && effectiveTo < effectiveFrom)" class="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 font-black text-white disabled:opacity-40" @click="assignRole">{{ saving ? t('common.saving') : t('rbac.system_ui.assign_role') }}</button>
                </div>
                <div v-if="selectedUser" class="mt-5 rounded-xl bg-gray-50 px-4 py-3"><p class="font-bold text-gray-900">{{ selectedUser.display_name?.trim() || selectedUser.email }}</p><p class="text-sm text-gray-500">{{ selectedUser.email }}</p></div>
                <p v-if="loading || assignmentLoading" role="status" aria-live="polite" class="mt-4 text-sm text-gray-500" :aria-busy="assignmentLoading">{{ t('rbac.system_ui.assignments_loading', { user: selectedUser?.display_name?.trim() || selectedUser?.email || selectedUserId }) }}</p>
                <div v-else-if="assignmentLoadError" role="alert" class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800"><span>{{ t('rbac.system_ui.assignment_load_failed') }}</span><button type="button" class="min-h-11 rounded-lg px-3 font-bold underline" @click="loadAssignments">{{ t('rbac.system_ui.retry') }}</button></div>
                <p v-else-if="!selectedUserId" class="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">{{ t('rbac.system_ui.search_user_to_view') }}</p>
                <div v-for="assignment in assignments" :key="assignment.id" class="mt-4 flex items-center justify-between gap-3 border-t border-gray-50 pt-3">
                    <div class="min-w-0"><p class="truncate font-bold">{{ userName(assignment.user_id) }}</p><p v-if="userEmail(assignment.user_id)" class="truncate text-xs text-gray-500">{{ userEmail(assignment.user_id) }}</p><p class="mt-1 text-xs font-semibold text-gray-700">{{ roleLabel(assignment.roles) || t('rbac.system_ui.system_role') }} · {{ assignmentStatus(assignment) }}</p><p class="text-xs text-gray-400">{{ assignment.effective_from }} - {{ assignment.effective_to || t('rbac.system_ui.no_end_date') }}</p></div>
                    <button class="min-h-11 rounded-lg px-3 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-40" :disabled="saving" @click="removeAssignment(assignment)">{{ saving ? t('common.processing') : t('common.delete') }}</button>
                </div>
                <p v-if="selectedUserId && !assignmentLoading && !assignmentLoadError && assignments.length === 0" class="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">{{ t('rbac.system_ui.no_assignments_for_user') }}</p>
                <Pagination v-if="assignmentTotal > 0" v-model="assignmentPage" v-model:per-page="assignmentPageSize" :total-items="assignmentTotal" />
            </div>

            <div v-if="activeSection === 'users'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
                <h3 class="mb-4 font-black">{{ t('rbac.system_ui.account_status') }}</h3>
                <SearchableSelect :model-value="selectedUserId" :options="userOptions" remote-search :loading="userLoading" :placeholder="t('rbac.system_ui.select_user')" :aria-label="t('rbac.system_ui.status_user')" :no-results-text="!userQuery ? t('rbac.system_ui.user_search_hint') : t('rbac.system_ui.no_users_found')" :loading-text="t('common.loading')" @search="searchUsers" @update:model-value="onUserSelected" />
                <section v-if="selectedUser" class="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4" :aria-busy="saving">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0"><h4 class="font-black text-gray-900">{{ selectedUser.display_name?.trim() || selectedUser.email }}</h4><p class="text-sm text-gray-600">{{ selectedUser.email }}</p></div>
                        <span class="rounded-full px-3 py-1 text-sm font-black" :class="currentStatus === 'disabled' ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'">{{ t('rbac.system_ui.current_status') }}: {{ t(`rbac.system_ui.${currentStatus}`) }}</span>
                    </div>
                    <div v-if="currentStatus === 'disabled'" class="mt-3 grid gap-2 rounded-xl bg-white/80 p-3 text-sm sm:grid-cols-2">
                        <p><span class="font-bold text-gray-700">{{ t('rbac.system_ui.disabled_at') }}: </span>{{ DateUtils.displayDate(selectedUser.disabled_at ?? undefined, preferences.locale, preferences.timeZone) }}</p>
                        <p><span class="font-bold text-gray-700">{{ t('rbac.system_ui.disabled_reason_recorded') }}: </span>{{ selectedUser.disabled_reason?.trim() || t('rbac.system_ui.no_disable_reason') }}</p>
                    </div>
                    <div class="mt-4 grid gap-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(12rem,2fr)_auto] sm:items-end">
                        <label class="space-y-1 text-xs font-bold text-gray-600"><span>{{ t('rbac.system_ui.change_to') }}</span><select v-model="selectedStatus" class="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2" :aria-label="t('rbac.system_ui.change_to')"><option value="active">{{ t('rbac.system_ui.active') }}</option><option value="disabled">{{ t('rbac.system_ui.disabled') }}</option></select></label>
                        <label v-if="selectedStatus === 'disabled' && currentStatus !== 'disabled'" class="space-y-1 text-xs font-bold text-gray-600"><span>{{ t('rbac.system_ui.disable_reason') }}</span><input v-model="statusReason" class="min-h-11 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" :placeholder="t('rbac.system_ui.disable_reason')"  :aria-label="t('rbac.system_ui.disable_reason')"/></label>
                        <div v-else></div>
                        <button :disabled="saving || !statusChanged || (selectedStatus === 'disabled' && statusReason.trim().length < 3)" class="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 font-black text-white disabled:opacity-40" @click="updateStatus">{{ saving ? t('common.saving') : t('common.save') }}</button>
                    </div>
                </section>
                <p v-else class="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">{{ t('rbac.system_ui.search_user_to_view') }}</p>
                <p class="mt-4 text-xs text-gray-400">{{ t('rbac.system_ui.last_owner_guard') }}</p>
            </div>
        </div>

        <div v-if="activeSection === 'permissions'" class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
            <RolePermissionEditor domain="system" :title="$t('rbac.system_permissions')" />
        </div>

        <TeachingRolePermissionsPanel v-if="activeSection === 'teaching_permissions'" />

        <PlatformTeachingRoleAssignmentsPanel v-else-if="activeSection === 'teaching_assignments'" />

        <IncompleteReportNotificationSettings v-else-if="activeSection === 'notifications'" />

        <DashboardScheduleVisibilitySettings v-else-if="activeSection === 'dashboard_schedule'" />

        <AuditLogPanel v-if="activeSection === 'audit'" />
        <AiAdminPanel v-if="activeSection === 'ai'" />
    </section>
</template>
