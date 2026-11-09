<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SearchableSelect from '@/components/ui/SearchableSelect.vue'
import { useFeedback } from '@/composables/useFeedback'
import type { RoleDTO } from '@/models/Rbac'
import { AiSettingsService, type QuotaPolicyDTO } from '@/services/ai/AiSettingsService'
import { AuthUserSearchService, type AuthUserSearchResultDTO } from '@/services/auth/AuthUserSearchService'
import { RoleService } from '@/services/rbac/RoleService'

/**
 * Site quota (counted in generations): a default policy with role and user
 * overrides, plus one-off grants and resets for a single user.
 */
const props = defineProps<{ userNames: Record<string, string> }>()
const policies = defineModel<QuotaPolicyDTO[]>('policies', { required: true })
const { t } = useI18n()
const { reportError, success } = useFeedback()

const roles = ref<RoleDTO[]>([])
const users = ref<AuthUserSearchResultDTO[]>([])
const userLoading = ref(false)
const knownUserNames = ref<Record<string, string>>({ ...props.userNames })
const saving = ref(false)
const form = reactive<{ scope: QuotaPolicyDTO['scope'], target_id: string, one_time_total: string, period: QuotaPolicyDTO['period'], period_amount: string }>({
    scope: 'default', target_id: '', one_time_total: '', period: 'month', period_amount: '',
})
const adjust = reactive<{ user_id: string, amount: number, note: string }>({ user_id: '', amount: 10, note: '' })
const balance = ref<{ remaining: number, periodic: { remaining: number, limit: number } | null, oneTime: { total: number, used: number, remaining: number } } | null>(null)

const roleOptions = computed(() => roles.value.map((role) => ({ value: role.id, label: role.name, description: role.domain ?? '' })))
const userOptions = computed(() => users.value.map((user) => ({ value: user.id, label: user.display_name?.trim() || user.email, description: user.email })))
const sortedPolicies = computed(() => [...policies.value].sort((a, b) => ['default', 'role', 'user'].indexOf(a.scope) - ['default', 'role', 'user'].indexOf(b.scope)))

function targetName(policy: QuotaPolicyDTO) {
    if (policy.scope === 'default') return t('ai.settings.quota_scope.default')
    if (policy.scope === 'role') return roles.value.find((role) => role.id === policy.target_id)?.name ?? policy.target_id
    return knownUserNames.value[policy.target_id ?? ''] ?? policy.target_id
}

function describe(policy: QuotaPolicyDTO) {
    const parts: string[] = []
    if (policy.one_time_total != null) parts.push(t('ai.settings.quota_one_time', { n: policy.one_time_total }))
    if (policy.period !== 'none') parts.push(t('ai.settings.quota_periodic', { n: policy.period_amount, period: t(`ai.settings.period.${policy.period}`) }))
    return parts.join(' + ') || t('ai.settings.quota_none')
}

function edit(policy: QuotaPolicyDTO) {
    Object.assign(form, {
        scope: policy.scope, target_id: policy.target_id ?? '',
        one_time_total: policy.one_time_total == null ? '' : String(policy.one_time_total),
        period: policy.period, period_amount: policy.period_amount == null ? '' : String(policy.period_amount),
    })
}

async function searchUsers(query: string) {
    if (!query.trim()) { users.value = []; return }
    userLoading.value = true
    try {
        users.value = await AuthUserSearchService.searchUsers(query)
        for (const user of users.value) knownUserNames.value[user.id] = user.display_name?.trim() || user.email
    } catch (error) { reportError(error) } finally { userLoading.value = false }
}

async function savePolicy() {
    saving.value = true
    try {
        const saved = await AiSettingsService.savePolicy({
            scope: form.scope,
            target_id: form.scope === 'default' ? null : form.target_id,
            one_time_total: form.one_time_total === '' ? null : Number(form.one_time_total),
            period: form.period,
            period_amount: form.period === 'none' || form.period_amount === '' ? null : Number(form.period_amount),
        })
        policies.value = [...policies.value.filter((policy) => policy.id !== saved.id), saved]
        success('ai.settings.saved')
    } catch (error) { reportError(error) } finally { saving.value = false }
}

async function removePolicy(policy: QuotaPolicyDTO) {
    try {
        await AiSettingsService.deletePolicy(policy.id)
        policies.value = policies.value.filter((item) => item.id !== policy.id)
    } catch (error) { reportError(error) }
}

async function loadBalance(userId: string) {
    adjust.user_id = userId
    balance.value = userId ? await AiSettingsService.userQuota(userId).catch((error) => { reportError(error); return null }) : null
}

async function adjustQuota(kind: 'grant' | 'reset') {
    if (!adjust.user_id) return
    saving.value = true
    try {
        await AiSettingsService.adjustQuota({ user_id: adjust.user_id, kind, delta: kind === 'grant' ? adjust.amount : undefined, note: adjust.note.trim() || undefined })
        await loadBalance(adjust.user_id)
        success('ai.settings.saved')
    } catch (error) { reportError(error) } finally { saving.value = false }
}

onMounted(async () => {
    try { roles.value = await RoleService.getRoles() } catch (error) { reportError(error) }
})
</script>

