<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import { useFeedback } from '@/composables/useFeedback'
import { TeacherDirectoryService, type TeacherAssignmentDTO } from '@/services/teacher/TeacherDirectoryService'
import { TeacherService } from '@/services/teacher/TeacherService'
import { SessionService } from '@/services/session/SessionService'
import { RoleService } from '@/services/rbac/RoleService'
import type { RoleDTO } from '@/models/Rbac'
import { roleDisplayName } from '@/utils/roleDisplay'
import { DateUtils } from '@/utils/dateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'

/**
 * A teacher's class assignments: current and upcoming first, ended ones on
 * request. Adding and removing use the class roster API, so the class
 * session's own permission checks apply.
 */
const props = defineProps<{
    teacherId: string
    teacherName: string
    archived: boolean
    /** The caller may change rosters somewhere (hides the add form otherwise). */
    canAssign: boolean
}>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const { t } = useI18n()
const { reportError, errorKey, success } = useFeedback()
const preferences = usePreferencesStore()

const assignments = ref<TeacherAssignmentDTO[]>([])
const loading = ref(false)
const loadFailed = ref(false)
const showEnded = ref(false)

const sessionOptions = ref<Array<{ value: string; label: string; description?: string; searchText: string }>>([])
const sessionsLoaded = ref(false)
const roles = ref<RoleDTO[]>([])
const form = ref({ sessionId: '', roleId: '', effectiveFrom: DateUtils.todayString() })
const saving = ref(false)
const removing = ref<TeacherAssignmentDTO | null>(null)
const removeBusy = ref(false)
let loadSequence = 0
let roleSequence = 0

const today = computed(() => DateUtils.todayString())
const activeAssignments = computed(() => assignments.value.filter(item => !item.effective_to || item.effective_to >= today.value))
const endedAssignments = computed(() => assignments.value.filter(item => item.effective_to && item.effective_to < today.value))
const visibleAssignments = computed(() => showEnded.value ? assignments.value : activeAssignments.value)
const roleOptions = computed(() => roles.value.map(role => ({ value: role.id, label: roleDisplayName(role, t), searchText: `${role.name} ${role.code ?? ''}` })))

function statusOf(item: TeacherAssignmentDTO) {
    if (item.effective_to && item.effective_to < today.value) return 'ended'
    if (item.effective_from > today.value) return 'upcoming'
    return 'current'
}

function dateText(value: string) {
    return DateUtils.displayDate(value, preferences.locale, preferences.timeZone)
}

function rangeText(item: TeacherAssignmentDTO) {
    return item.effective_to
        ? t('teacher.directory.assignment_range', { from: dateText(item.effective_from), to: dateText(item.effective_to) })
        : t('teacher.directory.assignment_since', { from: dateText(item.effective_from) })
}

function roleText(item: TeacherAssignmentDTO) {
    return roleDisplayName({ code: item.role_code, name: item.role_name }, t)
}

async function load() {
    const sequence = ++loadSequence
    loading.value = true
    loadFailed.value = false
    try {
        const result = await TeacherDirectoryService.getAssignments(props.teacherId)
        if (sequence === loadSequence) assignments.value = result
    } catch (error) {
        if (sequence !== loadSequence) return
        assignments.value = []
        loadFailed.value = true
        console.warn('Teacher assignments could not be loaded', error)
    } finally {
        if (sequence === loadSequence) loading.value = false
    }
}

async function ensureSessions() {
    if (sessionsLoaded.value) return
    try {
        const result = await SessionService.getAllClassSessions()
        sessionOptions.value = result.data.map(session => {
            const room = (session as { classrooms?: { name?: string } | null }).classrooms?.name ?? ''
            return { value: session.id!, label: session.name, description: room || undefined, searchText: `${session.name} ${room}` }
        })
        sessionsLoaded.value = true
    } catch (error) { reportError(error) }
}

async function loadRoles(sessionId: string) {
    const sequence = ++roleSequence
    roles.value = []
    form.value.roleId = ''
    if (!sessionId) return
    try {
        const result = await RoleService.getRolesForScope({ domain: 'teaching', scopeType: 'class_session', scopeId: sessionId })
        if (sequence !== roleSequence) return
        roles.value = result
        form.value.roleId = result.find(role => role.code === 'teacher')?.id ?? result[0]?.id ?? ''
    } catch (error) {
        if (sequence === roleSequence) reportError(error)
    }
}

async function addAssignment() {
    if (!form.value.sessionId || !form.value.roleId || !form.value.effectiveFrom) return
    saving.value = true
    try {
        await TeacherService.assignTeachersToSession(form.value.sessionId, [{
            teacher_id: props.teacherId, role_id: form.value.roleId, effective_from: form.value.effectiveFrom,
        }])
        const session = sessionOptions.value.find(option => option.value === form.value.sessionId)?.label ?? ''
        success('teacher.directory.assignment_add_success', { name: props.teacherName, session })
        form.value = { sessionId: '', roleId: '', effectiveFrom: DateUtils.todayString() }
        roles.value = []
        await load()
        emit('changed')
    } catch (error) {
        const code = (error as { code?: string } | null)?.code
        if (code === 'TEACHER_ARCHIVED') errorKey('teacher.directory.archived_assign_blocked')
        else reportError(error)
    } finally { saving.value = false }
}

