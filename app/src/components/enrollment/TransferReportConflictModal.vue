<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import RichTextViewer from '@/components/text-editor/RichTextViewer.vue'
import type { SingleLessonTransferConflict } from '@/services/enrollment/SingleLessonTransferConflictService'
import type { TransferConflictDisplayContext } from '@/services/enrollment/EnrollmentTransferQueryService'
import {
    TRANSFER_REPORT_FIELDS,
    createDefaultTransferFieldSelections,
    transferFieldDiffers,
    type TransferReportField,
    type TransferReportFieldSelections,
    type TransferReportFieldSource
} from '@/services/report/ReportFieldConflictService'
import {
    TransferReportConflictDisplayService,
    type TransferConflictDisplayValue
} from '@/services/report/TransferReportConflictDisplayService'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { copyToClipboard } from '@/utils/clipboard'

const props = defineProps<{
    conflict: SingleLessonTransferConflict
    isResolving?: boolean
}>()

const emit = defineEmits<{
    cancel: []
    resolve: [selections: TransferReportFieldSelections]
}>()

const { t } = useI18n()
const preferences = usePreferencesStore()
const copiedId = ref('')
const selections = ref(createDefaultTransferFieldSelections(
    props.conflict.sourceReport,
    props.conflict.targetReport
))

watch(() => props.conflict, conflict => {
    selections.value = createDefaultTransferFieldSelections(conflict.sourceReport, conflict.targetReport)
}, { deep: false })

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

const differingFields = computed(() => TRANSFER_REPORT_FIELDS.filter(field =>
    transferFieldDiffers(props.conflict.sourceReport, props.conflict.targetReport, field)
))

const sourceHeading = computed(() => TransferReportConflictDisplayService.formatContext(
    props.conflict.sourceContext,
    preferences.locale,
    preferences.timeZone,
    t
))
const targetHeading = computed(() => TransferReportConflictDisplayService.formatContext(
    props.conflict.targetContext,
    preferences.locale,
    preferences.timeZone,
    t
))

const comparisonRows = computed(() => differingFields.value.map(field => ({
    field,
    source: displayValue(props.conflict.sourceReport, props.conflict.sourceContext, field),
    target: displayValue(props.conflict.targetReport, props.conflict.targetContext, field)
})))

const technicalGroups = computed(() => [
    {
        key: 'source',
        label: t('student.transfer_conflict.source_report'),
        items: technicalItems(props.conflict.sourceReport, props.conflict.sourceContext)
    },
    {
        key: 'target',
        label: t('student.transfer_conflict.target_report'),
        items: technicalItems(props.conflict.targetReport, props.conflict.targetContext)
    }
])

function displayValue(
    report: OccurrenceReportDTO | null,
    context: TransferConflictDisplayContext,
    field: TransferReportField
): TransferConflictDisplayValue {
    return TransferReportConflictDisplayService.formatField(report, context, field, t)
}

function technicalItems(report: OccurrenceReportDTO | null, context: TransferConflictDisplayContext) {
    return [
        { label: t('student.transfer_conflict.report_id'), value: report?.id },
        { label: t('student.transfer_conflict.occurrence_id'), value: context.occurrenceId },
        { label: t('student.transfer_conflict.session_id'), value: context.sessionId },
        { label: t('student.transfer_conflict.classroom_id'), value: context.classroomId },
        { label: t('student.transfer_conflict.lesson_id'), value: context.lessonId },
        { label: t('student.transfer_conflict.enrollment_id'), value: props.conflict.enrollmentId }
    ].filter((item): item is { label: string; value: string } => Boolean(item.value))
}

function selectAll(source: TransferReportFieldSource) {
    differingFields.value.forEach(field => {
        selections.value[field] = source
    })
}

function toneClass(value: TransferConflictDisplayValue): string {
    if (value.kind !== 'text') return 'text-gray-700'
    if (value.tone === 'success') return 'text-emerald-700 bg-emerald-100'
    if (value.tone === 'danger') return 'text-rose-700 bg-rose-100'
    if (value.tone === 'warning') return 'text-amber-700 bg-amber-100'
    return 'text-gray-700'
}