<template>
    <section class="space-y-6 rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
        <p class="text-sm text-gray-600">{{ t('ai.settings.quota_description') }}</p>

        <ul class="space-y-2">
            <li v-for="policy in sortedPolicies" :key="policy.id" class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-50 px-4 py-3 text-sm">
                <span><span class="font-black text-gray-900">{{ t(`ai.settings.quota_scope.${policy.scope}`) }}</span>
                    <span v-if="policy.scope !== 'default'" class="ml-1 text-gray-700">{{ targetName(policy) }}</span>
                    <span class="ml-2 text-gray-700">{{ describe(policy) }}</span></span>
                <span class="flex gap-2">
                    <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-gray-700 hover:bg-gray-100" @click="edit(policy)">{{ t('ai.settings.edit') }}</button>
                    <button type="button" class="min-h-11 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50" @click="removePolicy(policy)">{{ t('ai.settings.delete') }}</button>
                </span>
            </li>
            <li v-if="!policies.length" class="rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600">{{ t('ai.settings.quota_empty') }}</li>
        </ul>

        <form class="grid gap-3 rounded-2xl border border-gray-200 p-5 md:grid-cols-2" @submit.prevent="savePolicy">
            <h3 class="font-black text-gray-900 md:col-span-2">{{ t('ai.settings.quota_edit_title') }}</h3>
            <label class="block text-sm font-bold text-gray-700" for="edulog-aiquotasettings-20-1581">{{ t('ai.settings.quota_applies_to') }}
                <select v-model="form.scope" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm" @change="form.target_id = ''">
                    <option v-for="scope in ['default', 'role', 'user']" :key="scope" :value="scope">{{ t(`ai.settings.quota_scope.${scope}`) }}</option>
                </select>
            </label>
            <div v-if="form.scope === 'role'" class="text-sm font-bold text-gray-700">{{ t('ai.settings.quota_scope.role') }}
                <SearchableSelect v-model="form.target_id" class="mt-1" :options="roleOptions" :aria-label="t('ai.settings.quota_scope.role')"  id="edulog-aiquotasettings-20-1581"/>
            </div>
            <div v-else-if="form.scope === 'user'" class="text-sm font-bold text-gray-700">{{ t('ai.settings.quota_scope.user') }}
                <SearchableSelect v-model="form.target_id" class="mt-1" :options="userOptions" remote-search :loading="userLoading" :aria-label="t('ai.settings.quota_scope.user')" @search="searchUsers" />
            </div>
            <div v-else></div>
            <label class="block text-sm font-bold text-gray-700" for="edulog-aiquotasettings-32-2725">{{ t('ai.settings.quota_one_time_label') }}
                <input v-model="form.one_time_total" type="number" min="0" step="1" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" :placeholder="t('ai.settings.quota_none')"  :aria-label="t('ai.settings.quota_none')"/>
            </label>
            <div class="grid grid-cols-2 gap-2">
                <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.quota_period_label') }}
                    <select v-model="form.period" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm" id="edulog-aiquotasettings-32-2725">
                        <option v-for="period in ['none', 'day', 'week', 'month']" :key="period" :value="period">{{ t(`ai.settings.period.${period}`) }}</option>
                    </select>
                </label>
                <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.quota_period_amount') }}
                    <input v-model="form.period_amount" type="number" min="0" step="1" :disabled="form.period === 'none'" :required="form.period !== 'none'" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm disabled:bg-gray-100" />
                </label>
            </div>
            <div class="md:col-span-2">
                <button type="submit" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50" :disabled="saving || (form.scope !== 'default' && !form.target_id)">{{ t('ai.settings.save') }}</button>
            </div>
        </form>

        <div class="space-y-3 rounded-2xl border border-gray-200 p-5">
            <h3 class="font-black text-gray-900">{{ t('ai.settings.quota_user_title') }}</h3>
            <SearchableSelect :model-value="adjust.user_id" :options="userOptions" remote-search :loading="userLoading" :aria-label="t('ai.settings.quota_scope.user')" @search="searchUsers" @update:model-value="loadBalance" />
            <p v-if="balance" class="text-sm text-gray-800" role="status">
                {{ t('ai.settings.quota_balance', { n: balance.remaining, used: balance.oneTime.used, total: balance.oneTime.total }) }}
                <template v-if="balance.periodic"> · {{ t('ai.settings.quota_balance_period', { n: balance.periodic.remaining, limit: balance.periodic.limit }) }}</template>
            </p>
            <div v-if="adjust.user_id" class="flex flex-wrap items-end gap-2">
                <label class="block text-sm font-bold text-gray-700">{{ t('ai.settings.quota_grant_amount') }}
                    <input v-model.number="adjust.amount" type="number" min="1" step="1" class="mt-1 min-h-11 w-28 rounded-xl border border-gray-200 px-3 text-sm" />
                </label>
                <label class="block min-w-0 flex-1 text-sm font-bold text-gray-700">{{ t('ai.settings.quota_note') }}
                    <input v-model="adjust.note" maxlength="500" class="mt-1 min-h-11 w-full rounded-xl border border-gray-200 px-3 text-sm" />
                </label>
                <button type="button" class="min-h-11 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white disabled:opacity-50" :disabled="saving || !adjust.amount" @click="adjustQuota('grant')">{{ t('ai.settings.quota_grant') }}</button>
                <button type="button" class="min-h-11 rounded-xl border border-gray-200 px-4 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50" :disabled="saving" @click="adjustQuota('reset')">{{ t('ai.settings.quota_reset') }}</button>
            </div>
        </div>
    </section>
</template>
