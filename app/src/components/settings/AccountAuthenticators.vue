<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import FactorChallenge from './FactorChallenge.vue'
import { additionalAuth, supportsWebAuthn, type AuthCapabilities, type EnrollableFactor, type Factor } from '@/services/auth/AdditionalAuthService'

const capabilities = ref<AuthCapabilities>()
const factors = ref<Factor[]>([])
const passkeys = ref<Awaited<ReturnType<typeof additionalAuth.passkeys>>>([])
const recovery = ref<Awaited<ReturnType<typeof additionalAuth.recoveryCodes>>>(null)
const codes = ref<string[]>([])
const enrollment = ref<{ factor: Factor; secret?: string }>()
const selectedType = ref<EnrollableFactor>()
const phone = ref('')
const pendingRemoval = ref<{ label: string; action: () => Promise<void> }>()
const busy = ref(false)
const errors = ref<string[]>([])
const factorTypes: EnrollableFactor[] = ['totp', 'phone', 'webauthn']
const availableTypes = computed(() => factorTypes.filter(type => capabilities.value?.mfa[type] && (type !== 'webauthn' || supportsWebAuthn())))
const normalFactors = computed(() => factors.value.filter(factor => factor.factor_type !== 'recovery_code'))

async function attempt(section: string, action: () => Promise<void>) {
    errors.value = errors.value.filter(item => item !== section)
    try { await action() } catch { errors.value.push(section) }
}
async function reload() {
    busy.value = true
    try {
        await attempt('capabilities', async () => { capabilities.value = await additionalAuth.capabilities() })
        await Promise.all([
            attempt('factors', async () => { factors.value = await additionalAuth.factors() }),
            capabilities.value?.methods.passkeys && attempt('passkeys', async () => { passkeys.value = await additionalAuth.passkeys() }),
            capabilities.value?.mfa.recoveryCodes && attempt('recovery', async () => { recovery.value = await additionalAuth.recoveryCodes() }),
        ])
    } finally {
        busy.value = false
    }
}
onMounted(reload)

async function act(action: () => Promise<void>) {
    busy.value = true
    try { await attempt('mutation', action) } finally { busy.value = false }
}
function enroll() {
    const type = selectedType.value
    if (!type) return
    return act(async () => {
        const { id, totp } = await additionalAuth.enrollFactor(type, phone.value)
        enrollment.value = { factor: { id, factor_type: type, status: 'unverified', can_verify: true }, secret: totp?.secret }
    })
}
function enrollmentCompleted() {
    enrollment.value = undefined
    selectedType.value = undefined
    phone.value = ''
    void reload()
}
async function confirmRemoval() {
    const removal = pendingRemoval.value
    if (!removal) return
    await act(async () => {
        await removal.action()
        pendingRemoval.value = undefined
        await reload()
    })
}
async function generateCodes() {
    await act(async () => {
        codes.value = (await additionalAuth.generateRecoveryCodes(Boolean(recovery.value))).codes ?? []
        recovery.value = await additionalAuth.recoveryCodes()
    })
}
function confirmFactorRemoval(factor: Factor, label: string) {
    pendingRemoval.value = { label, action: async () => { await additionalAuth.removeFactor(factor.id) } }
}
function confirmPasskeyRemoval(id: string, label: string) {
    pendingRemoval.value = { label, action: async () => { await additionalAuth.removePasskey(id) } }
}
function addPasskey() {
    return act(async () => { await additionalAuth.addPasskey(); await reload() })
}
function confirmRecoveryCodeChange(label: string, replace: boolean) {
    pendingRemoval.value = {
        label,
        action: async () => {
            if (replace) {
                codes.value = (await additionalAuth.generateRecoveryCodes(true)).codes ?? []
            } else {
                await additionalAuth.removeRecoveryCodes()
                codes.value = []
            }
        },
    }
}
</script>