async function copyId(value: string) {
    if (!await copyToClipboard(value)) return
    copiedId.value = value
    window.setTimeout(() => {
        if (copiedId.value === value) copiedId.value = ''
    }, 1600)
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

            <main class="min-h-0 flex-1 space-y-6 overflow-y-auto p-5 sm:p-8">
                <div class="grid gap-3 sm:grid-cols-2">
                    <section class="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
                        <p class="text-xs font-black uppercase tracking-widest text-amber-700">
                            {{ t('student.transfer_conflict.source_report') }}
                        </p>
                        <h3 class="mt-2 text-base font-black text-gray-900">{{ sourceHeading.title }}</h3>
                        <p class="mt-1 text-sm font-bold text-gray-500">{{ sourceHeading.details }}</p>
                    </section>
                    <section class="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
                        <p class="text-xs font-black uppercase tracking-widest text-emerald-700">
                            {{ t('student.transfer_conflict.target_report') }}
                        </p>
                        <h3 class="mt-2 text-base font-black text-gray-900">{{ targetHeading.title }}</h3>
                        <p class="mt-1 text-sm font-bold text-gray-500">{{ targetHeading.details }}</p>
                    </section>
                </div>

                <div v-if="!conflict.sourceReport" data-testid="no-source-report"
                    class="rounded-2xl border border-blue-100 bg-blue-50 p-5 text-sm font-bold leading-relaxed text-blue-800">
                    {{ t('student.transfer_conflict.no_source_report') }}
                </div>

                <template v-else>
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

                    <div class="space-y-4">
                        <section v-for="row in comparisonRows" :key="row.field"
                            class="overflow-hidden rounded-2xl border border-gray-100">
                            <h3 class="bg-gray-50 px-4 py-3 text-sm font-black text-gray-800">
                                {{ t(labels[row.field]) }}
                            </h3>
                            <div class="grid gap-0 sm:grid-cols-2">
                                <label class="cursor-pointer border-b border-gray-100 p-4 sm:border-b-0 sm:border-r"
                                    :class="selections[row.field] === 'source' ? 'bg-amber-50 ring-2 ring-inset ring-amber-400' : ''">
                                    <span class="flex items-center gap-2 text-xs font-black text-amber-700">
                                        <input v-model="selections[row.field]" type="radio" :name="row.field" value="source">
                                        {{ t('student.transfer_conflict.source_report') }}
                                    </span>
                                    <div class="mt-3 min-w-0">
                                        <RichTextViewer v-if="row.source.kind === 'rich'" :content="row.source.content"
                                            :font-scale="preferences.editorFontScale" />
                                        <a v-else-if="row.source.kind === 'link'" :href="row.source.href" target="_blank" rel="noopener noreferrer"
                                            class="block break-words font-bold text-blue-700 underline decoration-blue-300 underline-offset-4">
                                            {{ row.source.text }}<span v-if="row.source.detail" class="block text-xs font-medium text-gray-500">{{ row.source.detail }}</span>
                                        </a>
                                        <div v-else-if="row.source.kind === 'rating'" class="flex items-center gap-2">
                                            <span class="text-amber-400" :aria-label="row.source.text">
                                                <span v-for="star in 5" :key="star" :class="star <= row.source.rating ? '' : 'text-gray-200'">★</span>
                                            </span>
                                            <span class="text-sm font-black text-gray-600">{{ row.source.text }}</span>
                                        </div>
                                        <span v-else class="inline-flex rounded-lg px-2 py-1 text-sm font-bold" :class="toneClass(row.source)">
                                            {{ row.source.text }}
                                        </span>
                                    </div>
                                </label>

                                <label class="cursor-pointer p-4"
                                    :class="selections[row.field] === 'target' ? 'bg-emerald-50 ring-2 ring-inset ring-emerald-400' : ''">
                                    <span class="flex items-center gap-2 text-xs font-black text-emerald-700">
                                        <input v-model="selections[row.field]" type="radio" :name="row.field" value="target">
                                        {{ t('student.transfer_conflict.target_report') }}
                                    </span>
                                    <div class="mt-3 min-w-0">
                                        <RichTextViewer v-if="row.target.kind === 'rich'" :content="row.target.content"
                                            :font-scale="preferences.editorFontScale" />
                                        <a v-else-if="row.target.kind === 'link'" :href="row.target.href" target="_blank" rel="noopener noreferrer"
                                            class="block break-words font-bold text-blue-700 underline decoration-blue-300 underline-offset-4">
                                            {{ row.target.text }}<span v-if="row.target.detail" class="block text-xs font-medium text-gray-500">{{ row.target.detail }}</span>
                                        </a>
                                        <div v-else-if="row.target.kind === 'rating'" class="flex items-center gap-2">
                                            <span class="text-amber-400" :aria-label="row.target.text">
                                                <span v-for="star in 5" :key="star" :class="star <= row.target.rating ? '' : 'text-gray-200'">★</span>
                                            </span>
                                            <span class="text-sm font-black text-gray-600">{{ row.target.text }}</span>
                                        </div>
                                        <span v-else class="inline-flex rounded-lg px-2 py-1 text-sm font-bold" :class="toneClass(row.target)">
                                            {{ row.target.text }}
                                        </span>
                                    </div>
                                </label>
                            </div>
                        </section>
                    </div>
                </template>

                <details data-testid="technical-details" class="rounded-2xl border border-gray-200 bg-gray-50">
                    <summary class="cursor-pointer select-none px-5 py-4 text-sm font-black text-gray-600">
                        {{ t('student.transfer_conflict.technical_details') }}
                    </summary>
                    <div class="grid gap-5 border-t border-gray-200 p-5 sm:grid-cols-2">
                        <section v-for="group in technicalGroups" :key="group.key">
                            <h3 class="text-xs font-black uppercase tracking-widest text-gray-500">{{ group.label }}</h3>
                            <dl class="mt-3 space-y-3">
                                <div v-for="item in group.items" :key="item.label" class="rounded-xl bg-white p-3">
                                    <dt class="text-[10px] font-black uppercase tracking-widest text-gray-400">{{ item.label }}</dt>
                                    <dd class="mt-1 flex items-center gap-2">
                                        <code class="min-w-0 flex-1 break-all text-xs text-gray-600">{{ item.value }}</code>
                                        <button type="button" class="shrink-0 rounded-lg bg-gray-100 px-2 py-1 text-[10px] font-black text-gray-600"
                                            @click="copyId(item.value)">
                                            {{ copiedId === item.value ? t('student.transfer_conflict.copied') : t('student.transfer_conflict.copy_id') }}
                                        </button>
                                    </dd>
                                </div>
                            </dl>
                        </section>
                    </div>
                </details>
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
