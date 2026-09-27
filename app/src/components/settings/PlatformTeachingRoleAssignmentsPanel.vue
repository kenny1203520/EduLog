<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import Pagination from '@/components/common/Pagination.vue'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { SessionService } from '@/services/session/SessionService'
import { AuthUserSearchService, type AuthUserSearchResultDTO } from '@/services/auth/AuthUserSearchService'
import { apiV1Client } from '@/services/api/ApiV1Client'
import { RoleService } from '@/services/rbac/RoleService'
import type { PolicyScope, RoleDTO } from '@/models/Rbac'
import { roleDisplayName } from '@/utils/roleDisplay'

type Scope = Extract<PolicyScope, 'classroom' | 'class_session'>
type TeachingRoleAssignment = { id: string; user_id: string; role_id: string; scope_type: 'system' | Scope; scope_id: string | null; status: string; effective_from: string; effective_to: string | null; roles?: RoleDTO | null; user?: AuthUserSearchResultDTO | null }
type Classroom = { id: string; name: string }
type Session = { id: string; name: string; classroom_id?: string | null }

const { t, locale } = useI18n()
const toast = useToast()
const roles = ref<RoleDTO[]>([])
const classrooms = ref<Classroom[]>([])
const sessions = ref<Session[]>([])
const rootAssignments = ref<TeachingRoleAssignment[]>([])
const localAssignments = ref<TeachingRoleAssignment[]>([])
const exclusions = ref<TeachingRoleAssignment[]>([])
const users = ref<AuthUserSearchResultDTO[]>([])
const selectedUser = ref<AuthUserSearchResultDTO | null>(null)
const userQuery = ref('')
const userLoading = ref(false)
const userError = ref(false)
const rootCanManage = ref(false)
const localCanManage = ref(false)
const rootCanListUsers = ref(false)
const localCanListUsers = ref(false)
const loading = ref(false)
const rootLoading = ref(false)
const localLoading = ref(false)
const exclusionLoading = ref(false)
const rolesLoading = ref(false)
const rootLoadError = ref(false)
const localLoadError = ref(false)
const exclusionLoadError = ref(false)
const rolesLoadError = ref(false)
const saving = ref(false)
const scopeType = ref<Scope>('classroom')
const classroomId = ref('')
const sessionId = ref('')
const userId = ref('')
const roleId = ref('')
const effectiveFrom = ref(today())
const effectiveTo = ref('')
const epoch = ref(1)
const pageSize = 20
const rootPage = ref(1)
const localPage = ref(1)
const exclusionPage = ref(1)
const rootTotal = ref(0)
const localTotal = ref(0)
const exclusionTotal = ref(0)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestSequence = 0
let rootListSequence = 0
let localListSequence = 0
let roleListSequence = 0

const scopeId = computed(() => scopeType.value === 'classroom' ? classroomId.value : sessionId.value)
const scopeReady = computed(() => Boolean(scopeId.value))
const roleOptions = computed(() => roles.value.map(role => ({
    value: role.id,
    label: roleDisplayName(role, key => t(key)),
    description: role.is_builtin ? t('rbac.builtin') : role.description ?? undefined,
    searchText: `${role.code ?? ''} ${role.name} ${role.description ?? ''}`
})))
const userOptions = computed(() => users.value.map(user => ({
    value: user.id,
    label: user.display_name?.trim() || user.email,
    description: user.display_name?.trim() ? user.email : undefined,
    searchText: `${user.display_name ?? ''} ${user.email}`
})))
const classroomOptions = computed(() => classrooms.value.map(room => ({ value: room.id, label: room.name, searchText: room.name })))
const sessionOptions = computed(() => sessions.value.map(session => {
    const room = classrooms.value.find(item => item.id === session.classroom_id)
    return { value: session.id, label: session.name, description: room?.name, searchText: `${session.name} ${room?.name ?? ''}` }
}))
function today() {
    const now = new Date()
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function roleName(assignment: TeachingRoleAssignment) {
    const role = roles.value.find(item => item.id === assignment.role_id) ?? assignment.roles
    return role ? roleDisplayName(role, key => t(key)) : assignment.role_id
}

function userName(assignment: TeachingRoleAssignment) {
    return assignment.user?.display_name?.trim() || assignment.user?.email || assignment.user_id
}

function scopeLabel(type: string) {
    return type === 'classroom' ? t('rbac.scope.classroom') : type === 'class_session' ? t('rbac.scope.class_session') : t('rbac.scope.global_teaching')
}

function formattedDate(value: string) {
    const [year, month, day] = value.split('-').map(Number)
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(year, month - 1, day))
}

