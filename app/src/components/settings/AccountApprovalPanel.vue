<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AccountApprovalService, type GrantableRole, type PendingAccount } from '@/services/auth/AccountApprovalService'
import { UserAccountService } from '@/services/auth/UserAccountService'
import { RoleService } from '@/services/rbac/RoleService'
import { useFeedback } from '@/composables/useFeedback'
import { usePendingAccounts } from '@/composables/usePendingAccounts'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/dateUtils'
import { roleDisplayName } from '@/utils/roleDisplay'
import { providerLabel } from '@/utils/oauthProviders'

/**
 * Accounts that signed up themselves wait here until approved. Approval can
 * grant roles at platform scope (the defaults are preselected); rejecting
 * disables the account, which can still be approved later from 使用者狀態.
 */
const { t } = useI18n()
const { success, reportError } = useFeedback()
const preferences = usePreferencesStore()
const pendingBadge = usePendingAccounts()

const loading = ref(true)
const loadFailed = ref(false)
const accounts = ref<PendingAccount[]>([])
const roles = ref<GrantableRole[]>([])
const defaultRoleIds = ref<string[]>([])
const savedDefaultRoleIds = ref<string[]>([])
/** Roles chosen for each pending account, keyed by user id. */
const chosen = reactive<Record<string, string[]>>({})
const rejecting = ref<string | null>(null)
const rejectReason = ref('')
const busy = ref<string | null>(null)
const inviteEmail = ref('')

const roleGroups = computed(() => (['teaching', 'system'] as const)
    .map((domain) => ({ domain, roles: roles.value.filter((role) => role.domain === domain) }))
    .filter((group) => group.roles.length))
const defaultsChanged = computed(() => !sameIds(defaultRoleIds.value, savedDefaultRoleIds.value))

function sameIds(a: readonly string[], b: readonly string[]) {
    const sorted = (ids: readonly string[]) => [...ids].sort((x, y) => x.localeCompare(y)).join()
    return sorted(a) === sorted(b)
}

function roleName(role: GrantableRole) {
    return roleDisplayName({ code: role.code, name: role.name, is_system: role.domain === 'system' }, t)
}

async function load() {
    loading.value = true
    loadFailed.value = false
    try {
        const [pending, defaults] = await Promise.all([AccountApprovalService.pending(), AccountApprovalService.defaultRoles()])
        accounts.value = pending.accounts
        roles.value = defaults.roles
        defaultRoleIds.value = [...defaults.role_ids]
        savedDefaultRoleIds.value = [...defaults.role_ids]
        for (const account of pending.accounts) chosen[account.id] ??= [...defaults.role_ids]
        pendingBadge.set(pending.accounts.length)
    } catch (error) {
        loadFailed.value = true
        reportError(error, 'rbac.account_approval.load_failed')
    } finally {
        loading.value = false
    }
}

async function run(key: string, action: () => Promise<void>, successKey: string, failureKey: string) {
    busy.value = key
    try {
        await action()
        success(successKey)
    } catch (error) {
        reportError(error, failureKey)
    } finally {
        busy.value = null
    }
}

function approve(account: PendingAccount) {
    return run(`approve:${account.id}`, async () => {
        await AccountApprovalService.approve(account.id, chosen[account.id] ?? [])
        await load()
    }, 'rbac.account_approval.approved', 'rbac.account_approval.approve_failed')
}

/** Opens the reject form and puts keyboard focus in its reason field. */
async function startReject(account: PendingAccount) {
    rejecting.value = account.id
    rejectReason.value = ''
    await nextTick()
    document.getElementById(`reject-reason-${account.id}`)?.focus()
}

function reject(account: PendingAccount) {
    return run(`reject:${account.id}`, async () => {
        const epoch = (await RoleService.getCapabilities()).epoch
        await UserAccountService.updateStatus(account.id, 'disabled', rejectReason.value.trim(), epoch)
        rejecting.value = null
        await load()
    }, 'rbac.account_approval.rejected', 'rbac.account_approval.reject_failed')
}

