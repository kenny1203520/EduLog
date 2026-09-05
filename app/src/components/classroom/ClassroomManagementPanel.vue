<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import type { ClassroomDTO, ClassSessionDTO } from '@/models/Classroom'
import type { RoleDTO, RolePermissionPolicyDTO } from '@/models/Rbac'
import ScopedRolePolicyEditor, {
    type RolePolicySelections
} from '@/components/settings/ScopedRolePolicyEditor.vue'
import {
    INCOMPLETE_REPORT_PERMISSION,
    PermissionPolicyService
} from '@/services/rbac/PermissionPolicyService'

type PanelTab = 'details' | 'notifications' | 'sessions'

const props = defineProps<{
    room: Partial<ClassroomDTO>
    roomId?: string | null
    sessions: ClassSessionDTO[]
    roles: RoleDTO[]
    policies: RolePermissionPolicyDTO[]
    roomSelections: RolePolicySelections
    saving?: boolean
    initialTab?: PanelTab
}>()

const emit = defineEmits<{
    'update:room': [value: Partial<ClassroomDTO>]
    'update:roomSelections': [value: RolePolicySelections]
    close: []
    save: []
    'edit-session': [session: ClassSessionDTO]
    'policies-changed': []
}>()

const { t } = useI18n()
const toast = useToast()
const { reportError } = useFeedback()
const activeTab = ref<PanelTab>(props.initialTab || 'details')
const search = ref('')
const expandedSessionId = ref<string | null>(null)
const sessionSelections = ref<RolePolicySelections>({})
const sessionBaseline = ref('')
const savingSessionPolicy = ref(false)
const canManageRbac = ref(false)
const pendingAction = ref<null | (() => void)>(null)
const showUnsavedDialog = ref(false)

const roomModel = computed({
    get: () => props.room,
    set: value => emit('update:room', value)
})
const roomPolicyModel = computed({
    get: () => props.roomSelections,
    set: value => emit('update:roomSelections', value)
})
const filteredSessions = computed(() => props.sessions.filter(session =>
    !search.value || session.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase())
))
const sessionPolicyDirty = computed(() => Boolean(expandedSessionId.value)
    && JSON.stringify(sessionSelections.value) !== sessionBaseline.value)

function selectionsFor(scopeType: 'classroom' | 'class_session', scopeId?: string | null) {
    return Object.fromEntries(props.roles.map(role => {
        const policy = props.policies.find(item => item.role_id === role.id
            && item.scope_type === scopeType && item.scope_id === scopeId)
        return [role.id, policy?.effect || 'inherit']
    })) as RolePolicySelections
}

function loadSessionPolicy(sessionId: string) {
    expandedSessionId.value = sessionId
    sessionSelections.value = selectionsFor('class_session', sessionId)
    sessionBaseline.value = JSON.stringify(sessionSelections.value)
}

function runAfterDirtyCheck(action: () => void) {
    if (!sessionPolicyDirty.value) return action()
    pendingAction.value = action
    showUnsavedDialog.value = true
}

function selectTab(tab: PanelTab) {
    runAfterDirtyCheck(() => {
        activeTab.value = tab
        if (tab !== 'sessions') expandedSessionId.value = null
    })
}

function toggleSession(session: ClassSessionDTO) {
    if (!session.id) return
    runAfterDirtyCheck(() => {
        if (expandedSessionId.value === session.id) {
            expandedSessionId.value = null
            return
        }
        loadSessionPolicy(session.id!)
    })
}

function requestClose() {
    runAfterDirtyCheck(() => emit('close'))
}

function requestFullEdit(session: ClassSessionDTO) {
    runAfterDirtyCheck(() => emit('edit-session', session))
}

function resetSessionPolicy() {
    if (!expandedSessionId.value) return
    sessionSelections.value = selectionsFor('class_session', expandedSessionId.value)
    sessionBaseline.value = JSON.stringify(sessionSelections.value)
}

async function saveSessionPolicy(continuePending = false) {
    if (!expandedSessionId.value || !canManageRbac.value) return
    savingSessionPolicy.value = true
    try {
        const overrides = props.roles.flatMap(role => {
            const effect = sessionSelections.value[role.id]
            return effect === 'allow' || effect === 'deny' ? [{ role_id: role.id, effect }] : []
        })
        await PermissionPolicyService.replacePolicies(
            INCOMPLETE_REPORT_PERMISSION,
            { type: 'class_session', id: expandedSessionId.value },
            overrides
        )
        sessionBaseline.value = JSON.stringify(sessionSelections.value)
        emit('policies-changed')
        toast.success(t('settings.incomplete_notifications.saved'))
        if (continuePending && pendingAction.value) pendingAction.value()
        showUnsavedDialog.value = false
        pendingAction.value = null
    } catch (error: any) {
        reportError(error)
    } finally {
        savingSessionPolicy.value = false
    }
}