async function loadLists() {
    const sequence = ++localListSequence
    const scopeTypeAtRequest = scopeType.value
    const scopeIdAtRequest = scopeId.value
    const userIdAtRequest = userId.value
    localAssignments.value = []
    exclusions.value = []
    localTotal.value = 0
    exclusionTotal.value = 0
    localLoadError.value = false
    exclusionLoadError.value = false
    localCanManage.value = false
    localCanListUsers.value = false
    if (!scopeIdAtRequest || !userIdAtRequest) { localLoading.value = false; exclusionLoading.value = false; localCanManage.value = false; return }
    localLoading.value = true
    exclusionLoading.value = true
    localCanManage.value = await RoleService.canManageRoleScope(scopeTypeAtRequest, scopeIdAtRequest).catch(() => false)
    if (sequence !== localListSequence || scopeType.value !== scopeTypeAtRequest || scopeId.value !== scopeIdAtRequest || userId.value !== userIdAtRequest) return
    const baseQuery = new URLSearchParams({ scope_type: scopeTypeAtRequest, scope_id: scopeIdAtRequest, user_id: userIdAtRequest, limit: String(pageSize) })
    const assignmentQuery = new URLSearchParams(baseQuery)
    assignmentQuery.set('offset', String((localPage.value - 1) * pageSize))
    const exclusionQuery = new URLSearchParams(baseQuery)
    exclusionQuery.set('offset', String((exclusionPage.value - 1) * pageSize))
    const [assignments, blocked] = await Promise.allSettled([
        apiV1Client.get<TeachingRoleAssignment[]>(`/teaching-role-assignments/scoped?${assignmentQuery}`),
        apiV1Client.get<TeachingRoleAssignment[]>(`/teaching-role-exclusions?${exclusionQuery}`)
    ])
    if (sequence !== localListSequence || scopeType.value !== scopeTypeAtRequest || scopeId.value !== scopeIdAtRequest || userId.value !== userIdAtRequest) return
    localAssignments.value = assignments.status === 'fulfilled' ? assignments.value.data ?? [] : []
    exclusions.value = blocked.status === 'fulfilled' ? blocked.value.data ?? [] : []
    localTotal.value = assignments.status === 'fulfilled' ? Number(assignments.value.meta?.total ?? 0) : 0
    exclusionTotal.value = blocked.status === 'fulfilled' ? Number(blocked.value.meta?.total ?? 0) : 0
    if (assignments.status === 'fulfilled' && blocked.status === 'fulfilled') {
        localCanListUsers.value = assignments.value.meta?.can_list_users === true && blocked.value.meta?.can_list_users === true
    }
    localLoadError.value = assignments.status === 'rejected'
    exclusionLoadError.value = blocked.status === 'rejected'
    localLoading.value = false
    exclusionLoading.value = false
}

async function loadRolesForScope() {
    const sequence = ++roleListSequence
    const type = scopeType.value
    const id = scopeId.value
    roles.value = []
    roleId.value = ''
    rolesLoadError.value = false
    if (!id) { rolesLoading.value = false; return }
    rolesLoading.value = true
    try {
        const result = await RoleService.getRolesForScope({ domain: 'teaching', scopeType: type, scopeId: id })
        if (sequence !== roleListSequence || scopeType.value !== type || scopeId.value !== id) return
        roles.value = result
        roleId.value = result[0]?.id ?? ''
    } catch {
        if (sequence === roleListSequence) rolesLoadError.value = true
    } finally { if (sequence === roleListSequence) rolesLoading.value = false }
}

