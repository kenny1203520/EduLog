<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { OccurrenceLessonTransfer } from '@/services/enrollment/EnrollmentTransferQueryService'
import { DateUtils } from '@/utils/DateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'

defineProps<{
    transfers: OccurrenceLessonTransfer[]
    cancellingTransferId?: string | null
}>()

const emit = defineEmits<{
    open: [transfer: OccurrenceLessonTransfer]
    cancel: [transfer: OccurrenceLessonTransfer]
}>()

const { t } = useI18n()
const preferences = usePreferencesStore()

function destination(transfer: OccurrenceLessonTransfer) {
    const time = [transfer.other_start_time, transfer.other_end_time]
        .map(value => value?.slice(0, 5))
        .filter(Boolean)
        .join('–')
    return t('classroom.lesson_transfer.transferred_out', {
        date: DateUtils.displayDateWithWeekday(transfer.other_occurrence_date, preferences.locale),
        session: transfer.other_session_name || transfer.other_classroom_name || '',
        time
    })
}
</script>

<template>
    <section v-if="transfers.length" class="border-t border-slate-100 px-4 pb-5 pt-4 sm:px-5" aria-labelledby="transferred-out-title">
        <h4 id="transferred-out-title" class="mb-3 text-xs font-black uppercase tracking-wider text-slate-500">
            {{ t('classroom.lesson_transfer.title') }}
        </h4>
        <ul class="space-y-2">
            <li v-for="transfer in transfers" :key="transfer.transfer_id"
                class="flex flex-col gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex min-w-0 items-center gap-3">
                    <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-200 font-black text-slate-600" aria-hidden="true">
                        {{ transfer.student_name.trim().charAt(0) || '?' }}
                    </div>
                    <p class="min-w-0 break-words text-sm text-slate-600">
                        <span class="font-black text-slate-700">{{ transfer.student_name }}</span>
                        <span class="ml-1">{{ destination(transfer) }}</span>
                    </p>
                </div>
                <div class="flex shrink-0 gap-2">
                    <button type="button"
                        class="min-h-[44px] cursor-pointer rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        @click="emit('open', transfer)">
                        {{ t('classroom.lesson_transfer.open_target') }}
                    </button>
                    <button v-if="transfer.can_cancel" type="button" :disabled="cancellingTransferId === transfer.transfer_id"
                        class="min-h-[44px] cursor-pointer rounded-xl border border-rose-200 bg-white px-3 text-xs font-black text-rose-700 transition-colors hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
                        @click="emit('cancel', transfer)">
                        {{ t('student.transfer_history.cancel_transfer') }}
                    </button>
                </div>
            </li>
        </ul>
    </section>
</template>
