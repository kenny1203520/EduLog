<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { additionalAuth, supportsWebAuthn, type Factor } from '@/services/auth/AdditionalAuthService'

const props = defineProps<{ factor: Factor }>()
const emit = defineEmits<{ verified: [redirect: string] }>()
const code = ref('')
const challenge = ref<Awaited<ReturnType<typeof additionalAuth.challengeFactor>>>()
const busy = ref(false)
const error = ref(false)
const codeRequired = computed(() => props.factor.factor_type !== 'webauthn')
const recovery = computed(() => props.factor.factor_type === 'recovery_code')
watch(() => props.factor.id, () => {
    challenge.value = undefined
    code.value = ''
    error.value = false
})

async function verify() {
    busy.value = true
    error.value = false
    try {
        if (recovery.value) {
            emit('verified', (await additionalAuth.verifyRecoveryCode(code.value)).redirect)
        } else {
            const activeChallenge = challenge.value ?? await additionalAuth.challengeFactor(props.factor.id)
            if (!challenge.value && props.factor.factor_type === 'phone') {
                challenge.value = activeChallenge
                return
            }
            emit('verified', (await additionalAuth.verifyFactor(props.factor.id, activeChallenge, code.value)).redirect)
        }
    } catch {
        error.value = true
    } finally {
        busy.value = false
    }
}
</script>

<template>
    <form class="space-y-2" @submit.prevent="verify">
        <label v-if="codeRequired && (challenge || factor.factor_type !== 'phone')" class="block space-y-1">
            <span class="block text-sm font-semibold">{{ $t(recovery ? 'auth.recovery_code' : 'auth.verification_code') }}</span>
            <input v-model="code" required :pattern="recovery ? undefined : '[0-9]{4,10}'"
                :inputmode="recovery ? 'text' : 'numeric'" maxlength="128" autocomplete="one-time-code"
                class="w-full rounded-lg border border-slate-300 px-3 py-2 focus-visible:ring-2 focus-visible:ring-emerald-700">
        </label>
        <p v-if="factor.factor_type === 'webauthn' && !supportsWebAuthn()" class="text-sm text-slate-600">{{ $t('auth.webauthn_unavailable') }}</p>
        <button type="submit" :disabled="busy || (factor.factor_type === 'webauthn' && !supportsWebAuthn())"
            class="min-h-11 rounded-lg border border-emerald-700 px-3 font-semibold text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-700 disabled:opacity-50">
            {{ $t(!challenge && factor.factor_type === 'phone' ? 'auth.send_code' : 'auth.verify_code') }}
        </button>
        <button v-if="challenge && factor.factor_type === 'phone'" type="button" :disabled="busy"
            class="ml-2 min-h-11 rounded-lg px-2 text-sm text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-700"
            @click="challenge = undefined">{{ $t('auth.send_again') }}</button>
        <p v-if="error" role="alert" class="text-sm text-red-700">{{ $t('auth.method_failed') }}</p>
    </form>
</template>