async function load() {
    loading.value = true
    try {
        const [roomResult, sessionResult, caps] = await Promise.all([
            ClassroomService.getAllClassrooms(),
            SessionService.getAllClassSessions(),
            RoleService.getCapabilities()
        ])
        classrooms.value = roomResult.data as unknown as Classroom[]
        sessions.value = sessionResult.data as Session[]
        epoch.value = caps.epoch
        rootCanManage.value = await RoleService.canManageRoleScope('system').catch(() => false)
        classroomId.value ||= classrooms.value[0]?.id ?? ''
        if (classroomId.value && !sessions.value.some(session => session.id === sessionId.value)) {
            sessionId.value = sessions.value.find(session => session.classroom_id === classroomId.value)?.id ?? ''
        }
        if (scopeReady.value) await loadRolesForScope()
        await loadAssignments()
    } catch (error) {
        rootAssignments.value = []
        if (error) toast.error(t('rbac.platform_teaching_assignments.load_failed'))
    } finally { loading.value = false }
}

function assignmentStatus(assignment: TeachingRoleAssignment) {
    const currentDay = today()
    if (assignment.effective_from > currentDay) return t('classroom.role_assignments.status_scheduled')
    if (assignment.effective_to && assignment.effective_to < currentDay) return t('classroom.role_assignments.status_expired')
    return t('classroom.role_assignments.status_active')
}

async function loadRootAssignments() {
    const sequence = ++rootListSequence
    const userIdAtRequest = userId.value
    rootAssignments.value = []
    rootTotal.value = 0
    rootLoadError.value = false
    rootCanListUsers.value = false
    if (!rootCanManage.value || !userIdAtRequest) { rootLoading.value = false; return }
    rootLoading.value = true
    try {
        const params = new URLSearchParams({ user_id: userIdAtRequest, limit: String(pageSize), offset: String((rootPage.value - 1) * pageSize), sort: '-effective_from' })
        const response = await apiV1Client.get<TeachingRoleAssignment[]>(`/teaching-role-assignments?${params}`)
        if (sequence !== rootListSequence || userId.value !== userIdAtRequest) return
        rootAssignments.value = response.data ?? []
        rootTotal.value = Number(response.meta?.total ?? 0)
        rootCanListUsers.value = response.meta?.can_list_users === true
    } catch { if (sequence === rootListSequence) rootLoadError.value = true }
    finally { if (sequence === rootListSequence) rootLoading.value = false }
}

async function loadAssignments() {
    if (!userId.value) {
        rootAssignments.value = []; rootTotal.value = 0
        await loadLists()
        return
    }
    await Promise.all([loadRootAssignments().catch(() => { rootAssignments.value = []; rootTotal.value = 0 }), loadLists()])
}

function searchUsers(query: string) {
    if (searchTimer) clearTimeout(searchTimer)
    const sequence = ++requestSequence
    userQuery.value = query.trim()
    userError.value = false
    if (userQuery.value.length < 2) { users.value = []; userLoading.value = false; return }
    userLoading.value = true
    searchTimer = setTimeout(async () => {
        try {
            const results = await AuthUserSearchService.searchUsers(userQuery.value)
            if (sequence === requestSequence) users.value = results
        } catch { if (sequence === requestSequence) userError.value = true }
        finally { if (sequence === requestSequence) userLoading.value = false }
    }, 250)
}

function onUserSelected(id: string) {
    userId.value = id
    selectedUser.value = users.value.find(user => user.id === id) ?? null
}

