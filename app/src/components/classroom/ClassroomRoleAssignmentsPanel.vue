<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import Pagination from '@/components/common/Pagination.vue'
import type { RoleDTO } from '@/models/Rbac'
import { AuthUserSearchService, type AuthUserSearchResultDTO } from '@/services/auth/AuthUserSearchService'
import { ClassroomRoleAssignmentService, type ClassroomRoleAssignmentDTO } from '@/services/rbac/ClassroomRoleAssignmentService'
import { RoleService } from '@/services/rbac/RoleService'
import { roleDisplayName } from '@/utils/roleDisplay'

const props = defineProps<{
    classroomId?: string | null
}>()

const { t, locale } = useI18n()
const toast = useToast()
const loading = ref(false)
const saving = ref(false)
const canRead = ref(true)
const canManage = ref(false)
const canListUsers = ref(false)
const assignments = ref<ClassroomRoleAssignmentDTO[]>([])
const assignmentTotal = ref(0)
const roles = ref<RoleDTO[]>([])
const userOptions = ref<AuthUserSearchResultDTO[]>([])
const userSearchQuery = ref('')
const userSearchLoading = ref(false)
const userSearchError = ref(false)
const page = ref(1)
const pageSize = 10
const isFormOpen = ref(false)
const editingAssignment = ref<ClassroomRoleAssignmentDTO | null>(null)
const selectedUserId = ref('')
const selectedRoleId = ref('')
const effectiveFrom = ref(localToday())
const effectiveTo = ref('')
const formError = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSequence = 0

const roleOptions = computed(() => roles.value.map(role => ({
    value: role.id,
    label: roleDisplayName(role, key => t(key)),
    searchText: `${role.code ?? ''} ${role.name} ${role.description ?? ''}`,
    description: role.is_builtin ? t('rbac.builtin') : undefined
})))
const assignmentStart = computed(() => (page.value - 1) * pageSize)

function localToday() {
    const now = new Date()
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    return localDate.toISOString().slice(0, 10)
}

function userLabel(user: AuthUserSearchResultDTO) {
    const name = user.display_name?.trim()
    return name ? `${name} · ${user.email}` : user.email
}

function assignmentUserLabel(assignment: ClassroomRoleAssignmentDTO) {
    const displayName = assignment.user?.display_name?.trim()
    return displayName || assignment.user?.email || assignment.user_id
}

function assignmentRoleLabel(assignment: ClassroomRoleAssignmentDTO) {
    const role = roles.value.find(item => item.id === assignment.role_id) ?? assignment.roles
    if (!role) return assignment.role_id
    return roleDisplayName(role, key => t(key))
}

function formatDate(value: string) {
    const [year, month, day] = value.split('-').map(Number)
    return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(year, month - 1, day))
}

function assignmentStatus(assignment: ClassroomRoleAssignmentDTO) {
    const today = localToday()
    if (assignment.effective_from > today) return 'scheduled'
    if (assignment.effective_to && assignment.effective_to < today) return 'expired'
    return 'active'
}

function statusLabel(status: string) {
    return t(`classroom.role_assignments.status_${status}`)
}

function clearForm() {
    isFormOpen.value = false
    editingAssignment.value = null
    selectedUserId.value = ''
    selectedRoleId.value = ''
    effectiveFrom.value = localToday()
    effectiveTo.value = ''
    userOptions.value = []
    formError.value = ''
}

function openCreateForm() {
    clearForm()
    selectedRoleId.value = roleOptions.value[0]?.value ?? ''
    isFormOpen.value = true
}

function openEditForm(assignment: ClassroomRoleAssignmentDTO) {
    editingAssignment.value = assignment
    selectedUserId.value = assignment.user_id
    selectedRoleId.value = assignment.role_id
    effectiveFrom.value = assignment.effective_from
    effectiveTo.value = assignment.effective_to ?? ''
    if (assignment.user?.email) {
        userOptions.value = [{
            id: assignment.user_id,
            email: assignment.user.email,
            display_name: assignment.user.display_name
        }]
    }
    formError.value = ''
    isFormOpen.value = true
}

