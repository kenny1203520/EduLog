<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EnrollmentService } from '@/services/enrollment/EnrollmentService'
import type { SingleLessonTransferHistoryItem } from '@/services/enrollment/EnrollmentTransferQueryService'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/DateUtils'
import { domainErrorCode, mapDomainError } from '@/services/errors/mapDomainError'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import { mapSupabaseError } from '@/services/errors/mapSupabaseError'

const props = defineProps<{
    isOpen: boolean
    enrollmentId: string | null
}>()

const emit = defineEmits<{ 'update:isOpen': [value: boolean]; changed: [] }>()
const { t } = useI18n()

// Never show a raw thrown message: a recognized domain sentinel code gets its
// specific translation, anything else falls back to the call site's generic,
// translated description.
function describeError(cause: unknown, fallbackKey: string): string {
    const message = cause instanceof Error ? cause.message : undefined
    const domain = mapDomainError(domainErrorCode(cause))
    if (domain) return t(domain.i18nKey)
    if (message) return t(fallbackKey)
    return t(mapSupabaseError(cause).i18nKey)
}

const preferences = usePreferencesStore()
const history = ref<SingleLessonTransferHistoryItem[]>([])
const isLoading = ref(false)
const error = ref<string | null>(null)
const effectiveTargets = ref<Array<{ transfer_id: string; target_occurrence_id: string; is_effective_target: boolean; target_report_id: string | null }>>([])
const repairingTransferId = ref<string | null>(null)
const pendingCancel = ref<SingleLessonTransferHistoryItem | null>(null)
const isCancelling = ref(false)
const notice = ref<string | null>(null)

const activeHistory = computed(() => history.value.filter(item => !item.cancelled_at))
const closedHistory = computed(() => history.value.filter(item => item.cancelled_at))

function close() {
    emit('update:isOpen', false)
}

function formatDate(value: string) {
    return DateUtils.displayDate(value, preferences.locale, preferences.timeZone)
}

function formatDateTime(value: string) {
    return DateUtils.displayDateTime(value, preferences.locale, preferences.timeZone)
}

function formatTime(start: string | null, end: string | null) {
    const display = (value: string | null) => value?.slice(0, 5) || ''
    return [display(start), display(end)].filter(Boolean).join(' – ') || '-'
}

function occurrenceTitle(item: SingleLessonTransferHistoryItem, side: 'source' | 'target') {
    const prefix = side === 'source' ? 'source' : 'target'
    const session = item[`${prefix}_session_name` as keyof SingleLessonTransferHistoryItem] as string | null
    const classroom = item[`${prefix}_classroom_name` as keyof SingleLessonTransferHistoryItem] as string | null
    return [item.course_display_name, session, classroom].filter(Boolean).join(' · ') || '-'
}

function occurrenceDate(item: SingleLessonTransferHistoryItem, side: 'source' | 'target') {
    const prefix = side === 'source' ? 'source' : 'target'
    return item[`${prefix}_occurrence_date` as keyof SingleLessonTransferHistoryItem] as string
}

function occurrenceTime(item: SingleLessonTransferHistoryItem, side: 'source' | 'target') {
    const prefix = side === 'source' ? 'source' : 'target'
    return formatTime(
        item[`${prefix}_start_time` as keyof SingleLessonTransferHistoryItem] as string | null,
        item[`${prefix}_end_time` as keyof SingleLessonTransferHistoryItem] as string | null
    )
}

function effectiveTargetFor(item: SingleLessonTransferHistoryItem) {
    return effectiveTargets.value.find(target => target.transfer_id === item.id && target.is_effective_target)
}

function isMissingTargetReport(item: SingleLessonTransferHistoryItem) {
    return effectiveTargetFor(item)?.target_report_id === null
}

async function repairTargetReport(item: SingleLessonTransferHistoryItem) {
    const target = effectiveTargetFor(item)
    if (!props.enrollmentId || !target || target.target_report_id || repairingTransferId.value) return
    repairingTransferId.value = item.id
    try {
        await EnrollmentService.repairSingleLessonTransferReport(props.enrollmentId, target.target_occurrence_id)
        await loadHistory()
    } catch (cause) {
        error.value = describeError(cause, 'student.transfer_history.repair_error')
    } finally {
        repairingTransferId.value = null
    }
}

function requestCancel(item: SingleLessonTransferHistoryItem) {
    error.value = null
    notice.value = null
    pendingCancel.value = item
}

async function confirmCancel() {
    const item = pendingCancel.value
    if (!item || isCancelling.value) return
    isCancelling.value = true
    try {
        const result = await EnrollmentService.cancelSingleLessonTransfer(item.id)
        notice.value = t(result.targetReportRetained
            ? 'student.transfer_history.cancelled_target_retained'
            : 'student.transfer_history.cancelled')
        pendingCancel.value = null
        emit('changed')
        await loadHistory()
    } catch (cause) {
        pendingCancel.value = null
        error.value = describeError(cause, 'student.transfer_history.cancel_error')
    } finally {
        isCancelling.value = false
    }
}

