<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import type { SingleLessonTransferConflict } from '@/services/enrollment/SingleLessonTransferConflictService'
import {
    TRANSFER_REPORT_FIELDS,
    createDefaultTransferFieldSelections,
    transferFieldDiffers,
    type TransferReportField,
    type TransferReportFieldSelections,
    type TransferReportFieldSource
} from '@/services/report/ReportFieldConflictService'

const props = defineProps<{
    conflict: SingleLessonTransferConflict
    isResolving?: boolean
}>()

const emit = defineEmits<{
    cancel: []
    resolve: [selections: TransferReportFieldSelections]
}>()

const { t } = useI18n()
const selections = ref(createDefaultTransferFieldSelections(
    props.conflict.sourceReport,
    props.conflict.targetReport
))

watch(() => props.conflict, conflict => {
    selections.value = createDefaultTransferFieldSelections(conflict.sourceReport, conflict.targetReport)
}, { deep: false })

const differingFields = computed(() => TRANSFER_REPORT_FIELDS.filter(field =>
    transferFieldDiffers(props.conflict.sourceReport, props.conflict.targetReport, field)
))

const labels: Record<TransferReportField, string> = {
    lesson_id: 'report.fields.lesson_name',
    is_completed: 'report.fields.is_completed',
    progress_letter: 'report.fields.progress_letter',
    attendance: 'report.fields.attendance_status',
    class_participation: 'report.fields.class_participation',
    classroom_behavior: 'report.fields.classroom_behavior',
    contact_notes: 'report.fields.contact_notes',
    class_notes: 'report.fields.class_notes',
    content: 'report.fields.content',
    external_link: 'report.fields.external_link'
}

function selectAll(source: TransferReportFieldSource) {
    differingFields.value.forEach(field => {
        selections.value[field] = source
    })
}

function valueFor(report: OccurrenceReportDTO | null, field: TransferReportField): string {
    if (!report) return t('report.conflict.empty')
    let value: unknown
    if (field === 'attendance') {
        value = report.attendance_status === 'absent' && report.absence_reason
            ? `${report.attendance_status}: ${report.absence_reason}`
            : report.attendance_status
    } else {
        value = report[field as keyof OccurrenceReportDTO]
    }
    if (typeof value === 'boolean') {
        return value
            ? t('report.conflict.is_completed.yes')
            : t('report.conflict.is_completed.no')
    }
    if (value === null || value === undefined || value === '') return t('report.conflict.empty')
    return String(value)
}

function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !props.isResolving) emit('cancel')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
    <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-md"
        @click.self="!isResolving && emit('cancel')">
        <div class="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[2rem] bg-white shadow-2xl">
            <header class="border-b border-amber-100 bg-amber-50 p-6 sm:p-8">
                <h2 class="text-2xl font-black text-gray-900">{{ t('student.transfer_conflict.title') }}</h2>
                <p class="mt-2 text-sm font-bold leading-relaxed text-amber-800/70">
                    {{ t('student.transfer_conflict.description') }}
                </p>
            </header>

            <main class="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-8">
                <div class="flex flex-wrap gap-2">
                    <button type="button" class="rounded-xl bg-amber-600 px-4 py-2 text-xs font-black text-white"
                        @click="selectAll('source')">
                        {{ t('student.transfer_conflict.use_all_source') }}
                    </button>
                    <button type="button" class="rounded-xl bg-gray-100 px-4 py-2 text-xs font-black text-gray-600"
                        @click="selectAll('target')">
                        {{ t('student.transfer_conflict.keep_all_target') }}
                    </button>
                </div>

                <div v-if="differingFields.length" class="space-y-4">
                    <section v-for="field in differingFields" :key="field"
                        class="overflow-hidden rounded-2xl border border-gray-100">
                        <h3 class="bg-gray-50 px-4 py-3 text-sm font-black text-gray-800">
                            {{ t(labels[field]) }}
                        </h3>
                        <div class="grid gap-0 sm:grid-cols-2">
                            <label class="cursor-pointer border-b border-gray-100 p-4 sm:border-b-0 sm:border-r"
                                :class="selections[field] === 'source' ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : ''">
                                <span class="flex items-center gap-2 text-xs font-black text-amber-700">
                                    <input v-model="selections[field]" type="radio" :name="field" value="source">
                                    {{ t('student.transfer_conflict.source_report') }}
                                </span>
                                <pre class="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-gray-700">{{ valueFor(conflict.sourceReport, field) }}</pre>
                            </label>
                            <label class="cursor-pointer p-4"
                                :class="selections[field] === 'target' ? 'bg-emerald-50 ring-2 ring-inset ring-emerald-400' : ''">
                                <span class="flex items-center gap-2 text-xs font-black text-emerald-700">
                                    <input v-model="selections[field]" type="radio" :name="field" value="target">
                                    {{ t('student.transfer_conflict.target_report') }}
                                </span>
                                <pre class="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-sm text-gray-700">{{ valueFor(conflict.targetReport, field) }}</pre>
                            </label>
                        </div>
                    </section>
                </div>
            </main>

            <footer class="flex gap-3 border-t border-gray-100 bg-gray-50 p-5 sm:p-7">
                <button type="button" class="flex-1 rounded-2xl px-5 py-4 font-black text-gray-500"
                    :disabled="isResolving" @click="emit('cancel')">
                    {{ t('student.transfer_conflict.cancel_transfer') }}
                </button>
                <button type="button" class="flex-1 rounded-2xl bg-amber-600 px-5 py-4 font-black text-white disabled:opacity-50"
                    :disabled="isResolving" @click="emit('resolve', selections)">
                    {{ isResolving ? t('common.loading') : t('student.transfer_conflict.confirm') }}
                </button>
            </footer>
        </div>
    </div>
</template>
