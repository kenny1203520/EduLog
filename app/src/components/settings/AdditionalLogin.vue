<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import FactorChallenge from './FactorChallenge.vue'
import { additionalAuth, supportsWebAuthn, type AuthCapabilities, type Factor, type LoginMethod } from '@/services/auth/AdditionalAuthService'

const props = defineProps<{ methods?: AuthCapabilities['methods']; mfaRequired: boolean; online: boolean; returnTo?: string }>()
const emit = defineEmits<{ verified: [redirect: string]; cancel: [] }>()
const methods = computed(() => ([
    { id: 'email', label: 'auth.sign_in_email_code', enabled: props.methods?.emailOtp },
    { id: 'magicLink', label: 'auth.sign_in_email_link', enabled: props.methods?.magicLink },
    { id: 'sms', label: 'auth.sign_in_sms', enabled: props.methods?.sms },
    { id: 'saml', label: 'auth.sign_in_saml', enabled: props.methods?.saml },
] as const).filter(item => item.enabled))
const method = ref<LoginMethod>()
const destination = ref('')
const code = ref('')
const submitted = ref(false)
const busy = ref(false)
const error = ref(false)
const factors = ref<Factor[]>([])
const selectedId = ref('')
const selected = computed(() => factors.value.find(factor => factor.id === selectedId.value))
watch(method, () => {
    submitted.value = false
    destination.value = ''
    code.value = ''
    error.value = false
})

async function perform(action: () => Promise<void>) {
    busy.value = true
    error.value = false
    try { await action() } catch { error.value = true }
    finally { busy.value = false }
}
async function loadFactors() {
    await perform(async () => {
        factors.value = (await additionalAuth.factors()).filter(factor => factor.status === 'verified' && factor.can_verify)
        selectedId.value = factors.value[0]?.id ?? ''
    })
}
watch(() => props.mfaRequired, value => { if (value) void loadFactors() })
onMounted(() => { if (props.mfaRequired) void loadFactors() })

function submit() {
    const selection = method.value
    if (!selection) return
    return perform(async () => {
        if (selection === 'saml') {
            window.location.assign((await additionalAuth.startSso(destination.value, props.returnTo)).url)
        } else if (submitted.value && selection !== 'magicLink') {
            emit('verified', (await additionalAuth.verifyOtp(selection, destination.value, code.value)).redirect)
        } else {
            await additionalAuth.sendOtp(selection, destination.value, props.returnTo)
            submitted.value = true
        }
    })
}
function signInWithPasskey() {
    return perform(async () => emit('verified', (await additionalAuth.signInWithPasskey()).redirect))
}
</script>

<template>
    <section v-if="mfaRequired" class="w-full space-y-3" aria-labelledby="mfa-challenge-heading">
        <h2 id="mfa-challenge-heading" class="font-bold">{{ $t('auth.mfa_required') }}</h2>
        <label v-if="factors.length" class="block space-y-1">
            <span class="block text-sm">{{ $t('auth.choose_factor') }}</span>
            <select v-model="selectedId" class="w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:ring-2">
                <option v-for="factor in factors" :key="factor.id" :value="factor.id">{{ factor.friendly_name || $t(`auth.factor_${factor.factor_type}`) }}</option>
            </select>
        </label>
        <FactorChallenge v-if="selected" :key="selected.id" :factor="selected" @verified="emit('verified', $event)" />
        <p v-else-if="!busy && !error" role="status" class="text-sm">{{ $t('auth.no_available_factor') }}</p>
        <div class="flex flex-wrap gap-3">
            <button type="button" :disabled="busy" class="min-h-11 rounded-lg px-2 text-emerald-800 focus-visible:ring-2" @click="loadFactors">{{ $t('auth.retry_providers') }}</button>
            <button type="button" :disabled="busy" class="min-h-11 rounded-lg px-2 text-emerald-800 focus-visible:ring-2" @click="emit('cancel')">{{ $t('common.cancel') }}</button>
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-700">{{ $t('auth.method_failed') }}</p>
    </section>
    <section v-else-if="methods.length || (props.methods?.passkeys && supportsWebAuthn())" class="mt-5 w-full space-y-2" aria-labelledby="additional-login-heading">
        <h2 id="additional-login-heading" class="text-sm font-semibold text-slate-700">{{ $t('auth.more_sign_in_methods') }}</h2>
        <div class="grid gap-2">
            <button v-for="item in methods" :key="item.id" type="button" :aria-pressed="method === item.id" :disabled="busy || !online"
                class="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-emerald-700 aria-pressed:border-emerald-700 aria-pressed:bg-emerald-50 disabled:opacity-50"
                @click="method = method === item.id ? undefined : item.id">{{ $t(item.label) }}</button>
            <button v-if="props.methods?.passkeys && supportsWebAuthn()" type="button" :disabled="busy || !online"
                class="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:opacity-50"
                @click="signInWithPasskey">{{ $t('auth.sign_in_passkey') }}</button>
        </div>
        <form v-if="method" class="space-y-2 pt-2" @submit.prevent="submit">
            <label class="block space-y-1">
                <span class="block text-sm font-semibold">{{ $t(method === 'sms' ? 'auth.phone' : method === 'saml' ? 'auth.organization_domain' : 'auth.email') }}</span>
                <input v-model="destination" required :type="method === 'sms' ? 'tel' : method === 'saml' ? 'text' : 'email'"
                    :pattern="method === 'sms' ? '[+][1-9][0-9]{7,14}' : undefined" :placeholder="method === 'sms' ? '+886912345678' : method === 'saml' ? 'example.org' : undefined"
                    :autocomplete="method === 'sms' ? 'tel' : method === 'saml' ? 'off' : 'email'" :readonly="submitted"
                    class="w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:ring-2 focus-visible:ring-emerald-700">
            </label>
            <p v-if="submitted" role="status" class="text-sm text-slate-700">{{ $t('auth.check_sign_in_message') }}</p>
            <label v-if="submitted && method !== 'magicLink'" class="block space-y-1">
                <span class="block text-sm font-semibold">{{ $t('auth.verification_code') }}</span>
                <input v-model="code" required pattern="[0-9]{4,10}" inputmode="numeric" maxlength="10" autocomplete="one-time-code"
                    class="w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:ring-2 focus-visible:ring-emerald-700">
            </label>
            <div class="flex flex-wrap gap-2">
                <button v-if="!submitted || method !== 'magicLink'" type="submit" :disabled="busy || !online"
                    class="min-h-11 rounded-lg border border-emerald-700 px-3 font-semibold text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:opacity-50">
                    {{ $t(method === 'saml' ? 'auth.continue_sso' : submitted ? 'auth.verify_code' : method === 'magicLink' ? 'auth.send_sign_in_link' : 'auth.send_code') }}
                </button>
                <button v-if="submitted" type="button" :disabled="busy" class="min-h-11 rounded-lg px-2 text-sm text-emerald-800 focus-visible:ring-2"
                    @click="submitted = false; code = ''">{{ $t('auth.change_destination') }}</button>
            </div>
        </form>
        <p v-if="error" role="alert" class="text-sm text-red-700">{{ $t('auth.method_failed') }}</p>
    </section>
</template>