async function confirmRemove() {
    const item = removing.value
    if (!item) return
    removeBusy.value = true
    try {
        await TeacherService.removeTeacherAssignment(item.class_session_id, props.teacherId, item.effective_from)
        success('teacher.directory.assignment_remove_success')
        removing.value = null
        await load()
        emit('changed')
    } catch (error) { reportError(error) } finally { removeBusy.value = false }
}

watch(() => form.value.sessionId, (sessionId) => { void loadRoles(sessionId) })
watch(() => props.teacherId, () => { showEnded.value = false; void load() }, { immediate: true })
watch(() => props.canAssign && !props.archived, (show) => { if (show) void ensureSessions() }, { immediate: true })

defineExpose({ reload: load, activeCount: computed(() => activeAssignments.value.length) })
</script>

<template>
    <section class="space-y-3" aria-labelledby="teacher-assignments-title">
        <div>
            <h3 id="teacher-assignments-title" class="text-sm font-black text-slate-900">{{ t('teacher.directory.assignments_title') }}</h3>
            <p class="text-xs text-slate-500">{{ t('teacher.directory.assignments_hint') }}</p>
        </div>

        <div v-if="loading && assignments.length === 0" class="space-y-2" aria-hidden="true">
            <div v-for="n in 2" :key="n" class="h-14 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none"></div>
        </div>
        <div v-else-if="loadFailed" role="alert" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <span>{{ t('teacher.directory.assignments_load_failed') }}</span>
            <button type="button" class="min-h-11 rounded-lg px-3 font-bold underline" @click="load">{{ t('teacher.directory.retry') }}</button>
        </div>
        <p v-else-if="activeAssignments.length === 0 && !showEnded" class="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
            {{ t('teacher.directory.assignments_empty') }}
        </p>

        <ul v-if="visibleAssignments.length" class="space-y-2">
            <li v-for="item in visibleAssignments" :key="`${item.class_session_id}:${item.effective_from}`"
                class="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                :class="statusOf(item) === 'ended' ? 'opacity-70' : ''">
                <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" :style="{ backgroundColor: item.classroom_color || '#10b981' }" aria-hidden="true"></span>
                <div class="min-w-0 flex-1">
                    <router-link :to="{ name: 'session-details', params: { id: item.class_session_id } }"
                        class="block truncate font-bold text-slate-900 hover:text-emerald-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
                        {{ item.class_session_name }}
                    </router-link>
                    <p class="truncate text-xs text-slate-500">
                        <span v-if="item.classroom_name">{{ item.classroom_name }} · </span>{{ roleText(item) }}
                    </p>
                    <p class="text-xs text-slate-500">
                        <span class="font-bold" :class="statusOf(item) === 'current' ? 'text-emerald-700' : statusOf(item) === 'upcoming' ? 'text-sky-700' : 'text-slate-500'">
                            {{ t(`teacher.directory.assignment_${statusOf(item)}`) }}
                        </span>
                        · {{ rangeText(item) }}
                    </p>
                </div>
                <button v-if="item.can_manage && statusOf(item) !== 'ended'" type="button"
                    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-600"
                    :aria-label="`${t('teacher.directory.assignment_remove')}：${item.class_session_name}`" :title="t('teacher.directory.assignment_remove')"
                    @click="removing = item">
                    <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </li>
        </ul>

        <button v-if="endedAssignments.length && !showEnded" type="button" class="min-h-11 text-xs font-bold text-slate-600 underline-offset-2 hover:underline"
            @click="showEnded = true">
            {{ t('teacher.directory.assignment_show_ended', { n: endedAssignments.length }) }}
        </button>

        <p v-if="canAssign && archived" class="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">{{ t('teacher.directory.archived_assign_blocked') }}</p>
        <form v-else-if="canAssign" class="space-y-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 p-3" @submit.prevent="addAssignment">
            <p class="text-xs font-black uppercase tracking-wide text-emerald-800">{{ t('teacher.directory.assignment_add') }}</p>
            <SearchableSelect v-model="form.sessionId" :options="sessionOptions" :loading="!sessionsLoaded"
                :placeholder="t('teacher.directory.assignment_select_session')" :aria-label="t('teacher.directory.assignment_session')"
                :no-results-text="t('teacher.directory.assignment_no_sessions')" />
            <div class="grid gap-2 sm:grid-cols-2">
                <SearchableSelect v-model="form.roleId" :options="roleOptions" :disabled="!form.sessionId"
                    :placeholder="t('teacher.directory.assignment_role')" :aria-label="t('teacher.directory.assignment_role')" />
                <label class="block">
                    <span class="sr-only">{{ t('teacher.directory.assignment_start') }}</span>
                    <input v-model="form.effectiveFrom" type="date" required :aria-label="t('teacher.directory.assignment_start')"
                        class="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm" />
                </label>
            </div>
            <button type="submit" :disabled="saving || !form.sessionId || !form.roleId || !form.effectiveFrom"
                class="min-h-11 w-full rounded-xl bg-emerald-600 px-4 text-sm font-black text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                {{ saving ? t('common.saving') : t('teacher.directory.assignment_add') }}
            </button>
        </form>

        <ConfirmModal :is-open="removing !== null" :title="t('teacher.directory.assignment_remove_title')"
            :message="t('teacher.directory.assignment_remove_message', { name: teacherName, session: removing?.class_session_name ?? '' })"
            :confirm-text="t('teacher.directory.assignment_remove')" :is-dangerous="true" :is-loading="removeBusy"
            @confirm="confirmRemove" @close="removing = null" />
    </section>
</template>
