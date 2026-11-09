<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { PolicyScope, RoleDTO } from '@/models/Rbac'
import {
    resolveScheduleMode,
    type DashboardScheduleMode,
    type DashboardSchedulePolicies,
    type DashboardScheduleSelection,
    type DashboardScheduleSelections,
    type ResolvedDashboardScheduleMode
} from '@/models/DashboardScheduleMode'
import { roleDisplayName } from '@/utils/roleDisplay'

// Four-state counterpart of ScopedRolePolicyEditor for today's schedule:
// each role picks all / assigned / hidden or inherits from the scope above.
const props = withDefaults(defineProps<{
    roles: RoleDTO[]
    policies: DashboardSchedulePolicies
    scopeType: PolicyScope
    scopeId?: string | null
    classroomId?: string | null
    classSessionId?: string | null
    modelValue: DashboardScheduleSelections
    compact?: boolean
    disabled?: boolean
}>(), {
    scopeId: null,
    classroomId: null,
    classSessionId: null,
    compact: false,
    disabled: false
})

const emit = defineEmits<{ 'update:modelValue': [value: DashboardScheduleSelections] }>()
const { t } = useI18n()
const choices: DashboardScheduleSelection[] = ['inherit', 'all', 'assigned', 'hidden']

const selectedClass: Record<DashboardScheduleSelection, string> = {
    inherit: 'bg-gray-700 text-white',
    all: 'bg-emerald-600 text-white',
    assigned: 'bg-amber-700 text-white',
    hidden: 'bg-red-600 text-white'
}

const resultClass: Record<DashboardScheduleMode, string> = {
    all: 'text-emerald-600',
    assigned: 'text-amber-700',
    hidden: 'text-red-600'
}

function isCurrentScope(policy: { role_id: string; scope_type: PolicyScope; scope_id?: string | null }, roleId: string) {
    return policy.role_id === roleId && policy.scope_type === props.scopeType
        && (props.scopeType === 'system' || policy.scope_id === props.scopeId)
}

function inheritedFor(roleId: string): ResolvedDashboardScheduleMode {
    return resolveScheduleMode({
        all: props.policies.all.filter(policy => !isCurrentScope(policy, roleId)),
        view: props.policies.view.filter(policy => !isCurrentScope(policy, roleId))
    }, roleId, { classroomId: props.classroomId, classSessionId: props.classSessionId })
}

function effectiveFor(roleId: string): ResolvedDashboardScheduleMode {
    const local = props.modelValue[roleId] || 'inherit'
    return local === 'inherit' ? inheritedFor(roleId) : { mode: local, source: props.scopeType }
}

function resultLabel(result: ResolvedDashboardScheduleMode) {
    return result.mode ? t(`settings.dashboard_schedule.${result.mode}`) : t('settings.dashboard_schedule.no_policy')
}

function sourceLabel(result: ResolvedDashboardScheduleMode) {
    return result.source ? t(`settings.dashboard_schedule.${result.source}`) : t('settings.dashboard_schedule.default_source')
}

function update(roleId: string, selection: DashboardScheduleSelection) {
    if (props.disabled || props.roles.find(role => role.id === roleId)?.is_protected) return
    emit('update:modelValue', { ...props.modelValue, [roleId]: selection })
}
</script>

<template>
    <div class="space-y-3" :class="{ 'space-y-2': compact }">
        <article v-for="role in roles" :key="role.id"
            class="grid min-w-0 gap-3 rounded-2xl border border-gray-100 bg-gray-50"
            :class="compact ? 'p-3 md:grid-cols-[minmax(8rem,1fr)_auto]' : 'p-4 lg:grid-cols-[minmax(10rem,1fr)_auto_minmax(12rem,1fr)] lg:items-center'">
            <div class="min-w-0">
                <p class="truncate font-black text-gray-800" :title="roleDisplayName(role, t)">{{ roleDisplayName(role, t) }}</p>
                <p v-if="role.is_protected" class="mt-1 text-xs font-bold text-amber-700">{{ $t('rbac.protected_read_only') }}</p>
                <p class="mt-1 text-xs font-bold text-gray-500">
                    {{ $t('settings.dashboard_schedule.effective') }}:
                    <span :class="effectiveFor(role.id).mode ? resultClass[effectiveFor(role.id).mode!] : 'text-gray-500'">
                        {{ resultLabel(effectiveFor(role.id)) }}
                    </span>
                    · {{ sourceLabel(effectiveFor(role.id)) }}
                </p>
            </div>
            <div class="grid w-full grid-cols-2 gap-1 rounded-xl bg-white p-1 shadow-sm sm:inline-flex sm:w-auto" role="group"
                :aria-label="roleDisplayName(role, t)">
                <button v-for="choice in choices" :key="choice" type="button"
                    class="min-h-9 min-w-0 cursor-pointer rounded-lg px-2.5 py-2 text-xs font-black transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
                    :class="modelValue[role.id] === choice ? selectedClass[choice] : 'text-gray-600 hover:bg-gray-100'"
                    :aria-pressed="modelValue[role.id] === choice" :disabled="disabled || role.is_protected"
                    @click="update(role.id, choice)">
                    {{ $t(`settings.dashboard_schedule.${choice}`) }}
                </button>
            </div>
            <p v-if="!compact" class="text-xs font-bold text-gray-500">
                {{ $t('settings.dashboard_schedule.inherited') }}:
                {{ resultLabel(inheritedFor(role.id)) }} · {{ sourceLabel(inheritedFor(role.id)) }}
            </p>
        </article>
    </div>
</template>