function searchAccounts(query: string) {
    if (searchTimer) clearTimeout(searchTimer)
    const requestId = ++searchSequence
    const normalized = query.trim()
    userSearchQuery.value = normalized
    userSearchError.value = false
    if (normalized.length < 2) {
        userOptions.value = []
        userSearchLoading.value = false
        return
    }
    userSearchLoading.value = true
    searchTimer = setTimeout(async () => {
        try {
            const results = await AuthUserSearchService.searchUsers(normalized)
            if (requestId === searchSequence) userOptions.value = results
        } catch {
            if (requestId === searchSequence) userSearchError.value = true
        } finally {
            if (requestId === searchSequence) userSearchLoading.value = false
        }
    }, 250)
}

async function loadAssignments() {
    if (!props.classroomId) return
    loading.value = true
    try {
        const result = await ClassroomRoleAssignmentService.list(props.classroomId, page.value, pageSize)
        assignments.value = result.data
        assignmentTotal.value = result.total
        canListUsers.value = result.canListUsers
        canRead.value = true
    } catch {
        canRead.value = false
        assignments.value = []
        assignmentTotal.value = 0
    } finally {
        loading.value = false
    }
}

async function loadPanel() {
    clearForm()
    page.value = 1
    if (!props.classroomId) {
        canRead.value = false
        canManage.value = false
        canListUsers.value = false
        assignments.value = []
        roles.value = []
        return
    }
    canManage.value = await RoleService.canManageRoleScope('classroom', props.classroomId).catch(() => false)
    const results = await Promise.allSettled([
        ClassroomRoleAssignmentService.list(props.classroomId, 1, pageSize),
        RoleService.getRolesForScope({ domain: 'teaching', scopeType: 'classroom', scopeId: props.classroomId })
    ])
    const assignmentResult = results[0]
    if (assignmentResult.status === 'fulfilled') {
        assignments.value = assignmentResult.value.data
        assignmentTotal.value = assignmentResult.value.total
        canListUsers.value = assignmentResult.value.canListUsers
        canRead.value = true
    } else {
        assignments.value = []
        assignmentTotal.value = 0
        canListUsers.value = false
        canRead.value = false
    }
    roles.value = results[1].status === 'fulfilled' ? results[1].value : []
}

async function submitAssignment() {
    if (!props.classroomId || !canManage.value || !canListUsers.value || !selectedUserId.value || !selectedRoleId.value || !effectiveFrom.value) return
    if (effectiveTo.value && effectiveTo.value < effectiveFrom.value) {
        formError.value = t('classroom.role_assignments.invalid_date_range')
        return
    }
    saving.value = true
    formError.value = ''
    try {
        const isNewAssignment = !editingAssignment.value
        const capabilities = await RoleService.getCapabilities()
        const input = {
            user_id: selectedUserId.value,
            role_id: selectedRoleId.value,
            effective_from: effectiveFrom.value,
            effective_to: effectiveTo.value || null,
            expected_epoch: capabilities.epoch
        }
        if (editingAssignment.value) {
            await ClassroomRoleAssignmentService.update(props.classroomId, editingAssignment.value.id, input)
        } else {
            await ClassroomRoleAssignmentService.create(props.classroomId, input)
        }
        toast.success(t(editingAssignment.value ? 'classroom.role_assignments.updated' : 'classroom.role_assignments.created'))
        clearForm()
        if (isNewAssignment && assignmentStart.value >= assignmentTotal.value) page.value = Math.max(1, Math.ceil((assignmentTotal.value + 1) / pageSize))
        await loadAssignments()
    } catch (error: any) {
        if (error?.code === 'CLASSROOM_ROLE_ASSIGNMENT_OVERLAP') {
            formError.value = t('classroom.role_assignments.overlap')
        } else if (error?.status === 403) {
            formError.value = t('classroom.role_assignments.directory_permission_required')
        } else {
            formError.value = error?.message || t('classroom.role_assignments.save_failed')
        }
    } finally {
        saving.value = false
    }
}