function discardAndContinue() {
    resetSessionPolicy()
    pendingAction.value?.()
    pendingAction.value = null
    showUnsavedDialog.value = false
}

function sessionTypeLabel(session: ClassSessionDTO) {
    return t(session.session_type === 'camp' ? 'classroom.camp' : 'classroom.regular_session')
}

function timeSummary(session: ClassSessionDTO) {
    const rules = session.schedule_rules || []
    if (!rules.length) return t('classroom.schedule_draft')
    return rules.map(rule => `${rule.start_time || ''}–${rule.end_time || ''}`).join(' · ')
}

onMounted(async () => {
    if (typeof PermissionPolicyService.canManageRbac !== 'function') return
    canManageRbac.value = await PermissionPolicyService.canManageRbac()
})
watch(() => props.roomId, () => {
    activeTab.value = props.initialTab || 'details'
    expandedSessionId.value = null
    search.value = ''
})
</script>

<template>
    <div class="fixed inset-0 z-50 flex bg-black/50 backdrop-blur-sm sm:items-center sm:justify-center sm:p-4">
        <section class="flex h-full w-full min-w-0 flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(92vh,900px)] sm:max-w-5xl sm:rounded-3xl"
            role="dialog" aria-modal="true" :aria-label="roomId ? $t('classroom.edit_room') : $t('classroom.add_room')">
            <header class="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-4 sm:px-6">
                <div class="min-w-0">
                    <p class="text-xs font-black uppercase tracking-widest text-emerald-600">{{ $t('classroom.room_management') }}</p>
                    <h3 class="truncate text-xl font-black text-gray-900 sm:text-2xl">
                        {{ roomId ? $t('classroom.edit_room') : $t('classroom.add_room') }}
                    </h3>
                </div>
                <button type="button" class="h-11 w-11 shrink-0 rounded-xl text-2xl text-gray-400 hover:bg-gray-100"
                    :aria-label="$t('common.close')" @click="requestClose">×</button>
            </header>

            <nav class="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-100 px-4 py-2 sm:px-6" aria-label="Room editor sections">
                <button v-for="tab in (roomId ? ['details', 'notifications', 'sessions'] : ['details', 'notifications'])" :key="tab"
                    type="button" class="shrink-0 rounded-xl px-4 py-2 text-sm font-black transition"
                    :class="activeTab === tab ? 'bg-emerald-600 text-white' : 'text-gray-500 hover:bg-gray-100'"
                    @click="selectTab(tab as PanelTab)">
                    {{ $t(`classroom.panel_${tab}`) }}
                </button>
            </nav>

            <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                <div v-if="activeTab === 'details'" class="mx-auto grid max-w-3xl grid-cols-1 gap-5 md:grid-cols-2">
                    <label class="space-y-2 md:col-span-2">
                        <span class="text-sm font-bold text-gray-700">{{ $t('classroom.room_name') }}</span>
                        <input v-model="roomModel.name" :placeholder="$t('classroom.room_placeholder')" class="w-full rounded-xl border-gray-300">
                    </label>
                    <label class="space-y-2">
                        <span class="text-sm font-bold text-gray-700">{{ $t('classroom.address') }}</span>
                        <input v-model="roomModel.address" class="w-full rounded-xl border-gray-300">
                    </label>
                    <label class="space-y-2">
                        <span class="text-sm font-bold text-gray-700">{{ $t('classroom.phone') }}</span>
                        <input v-model="roomModel.phone" class="w-full rounded-xl border-gray-300">
                    </label>
                    <label class="min-w-0 space-y-2 md:col-span-2">
                        <span class="text-sm font-bold text-gray-700">{{ $t('classroom.external_link') }}</span>
                        <input v-model="roomModel.external_link" :placeholder="$t('classroom.external_link_placeholder')" class="w-full min-w-0 rounded-xl border-gray-300">
                    </label>
                    <label class="space-y-2 md:col-span-2">
                        <span class="text-sm font-bold text-gray-700">{{ $t('classroom.color_label') }}</span>
                        <input v-model="roomModel.color" type="color" class="h-12 w-full cursor-pointer rounded-xl border-gray-300 bg-white p-1">
                    </label>
                </div>

                <div v-else-if="activeTab === 'notifications'" class="mx-auto max-w-4xl space-y-4">
                    <p class="text-sm font-bold leading-6 text-gray-500">{{ $t('classroom.room_notification_hint') }}</p>
                    <p v-if="!canManageRbac" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">{{ $t('errors.permission_required_for_settings') }}</p>
                    <ScopedRolePolicyEditor v-model="roomPolicyModel" :roles="roles" :policies="policies"
                        scope-type="classroom" :scope-id="roomId" :classroom-id="roomId" :disabled="saving || !canManageRbac" />
                </div>

                <div v-else class="mx-auto max-w-4xl space-y-4">
                    <div class="sticky top-0 z-10 bg-white pb-2">
                        <input v-model="search" type="search" :placeholder="$t('classroom.search_child_sessions')"
                            class="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 font-bold">
                    </div>
                    <article v-for="session in filteredSessions" :key="session.id" class="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                        <button type="button" class="grid w-full min-w-0 gap-3 p-4 text-left sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                            @click="toggleSession(session)">
                            <div class="min-w-0">
                                <div class="flex min-w-0 flex-wrap items-center gap-2">
                                    <h4 class="min-w-0 break-words font-black text-gray-900">{{ session.name }}</h4>
                                    <span class="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-black text-emerald-700">{{ sessionTypeLabel(session) }}</span>
                                </div>
                                <p class="mt-1 break-words text-xs font-bold text-gray-400">{{ timeSummary(session) }} · {{ session.time_zone }}</p>
                            </div>
                            <span class="text-sm font-black text-emerald-600">{{ expandedSessionId === session.id ? '−' : '+' }}</span>
                        </button>
                        <div v-if="expandedSessionId === session.id" class="space-y-4 border-t border-gray-100 bg-gray-50/60 p-4">
                            <ScopedRolePolicyEditor v-model="sessionSelections" :roles="roles" :policies="policies"
                                scope-type="class_session" :scope-id="session.id" :classroom-id="roomId"
                                :class-session-id="session.id" compact :disabled="savingSessionPolicy || !canManageRbac" />
                            <div class="flex flex-wrap justify-end gap-2">
                                <button type="button" class="rounded-xl px-4 py-2 text-sm font-black text-gray-600 hover:bg-white" @click="resetSessionPolicy">{{ $t('common.reset') }}</button>
                                <button type="button" class="rounded-xl px-4 py-2 text-sm font-black text-emerald-700 hover:bg-white" @click="requestFullEdit(session)">{{ $t('classroom.full_edit_session') }}</button>
                                <button v-if="canManageRbac" type="button" :disabled="savingSessionPolicy || !sessionPolicyDirty" class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40" @click="saveSessionPolicy()">{{ $t('classroom.save_notification_settings') }}</button>
                            </div>
                        </div>
                    </article>
                    <p v-if="filteredSessions.length === 0" class="rounded-2xl border border-dashed border-gray-200 p-10 text-center font-bold text-gray-400">{{ $t('classroom.no_sessions') }}</p>
                </div>
            </div>

            <footer class="flex shrink-0 flex-wrap justify-end gap-3 border-t border-gray-100 bg-white px-4 py-4 sm:px-6">
                <button type="button" :disabled="saving" class="rounded-xl px-5 py-3 font-bold text-gray-600 hover:bg-gray-100 disabled:opacity-40" @click="requestClose">{{ $t('common.cancel') }}</button>
                <button type="button" :disabled="saving || !room.name" class="rounded-xl bg-emerald-600 px-6 py-3 font-black text-white shadow-sm disabled:opacity-40" @click="emit('save')">
                    {{ saving ? $t('common.loading') : $t('common.save') }}
                </button>
            </footer>
        </section>

        <div v-if="showUnsavedDialog" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
            <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                <h4 class="text-lg font-black text-gray-900">{{ $t('classroom.unsaved_notification_title') }}</h4>
                <p class="mt-2 text-sm font-bold leading-6 text-gray-500">{{ $t('classroom.unsaved_notification_message') }}</p>
                <div class="mt-6 flex flex-wrap justify-end gap-2">
                    <button type="button" class="rounded-xl px-4 py-2 font-bold text-gray-500" @click="showUnsavedDialog = false; pendingAction = null">{{ $t('common.cancel') }}</button>
                    <button type="button" class="rounded-xl px-4 py-2 font-bold text-red-600 hover:bg-red-50" @click="discardAndContinue">{{ $t('common.discard') }}</button>
                    <button v-if="canManageRbac" type="button" :disabled="savingSessionPolicy" class="rounded-xl bg-emerald-600 px-4 py-2 font-black text-white disabled:opacity-40" @click="saveSessionPolicy(true)">{{ $t('common.save') }}</button>
                </div>
            </div>
        </div>
    </div>
</template>
