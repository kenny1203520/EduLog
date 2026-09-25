<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
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
const userQuery = ref('')
const userLoading = ref(false)
const userError = ref(false)
const rootCanManage = ref(false)
const localCanManage = ref(false)
const canListUsers = ref(false)
const loading = ref(false)
const saving = ref(false)
const scopeType = ref<Scope>('classroom')
const classroomId = ref('')
const sessionId = ref('')
const userId = ref('')
const roleId = ref('')
const effectiveFrom = ref(today())
const effectiveTo = ref('')
const epoch = ref(1)
let searchTimer: ReturnType<typeof setTimeout> | undefined
let requestSequence = 0

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
    if (!scopeReady.value) { localAssignments.value = []; exclusions.value = []; localCanManage.value = false; return }
    localCanManage.value = await RoleService.canManageRoleScope(scopeType.value, scopeId.value).catch(() => false)
    const query = `scope_type=${scopeType.value}&scope_id=${encodeURIComponent(scopeId.value)}&limit=100&offset=0`
    const [assignments, blocked] = await Promise.allSettled([
        apiV1Client.get<TeachingRoleAssignment[]>(`/teaching-role-assignments/scoped?${query}`),
        apiV1Client.get<TeachingRoleAssignment[]>(`/teaching-role-exclusions?${query}`)
    ])
    localAssignments.value = assignments.status === 'fulfilled' ? assignments.value.data ?? [] : []
    exclusions.value = blocked.status === 'fulfilled' ? blocked.value.data ?? [] : []
    if (assignments.status === 'fulfilled' && blocked.status === 'fulfilled') {
        canListUsers.value = assignments.value.meta?.can_list_users === true && blocked.value.meta?.can_list_users === true
    }
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
        const rootResponse = rootCanManage.value
            ? await apiV1Client.get<TeachingRoleAssignment[]>('/teaching-role-assignments?limit=100&offset=0&sort=-effective_from').catch(() => null)
            : null
        rootAssignments.value = rootResponse?.data ?? []
        if (rootResponse) canListUsers.value = rootResponse.meta?.can_list_users === true
        if (scopeReady.value) {
            roles.value = await RoleService.getRolesForScope({ domain: 'teaching', scopeType: scopeType.value, scopeId: scopeId.value })
        }
        roleId.value ||= roles.value[0]?.id ?? ''
        await loadLists()
    } catch (error) {
        rootAssignments.value = []
        if (error) toast.error(t('rbac.platform_teaching_assignments.load_failed'))
    } finally { loading.value = false }
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

async function mutateAssignment(target: 'root' | 'local') {
    if (!userId.value || !roleId.value || !effectiveFrom.value || (target === 'local' && !scopeReady.value)) return
    if (effectiveTo.value && effectiveTo.value < effectiveFrom.value) { toast.error(t('classroom.role_assignments.invalid_date_range')); return }
    saving.value = true
    try {
        const body: Record<string, unknown> = { user_id: userId.value, role_id: roleId.value, effective_from: effectiveFrom.value, effective_to: effectiveTo.value || null, expected_epoch: epoch.value }
        if (target === 'root') await apiV1Client.post('/teaching-role-assignments', body)
        else await apiV1Client.post('/teaching-role-assignments/scoped', { ...body, scope_type: scopeType.value, scope_id: scopeId.value })
        toast.success(t('rbac.platform_teaching_assignments.saved'))
        await load()
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
        await load()
    } catch { toast.error(t('rbac.platform_teaching_assignments.remove_failed')) }
    finally { saving.value = false }
}