async function revokeAssignment(assignment: ClassroomRoleAssignmentDTO) {
    if (!props.classroomId || !window.confirm(t('classroom.role_assignments.confirm_revoke', { user: assignmentUserLabel(assignment), role: assignmentRoleLabel(assignment) }))) return
    saving.value = true
    try {
        const capabilities = await RoleService.getCapabilities()
        await ClassroomRoleAssignmentService.delete(props.classroomId, assignment.id, capabilities.epoch)
        toast.success(t('classroom.role_assignments.revoked'))
        if (assignments.value.length === 1 && page.value > 1) page.value -= 1
        await loadAssignments()
    } catch (error: any) {
        formError.value = error?.message || t('classroom.role_assignments.revoke_failed')
    } finally {
        saving.value = false
    }
}

watch(page, () => { void loadAssignments() })
watch(() => props.classroomId, () => { void loadPanel() })
onMounted(() => { void loadPanel() })
onBeforeUnmount(() => { if (searchTimer) clearTimeout(searchTimer) })
</script>

<template>
    <section class="mx-auto max-w-5xl space-y-5" aria-labelledby="classroom-role-assignments-title">
        <header class="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div class="min-w-0">
                <h4 id="classroom-role-assignments-title" class="text-lg font-black text-gray-900">{{ t('classroom.role_assignments.title') }}</h4>
                <p class="mt-1 max-w-3xl text-sm leading-6 text-gray-600">{{ t('classroom.role_assignments.scope_hint') }}</p>
            </div>
            <button v-if="canManage" type="button" class="min-h-11 shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!canListUsers || !roles.length || loading" @click="openCreateForm">
                {{ t('classroom.role_assignments.add') }}
            </button>
        </header>

        <p v-if="!classroomId" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900">{{ t('classroom.role_assignments.save_room_first') }}</p>
        <p v-else-if="!canRead" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900">{{ t('errors.permission_required_for_settings') }}</p>
        <p v-else-if="canManage && !canListUsers" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900">{{ t('classroom.role_assignments.directory_permission_required') }}</p>

        <form v-if="isFormOpen && canManage && canListUsers" class="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" @submit.prevent="submitAssignment">
            <div class="flex items-center justify-between gap-3">
                <h5 class="font-black text-gray-900">{{ t(editingAssignment ? 'classroom.role_assignments.edit_title' : 'classroom.role_assignments.add_title') }}</h5>
                <button type="button" class="min-h-11 min-w-11 rounded-lg px-3 text-sm font-bold text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" @click="clearForm">{{ t('common.cancel') }}</button>
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
                <label class="min-w-0 space-y-2">
                    <span class="text-sm font-bold text-gray-700">{{ t('classroom.role_assignments.account') }}</span>
                    <SearchableSelect v-model="selectedUserId" :options="userOptions.map(user => ({ value: user.id, label: userLabel(user), searchText: `${user.email} ${user.display_name ?? ''}` }))" remote-search :loading="userSearchLoading" :no-results-text="userSearchQuery.length < 2 ? t('classroom.role_assignments.user_search_hint') : userSearchError ? t('classroom.role_assignments.user_search_failed') : t('classroom.role_assignments.no_users_found')" :loading-text="t('common.loading')" :placeholder="t('classroom.role_assignments.search_account')" :aria-label="t('classroom.role_assignments.account')" @search="searchAccounts" />
                    <span class="block text-xs leading-5 text-gray-500">{{ t('classroom.role_assignments.account_search_hint') }}</span>
                </label>
                <label class="min-w-0 space-y-2">
                    <span class="text-sm font-bold text-gray-700">{{ t('classroom.role_assignments.role') }}</span>
                    <SearchableSelect v-model="selectedRoleId" :options="roleOptions" :placeholder="t('classroom.role_assignments.select_role')" :aria-label="t('classroom.role_assignments.role')" :no-results-text="t('classroom.role_assignments.no_roles')" />
                </label>
                <label class="space-y-2">
                    <span class="text-sm font-bold text-gray-700">{{ t('classroom.role_assignments.effective_from') }}</span>
                    <input v-model="effectiveFrom" type="date" required class="min-h-11 w-full rounded-xl border-gray-300 focus:border-emerald-600 focus:ring-emerald-600">
                </label>
                <label class="space-y-2">
                    <span class="text-sm font-bold text-gray-700">{{ t('classroom.role_assignments.effective_to') }}</span>
                    <input v-model="effectiveTo" type="date" class="min-h-11 w-full rounded-xl border-gray-300 focus:border-emerald-600 focus:ring-emerald-600">
                </label>
            </div>
            <p v-if="formError" role="alert" class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{{ formError }}</p>
            <div class="flex flex-col-reverse justify-end gap-2 sm:flex-row">
                <button type="button" class="min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400" :disabled="saving" @click="clearForm">{{ t('common.cancel') }}</button>
                <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-50" :disabled="saving || !selectedUserId || !selectedRoleId || !effectiveFrom">
                    {{ saving ? t('common.loading') : t('common.save') }}
                </button>
            </div>
        </form>

        <div v-if="canRead" class="space-y-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h5 class="text-sm font-black text-gray-800">{{ t('classroom.role_assignments.list_title') }}</h5>
                <span class="text-xs font-bold text-gray-500">{{ t('classroom.role_assignments.assignment_count', { count: assignmentTotal }) }}</span>
            </div>
            <div v-if="loading" class="rounded-2xl border border-gray-200 bg-gray-50 p-8 text-center text-sm font-bold text-gray-500" role="status" aria-live="polite">{{ t('common.loading') }}</div>
            <div v-else-if="!assignments.length" class="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-10 text-center">
                <p class="font-bold text-gray-700">{{ t('classroom.role_assignments.empty_title') }}</p>
                <p class="mt-1 text-sm text-gray-500">{{ t(canManage ? 'classroom.role_assignments.empty_manage_hint' : 'classroom.role_assignments.empty_read_hint') }}</p>
            </div>
            <ul v-else class="space-y-2" :aria-label="t('classroom.role_assignments.list_title')">
                <li v-for="assignment in assignments" :key="assignment.id" class="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div class="flex min-w-0 items-start gap-3">
                        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-black text-emerald-800" aria-hidden="true">{{ assignmentUserLabel(assignment).slice(0, 1).toLocaleUpperCase() }}</span>
                        <div class="min-w-0">
                            <p class="truncate font-black text-gray-900">{{ assignmentUserLabel(assignment) }}</p>
                            <p v-if="assignment.user?.email && assignment.user?.display_name" class="truncate text-xs text-gray-500">{{ assignment.user.email }}</p>
                            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
                                <span class="rounded-full bg-slate-100 px-2.5 py-1 font-bold text-slate-700">{{ assignmentRoleLabel(assignment) }}</span>
                                <span class="rounded-full px-2.5 py-1 font-bold" :class="assignmentStatus(assignment) === 'active' ? 'bg-emerald-50 text-emerald-700' : assignmentStatus(assignment) === 'scheduled' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'">{{ statusLabel(assignmentStatus(assignment)) }}</span>
                            </div>
                            <p class="mt-1 text-xs text-gray-500">{{ t('classroom.role_assignments.validity', { from: formatDate(assignment.effective_from), to: assignment.effective_to ? formatDate(assignment.effective_to) : t('classroom.role_assignments.no_end_date') }) }}</p>
                        </div>
                    </div>
                    <div v-if="canManage && canListUsers" class="flex shrink-0 gap-2 sm:pl-3">
                        <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50" :disabled="saving" @click="openEditForm(assignment)">{{ t('common.edit') }}</button>
                        <button type="button" class="min-h-11 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50" :disabled="saving" @click="revokeAssignment(assignment)">{{ t('classroom.role_assignments.revoke') }}</button>
                    </div>
                </li>
            </ul>
            <Pagination v-if="assignmentTotal > pageSize" v-model="page" :totalItems="assignmentTotal" :perPage="pageSize" />
        </div>
    </section>
</template>
