<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from '@/components/ui/AppDialog.vue'
import FactorChallenge from '../FactorChallenge.vue'
import RecoveryCodesPanel from './RecoveryCodesPanel.vue'
import MethodIcon from './MethodIcon.vue'
import { ui } from './styles'
import { copyToClipboard } from '@/utils/clipboard'
import { additionalAuth, type EnrollableFactor, type Factor, type TotpEnrollment } from '@/services/auth/AdditionalAuthService'

/**
 * Step-by-step authenticator setup. A factor that was created but not
 * verified is deleted whenever the dialog closes or unmounts, so an
 * abandoned setup never lingers as an unusable authenticator.
 */
const props = defineProps<{ type: EnrollableFactor; offerRecoveryCodes: boolean }>()
const emit = defineEmits<{ close: [changed: boolean] }>()
const { t } = useI18n()

type Step = 'details' | 'verify' | 'done'
const step = ref<Step>('details')
const name = ref('')
const phone = ref('')
const factor = ref<Factor>()
const totp = ref<TotpEnrollment>()
const verified = ref(false)
const busy = ref(false)
const failed = ref(false)
const codes = ref<string[]>([])
const codesSaved = ref(false)
const secretCopied = ref(false)
const nameId = useId()
const phoneId = useId()
const touch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches

