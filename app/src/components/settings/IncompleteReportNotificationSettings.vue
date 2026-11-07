<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { SessionService } from '@/services/session/SessionService'
import { RoleService } from '@/services/rbac/RoleService'
import {
    INCOMPLETE_REPORT_PERMISSION,
    PermissionPolicyService
} from '@/services/rbac/PermissionPolicyService'
import type { PermissionDTO, PolicyScope, RoleDTO, RolePermissionPolicyDTO } from '@/models/Rbac'
import ScopedRolePolicyEditor, { type PolicySelection } from '@/components/settings/ScopedRolePolicyEditor.vue'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'

const { t } = useI18n()
const props = withDefaults(defineProps<{ titleKey?: string; descriptionKey?: string }>(), {
    titleKey: 'settings.incomplete_notifications.title',
    descriptionKey: 'settings.incomplete_notifications.description'
})
const toast = useToast()
const { reportError } = useFeedback()
const scopeType = ref<PolicyScope>('system')
const classroomId = ref('')
const sessionId = ref('')
const classrooms = ref<any[]>([])
const sessions = ref<any[]>([])
const roles = ref<RoleDTO[]>([])
const permission = ref<PermissionDTO | null>(null)
const policies = ref<RolePermissionPolicyDTO[]>([])
const selections = ref<Record<string, PolicySelection>>({})
const loading = ref(false)
const saving = ref(false)
const canManageRbac = ref(false)

const filteredSessions = computed(() => !classroomId.value
    ? sessions.value
    : sessions.value.filter(session => session.classroom_id === classroomId.value))
const classroomOptions = computed(() => classrooms.value.map(room => ({ value: room.id, label: room.name, searchText: room.name })))
const sessionOptions = computed(() => filteredSessions.value.map(session => {
    const room = classrooms.value.find(item => item.id === session.classroom_id)
    return { value: session.id, label: session.name, description: room?.name, searchText: `${session.name} ${room?.name ?? ''}` }
}))
const scopeId = computed(() => scopeType.value === 'system'
    ? null
    : scopeType.value === 'classroom' ? classroomId.value : sessionId.value)
const canSave = computed(() => canManageRbac.value && (scopeType.value === 'system' || Boolean(scopeId.value)))

function isCurrentScope(policy: RolePermissionPolicyDTO) {
    return policy.scope_type === scopeType.value
        && (scopeType.value === 'system' || policy.scope_id === scopeId.value)
}

function syncSelections() {
    selections.value = Object.fromEntries(roles.value.map(role => {
        const current = policies.value.find(policy => policy.role_id === role.id && isCurrentScope(policy))
        return [role.id, current?.effect || 'inherit']
    }))
}


async function load() {
    loading.value = true
    try {
        canManageRbac.value = await PermissionPolicyService.canManageRbac()
        const [roleData, permissionData] = await Promise.all([
            RoleService.getRoles(),
            PermissionPolicyService.getPermission(INCOMPLETE_REPORT_PERMISSION)
        ])
        roles.value = roleData
        permission.value = permissionData
        policies.value = await PermissionPolicyService.getPolicies(permissionData.id)
        // Global policy management should remain usable even when the operator
        // has no permission to browse classroom/session records. These lookups
        // only populate scope selectors and must not block system scope.
        const [classroomResult, sessionResult] = await Promise.allSettled([
            ClassroomService.getAllClassrooms(),
            SessionService.getAllClassSessions()
        ])
        if (classroomResult.status === 'fulfilled') classrooms.value = classroomResult.value.data
        if (sessionResult.status === 'fulfilled') sessions.value = sessionResult.value.data
        syncSelections()
    } catch (error: any) {
        reportError(error)
    } finally {
        loading.value = false
    }
}

async function save() {
    if (!canSave.value) return
    saving.value = true
    try {
        const overrides = roles.value.flatMap(role => {
            const effect = selections.value[role.id]
            return effect === 'allow' || effect === 'deny' ? [{ role_id: role.id, effect }] : []
        })
        await PermissionPolicyService.replacePolicies(
            INCOMPLETE_REPORT_PERMISSION,
            { type: scopeType.value, id: scopeId.value },
            overrides
        )
        if (permission.value) policies.value = await PermissionPolicyService.getPolicies(permission.value.id)
        syncSelections()
        toast.success(t('settings.incomplete_notifications.saved'))
    } catch (error: any) {
        reportError(error)
    } finally {
        saving.value = false
    }
}

watch(scopeType, () => {
    if (scopeType.value === 'system') {
        classroomId.value = ''
        sessionId.value = ''
    }
    syncSelections()
})
watch(classroomId, () => {
    if (sessionId.value && !filteredSessions.value.some(session => session.id === sessionId.value)) sessionId.value = ''
    syncSelections()
})
watch(sessionId, syncSelections)
onMounted(load)
</script>

<template>
    <section id="incomplete-notifications" class="overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-sm">
        <div class="border-b border-gray-50 p-6 sm:p-8">
            <h3 class="text-2xl font-black tracking-tight text-gray-900">{{ $t(props.titleKey) }}</h3>
            <p class="mt-1 text-sm font-bold text-gray-400">{{ $t(props.descriptionKey) }}</p>
        </div>
        <div class="space-y-6 p-6 sm:p-8">
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                <label class="space-y-2" for="edulog-incompletereportnotificationsettings-9-521">
                    <span class="text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('settings.incomplete_notifications.scope') }}</span>
                    <select v-model="scopeType" class="w-full rounded-xl border-gray-200 bg-gray-50 px-4 py-3 font-bold">
                        <option value="system">{{ $t('settings.incomplete_notifications.system') }}</option>
                        <option value="classroom">{{ $t('settings.incomplete_notifications.classroom') }}</option>
                        <option value="class_session">{{ $t('settings.incomplete_notifications.class_session') }}</option>
                    </select>
                </label>
                <div v-if="scopeType !== 'system'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('classroom.room') }}</span>
                    <SearchableSelect v-model="classroomId" :options="classroomOptions" :placeholder="$t('common.select_placeholder')" :aria-label="$t('classroom.room')"  id="edulog-incompletereportnotificationsettings-9-521"/>
                </div>
                <div v-if="scopeType === 'class_session'" class="space-y-2">
                    <span class="text-xs font-black uppercase tracking-widest text-gray-400">{{ $t('classroom.session') }}</span>
                    <SearchableSelect v-model="sessionId" :options="sessionOptions" :placeholder="$t('common.select_placeholder')" :aria-label="$t('classroom.session')" />
                </div>
            </div>
            <div v-if="loading" class="py-8 text-center font-bold text-gray-400">{{ $t('common.loading') }}</div>
            <template v-else>
                <p v-if="!canManageRbac" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                    {{ $t('errors.permission_required_for_settings') }}
                </p>
                <ScopedRolePolicyEditor v-model="selections" :roles="roles" :policies="policies"
                    :scope-type="scopeType" :scope-id="scopeId" :classroom-id="classroomId || null"
                    :class-session-id="sessionId || null" :disabled="!canSave || saving" />
            </template>

            <div class="flex flex-col gap-3 rounded-2xl bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p class="text-xs font-bold leading-5 text-amber-800">{{ $t('settings.incomplete_notifications.inheritance_hint') }}</p>
                <button v-if="canManageRbac" type="button" @click="save" :disabled="saving || !canSave"
                    class="shrink-0 rounded-xl bg-emerald-600 px-6 py-3 font-black text-white transition hover:bg-emerald-700 disabled:opacity-40">
                    {{ saving ? $t('common.loading') : $t('common.save') }}
                </button>
            </div>
        </div>
    </section>
</template>
