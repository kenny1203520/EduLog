<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { additionalAuth, supportsWebAuthn, type Factor } from '@/services/auth/AdditionalAuthService'

const props = defineProps<{ factor: Factor; autofocus?: boolean }>()
const emit = defineEmits<{ verified: [redirect: string] }>()
const code = ref('')
const challenge = ref<Awaited<ReturnType<typeof additionalAuth.challengeFactor>>>()
const busy = ref(false)
const error = ref(false)
const input = useTemplateRef<HTMLInputElement>('input')
const inputId = useId()
const errorId = useId()
const codeRequired = computed(() => props.factor.factor_type !== 'webauthn')
const recovery = computed(() => props.factor.factor_type === 'recovery_code')
const showInput = computed(() => codeRequired.value && (Boolean(challenge.value) || props.factor.factor_type !== 'phone'))
const webauthnBlocked = computed(() => props.factor.factor_type === 'webauthn' && !supportsWebAuthn())
/** Authenticator apps and SMS send six digits; reaching that length submits for the user. */
const autoSubmitLength = 6

// The `autofocus` attribute only applies on page load or when a dialog opens, not to inputs added later.
onMounted(() => { if (props.autofocus) input.value?.focus() })
watch(() => props.factor.id, () => {
    challenge.value = undefined
    code.value = ''
    error.value = false
})

function onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value
    code.value = recovery.value ? value : value.replace(/\D/g, '').slice(0, 10)
    if (error.value) error.value = false
    if (!recovery.value && code.value.length === autoSubmitLength && !busy.value) void verify()
}

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
                await nextTick()
                input.value?.focus()
                return
            }
            emit('verified', (await additionalAuth.verifyFactor(props.factor.id, activeChallenge, code.value)).redirect)
        }
    } catch {
        error.value = true
        code.value = ''
        await nextTick()
        input.value?.focus()
    } finally {
        busy.value = false
    }
}
</script>

<template>
    <form class="space-y-3" :aria-busy="busy" @submit.prevent="verify">
        <div v-if="showInput" class="space-y-1.5">
            <label :for="inputId" class="block text-sm font-bold text-gray-700">{{ $t(recovery ? 'auth.recovery_code' : 'auth.verification_code') }}</label>
            <input :id="inputId" ref="input" :value="code" required :autofocus="autofocus"
                :pattern="recovery ? undefined : '[0-9]{4,10}'" :inputmode="recovery ? 'text' : 'numeric'"
                :maxlength="recovery ? 128 : 10" autocomplete="one-time-code" spellcheck="false" :disabled="busy"
                :aria-invalid="error" :aria-describedby="error ? errorId : undefined"
                :placeholder="recovery ? undefined : '000000'"
                class="block w-full rounded-xl border bg-white px-4 py-3 text-gray-900 transition-colors duration-200 placeholder:text-gray-300 focus-visible:border-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30 disabled:bg-gray-50"
                :class="[recovery ? 'font-mono text-base' : 'text-center font-mono text-2xl tracking-[0.5em]', error ? 'border-rose-400' : 'border-gray-200']"
                @input="onInput">
            <p v-if="error" :id="errorId" role="alert" class="text-sm font-bold text-rose-700">{{ $t('auth.method_failed') }}</p>
        </div>
        <p v-if="webauthnBlocked" class="text-sm text-gray-600">{{ $t('auth.webauthn_unavailable') }}</p>
        <p v-if="error && !showInput" role="alert" class="text-sm font-bold text-rose-700">{{ $t('auth.method_failed') }}</p>
        <div class="flex flex-wrap items-center gap-2">
            <button type="submit" :disabled="busy || webauthnBlocked"
                class="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-2 text-sm font-black text-white transition-colors duration-200 hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                <svg v-if="busy" class="h-4 w-4 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" class="opacity-25" /><path fill="currentColor" class="opacity-75" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" /></svg>
                {{ $t(!challenge && factor.factor_type === 'phone' ? 'auth.send_code' : 'auth.verify_code') }}
            </button>
            <button v-if="challenge && factor.factor_type === 'phone'" type="button" :disabled="busy"
                class="min-h-11 cursor-pointer rounded-xl px-3 text-sm font-bold text-emerald-700 transition-colors duration-200 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                @click="challenge = undefined">{{ $t('auth.send_again') }}</button>
        </div>
    </form>
</template>
