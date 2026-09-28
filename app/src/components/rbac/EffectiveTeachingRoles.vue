<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RoleService, type EffectiveTeachingRoleDTO } from '@/services/rbac/RoleService'
import type { PolicyScope } from '@/models/Rbac'

const props = defineProps<{
  userId?: string | null
  scopeType: PolicyScope
  scopeId?: string | null
  effectiveDate?: string
}>()
const { t, locale } = useI18n()
const rows = ref<EffectiveTeachingRoleDTO[]>([])
const loading = ref(false)
const failed = ref(false)
let sequence = 0

const includedRoles = computed(() => rows.value.filter(row => !row.is_excluded))
const excludedRoles = computed(() => rows.value.filter(row => row.is_excluded))

function roleName(row: EffectiveTeachingRoleDTO) {
  return row.code ? t(`rbac.role_names.${row.code}`, row.name) : row.name
}
function sourceName(row: EffectiveTeachingRoleDTO) {
  if (row.is_excluded) return t('rbac.effective_roles.source_exclusion')
  const source = row.source_type === 'teaching_assignment'
    ? t('rbac.effective_roles.source_teaching_assignment')
    : t(`rbac.effective_roles.scope_${row.source_scope_type}`)
  return row.is_inherited ? `${t('rbac.effective_roles.source_role_inheritance')} · ${source}` : source
}
function validity(row: EffectiveTeachingRoleDTO) {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(`${row.effective_from}T00:00:00`))
    + ' – ' + (row.effective_to
      ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(`${row.effective_to}T00:00:00`))
      : t('rbac.effective_roles.no_end_date'))
}
async function load() {
  const request = ++sequence
  if (!props.userId || ((props.scopeType === 'classroom' || props.scopeType === 'class_session') && !props.scopeId)) {
    rows.value = []
    failed.value = false
    return
  }
  loading.value = true
  failed.value = false
  try {
    const result = await RoleService.getEffectiveTeachingRoles({
      userId: props.userId,
      scopeType: props.scopeType,
      scopeId: props.scopeId,
      effectiveDate: props.effectiveDate,
    })
    if (request === sequence) rows.value = result
  } catch {
    if (request === sequence) failed.value = true
  } finally {
    if (request === sequence) loading.value = false
  }
}
watch(() => [props.userId, props.scopeType, props.scopeId, props.effectiveDate], load, { immediate: true })
</script>

<template>
  <section class="rounded-xl border border-slate-200 bg-slate-50/70 p-3" :aria-busy="loading">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h5 class="text-sm font-black text-slate-800">{{ t('rbac.effective_roles.title') }}</h5>
      <span class="text-xs text-slate-500">{{ t('rbac.effective_roles.date', { date: effectiveDate || t('rbac.effective_roles.today') }) }}</span>
    </div>
    <p v-if="loading" role="status" aria-live="polite" class="mt-2 text-sm text-slate-500">{{ t('common.loading') }}</p>
    <div v-else-if="failed" role="alert" class="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-rose-700">
      <span>{{ t('rbac.effective_roles.load_failed') }}</span>
      <button type="button" class="min-h-10 rounded-lg px-3 font-bold underline" @click="load">{{ t('rbac.platform_teaching_assignments.retry') }}</button>
    </div>
    <template v-else>
      <ul v-if="includedRoles.length" class="mt-2 grid gap-2 sm:grid-cols-2">
        <li v-for="(row, index) in includedRoles" :key="`${row.role_id}:${row.source_type}:${row.source_scope_id}:${index}`" class="min-w-0 rounded-lg border border-white bg-white px-3 py-2 shadow-sm">
          <p class="break-words text-sm font-bold text-slate-900">{{ roleName(row) }}</p>
          <p class="mt-0.5 break-words text-xs text-slate-600">{{ sourceName(row) }} · {{ validity(row) }}</p>
        </li>
      </ul>
      <p v-else class="mt-2 text-sm text-slate-500">{{ t('rbac.effective_roles.empty') }}</p>
      <div v-if="excludedRoles.length" class="mt-3 border-l-2 border-amber-400 pl-3">
        <p class="text-xs font-bold text-amber-800">{{ t('rbac.effective_roles.exclusions') }}</p>
        <p v-for="(row, index) in excludedRoles" :key="`${row.role_id}:${row.source_scope_id}:${index}`" class="mt-1 break-words text-xs text-amber-800">{{ roleName(row) }} · {{ sourceName(row) }} · {{ validity(row) }}</p>
      </div>
    </template>
  </section>
</template>
