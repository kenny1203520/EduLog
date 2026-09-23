<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { SessionService } from '@/services/session/SessionService'
import { apiV1Client } from '@/services/api/ApiV1Client'
import type { PolicyScope } from '@/models/Rbac'
import RolePermissionEditor from '@/components/settings/RolePermissionEditor.vue'
import { useFeedback } from '@/composables/useFeedback'

type Teaching = { id: string; name: string }
type ClassroomOption = { id: string; name: string; teaching_id?: string }
type SessionOption = { id: string; name: string; classroom_id?: string | null; teaching_id?: string }

const { t } = useI18n()
const { reportError } = useFeedback()
const teachings = ref<Teaching[]>([])
const classrooms = ref<ClassroomOption[]>([])
const sessions = ref<SessionOption[]>([])
const loading = ref(false)
const scopeMode = ref<'global' | 'teaching' | 'classroom' | 'class_session'>('global')
const teachingId = ref('')
const classroomId = ref('')
const sessionId = ref('')

const filteredClassrooms = computed(() => !teachingId.value
    ? classrooms.value
    : classrooms.value.filter(room => room.teaching_id === teachingId.value))
const selectedSession = computed(() => sessions.value.find(session => session.id === sessionId.value) ?? null)
const selectedClassroom = computed(() => classrooms.value.find(room => room.id === classroomId.value) ?? null)
const roleTeachingId = computed(() => scopeMode.value === 'teaching' ? teachingId.value
    : scopeMode.value === 'classroom' ? selectedClassroom.value?.teaching_id ?? ''
        : scopeMode.value === 'class_session'
            ? selectedSession.value?.teaching_id ?? classrooms.value.find(room => room.id === selectedSession.value?.classroom_id)?.teaching_id ?? ''
            : '')
const policyScopeType = computed<PolicyScope>(() => scopeMode.value === 'global' ? 'teaching' : scopeMode.value)
const policyScopeId = computed(() => scopeMode.value === 'global' ? null
    : scopeMode.value === 'teaching' ? teachingId.value || null
        : scopeMode.value === 'classroom' ? classroomId.value || null : sessionId.value || null)
const contextReady = computed(() => scopeMode.value === 'global'
    || (scopeMode.value === 'teaching' && Boolean(teachingId.value))
    || (scopeMode.value === 'classroom' && Boolean(classroomId.value))
    || (scopeMode.value === 'class_session' && Boolean(sessionId.value)))

async function load() {
    loading.value = true
    try {
        const [overview, classroomResult, sessionResult] = await Promise.all([
            apiV1Client.get<{ teachings?: Teaching[] }>('/pages/settings/overview'),
            ClassroomService.getAllClassrooms(),
            SessionService.getAllClassSessions()
        ])
        teachings.value = overview.data.teachings ?? []
        classrooms.value = classroomResult.data as unknown as ClassroomOption[]
        sessions.value = sessionResult.data as SessionOption[]
        teachingId.value ||= teachings.value[0]?.id ?? ''
    } catch (error) { reportError(error) } finally { loading.value = false }
}

watch(teachingId, () => {
    if (classroomId.value && !filteredClassrooms.value.some(room => room.id === classroomId.value)) classroomId.value = ''
    if (selectedSession.value && !filteredSessions.value.some(session => session.id === selectedSession.value?.id)) sessionId.value = ''
})
const filteredSessions = computed(() => {
    if (scopeMode.value === 'class_session' && classroomId.value) return sessions.value.filter(session => session.classroom_id === classroomId.value)
    const roomIds = new Set(filteredClassrooms.value.map(room => room.id))
    return sessions.value.filter(session => !session.classroom_id || roomIds.has(session.classroom_id))
})

onMounted(load)
</script>

<template>
    <section class="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm">
        <header class="border-b border-gray-100 p-6 sm:p-8">
            <h3 class="text-xl font-black text-gray-900">{{ t('settings.teaching_role_permissions.title') }}</h3>
            <p class="mt-1 max-w-3xl text-sm text-gray-500">{{ t('settings.teaching_role_permissions.description') }}</p>
            <p class="mt-3 rounded-xl bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-900">{{ t('rbac.sensitive_student_data_hint') }}</p>
        </header>
        <div class="space-y-5 p-6 sm:p-8">
            <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <label class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-wider text-gray-500">{{ t('rbac.scope.label') }}</span>
                    <select v-model="scopeMode" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold" :aria-label="t('rbac.scope.label')">
                        <option value="global">{{ t('rbac.scope.global_teaching') }}</option>
                        <option value="teaching">{{ t('rbac.scope.teaching') }}</option>
                        <option value="classroom">{{ t('rbac.scope.classroom') }}</option>
                        <option value="class_session">{{ t('rbac.scope.class_session') }}</option>
                    </select>
                </label>
                <label v-if="scopeMode === 'teaching' || scopeMode === 'classroom' || scopeMode === 'class_session'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-wider text-gray-500">{{ t('rbac.scope.teaching_context') }}</span>
                    <select v-model="teachingId" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold" :aria-label="t('rbac.scope.teaching_context')">
                        <option value="">{{ t('common.select_placeholder') }}</option>
                        <option v-for="teaching in teachings" :key="teaching.id" :value="teaching.id">{{ teaching.name }}</option>
                    </select>
                </label>
                <label v-if="scopeMode === 'classroom' || scopeMode === 'class_session'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-wider text-gray-500">{{ t('rbac.scope.classroom') }}</span>
                    <select v-model="classroomId" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold" :aria-label="t('rbac.scope.classroom')">
                        <option value="">{{ t('common.select_placeholder') }}</option>
                        <option v-for="room in filteredClassrooms" :key="room.id" :value="room.id">{{ room.name }}</option>
                    </select>
                </label>
                <label v-if="scopeMode === 'class_session'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-wider text-gray-500">{{ t('rbac.scope.class_session') }}</span>
                    <select v-model="sessionId" class="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold" :aria-label="t('rbac.scope.class_session')">
                        <option value="">{{ t('common.select_placeholder') }}</option>
                        <option v-for="session in filteredSessions" :key="session.id" :value="session.id">{{ session.name }}</option>
                    </select>
                </label>
            </div>
            <p v-if="loading" class="py-8 text-center text-sm font-bold text-gray-400">{{ t('common.loading') }}</p>
            <RolePermissionEditor v-else-if="contextReady" domain="teaching" :teaching-id="roleTeachingId"
                :policy-scope-type="policyScopeType" :policy-scope-id="policyScopeId"
                :can-manage-role-definitions="false" />
            <p v-else class="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">{{ t('rbac.scope.select_context') }}</p>
        </div>
    </section>
</template>
