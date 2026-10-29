<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { SessionService } from '@/services/session/SessionService'
import type { PolicyScope } from '@/models/Rbac'
import RolePermissionEditor from '@/components/settings/RolePermissionEditor.vue'
import { useFeedback } from '@/composables/useFeedback'
import SearchableSelect from '@/components/common/SearchableSelect.vue'

type ClassroomOption = { id: string; name: string; teaching_id?: string }
type SessionOption = { id: string; name: string; classroom_id?: string | null; teaching_id?: string }

const { t } = useI18n()
const { reportError } = useFeedback()
const classrooms = ref<ClassroomOption[]>([])
const sessions = ref<SessionOption[]>([])
const loading = ref(false)
const scopeMode = ref<'global' | 'classroom' | 'class_session'>('global')
const classroomId = ref('')
const sessionId = ref('')

const filteredClassrooms = computed(() => classrooms.value)
const classroomOptions = computed(() => filteredClassrooms.value.map(room => ({ value: room.id, label: room.name, searchText: room.name })))
const policyScopeType = computed<PolicyScope>(() => scopeMode.value === 'global' ? 'system' : scopeMode.value)
const policyScopeId = computed(() => scopeMode.value === 'global' ? null
    : scopeMode.value === 'classroom' ? classroomId.value || null : sessionId.value || null)
const contextReady = computed(() => scopeMode.value === 'global'
    || (scopeMode.value === 'classroom' && Boolean(classroomId.value))
    || (scopeMode.value === 'class_session' && Boolean(sessionId.value)))

async function load() {
    loading.value = true
    try {
        const [classroomResult, sessionResult] = await Promise.all([
            ClassroomService.getAllClassrooms(),
            SessionService.getAllClassSessions()
        ])
        classrooms.value = classroomResult.data as unknown as ClassroomOption[]
        sessions.value = sessionResult.data as SessionOption[]
    } catch (error) { reportError(error) } finally { loading.value = false }
}
const filteredSessions = computed(() => {
    if (scopeMode.value === 'class_session' && classroomId.value) return sessions.value.filter(session => session.classroom_id === classroomId.value)
    if (scopeMode.value === 'class_session') return []
    const roomIds = new Set(filteredClassrooms.value.map(room => room.id))
    return sessions.value.filter(session => !session.classroom_id || roomIds.has(session.classroom_id))
})
const sessionOptions = computed(() => filteredSessions.value.map(session => {
    const room = classrooms.value.find(item => item.id === session.classroom_id)
    return { value: session.id, label: session.name, description: room?.name, searchText: `${session.name} ${room?.name ?? ''}` }
}))

watch(classroomId, () => {
    if (sessionId.value && !filteredSessions.value.some(session => session.id === sessionId.value)) sessionId.value = ''
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
                        <option value="classroom">{{ t('rbac.scope.classroom') }}</option>
                        <option value="class_session">{{ t('rbac.scope.class_session') }}</option>
                    </select>
                </label>
                <div v-if="scopeMode === 'classroom' || scopeMode === 'class_session'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-wider text-gray-500">{{ t('rbac.scope.classroom') }}</span>
                    <SearchableSelect v-model="classroomId" :options="classroomOptions" :placeholder="t('common.select_placeholder')" :aria-label="t('rbac.scope.classroom')" />
                </div>
                <div v-if="scopeMode === 'class_session'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-wider text-gray-500">{{ t('rbac.scope.class_session') }}</span>
                    <SearchableSelect v-model="sessionId" :options="sessionOptions" :placeholder="t('common.select_placeholder')" :aria-label="t('rbac.scope.class_session')" />
                </div>
            </div>
            <p v-if="loading" class="py-8 text-center text-sm font-bold text-gray-400">{{ t('common.loading') }}</p>
            <RolePermissionEditor v-else-if="contextReady" domain="teaching"
                :policy-scope-type="policyScopeType" :policy-scope-id="policyScopeId"
                :can-manage-role-definitions="false" />
            <p v-else class="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">{{ t('rbac.scope.select_context') }}</p>
        </div>
    </section>
</template>