<template>
    <section class="mt-6 space-y-4 border-t border-slate-200 pt-5" aria-labelledby="authenticator-heading">
        <h3 id="authenticator-heading" class="font-black">{{ $t('auth.authenticators') }}</h3>
        <div v-if="errors.length" role="status" class="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            <p>{{ $t(errors.includes('mutation') ? 'auth.method_failed' : 'auth.methods_unavailable') }}</p>
            <button type="button" :disabled="busy" class="min-h-11 rounded px-2 font-semibold underline focus-visible:ring-2" @click="reload">{{ $t('auth.retry_providers') }}</button>
        </div>

        <div class="space-y-2">
            <h4 class="font-semibold">{{ $t('auth.mfa_title') }}</h4>
            <ul v-if="normalFactors.length" class="divide-y divide-slate-200">
                <li v-for="factor in normalFactors" :key="factor.id" class="flex flex-wrap items-center gap-2 py-1 text-sm">
                    <span class="flex-1">{{ factor.friendly_name || $t(`auth.factor_${factor.factor_type}`) }}</span>
                    <button v-if="factor.status === 'unverified' && factor.can_verify && factor.factor_type !== 'totp'" type="button" :disabled="busy || Boolean(enrollment)"
                        class="min-h-11 rounded px-2 text-emerald-800 focus-visible:ring-2" @click="enrollment = { factor }">{{ $t('auth.verify_code') }}</button>
                    <button type="button" :disabled="busy" class="min-h-11 rounded px-2 text-red-700 focus-visible:ring-2"
                        @click="confirmFactorRemoval(factor, factor.friendly_name || $t(`auth.factor_${factor.factor_type}`))">{{ $t('auth.remove_authenticator') }}</button>
                </li>
            </ul>
            <p v-else-if="!busy" class="text-sm text-slate-600">{{ $t('auth.no_available_factor') }}</p>

            <div v-if="enrollment" class="space-y-3 rounded-lg border border-slate-200 p-3">
                <p v-if="enrollment.secret" class="break-all text-sm">
                    {{ $t('auth.totp_secret') }} <code class="select-all rounded bg-slate-100 px-1">{{ enrollment.secret }}</code>
                </p>
                <FactorChallenge :key="enrollment.factor.id" :factor="enrollment.factor" @verified="enrollmentCompleted" />
                <button type="button" class="min-h-11 rounded px-2 text-slate-700 focus-visible:ring-2" @click="enrollmentCompleted">{{ $t('common.cancel') }}</button>
            </div>
            <form v-else-if="availableTypes.length" class="flex flex-wrap items-end gap-2" @submit.prevent="enroll">
                <label class="space-y-1">
                    <span class="block text-sm">{{ $t('auth.choose_factor') }}</span>
                    <select v-model="selectedType" required class="min-h-11 rounded-lg border border-slate-300 px-2 focus-visible:ring-2">
                        <option :value="undefined" disabled>{{ $t('auth.choose_factor') }}</option>
                        <option v-for="type in availableTypes" :key="type" :value="type">{{ $t(`auth.factor_${type}`) }}</option>
                    </select>
                </label>
                <label v-if="selectedType === 'phone'" class="space-y-1">
                    <span class="block text-sm">{{ $t('auth.phone') }}</span>
                    <input v-model="phone" type="tel" required autocomplete="tel" pattern="[+][1-9][0-9]{7,14}" placeholder="+886912345678"
                        class="min-h-11 rounded-lg border border-slate-300 px-2 focus-visible:ring-2">
                </label>
                <button type="submit" :disabled="busy" class="min-h-11 rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-800 focus-visible:ring-2 disabled:opacity-50">{{ $t('auth.add_authenticator') }}</button>
            </form>
        </div>

        <div v-if="capabilities?.methods.passkeys" class="space-y-2">
            <h4 class="font-semibold">{{ $t('auth.passkeys') }}</h4>
            <ul v-if="passkeys.length" class="divide-y divide-slate-200">
                <li v-for="key in passkeys" :key="key.id" class="flex flex-wrap items-center gap-2 text-sm">
                    <span class="flex-1">{{ key.friendly_name || $t('auth.passkey') }} <time :datetime="key.created_at">· {{ new Date(key.created_at).toLocaleDateString($i18n.locale) }}</time></span>
                    <button type="button" :disabled="busy" class="min-h-11 rounded px-2 text-red-700 focus-visible:ring-2"
                        @click="confirmPasskeyRemoval(key.id, key.friendly_name || $t('auth.passkey'))">{{ $t('auth.remove_authenticator') }}</button>
                </li>
            </ul>
            <button v-if="supportsWebAuthn()" type="button" :disabled="busy" class="min-h-11 rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-800 focus-visible:ring-2"
                @click="addPasskey">{{ $t('auth.add_passkey') }}</button>
            <p v-else class="text-sm text-slate-600">{{ $t('auth.webauthn_unavailable') }}</p>
        </div>

        <div v-if="capabilities?.mfa.recoveryCodes && normalFactors.some(factor => factor.status === 'verified')" class="space-y-2">
            <h4 class="font-semibold">{{ $t('auth.factor_recovery_code') }}</h4>
            <p v-if="recovery?.remaining !== undefined" class="text-sm text-slate-600">{{ $t('auth.recovery_remaining', { count: recovery.remaining }) }}</p>
            <div v-if="codes.length" class="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p role="status" class="text-sm">{{ $t('auth.save_recovery_codes') }}</p>
                <ul class="grid grid-cols-2 gap-1 font-mono text-sm">
                    <li v-for="code in codes" :key="code"><code class="select-all">{{ code }}</code></li>
                </ul>
                <button type="button" class="min-h-11 rounded px-2 text-sm underline focus-visible:ring-2" @click="codes = []">{{ $t('auth.hide_recovery_codes') }}</button>
            </div>
            <div class="flex flex-wrap gap-2">
                <button v-if="!recovery" type="button" :disabled="busy" class="min-h-11 rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-800 focus-visible:ring-2"
                    @click="generateCodes">{{ $t('auth.generate_recovery_codes') }}</button>
                <button v-else type="button" :disabled="busy" class="min-h-11 rounded-lg border border-emerald-700 px-3 text-sm font-semibold text-emerald-800 focus-visible:ring-2"
                    @click="confirmRecoveryCodeChange($t('auth.factor_recovery_code'), true)">{{ $t('auth.replace_recovery_codes') }}</button>
                <button v-if="recovery" type="button" :disabled="busy" class="min-h-11 rounded px-2 text-sm text-red-700 focus-visible:ring-2"
                    @click="confirmRecoveryCodeChange($t('auth.factor_recovery_code'), false)">{{ $t('auth.remove_authenticator') }}</button>
            </div>
        </div>

        <div v-if="pendingRemoval" role="status" class="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <p>{{ $t('auth.confirm_authenticator_change', { name: pendingRemoval.label }) }}</p>
            <button type="button" :disabled="busy" class="min-h-11 rounded px-2 font-bold text-red-700 focus-visible:ring-2" @click="confirmRemoval">{{ $t('auth.confirm_authenticator_action') }}</button>
            <button type="button" :disabled="busy" class="min-h-11 rounded px-2 text-slate-700 focus-visible:ring-2" @click="pendingRemoval = undefined">{{ $t('common.cancel') }}</button>
        </div>
    </section>
</template>
