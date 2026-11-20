<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import FactorChallenge from './FactorChallenge.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import AuthMethodRow from './security/AuthMethodRow.vue'
import EnrollFactorDialog from './security/EnrollFactorDialog.vue'
import MethodIcon from './security/MethodIcon.vue'
import RecoveryCodesPanel from './security/RecoveryCodesPanel.vue'
import { ui } from './security/styles'
import {
    additionalAuth, passkeyFailure, passkeySupport,
    type AuthCapabilities, type EnrollableFactor, type Factor, type Passkey, type PasskeyFailure,
} from '@/services/auth/AdditionalAuthService'

const props = defineProps<{ canManageProviders?: boolean }>()
const { t, locale } = useI18n()
const capabilities = ref<AuthCapabilities>()
const factors = ref<Factor[]>([])
const passkeys = ref<Passkey[]>([])
const recovery = ref<Awaited<ReturnType<typeof additionalAuth.recoveryCodes>>>(null)
const issuedCodes = ref<string[]>([])
const issuedSaved = ref(false)
const enrolling = ref<EnrollableFactor>()
const resuming = ref<Factor>()
const pending = ref<{ title: string; message: string; confirm: string; action: () => Promise<void> }>()
const loaded = ref(false)
const busy = ref(false)
const errors = ref<string[]>([])
const passkeyProblem = ref<Exclude<PasskeyFailure, 'cancelled'>>()
const canCreatePasskey = ref(false)

const factorTypes: EnrollableFactor[] = ['totp', 'phone', 'webauthn']
/** Every verified factor plus pending phone/security-key factors the server still lets the user finish. */
const listed = computed(() => factors.value.filter(factor => factor.factor_type !== 'recovery_code'
    && (factor.status === 'verified' || (factor.factor_type !== 'totp' && factor.can_verify))))
const rows = computed(() => factorTypes
    .filter(type => capabilities.value?.mfa[type] || listed.value.some(factor => factor.factor_type === type))
    .map(type => ({ type, items: listed.value.filter(factor => factor.factor_type === type), enrollable: Boolean(capabilities.value?.mfa[type]) })))
const hasVerified = computed(() => listed.value.some(factor => factor.status === 'verified'))
const showRecovery = computed(() => Boolean(capabilities.value?.mfa.recoveryCodes) && hasVerified.value)
const passkeysEnabled = computed(() => Boolean(capabilities.value?.methods.passkeys))