watch([scopeType, classroomId, sessionId], async () => {
    if (scopeReady.value) {
        roles.value = await RoleService.getRolesForScope({ domain: 'teaching', scopeType: scopeType.value, scopeId: scopeId.value }).catch(() => roles.value)
        roleId.value ||= roles.value[0]?.id ?? ''
    }
    void loadLists()
})
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
            <section class="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 sm:p-5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h4 class="font-black text-gray-900">{{ t('rbac.platform_teaching_assignments.root_title') }}</h4>
                    <span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">{{ t('rbac.platform_teaching_assignments.root_badge') }}</span>
                </div>
                <p class="mt-1 text-sm text-gray-600">{{ t('rbac.platform_teaching_assignments.root_hint') }}</p>
                <div v-if="rootCanManage" class="mt-4 grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
                    <SearchableSelect v-model="userId" :options="userOptions" remote-search :loading="userLoading" :placeholder="t('classroom.role_assignments.search_account')" :aria-label="t('classroom.role_assignments.account')" :no-results-text="userQuery.length < 2 ? t('classroom.role_assignments.user_search_hint') : userError ? t('classroom.role_assignments.user_search_failed') : t('classroom.role_assignments.no_users_found')" :loading-text="t('common.loading')" @search="searchUsers" />
                    <SearchableSelect v-model="roleId" :options="roleOptions" :placeholder="t('classroom.role_assignments.select_role')" :aria-label="t('classroom.role_assignments.role')" />
                    <button type="button" class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40" :disabled="saving || !userId || !roleId || !canListUsers" @click="mutateAssignment('root')">{{ t('rbac.platform_teaching_assignments.grant_root') }}</button>
                    <label class="space-y-1 text-xs font-bold text-gray-500"><span>{{ t('classroom.role_assignments.effective_from') }}</span><input v-model="effectiveFrom" type="date" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800" /></label>
                    <label class="space-y-1 text-xs font-bold text-gray-500"><span>{{ t('classroom.role_assignments.effective_to') }}</span><input v-model="effectiveTo" type="date" :min="effectiveFrom" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800" /></label>
                </div>
                <p v-else class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.read_only') }}</p>
                <p v-if="rootCanManage && !canListUsers" class="mt-2 text-xs text-amber-700">{{ t('rbac.platform_teaching_assignments.directory_required') }}</p>
                <ul v-if="rootAssignments.length" class="mt-4 divide-y divide-emerald-100 rounded-xl border border-emerald-100 bg-white">
                    <li v-for="assignment in rootAssignments" :key="assignment.id" class="flex flex-wrap items-center justify-between gap-3 p-3">
                        <div class="min-w-0"><p class="truncate font-bold text-gray-900">{{ userName(assignment) }}</p><p class="text-xs text-gray-500">{{ roleName(assignment) }} · {{ formattedDate(assignment.effective_from) }} — {{ assignment.effective_to ? formattedDate(assignment.effective_to) : t('classroom.role_assignments.no_end_date') }}</p></div>
                        <button v-if="rootCanManage" type="button" class="text-sm font-bold text-rose-700" :disabled="saving" @click="removeAssignment(assignment, 'root')">{{ t('classroom.role_assignments.revoke') }}</button>
                    </li>
                </ul>
                <p v-else class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.no_root_assignments') }}</p>
            </section>

            <section class="mt-6 rounded-2xl border border-gray-200 p-4 sm:p-5">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div><h4 class="font-black text-gray-900">{{ t('rbac.platform_teaching_assignments.local_title') }}</h4><p class="mt-1 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.local_hint') }}</p></div>
                    <div class="flex flex-wrap gap-2">
                        <select v-model="scopeType" class="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold"><option value="classroom">{{ t('rbac.scope.classroom') }}</option><option value="class_session">{{ t('rbac.scope.class_session') }}</option></select>
                        <select v-if="scopeType === 'classroom'" v-model="classroomId" class="max-w-56 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold"><option v-for="room in classrooms" :key="room.id" :value="room.id">{{ room.name }}</option></select>
                        <select v-else v-model="sessionId" class="max-w-56 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold"><option v-for="session in sessions" :key="session.id" :value="session.id">{{ session.name }}</option></select>
                    </div>
                </div>
                <p v-if="scopeReady && !localCanManage" class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.read_only') }}</p>
                <div v-if="scopeReady && localCanManage" class="mt-4 grid gap-3 lg:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto]">
                    <SearchableSelect v-model="userId" :options="userOptions" remote-search :loading="userLoading" :placeholder="t('classroom.role_assignments.search_account')" :aria-label="t('classroom.role_assignments.account')" :no-results-text="userQuery.length < 2 ? t('classroom.role_assignments.user_search_hint') : userError ? t('classroom.role_assignments.user_search_failed') : t('classroom.role_assignments.no_users_found')" :loading-text="t('common.loading')" @search="searchUsers" />
                    <SearchableSelect v-model="roleId" :options="roleOptions" :placeholder="t('classroom.role_assignments.select_role')" :aria-label="t('classroom.role_assignments.role')" />
                    <div class="flex gap-2"><button type="button" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40" :disabled="saving || !userId || !roleId || !canListUsers" @click="mutateAssignment('local')">{{ t('rbac.platform_teaching_assignments.regrant') }}</button><button type="button" class="rounded-xl border border-amber-300 px-3 py-2 text-xs font-black text-amber-800 disabled:opacity-40" :disabled="saving || !userId || !roleId || !canListUsers" @click="excludeRole">{{ t('rbac.platform_teaching_assignments.exclude') }}</button></div>
                </div>
                <p v-if="scopeReady && localCanManage && !canListUsers" class="mt-2 text-xs text-amber-700">{{ t('rbac.platform_teaching_assignments.directory_required') }}</p>
                <div class="mt-5 grid gap-4 xl:grid-cols-2">
                    <div><h5 class="mb-2 text-sm font-black text-gray-700">{{ t('rbac.platform_teaching_assignments.local_grants') }}</h5><ul v-if="localAssignments.length" class="divide-y divide-gray-100 rounded-xl border border-gray-100"><li v-for="assignment in localAssignments" :key="assignment.id" class="flex items-center justify-between gap-2 p-3"><div class="min-w-0"><p class="truncate text-sm font-bold">{{ userName(assignment) }}</p><p class="text-xs text-gray-500">{{ roleName(assignment) }} · {{ formattedDate(assignment.effective_from) }} — {{ assignment.effective_to ? formattedDate(assignment.effective_to) : t('classroom.role_assignments.no_end_date') }}</p></div><button v-if="localCanManage" class="text-xs font-bold text-rose-700" :disabled="saving" @click="removeAssignment(assignment, 'local')">{{ t('classroom.role_assignments.revoke') }}</button></li></ul><p v-else class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.no_local_grants') }}</p></div>
                    <div><h5 class="mb-2 text-sm font-black text-gray-700">{{ t('rbac.platform_teaching_assignments.exclusions') }}</h5><ul v-if="exclusions.length" class="divide-y divide-gray-100 rounded-xl border border-gray-100"><li v-for="assignment in exclusions" :key="assignment.id" class="flex items-center justify-between gap-2 p-3"><div class="min-w-0"><p class="truncate text-sm font-bold">{{ userName(assignment) }}</p><p class="text-xs text-gray-500">{{ roleName(assignment) }} · {{ formattedDate(assignment.effective_from) }} — {{ assignment.effective_to ? formattedDate(assignment.effective_to) : t('classroom.role_assignments.no_end_date') }}</p></div><button v-if="localCanManage" class="text-xs font-bold text-rose-700" :disabled="saving" @click="removeAssignment(assignment, 'exclusion')">{{ t('classroom.role_assignments.revoke') }}</button></li></ul><p v-else class="rounded-xl border border-dashed border-gray-200 p-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.no_exclusions') }}</p></div>
                </div>
                <p v-if="!scopeReady" class="mt-4 text-sm text-gray-500">{{ t('rbac.platform_teaching_assignments.select_scope') }}</p>
                <p v-else class="mt-4 text-xs text-gray-400">{{ t('rbac.platform_teaching_assignments.selected_scope', { scope: scopeLabel(scopeType) }) }}</p>
            </section>
        </template>
    </section>
</template>