async function mutateAssignment(target: 'root' | 'local') {
    if (!userId.value || !roleId.value || !effectiveFrom.value || (target === 'local' && !scopeReady.value)) return
    if (effectiveTo.value && effectiveTo.value < effectiveFrom.value) { toast.error(t('classroom.role_assignments.invalid_date_range')); return }
    saving.value = true
    try {
        const body: Record<string, unknown> = { user_id: userId.value, role_id: roleId.value, effective_from: effectiveFrom.value, effective_to: effectiveTo.value || null, expected_epoch: epoch.value }
        if (target === 'root') await apiV1Client.post('/teaching-role-assignments', body)
        else await apiV1Client.post('/teaching-role-assignments/scoped', { ...body, scope_type: scopeType.value, scope_id: scopeId.value })
        toast.success(t('rbac.platform_teaching_assignments.saved'))
        await loadAssignments()
    } catch (error: any) {
        if (error?.code === 'TEACHING_ROLE_ASSIGNMENT_OVERLAP' || error?.code === 'PLATFORM_TEACHING_ROLE_ASSIGNMENT_OVERLAP') toast.error(t('rbac.platform_teaching_assignments.overlap'))
        else toast.error(t('rbac.platform_teaching_assignments.save_failed'))
    } finally { saving.value = false }
}

async function excludeRole() {
    if (!scopeReady.value || !userId.value || !roleId.value || !effectiveFrom.value) return
    if (effectiveTo.value && effectiveTo.value < effectiveFrom.value) { toast.error(t('classroom.role_assignments.invalid_date_range')); return }
    saving.value = true
    try {
        await apiV1Client.post(`/teaching-role-exclusions?scope_type=${scopeType.value}&scope_id=${encodeURIComponent(scopeId.value)}`, {
            user_id: userId.value, role_id: roleId.value, effective_from: effectiveFrom.value,
            effective_to: effectiveTo.value || null, expected_epoch: epoch.value
        })
        toast.success(t('rbac.platform_teaching_assignments.exclusion_saved'))
        await loadLists()
    } catch (error: any) {
        if (error?.code === 'ROLE_ASSIGNMENT_EXCLUSION_OVERLAP') toast.error(t('rbac.platform_teaching_assignments.overlap'))
        else toast.error(t('rbac.platform_teaching_assignments.save_failed'))
    } finally { saving.value = false }
}

async function removeAssignment(assignment: TeachingRoleAssignment, target: 'root' | 'local' | 'exclusion') {
    if (!window.confirm(t('rbac.platform_teaching_assignments.remove_confirm', { role: roleName(assignment), user: userName(assignment) }))) return
    saving.value = true
    try {
        const body = { expected_epoch: epoch.value }
        if (target === 'root') await apiV1Client.delete(`/teaching-role-assignments/${assignment.id}`, body)
        else if (target === 'local') await apiV1Client.delete(`/teaching-role-assignments/scoped/${assignment.id}?scope_type=${scopeType.value}&scope_id=${encodeURIComponent(scopeId.value)}`, body)
        else await apiV1Client.delete(`/teaching-role-exclusions/${assignment.id}?scope_type=${scopeType.value}&scope_id=${encodeURIComponent(scopeId.value)}`, body)
        if (target === 'root') await loadRootAssignments()
        else await loadLists()
        toast.success(t('common.deleted'))
    } catch { toast.error(t('rbac.platform_teaching_assignments.remove_failed')) }
    finally { saving.value = false }
}

watch([scopeType, classroomId, sessionId], async () => {
    localPage.value = 1
    exclusionPage.value = 1
    void loadRolesForScope()
    void loadAssignments()
}, { flush: 'sync' })
watch(userId, () => {
    rootPage.value = 1; localPage.value = 1; exclusionPage.value = 1
    void loadAssignments()
}, { flush: 'sync' })
watch(rootPage, () => { void loadRootAssignments() })
watch(localPage, () => { void loadLists() })
watch(exclusionPage, () => { void loadLists() })
onMounted(load)
</script>