const steps: Step[] = ['details', 'verify', 'done']
const stepIndex = computed(() => steps.indexOf(step.value))
const factorLabel = computed(() => t(`auth.factor_${props.type}`))
/** GoTrue returns raw SVG markup; wrap it as a data URI so it renders through <img> (never as live markup). */
const qrSource = computed(() => {
    const value = totp.value?.qr_code?.trim()
    if (!value) return ''
    return value.startsWith('data:') ? value : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`
})
const groupedSecret = computed(() => totp.value?.secret.match(/.{1,4}/g)?.join(' ') ?? '')
const canClose = computed(() => !codes.value.length || codesSaved.value)

async function start() {
    busy.value = true
    failed.value = false
    try {
        const result = await additionalAuth.enrollFactor(props.type, { phone: phone.value, friendlyName: name.value })
        factor.value = { id: result.id, factor_type: props.type, status: 'unverified', friendly_name: name.value.trim() || null, can_verify: true }
        totp.value = result.totp
        step.value = 'verify'
    } catch {
        failed.value = true
    } finally {
        busy.value = false
    }
}

async function onVerified() {
    verified.value = true
    step.value = 'done'
    if (!props.offerRecoveryCodes) return
    try {
        codes.value = (await additionalAuth.generateRecoveryCodes(false)).codes ?? []
    } catch {
        codes.value = []
    }
}

async function copySecret() {
    if (totp.value) secretCopied.value = await copyToClipboard(totp.value.secret)
}

let discarded = false
function discardUnverified() {
    if (discarded || verified.value || !factor.value) return
    discarded = true
    void additionalAuth.removeFactor(factor.value.id).catch(() => undefined)
}
function close() {
    if (!canClose.value) return
    discardUnverified()
    emit('close', verified.value)
}
onBeforeUnmount(discardUnverified)
</script>

<template>
    <AppDialog open :title="$t('auth.enroll_title', { method: factorLabel })" :description="$t(`auth.enroll_intro_${type}`)"
        :dismissible="canClose" @close="close">
        <ol class="mb-6 flex items-center gap-2" :aria-label="$t('auth.enroll_progress')">
            <li v-for="(item, index) in steps" :key="item" class="flex flex-1 items-center gap-2" :aria-current="index === stepIndex ? 'step' : undefined">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black transition-colors duration-200"
                    :class="index < stepIndex ? 'bg-emerald-600 text-white' : index === stepIndex ? 'bg-emerald-100 text-emerald-800 ring-2 ring-emerald-600' : 'bg-gray-100 text-gray-500'">
                    <svg v-if="index < stepIndex" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0z" clip-rule="evenodd" /></svg>
                    <template v-else>{{ index + 1 }}</template>
                </span>
                <span class="hidden text-xs font-bold sm:inline" :class="index === stepIndex ? 'text-gray-900' : 'text-gray-500'">{{ $t(`auth.enroll_step_${item}`) }}</span>
                <span v-if="index < steps.length - 1" class="h-px flex-1 bg-gray-200" aria-hidden="true" />
            </li>
        </ol>

        <form v-if="step === 'details'" class="space-y-4" @submit.prevent="start">
            <div>
                <label :for="nameId" :class="ui.label">{{ $t('auth.authenticator_name') }}</label>
                <input :id="nameId" v-model="name" data-autofocus maxlength="120" autocomplete="off" :placeholder="$t(`auth.authenticator_name_placeholder_${type}`)" :class="ui.input">
                <p class="mt-1 text-xs text-gray-500">{{ $t('auth.authenticator_name_hint') }}</p>
            </div>
            <div v-if="type === 'phone'">
                <label :for="phoneId" :class="ui.label">{{ $t('auth.phone') }}</label>
                <input :id="phoneId" v-model="phone" type="tel" required autocomplete="tel" pattern="[+][1-9][0-9]{7,14}" placeholder="+886912345678" :class="ui.input">
            </div>
            <p v-if="failed" role="alert" :class="ui.alert">{{ $t('auth.method_failed') }}</p>
            <div class="flex flex-wrap justify-end gap-2 pt-2">
                <button type="button" :class="ui.ghost" @click="close">{{ $t('common.cancel') }}</button>
                <button type="submit" :class="ui.primary" :disabled="busy">{{ $t('auth.enroll_continue') }}</button>
            </div>
        </form>

        <div v-else-if="step === 'verify' && factor" class="space-y-5">
            <template v-if="totp">
                <div class="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                    <div class="shrink-0 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
                        <img v-if="qrSource" :src="qrSource" :alt="$t('auth.qr_alt')" width="176" height="176" class="h-44 w-44">
                        <div v-else class="flex h-44 w-44 items-center justify-center text-gray-300"><MethodIcon name="qr" /></div>
                    </div>
                    <div class="min-w-0 flex-1 space-y-3 text-sm text-gray-700">
                        <p class="font-bold text-gray-900">{{ $t('auth.scan_qr') }}</p>
                        <p>{{ $t('auth.scan_qr_hint') }}</p>
                        <a v-if="touch && totp.uri" :href="totp.uri" :class="ui.secondary">{{ $t('auth.open_in_authenticator') }}</a>
                        <details class="group rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 open:pb-3">
                            <summary class="flex min-h-9 cursor-pointer list-none items-center gap-2 font-bold text-emerald-800 [&::-webkit-details-marker]:hidden">
                                <svg class="h-4 w-4 transition-transform duration-200 group-open:rotate-90 motion-reduce:transition-none" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7.3 4.3a1 1 0 0 1 1.4 0l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4-1.4L11.6 10 7.3 5.7a1 1 0 0 1 0-1.4z" clip-rule="evenodd" /></svg>
                                {{ $t('auth.cant_scan') }}
                            </summary>
                            <p class="mt-2 text-xs text-gray-600">{{ $t('auth.totp_secret') }}</p>
                            <div class="mt-2 flex flex-wrap items-center gap-2">
                                <code translate="no" class="select-all rounded-lg bg-white px-3 py-2 font-mono text-sm tracking-wider text-gray-900 shadow-sm">{{ groupedSecret }}</code>
                                <button type="button" :class="ui.secondary" @click="copySecret">{{ $t(secretCopied ? 'auth.copied' : 'auth.copy_secret') }}</button>
                            </div>
                        </details>
                    </div>
                </div>
            </template>
            <p v-else-if="type === 'webauthn'" class="text-sm text-gray-700">{{ $t('auth.webauthn_prompt') }}</p>
            <div class="border-t border-gray-100 pt-5">
                <FactorChallenge :factor="factor" autofocus @verified="onVerified" />
            </div>
            <div class="flex justify-end">
                <button type="button" :class="ui.ghost" @click="close">{{ $t('common.cancel') }}</button>
            </div>
        </div>

        <div v-else class="space-y-5">
            <div class="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-900">
                <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white"><MethodIcon name="shield" /></span>
                <p class="font-bold">{{ $t('auth.enroll_success', { method: name.trim() || factorLabel }) }}</p>
            </div>
            <template v-if="codes.length">
                <h3 class="font-black">{{ $t('auth.recovery_codes_title') }}</h3>
                <RecoveryCodesPanel v-model:saved="codesSaved" :codes="codes" />
            </template>
            <div class="flex justify-end">
                <button type="button" :class="ui.primary" :disabled="!canClose" @click="close">{{ $t('auth.enroll_finish') }}</button>
            </div>
        </div>
    </AppDialog>
</template>
