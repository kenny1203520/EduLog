<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { SessionService } from '@/services/session/SessionService'
import { TeacherRoleService, type TeacherRoleTypeDTO } from '@/services/teacher/TeacherRoleService'
import type { IncompleteReportNotificationRule, NotificationScopeType } from '@/models/IncompleteReportNotificationPolicy'

const { t } = useI18n()
const toast = useToast()
const scopeType = ref<NotificationScopeType>('global')
const classroomId = ref('')
const sessionId = ref('')
const classrooms = ref<any[]>([])
const sessions = ref<any[]>([])
const roles = ref<TeacherRoleTypeDTO[]>([])
const rules = ref<IncompleteReportNotificationRule[]>([])
const selectedRoleIds = ref<Set<string>>(new Set())
const loading = ref(false)
const saving = ref(false)

const filteredSessions = computed(() => !classroomId.value
    ? sessions.value
    : sessions.value.filter(session => session.classroom_id === classroomId.value))

const canSave = computed(() => scopeType.value === 'global'
    || (scopeType.value === 'classroom' && Boolean(classroomId.value))
    || (scopeType.value === 'class_session' && Boolean(sessionId.value)))

function syncSelection() {
    const matching = rules.value.filter(rule => {
        if (scopeType.value === 'global') return rule.scope_type === 'global'
        if (scopeType.value === 'classroom') return rule.scope_type === 'classroom' && rule.classroom_id === classroomId.value
        return rule.scope_type === 'class_session' && rule.class_session_id === sessionId.value
    })
    selectedRoleIds.value = new Set(matching.map(rule => rule.role_type_id))
}

function toggleRole(roleId: string) {
    const next = new Set(selectedRoleIds.value)
    next.has(roleId) ? next.delete(roleId) : next.add(roleId)
    selectedRoleIds.value = next
}

async function load() {
    loading.value = true
    try {
        const [roleData, ruleData, classroomResult, sessionResult] = await Promise.all([
            TeacherRoleService.getRoleTypes(),
            TeacherRoleService.getNotificationRules(),
            ClassroomService.getClassrooms(1, 500),
            SessionService.getClassSessions(1, 500)
        ])
        roles.value = roleData
        rules.value = ruleData
        classrooms.value = classroomResult.data
        sessions.value = sessionResult.data
        syncSelection()
    } catch (error: any) {
        toast.error(error.message)
    } finally {
        loading.value = false
    }
}

async function save() {
    if (!canSave.value) return
    saving.value = true
    try {
        const id = scopeType.value === 'classroom' ? classroomId.value : scopeType.value === 'class_session' ? sessionId.value : null
        await TeacherRoleService.replaceNotificationRoles({ type: scopeType.value, id }, [...selectedRoleIds.value])
        rules.value = await TeacherRoleService.getNotificationRules()
        syncSelection()
        toast.success(t('settings.incomplete_notifications.saved'))
    } catch (error: any) {
        toast.error(error.message)
    } finally {
        saving.value = false
    }
}

watch(scopeType, () => {
    if (scopeType.value === 'global') {
        classroomId.value = ''
        sessionId.value = ''
    }
    syncSelection()
})
watch(classroomId, () => {
    if (sessionId.value && !filteredSessions.value.some(session => session.id === sessionId.value)) sessionId.value = ''
    syncSelection()
})
watch(sessionId, syncSelection)
onMounted(load)
</script>

<template>
    <section id="incomplete-notifications" class="overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
        <div class="border-b border-gray-50 p-6 sm:p-8">
            <h3 class="text-2xl font-black tracking-tight text-gray-900">{{ $t('settings.incomplete_notifications.title') }}</h3>
            <p class="mt-1 text-sm font-bold text-gray-400">{{ $t('settings.incomplete_notifications.description') }}</p>
        </div>
        <div class="space-y-6 p-6 sm:p-8">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                <label class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('settings.incomplete_notifications.scope') }}</span>
                    <select v-model="scopeType" class="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 font-bold">
                        <option value="global">{{ $t('settings.incomplete_notifications.global') }}</option>
                        <option value="classroom">{{ $t('settings.incomplete_notifications.classroom') }}</option>
                        <option value="class_session">{{ $t('settings.incomplete_notifications.class_session') }}</option>
                    </select>
                </label>
                <label v-if="scopeType !== 'global'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('classroom.room') }}</span>
                    <select v-model="classroomId" class="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 font-bold">
                        <option value="">{{ $t('common.select_placeholder') }}</option>
                        <option v-for="room in classrooms" :key="room.id" :value="room.id">{{ room.name }}</option>
                    </select>
                </label>
                <label v-if="scopeType === 'class_session'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('classroom.session') }}</span>
                    <select v-model="sessionId" class="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 font-bold">
                        <option value="">{{ $t('common.select_placeholder') }}</option>
                        <option v-for="item in filteredSessions" :key="item.id" :value="item.id">{{ item.name }}</option>
                    </select>
                </label>
            </div>

            <div v-if="loading" class="py-8 text-center font-bold text-gray-400">{{ $t('common.loading') }}</div>
            <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <button v-for="role in roles" :key="role.id" type="button" @click="toggleRole(role.id)"
                    :disabled="!canSave" :class="[
                        'flex items-center gap-3 rounded-2xl border p-4 text-left font-black transition disabled:opacity-40',
                        selectedRoleIds.has(role.id) ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-gray-100 bg-gray-50 text-gray-600'
                    ]">
                    <span :class="['flex h-5 w-5 shrink-0 items-center justify-center rounded-md border', selectedRoleIds.has(role.id) ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300 bg-white']">
                        <span v-if="selectedRoleIds.has(role.id)">✓</span>
                    </span>
                    <span class="truncate">{{ role.name }}</span>
                </button>
            </div>

            <div class="flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs font-bold leading-5 text-amber-800">{{ $t('settings.incomplete_notifications.inheritance_hint') }}</p>
                <button type="button" @click="save" :disabled="saving || !canSave"
                    class="shrink-0 rounded-xl bg-emerald-600 px-6 py-3 font-black text-white transition hover:bg-emerald-700 disabled:opacity-40">
                    {{ saving ? $t('common.loading') : $t('common.save') }}
                </button>
            </div>
        </div>
    </section>
</template>