<template>
    <section class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
        <header class="mb-5">
            <h3 class="text-xl font-black text-gray-900">{{ t('rbac.platform_teaching_assignments.title') }}</h3>
            <p class="mt-1 text-sm leading-6 text-gray-500">{{ t('rbac.platform_teaching_assignments.description') }}</p>
        </header>
        <div v-if="loading" class="py-8 text-center text-sm text-gray-400">{{ t('common.loading') }}</div>
        <template v-else>
            <section class="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 sm:p-5" :aria-busy="rootLoading">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h4 class="font-black text-gray-900">{{ t('rbac.platform_teaching_assignments.root_title') }}</h4>
                    <span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">{{ t('rbac.platform_teaching_assignments.root_badge') }}</span>
                </div>
                <p class="mt-1 text-sm text-gray-600">{{ t('rbac.platform_teaching_assignments.root_hint') }}</p>
                <div v-if="rootCanManage" class="mt-4 grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
                    <SearchableSelect :model-value="userId" :options="userOptions" remote-search :loading="userLoading" :placeholder="t('classroom.role_assignments.search_account')" :aria-label="t('classroom.role_assignments.account')" :no-results-text="userQuery.length < 2 ? t('classroom.role_assignments.user_search_hint') : userError ? t('classroom.role_assignments.user_search_failed') : t('classroom.role_assignments.no_users_found')" :loading-text="t('common.loading')" @search="searchUsers" @update:model-value="onUserSelected" />
                    <SearchableSelect v-model="roleId" :options="roleOptions" :placeholder="t('classroom.role_assignments.select_role')" :aria-label="t('classroom.role_assignments.role')" :disabled="rootLoading || rolesLoading" />
                    <button type="button" class="min-h-11 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40" :disabled="saving || rootLoading || rolesLoading || !userId || !roleId || !rootCanListUsers" @click="mutateAssignment('root')">{{ saving ? t('common.saving') : t('rbac.platform_teaching_assignments.grant_root') }}</button>
                    <label class="space-y-1 text-xs font-bold text-gray-500"><span>{{ t('classroom.role_assignments.effective_from') }}</span><input v-model="effectiveFrom" type="date" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800" /></label>
                    <label class="space-y-1 text-xs font-bold text-gray-500"><span>{{ t('classroom.role_assignments.effective_to') }}</span><input v-model="effectiveTo" type="date" :min="effectiveFrom" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800" /></label>
                </div>
                <p v-else class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.read_only') }}</p>
                <p v-if="userId && selectedUser" class="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm text-gray-700">{{ t('rbac.platform_teaching_assignments.selected_user', { user: selectedUser.display_name?.trim() || selectedUser.email, email: selectedUser.email }) }}</p>
                <p v-if="rootLoading" role="status" aria-live="polite" class="mt-3 text-sm text-gray-600">{{ t('rbac.platform_teaching_assignments.loading_user_assignments', { user: selectedUser?.display_name?.trim() || selectedUser?.email || userId }) }}</p>
                <div v-else-if="rootLoadError" role="alert" class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800"><span>{{ t('rbac.platform_teaching_assignments.load_failed') }}</span><button type="button" class="min-h-11 px-3 font-bold underline" @click="loadRootAssignments">{{ t('rbac.platform_teaching_assignments.retry') }}</button></div>
                <p v-if="rootCanManage && !rootCanListUsers" class="mt-2 text-xs text-amber-700">{{ t('rbac.platform_teaching_assignments.directory_required') }}</p>
                <ul v-if="userId && rootAssignments.length" class="mt-4 divide-y divide-emerald-100 rounded-xl border border-emerald-100 bg-white">
                    <li v-for="assignment in rootAssignments" :key="assignment.id" class="flex flex-wrap items-center justify-between gap-3 p-3">
                        <div class="min-w-0"><p class="truncate font-bold text-gray-900">{{ userName(assignment) }}</p><p class="text-xs text-gray-500">{{ roleName(assignment) }} · {{ assignmentStatus(assignment) }} · {{ formattedDate(assignment.effective_from) }} — {{ assignment.effective_to ? formattedDate(assignment.effective_to) : t('classroom.role_assignments.no_end_date') }}</p></div>
                        <button v-if="rootCanManage" type="button" class="text-sm font-bold text-rose-700" :disabled="saving" @click="removeAssignment(assignment, 'root')">{{ t('classroom.role_assignments.revoke') }}</button>
                    </li>
                </ul>
                <p v-else-if="!userId" class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.search_user_to_view') }}</p>
                <p v-else-if="!rootLoading && !rootLoadError" class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.no_root_assignments') }}</p>
                <Pagination v-if="rootTotal > pageSize" v-model="rootPage" :per-page="pageSize" :total-items="rootTotal" />
            </section>

            <section class="mt-6 rounded-2xl border border-gray-200 p-4 sm:p-5" :aria-busy="localLoading || exclusionLoading || rolesLoading">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div><h4 class="font-black text-gray-900">{{ t('rbac.platform_teaching_assignments.local_title') }}</h4><p class="mt-1 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.local_hint') }}</p></div>
                    <div class="flex flex-wrap gap-2">
                        <select v-model="scopeType" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold"><option value="classroom">{{ t('rbac.scope.classroom') }}</option><option value="class_session">{{ t('rbac.scope.class_session') }}</option></select>
                        <div v-if="scopeType === 'classroom'" class="w-full sm:w-64"><SearchableSelect v-model="classroomId" :options="classroomOptions" :placeholder="t('common.select_placeholder')" :aria-label="t('rbac.scope.classroom')" /></div>
                        <div v-else class="w-full sm:w-64"><SearchableSelect v-model="sessionId" :options="sessionOptions" :placeholder="t('common.select_placeholder')" :aria-label="t('rbac.scope.class_session')" /></div>
                    </div>
                </div>
                <p v-if="scopeReady && !localCanManage" class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.read_only') }}</p>
                <div v-if="scopeReady && localCanManage" class="mt-4 grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
                    <SearchableSelect :model-value="userId" :options="userOptions" remote-search :loading="userLoading" :placeholder="t('classroom.role_assignments.search_account')" :aria-label="t('classroom.role_assignments.account')" :no-results-text="userQuery.length < 2 ? t('classroom.role_assignments.user_search_hint') : userError ? t('classroom.role_assignments.user_search_failed') : t('classroom.role_assignments.no_users_found')" :loading-text="t('common.loading')" @search="searchUsers" @update:model-value="onUserSelected" />
                    <SearchableSelect v-model="roleId" :options="roleOptions" :placeholder="t('classroom.role_assignments.select_role')" :aria-label="t('classroom.role_assignments.role')" :disabled="rolesLoading || localLoading || exclusionLoading" />
                    <div class="flex flex-wrap gap-2"><button type="button" class="min-h-11 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40" :disabled="saving || localLoading || exclusionLoading || rolesLoading || !userId || !roleId || !localCanListUsers" @click="mutateAssignment('local')">{{ saving ? t('common.saving') : t('rbac.platform_teaching_assignments.regrant') }}</button><button type="button" class="min-h-11 rounded-xl border border-amber-300 px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-40" :disabled="saving || localLoading || exclusionLoading || rolesLoading || !userId || !roleId || !localCanListUsers" @click="excludeRole">{{ saving ? t('common.saving') : t('rbac.platform_teaching_assignments.exclude') }}</button></div>
                </div>
                <p v-if="scopeReady && localCanManage && !localCanListUsers" class="mt-2 text-xs text-amber-700">{{ t('rbac.platform_teaching_assignments.directory_required') }}</p>
                <p v-if="userId && selectedUser" class="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700">{{ t('rbac.platform_teaching_assignments.selected_context', { user: selectedUser.display_name?.trim() || selectedUser.email, scope: scopeLabel(scopeType) }) }}</p>
                <p v-if="rolesLoading" role="status" aria-live="polite" class="mt-3 text-sm text-gray-600">{{ t('rbac.platform_teaching_assignments.loading_scope_roles', { scope: scopeLabel(scopeType) }) }}</p>
                <div v-else-if="rolesLoadError" role="alert" class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800"><span>{{ t('rbac.platform_teaching_assignments.roles_load_failed') }}</span><button type="button" class="min-h-11 px-3 font-bold underline" @click="loadRolesForScope">{{ t('rbac.platform_teaching_assignments.retry') }}</button></div>
                <div class="mt-5 grid gap-4 xl:grid-cols-2">
                    <div><h5 class="mb-2 text-sm font-black text-gray-700">{{ t('rbac.platform_teaching_assignments.local_grants') }}</h5><p v-if="localLoading" role="status" aria-live="polite" class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">{{ t('rbac.platform_teaching_assignments.loading_scope_assignments', { user: selectedUser?.display_name?.trim() || selectedUser?.email || userId, scope: scopeLabel(scopeType) }) }}</p><div v-else-if="localLoadError" role="alert" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{{ t('rbac.platform_teaching_assignments.load_failed') }} <button type="button" class="font-bold underline" @click="loadLists">{{ t('rbac.platform_teaching_assignments.retry') }}</button></div><ul v-else-if="localAssignments.length" class="divide-y divide-gray-100 rounded-xl border border-gray-100"><li v-for="assignment in localAssignments" :key="assignment.id" class="flex items-center justify-between gap-2 p-3"><div class="min-w-0"><p class="truncate text-sm font-bold">{{ roleName(assignment) }} · {{ assignmentStatus(assignment) }}</p><p class="text-xs text-gray-500">{{ formattedDate(assignment.effective_from) }} — {{ assignment.effective_to ? formattedDate(assignment.effective_to) : t('classroom.role_assignments.no_end_date') }}</p></div><button v-if="localCanManage" class="text-xs font-bold text-rose-700" :disabled="saving || localLoading" @click="removeAssignment(assignment, 'local')">{{ t('classroom.role_assignments.revoke') }}</button></li></ul><p v-else-if="!localLoading && !localLoadError" class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">{{ userId ? t('rbac.platform_teaching_assignments.no_local_grants') : t('rbac.platform_teaching_assignments.search_user_to_view') }}</p><Pagination v-if="localTotal > pageSize" v-model="localPage" :per-page="pageSize" :total-items="localTotal" /></div>
                    <div><h5 class="mb-2 text-sm font-black text-gray-700">{{ t('rbac.platform_teaching_assignments.exclusions') }}</h5><p v-if="exclusionLoading" role="status" aria-live="polite" class="rounded-xl bg-gray-50 p-4 text-sm text-gray-600">{{ t('rbac.platform_teaching_assignments.loading_scope_exclusions', { user: selectedUser?.display_name?.trim() || selectedUser?.email || userId, scope: scopeLabel(scopeType) }) }}</p><div v-else-if="exclusionLoadError" role="alert" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">{{ t('rbac.platform_teaching_assignments.load_failed') }} <button type="button" class="font-bold underline" @click="loadLists">{{ t('rbac.platform_teaching_assignments.retry') }}</button></div><ul v-else-if="exclusions.length" class="divide-y divide-gray-100 rounded-xl border border-gray-100"><li v-for="assignment in exclusions" :key="assignment.id" class="flex items-center justify-between gap-2 p-3"><div class="min-w-0"><p class="truncate text-sm font-bold">{{ roleName(assignment) }} · {{ assignmentStatus(assignment) }}</p><p class="text-xs text-gray-500">{{ formattedDate(assignment.effective_from) }} — {{ assignment.effective_to ? formattedDate(assignment.effective_to) : t('classroom.role_assignments.no_end_date') }}</p></div><button v-if="localCanManage" class="text-xs font-bold text-rose-700" :disabled="saving || exclusionLoading" @click="removeAssignment(assignment, 'exclusion')">{{ t('classroom.role_assignments.revoke') }}</button></li></ul><p v-else-if="!exclusionLoading && !exclusionLoadError" class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">{{ userId ? t('rbac.platform_teaching_assignments.no_exclusions') : t('rbac.platform_teaching_assignments.search_user_to_view') }}</p><Pagination v-if="exclusionTotal > pageSize" v-model="exclusionPage" :per-page="pageSize" :total-items="exclusionTotal" /></div>
                </div>
                <p v-if="!scopeReady" class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.select_scope') }}</p>
                <p v-else class="mt-4 text-xs text-gray-400">{{ t('rbac.platform_teaching_assignments.selected_scope', { scope: scopeLabel(scopeType) }) }}</p>
            </section>
        </template>
    </section>
</template>
