<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
    PermissionPolicyEvaluator,
    type PolicyEffect,
    type PolicyScope,
    type RoleDTO,
    type RolePermissionPolicyDTO
} from '@/models/Rbac'
import { roleDisplayName } from '@/utils/roleDisplay'

export type PolicySelection = PolicyEffect | 'inherit'
export type RolePolicySelections = Record<string, PolicySelection>

const props = withDefaults(defineProps<{
    roles: RoleDTO[]
    policies: RolePermissionPolicyDTO[]
    scopeType: PolicyScope
    scopeId?: string | null
    classroomId?: string | null
    classSessionId?: string | null
    modelValue: RolePolicySelections
    compact?: boolean
    disabled?: boolean
    labelNamespace?: string
}>(), {
    scopeId: null,
    classroomId: null,
    classSessionId: null,
    compact: false,
    disabled: false,
    labelNamespace: 'settings.incomplete_notifications'
})

const emit = defineEmits<{ 'update:modelValue': [value: RolePolicySelections] }>()
const { t } = useI18n()
const choices: PolicySelection[] = ['inherit', 'allow', 'deny']

const hierarchyHasPolicy = computed(() => props.policies.some(policy =>
    policy.scope_type === 'system'
    || (policy.scope_type === 'classroom' && policy.scope_id === props.classroomId)
    || (policy.scope_type === 'class_session' && policy.scope_id === props.classSessionId)
))

function isCurrentScope(policy: RolePermissionPolicyDTO) {
    return policy.scope_type === props.scopeType
        && (props.scopeType === 'system' || policy.scope_id === props.scopeId)
}

function inheritedFor(roleId: string) {
    return PermissionPolicyEvaluator.resolveRole(
        props.policies.filter(policy => !(policy.role_id === roleId && isCurrentScope(policy))),
        roleId,
        { classroomId: props.classroomId, classSessionId: props.classSessionId }
    )
}

function effectiveFor(roleId: string) {
    const local = props.modelValue[roleId] || 'inherit'
    return local === 'inherit' ? inheritedFor(roleId) : { effect: local, source: props.scopeType }
}

function resultLabel(roleId: string, inherited = false) {
    const result = inherited ? inheritedFor(roleId) : effectiveFor(roleId)
    if (result.effect) return t(`${props.labelNamespace}.${result.effect}`)
    return hierarchyHasPolicy.value
        ? t(`${props.labelNamespace}.no_policy`)
        : t(`${props.labelNamespace}.legacy_fallback`)
}

function sourceLabel(roleId: string, inherited = false) {
    const source = (inherited ? inheritedFor(roleId) : effectiveFor(roleId)).source
    return source
        ? t(`${props.labelNamespace}.${source}`)
        : t(`${props.labelNamespace}.no_policy`)
}

function update(roleId: string, effect: PolicySelection) {
    if (props.disabled) return
    emit('update:modelValue', { ...props.modelValue, [roleId]: effect })
}
</script>

<template>
    <div class="space-y-3" :class="{ 'space-y-2': compact }">
        <article v-for="role in roles" :key="role.id"
            class="grid min-w-0 gap-3 rounded-2xl border border-gray-100 bg-gray-50"
            :class="compact ? 'p-3 md:grid-cols-[minmax(8rem,1fr)_auto]' : 'p-4 lg:grid-cols-[minmax(10rem,1fr)_auto_minmax(12rem,1fr)] lg:items-center'">
            <div class="min-w-0">
                <p class="truncate font-black text-gray-800" :title="roleDisplayName(role, t)">{{ roleDisplayName(role, t) }}</p>
                <p class="mt-1 text-xs font-bold text-gray-400">
                    {{ $t(`${labelNamespace}.effective`) }}:
                    <span :class="effectiveFor(role.id).effect === 'deny' ? 'text-red-600' : effectiveFor(role.id).effect === 'allow' ? 'text-emerald-600' : 'text-gray-500'">
                        {{ resultLabel(role.id) }}
                    </span>
                    · {{ sourceLabel(role.id) }}
                </p>
            </div>
            <div class="inline-flex w-full rounded-xl bg-white p-1 shadow-sm sm:w-auto" role="group"
                :aria-label="roleDisplayName(role, t)">
                <button v-for="effect in choices" :key="effect" type="button"
                    class="min-w-0 flex-1 rounded-lg px-2.5 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 sm:flex-none"
                    :class="modelValue[role.id] === effect
                        ? effect === 'allow' ? 'bg-emerald-600 text-white' : effect === 'deny' ? 'bg-red-600 text-white' : 'bg-gray-700 text-white'
                        : 'text-gray-500 hover:bg-gray-100'"
                    :aria-pressed="modelValue[role.id] === effect" :disabled="disabled"
                    @click="update(role.id, effect)">
                    {{ $t(`${labelNamespace}.${effect}`) }}
                </button>
            </div>
            <p v-if="!compact" class="text-xs font-bold text-gray-400">
                {{ $t(`${labelNamespace}.inherited`) }}:
                {{ resultLabel(role.id, true) }} · {{ sourceLabel(role.id, true) }}
            </p>
        </article>
    </div>
</template>