function invite() {
    const email = inviteEmail.value.trim()
    return run('invite', async () => {
        await AccountApprovalService.invite(email)
        inviteEmail.value = ''
    }, 'rbac.account_approval.invited', 'rbac.account_approval.invite_failed')
}

function saveDefaults() {
    return run('defaults', async () => {
        const saved = await AccountApprovalService.saveDefaultRoles(defaultRoleIds.value)
        defaultRoleIds.value = [...saved]
        savedDefaultRoleIds.value = [...saved]
    }, 'rbac.account_approval.defaults_saved', 'rbac.account_approval.defaults_failed')
}

onMounted(load)
</script>

<template>
    <div class="grid gap-6">
        <section class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm" aria-labelledby="pending-accounts-title" :aria-busy="loading">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <h3 id="pending-accounts-title" class="font-black text-gray-900">{{ t('rbac.account_approval.pending_title') }}</h3>
                <span class="rounded-full bg-sky-50 px-3 py-1 text-sm font-black text-sky-800">{{ t('rbac.account_approval.pending_count', { n: accounts.length }) }}</span>
            </div>
            <p class="mt-1 text-sm text-gray-500">{{ t('rbac.account_approval.pending_description') }}</p>

            <p v-if="loading" role="status" class="mt-4 text-sm text-gray-500">{{ t('common.loading') }}</p>
            <div v-else-if="loadFailed" role="alert" class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
                <span>{{ t('rbac.account_approval.load_failed') }}</span>
                <button type="button" class="min-h-11 rounded-lg px-3 font-bold underline" @click="load">{{ t('rbac.system_ui.retry') }}</button>
            </div>
            <p v-else-if="!accounts.length" class="mt-4 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500">{{ t('rbac.account_approval.none_pending') }}</p>

            <ul v-else class="mt-4 grid gap-4">
                <li v-for="account in accounts" :key="account.id" class="rounded-2xl border border-gray-100 bg-gray-50/60 p-4" data-testid="pending-account">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0">
                            <p class="truncate font-black text-gray-900">{{ account.display_name?.trim() || account.email }}</p>
                            <p class="truncate text-sm text-gray-600">{{ account.email }}</p>
                            <p class="mt-1 text-xs text-gray-500">
                                {{ t('rbac.account_approval.signed_up_with', { provider: account.provider === 'email' ? t('auth.email') : providerLabel(account.provider) }) }}
                                · {{ DateUtils.displayDate(account.created_at, preferences.locale, preferences.timeZone) }}
                            </p>
                        </div>
                    </div>

                    <fieldset v-if="roleGroups.length" class="mt-3">
                        <legend class="text-xs font-bold text-gray-600">{{ t('rbac.account_approval.roles_to_grant') }}</legend>
                        <div v-for="group in roleGroups" :key="group.domain" role="group" :aria-label="t(`rbac.account_approval.domain_${group.domain}`)" class="mt-2">
                            <p class="mb-2 text-xs font-bold text-gray-500" aria-hidden="true">{{ t(`rbac.account_approval.domain_${group.domain}`) }}</p>
                            <div class="flex flex-wrap gap-2">
                                <label v-for="role in group.roles" :key="role.id" class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 has-[:checked]:border-emerald-300 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900">
                                    <input v-model="chosen[account.id]" type="checkbox" :value="role.id" class="h-4 w-4 accent-emerald-600" />
                                    {{ roleName(role) }}
                                </label>
                            </div>
                        </div>
                        <p v-if="!chosen[account.id]?.length" class="mt-2 text-xs font-semibold text-amber-700">{{ t('rbac.account_approval.no_roles_warning') }}</p>
                    </fieldset>

                    <div v-if="rejecting === account.id" class="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                        <label class="space-y-1 text-xs font-bold text-gray-600">
                            <span>{{ t('rbac.account_approval.reject_reason') }}</span>
                            <input :id="`reject-reason-${account.id}`" v-model="rejectReason" maxlength="500" class="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm" />
                        </label>
                        <button type="button" class="min-h-11 rounded-xl px-4 font-bold text-gray-600 hover:bg-gray-100" @click="rejecting = null">{{ t('common.cancel') }}</button>
                        <button type="button" :disabled="busy !== null || rejectReason.trim().length < 3" class="min-h-11 rounded-xl bg-rose-600 px-4 font-black text-white hover:bg-rose-700 disabled:opacity-40" @click="reject(account)">
                            {{ busy === `reject:${account.id}` ? t('common.processing') : t('rbac.account_approval.confirm_reject') }}
                        </button>
                    </div>
                    <div v-else class="mt-3 flex flex-wrap justify-end gap-2">
                        <button type="button" :disabled="busy !== null" class="min-h-11 rounded-xl border border-rose-200 px-4 font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-40" @click="startReject(account)">{{ t('rbac.account_approval.reject') }}</button>
                        <button type="button" :disabled="busy !== null" class="min-h-11 rounded-xl bg-emerald-600 px-4 font-black text-white hover:bg-emerald-700 disabled:opacity-40" @click="approve(account)">
                            {{ busy === `approve:${account.id}` ? t('common.processing') : t('rbac.account_approval.approve') }}
                        </button>
                    </div>
                </li>
            </ul>
        </section>

        <section class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm" aria-labelledby="invite-title">
            <h3 id="invite-title" class="font-black text-gray-900">{{ t('rbac.account_approval.invite_title') }}</h3>
            <p class="mt-1 text-sm text-gray-500">{{ t('rbac.account_approval.invite_description') }}</p>
            <form class="mt-4 flex flex-wrap gap-2" @submit.prevent="invite">
                <label class="sr-only" for="invite-email">{{ t('auth.email') }}</label>
                <input id="invite-email" v-model="inviteEmail" type="email" required maxlength="320" autocomplete="off" :placeholder="t('auth.email_placeholder')" class="min-h-11 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 text-sm" />
                <button type="submit" :disabled="busy !== null || !inviteEmail.trim()" class="min-h-11 rounded-xl bg-emerald-600 px-4 font-black text-white hover:bg-emerald-700 disabled:opacity-40">
                    {{ busy === 'invite' ? t('common.processing') : t('rbac.account_approval.send_invite') }}
                </button>
            </form>
        </section>

        <section class="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm" aria-labelledby="default-roles-title">
            <h3 id="default-roles-title" class="font-black text-gray-900">{{ t('rbac.account_approval.defaults_title') }}</h3>
            <p class="mt-1 text-sm text-gray-500">{{ t('rbac.account_approval.defaults_description') }}</p>
            <fieldset class="mt-4" :disabled="loading">
                <legend class="sr-only">{{ t('rbac.account_approval.defaults_title') }}</legend>
                <div v-for="group in roleGroups" :key="group.domain" class="mb-3">
                    <p class="mb-2 text-xs font-bold text-gray-500">{{ t(`rbac.account_approval.domain_${group.domain}`) }}</p>
                    <div class="flex flex-wrap gap-2">
                        <label v-for="role in group.roles" :key="role.id" class="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 has-[:checked]:border-emerald-300 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900">
                            <input v-model="defaultRoleIds" type="checkbox" :value="role.id" class="h-4 w-4 accent-emerald-600" />
                            {{ roleName(role) }}
                        </label>
                    </div>
                </div>
                <p v-if="!defaultRoleIds.length" class="text-xs text-gray-500">{{ t('rbac.account_approval.defaults_none') }}</p>
            </fieldset>
            <div class="mt-3 flex justify-end">
                <button type="button" :disabled="busy !== null || !defaultsChanged" class="min-h-11 rounded-xl bg-emerald-600 px-4 font-black text-white hover:bg-emerald-700 disabled:opacity-40" @click="saveDefaults">
                    {{ busy === 'defaults' ? t('common.saving') : t('common.save') }}
                </button>
            </div>
        </section>
    </div>
</template>