async function loadHistory() {
    if (!props.enrollmentId) return
    isLoading.value = true
    error.value = null
    try {
        const [historyItems, targets] = await Promise.all([
            EnrollmentService.getSingleLessonTransferHistory(props.enrollmentId),
            EnrollmentService.getEffectiveSingleLessonTransferTargets(props.enrollmentId)
        ])
        history.value = historyItems
        effectiveTargets.value = targets
    } catch (cause) {
        error.value = describeError(cause, 'student.transfer_history.load_error')
    } finally {
        isLoading.value = false
    }
}

watch(() => [props.isOpen, props.enrollmentId], ([isOpen]) => {
    if (isOpen) void loadHistory()
}, { immediate: true })
</script>

<template>
    <Teleport to="body">
        <div v-if="isOpen" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            @click.self="close">
            <section class="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
                role="dialog" aria-modal="true" aria-labelledby="transfer-history-title">
                <header class="flex items-center justify-between border-b border-gray-100 bg-gray-50/70 px-5 py-4 sm:px-6">
                    <div class="flex items-center gap-3">
                        <div class="rounded-xl bg-amber-50 p-2.5 text-amber-600">
                            <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div>
                            <h3 id="transfer-history-title" class="text-xl font-black tracking-tight text-gray-900">{{ $t('student.transfer_history.title') }}</h3>
                            <p class="mt-0.5 text-sm font-medium text-gray-500">{{ $t('student.transfer_history.subtitle') }}</p>
                        </div>
                    </div>
                    <button type="button" class="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700" :aria-label="$t('common.close')" @click="close">
                        <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18 18 6M6 6l12 12" /></svg>
                    </button>
                </header>

                <main class="flex-1 overflow-y-auto bg-gray-50/40 p-5 sm:p-6">
                    <p v-if="notice" role="status" class="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{{ notice }}</p>
                    <div v-if="isLoading" class="flex flex-col items-center justify-center py-16 text-gray-500">
                        <svg class="mb-3 h-8 w-8 animate-spin text-emerald-500" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" /><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        <span class="text-sm font-bold">{{ $t('student.transfer_history.loading') }}</span>
                    </div>

                    <div v-else-if="error" class="mx-auto max-w-md rounded-2xl border border-rose-100 bg-rose-50 p-6 text-center">
                        <p class="font-bold text-rose-700">{{ $t('student.transfer_history.load_error') }}</p>
                        <p class="mt-1 break-words text-sm text-rose-600">{{ error }}</p>
                        <button type="button" class="mt-4 rounded-xl bg-rose-600 px-4 py-2 text-sm font-black text-white hover:bg-rose-700" @click="loadHistory">{{ $t('student.transfer_history.retry') }}</button>
                    </div>

                    <div v-else-if="history.length === 0" class="flex flex-col items-center justify-center py-16 text-center text-gray-400">
                        <svg class="mb-3 h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8v4l3 3m7-3a10 10 0 11-20 0 10 10 0 0120 0z" /></svg>
                        <p class="font-bold">{{ $t('student.transfer_history.empty') }}</p>
                    </div>

                    <div v-else class="space-y-8">
                        <section v-if="activeHistory.length" aria-labelledby="active-transfer-history">
                            <h4 id="active-transfer-history" class="mb-3 flex items-center gap-2 text-sm font-black text-emerald-700"><span class="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />{{ $t('student.transfer_history.active') }}</h4>
                            <div class="space-y-3">
                                <article v-for="item in activeHistory" :key="item.id" class="relative overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
                                    <div class="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
                                    <div class="p-4 pl-5 sm:p-5 sm:pl-6">
                                        <div class="mb-4 flex flex-wrap items-center justify-between gap-2"><span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">{{ $t('student.transfer_history.active') }}</span><span class="text-xs font-semibold text-gray-500">{{ $t('student.transfer_history.created_at', { date: formatDateTime(item.created_at) }) }}</span></div>
                                        <div class="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
                                            <div class="rounded-xl bg-gray-50 p-3"><p class="text-[11px] font-black uppercase tracking-wider text-gray-400">{{ $t('student.transfer_history.source') }}</p><p class="mt-1 font-bold text-gray-900">{{ occurrenceTitle(item, 'source') }}</p><p class="mt-1 text-sm text-gray-500">{{ formatDate(occurrenceDate(item, 'source')) }} · {{ occurrenceTime(item, 'source') }}</p></div>
                                            <div class="flex items-center justify-center text-amber-500"><svg class="h-6 w-6 rotate-90 sm:rotate-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 12h14m-5-5 5 5-5 5" /></svg></div>
                                            <div class="rounded-xl bg-emerald-50/70 p-3"><p class="text-[11px] font-black uppercase tracking-wider text-emerald-600">{{ $t('student.transfer_history.target') }}</p><p class="mt-1 font-bold text-gray-900">{{ occurrenceTitle(item, 'target') }}</p><p class="mt-1 text-sm text-gray-500">{{ formatDate(occurrenceDate(item, 'target')) }} · {{ occurrenceTime(item, 'target') }}</p></div>
                                        </div>
                                        <div class="mt-4 flex flex-wrap items-center justify-end gap-3">
                                            <template v-if="effectiveTargetFor(item)">
                                            <span v-if="!isMissingTargetReport(item)" class="text-xs font-bold text-emerald-700">{{ $t('student.transfer_history.report_exists') }}</span>
                                            <template v-else>
                                                <span class="text-xs font-bold text-amber-700">{{ $t('student.transfer_history.report_missing') }}</span>
                                                <button type="button" :disabled="repairingTransferId === item.id" @click="repairTargetReport(item)"
                                                    class="rounded-xl bg-amber-500 px-3 py-2 text-xs font-black text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60">
                                                    {{ repairingTransferId === item.id ? $t('student.transfer_history.repairing') : $t('student.transfer_history.repair_report') }}
                                                </button>
                                            </template>
                                            </template>
                                            <button type="button" :disabled="isCancelling" @click="requestCancel(item)"
                                                class="cursor-pointer rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-60">
                                                {{ $t('student.transfer_history.cancel_transfer') }}
                                            </button>
                                        </div>
                                    </div>
                                </article>
                            </div>
                        </section>

                        <section v-if="closedHistory.length" aria-labelledby="closed-transfer-history">
                            <h4 id="closed-transfer-history" class="mb-3 flex items-center gap-2 text-sm font-black text-gray-600"><span class="h-2 w-2 rounded-full bg-gray-400" />{{ $t('student.transfer_history.closed') }}</h4>
                            <div class="space-y-3">
                                <article v-for="item in closedHistory" :key="item.id" class="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm opacity-90">
                                    <div class="absolute inset-y-0 left-0 w-1 bg-gray-300" />
                                    <div class="p-4 pl-5 sm:p-5 sm:pl-6">
                                        <div class="mb-4 flex flex-wrap items-center justify-between gap-2"><span class="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-black text-gray-600">{{ $t('student.transfer_history.closed') }}</span><span class="text-xs font-semibold text-gray-500">{{ $t('student.transfer_history.closed_at', { date: formatDateTime(item.cancelled_at!) }) }}</span></div>
                                        <div class="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
                                            <div class="rounded-xl bg-gray-50 p-3"><p class="text-[11px] font-black uppercase tracking-wider text-gray-400">{{ $t('student.transfer_history.source') }}</p><p class="mt-1 font-bold text-gray-800">{{ occurrenceTitle(item, 'source') }}</p><p class="mt-1 text-sm text-gray-500">{{ formatDate(occurrenceDate(item, 'source')) }} · {{ occurrenceTime(item, 'source') }}</p></div>
                                            <div class="flex items-center justify-center text-gray-400"><svg class="h-6 w-6 rotate-90 sm:rotate-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 12h14m-5-5 5 5-5 5" /></svg></div>
                                            <div class="rounded-xl bg-gray-50 p-3"><p class="text-[11px] font-black uppercase tracking-wider text-gray-400">{{ $t('student.transfer_history.target') }}</p><p class="mt-1 font-bold text-gray-800">{{ occurrenceTitle(item, 'target') }}</p><p class="mt-1 text-sm text-gray-500">{{ formatDate(occurrenceDate(item, 'target')) }} · {{ occurrenceTime(item, 'target') }}</p></div>
                                        </div>
                                    </div>
                                </article>
                            </div>
                        </section>
                    </div>
                </main>
            </section>
        </div>
    </Teleport>
    <ConfirmModal
        :is-open="pendingCancel !== null"
        :title="$t('student.transfer_history.cancel_confirm_title')"
        :message="pendingCancel ? $t('student.transfer_history.cancel_confirm_message', {
            source: DateUtils.displayDateWithWeekday(pendingCancel.source_occurrence_date, preferences.locale),
            target: DateUtils.displayDateWithWeekday(pendingCancel.target_occurrence_date, preferences.locale)
        }) : ''"
        :confirm-text="$t('student.transfer_history.cancel_transfer')"
        :cancel-text="$t('student.transfer_history.keep_transfer')"
        :is-dangerous="true"
        :is-loading="isCancelling"
        stacked
        @confirm="confirmCancel"
        @close="pendingCancel = null"
    />
</template>