function label(factor: Factor) {
    return factor.friendly_name || t(`auth.factor_${factor.factor_type}`)
}
function formatDate(value?: string | null) {
    return value ? new Date(value).toLocaleDateString(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}

async function attempt(section: string, action: () => Promise<void>) {
    errors.value = errors.value.filter(item => item !== section)
    try { await action() } catch { errors.value.push(section) }
}
/** An unverified TOTP can never be finished (its secret is not shown again), so it is removed. */
async function discardAbandoned(list: Factor[]) {
    const abandoned = list.filter(factor => factor.factor_type === 'totp' && factor.status === 'unverified')
    if (abandoned.length) await Promise.allSettled(abandoned.map(factor => additionalAuth.removeFactor(factor.id)))
    return list.filter(factor => !abandoned.includes(factor))
}
async function reload() {
    busy.value = true
    try {
        await attempt('capabilities', async () => { capabilities.value = await additionalAuth.capabilities() })
        await Promise.all([
            attempt('factors', async () => { factors.value = await discardAbandoned(await additionalAuth.factors()) }),
            capabilities.value?.methods.passkeys && attempt('passkeys', async () => { passkeys.value = await additionalAuth.passkeys() }),
            capabilities.value?.mfa.recoveryCodes && attempt('recovery', async () => { recovery.value = await additionalAuth.recoveryCodes() }),
        ])
    } finally {
        busy.value = false
        loaded.value = true
    }
}
onMounted(async () => {
    canCreatePasskey.value = await passkeySupport()
    await reload()
})

async function act(action: () => Promise<void>) {
    busy.value = true
    try { await attempt('mutation', action) } finally { busy.value = false }
}
function enrollmentClosed(changed: boolean) {
    enrolling.value = undefined
    if (changed) void reload()
}
function resumed() {
    resuming.value = undefined
    void reload()
}
function confirmChange(title: string, message: string, confirm: string, action: () => Promise<void>) {
    pending.value = { title, message, confirm, action }
}
async function runPending() {
    const change = pending.value
    if (!change) return
    await act(async () => {
        try { await change.action() } finally { pending.value = undefined }
        await reload()
    })
}
function removeFactor(factor: Factor) {
    confirmChange(t('auth.remove_title'), t('auth.remove_factor_message', { name: label(factor) }), t('auth.remove_authenticator'),
        async () => { await additionalAuth.removeFactor(factor.id) })
}
function removePasskey(key: Passkey) {
    confirmChange(t('auth.remove_title'), t('auth.remove_factor_message', { name: key.friendly_name || t('auth.passkey') }), t('auth.remove_authenticator'),
        async () => { await additionalAuth.removePasskey(key.id) })
}
async function addPasskey() {
    passkeyProblem.value = undefined
    busy.value = true
    try {
        await additionalAuth.addPasskey()
        await reload()
    } catch (error) {
        const reason = passkeyFailure(error)
        if (reason !== 'cancelled') passkeyProblem.value = reason
    } finally {
        busy.value = false
    }
}
async function generateCodes() {
    await act(async () => {
        issuedCodes.value = (await additionalAuth.generateRecoveryCodes(Boolean(recovery.value))).codes ?? []
        issuedSaved.value = false
        recovery.value = await additionalAuth.recoveryCodes()
    })
}
function replaceCodes() {
    confirmChange(t('auth.replace_recovery_codes'), t('auth.replace_codes_message'), t('auth.replace_recovery_codes'), async () => {
        issuedCodes.value = (await additionalAuth.generateRecoveryCodes(true)).codes ?? []
        issuedSaved.value = false
    })
}
function removeCodes() {
    confirmChange(t('auth.remove_title'), t('auth.remove_codes_message'), t('auth.remove_authenticator'), async () => {
        await additionalAuth.removeRecoveryCodes()
        issuedCodes.value = []
    })
}
</script>

<template>
    <section class="space-y-4" aria-labelledby="authenticator-heading" :aria-busy="busy">
        <div>
            <h3 id="authenticator-heading" class="text-lg font-black">{{ $t('auth.mfa_title') }}</h3>
            <p class="mt-1 text-sm text-gray-600">{{ $t('auth.mfa_description') }}</p>
        </div>

        <div v-if="errors.length" role="status" :class="ui.alert">
            <p class="flex-1">{{ $t(errors.includes('mutation') ? 'auth.method_failed' : 'auth.methods_unavailable') }}</p>
            <button type="button" :disabled="busy" :class="ui.ghost" @click="reload">{{ $t('auth.retry_providers') }}</button>
        </div>

        <div v-if="!loaded" class="space-y-3" aria-hidden="true">
            <div v-for="index in 2" :key="index" class="h-20 animate-pulse rounded-2xl bg-gray-100 motion-reduce:animate-none" />
        </div>

        <template v-else>
            <p v-if="!rows.length && !passkeysEnabled" class="rounded-2xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-600">{{ $t('auth.no_available_factor') }}</p>

            <AuthMethodRow v-for="row in rows" :key="row.type" :title="$t(`auth.factor_${row.type}`)" :description="$t(`auth.factor_${row.type}_description`)"
                :status="row.items.some(item => item.status === 'verified') ? 'enabled' : 'not_set'">
                <template #icon><MethodIcon :name="row.type" /></template>
                <ul v-if="row.items.length" class="mt-3 space-y-2">
                    <li v-for="factor in row.items" :key="factor.id" class="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                        <span class="min-w-0 flex-1 truncate font-bold text-gray-800">{{ label(factor) }}</span>
                        <span v-if="factor.status === 'unverified'" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-800">{{ $t('auth.status_pending') }}</span>
                        <button v-if="factor.status === 'unverified'" type="button" :disabled="busy" :class="ui.ghost" @click="resuming = factor">{{ $t('auth.continue_verification') }}</button>
                        <button type="button" :disabled="busy" :class="ui.danger" :aria-label="$t('auth.remove_named', { name: label(factor) })" @click="removeFactor(factor)">{{ $t('auth.remove_authenticator') }}</button>
                    </li>
                </ul>
                <template v-if="row.enrollable" #actions>
                    <button type="button" :disabled="busy" :class="row.items.length ? ui.secondary : ui.primary" @click="enrolling = row.type">
                        {{ $t(row.items.length ? 'auth.add_another' : 'auth.set_up') }}
                    </button>
                </template>
            </AuthMethodRow>

            <AuthMethodRow v-if="passkeysEnabled" :title="$t('auth.passkeys')" :description="$t('auth.passkeys_description')" :status="passkeys.length ? 'enabled' : 'not_set'">
                <template #icon><MethodIcon name="passkey" /></template>
                <ul v-if="passkeys.length" class="mt-3 space-y-2">
                    <li v-for="key in passkeys" :key="key.id" class="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 text-sm">
                        <div class="min-w-0 flex-1">
                            <p class="truncate font-bold text-gray-800">{{ key.friendly_name || $t('auth.passkey') }}</p>
                            <p class="text-xs text-gray-500">
                                <time :datetime="key.created_at">{{ $t('auth.created_on', { date: formatDate(key.created_at) }) }}</time>
                                <template v-if="key.last_used_at"> · <time :datetime="key.last_used_at">{{ $t('auth.last_used_on', { date: formatDate(key.last_used_at) }) }}</time></template>
                            </p>
                        </div>
                        <button type="button" :disabled="busy" :class="ui.danger" :aria-label="$t('auth.remove_named', { name: key.friendly_name || $t('auth.passkey') })" @click="removePasskey(key)">{{ $t('auth.remove_authenticator') }}</button>
                    </li>
                </ul>
                <p v-if="!canCreatePasskey" class="mt-2 text-sm text-gray-600">{{ $t('auth.webauthn_unavailable') }}</p>
                <p v-if="passkeyProblem" role="alert" class="mt-2 text-sm font-bold text-rose-700">{{ $t(`auth.passkey_${passkeyProblem}`) }}</p>
                <template v-if="canCreatePasskey" #actions>
                    <button type="button" :disabled="busy" :class="passkeys.length ? ui.secondary : ui.primary" @click="addPasskey">{{ $t('auth.add_passkey') }}</button>
                </template>
            </AuthMethodRow>
            <AuthMethodRow v-else-if="props.canManageProviders && capabilities" muted :title="$t('auth.passkeys')" :description="$t('auth.passkey_disabled_admin_hint')" status="disabled">
                <template #icon><MethodIcon name="passkey" /></template>
                <p class="mt-2 text-xs text-gray-500"><code translate="no" class="rounded bg-white px-1.5 py-0.5">PASSKEY_ENABLED=true</code> · <code translate="no" class="rounded bg-white px-1.5 py-0.5">WEBAUTHN_RP_ID</code></p>
            </AuthMethodRow>

            <AuthMethodRow v-if="showRecovery" :title="$t('auth.factor_recovery_code')" :status="recovery ? 'enabled' : 'not_set'"
                :description="recovery?.remaining !== undefined ? $t('auth.recovery_remaining', { count: recovery.remaining }) : $t('auth.recovery_description')">
                <template #icon><MethodIcon name="recovery_code" /></template>
                <template #actions>
                    <button v-if="!recovery" type="button" :disabled="busy" :class="ui.primary" @click="generateCodes">{{ $t('auth.generate_recovery_codes') }}</button>
                    <template v-else>
                        <button type="button" :disabled="busy" :class="ui.secondary" @click="replaceCodes">{{ $t('auth.replace_recovery_codes') }}</button>
                        <button type="button" :disabled="busy" :class="ui.danger" @click="removeCodes">{{ $t('auth.remove_authenticator') }}</button>
                    </template>
                </template>
            </AuthMethodRow>
        </template>

        <EnrollFactorDialog v-if="enrolling" :type="enrolling" :offer-recovery-codes="Boolean(capabilities?.mfa.recoveryCodes) && !recovery" @close="enrollmentClosed" />

        <AppDialog v-if="resuming" open :title="$t('auth.continue_verification')" :description="label(resuming)" @close="resuming = undefined">
            <FactorChallenge :factor="resuming" autofocus @verified="resumed" />
        </AppDialog>

        <AppDialog v-if="issuedCodes.length" open :title="$t('auth.recovery_codes_title')" :dismissible="issuedSaved" @close="issuedCodes = []">
            <RecoveryCodesPanel v-model:saved="issuedSaved" :codes="issuedCodes" />
            <template #footer>
                <button type="button" :class="ui.primary" :disabled="!issuedSaved" @click="issuedCodes = []">{{ $t('auth.enroll_finish') }}</button>
            </template>
        </AppDialog>

        <ConfirmModal v-if="pending" :is-open="true" is-dangerous :is-loading="busy" :title="pending.title" :message="pending.message"
            :confirm-text="pending.confirm" @confirm="runPending" @close="pending = undefined" />
    </section>
</template>
