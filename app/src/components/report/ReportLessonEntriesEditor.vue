<template>
    <section class="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4" :aria-labelledby="`${editorId}-title`">
        <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
                <h3 :id="`${editorId}-title`" class="text-sm font-semibold text-gray-800">
                    {{ $t('report.editor.lesson_entries.title') }}
                </h3>
                <p class="mt-1 text-xs text-gray-600">{{ $t('report.editor.lesson_entries.description') }}</p>
            </div>
            <button
                type="button"
                :disabled="disabled"
                class="inline-flex min-h-11 items-center rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                @click="addEntry"
            >
                {{ $t('report.editor.lesson_entries.add') }}
            </button>
        </div>

        <p v-if="optionsLoading" class="mb-3 text-sm text-gray-600" role="status">
            {{ $t('report.editor.lesson_entries.loading') }}
        </p>
        <div v-if="optionsError" class="mb-3 rounded-md border border-red-200 bg-white p-3 text-sm text-red-700" role="alert">
            <span>{{ optionsError }}</span>
            <button type="button" class="ml-2 min-h-11 px-2 font-semibold underline focus-visible:outline focus-visible:outline-2" @click="$emit('retry-options')">
                {{ $t('report.editor.progress_check.retry') }}
            </button>
        </div>

        <div v-if="!entries.length" class="rounded-lg border border-dashed border-amber-300 bg-white/70 p-4 text-sm text-gray-600">
            {{ $t('report.editor.lesson_entries.empty') }}
        </div>

        <fieldset
            v-for="(entry, index) in entries"
            :key="entry.id"
            class="mb-3 min-w-0 rounded-lg border border-amber-200 bg-white p-3 last:mb-0"
        >
            <legend class="max-w-full px-1 text-sm font-semibold text-gray-800">
                {{ $t('report.editor.lesson_entries.entry_heading', { index: index + 1 }) }}
                <span v-if="courseName(entry)" class="font-normal text-gray-600">· {{ courseName(entry) }}</span>
            </legend>

            <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <div class="min-w-0">
                    <label :for="fieldId(entry.id, 'course')" class="mb-1 block text-xs font-medium text-gray-700">
                        {{ $t('report.editor.lesson_entries.course') }}
                    </label>
                    <select
                        :id="fieldId(entry.id, 'course')"
                        :name="fieldId(entry.id, 'course')"
                        :value="entry.enrollment_id"
                        required
                        :aria-invalid="isEntryIncomplete(entry)"
                        :aria-describedby="isEntryIncomplete(entry) ? fieldId(entry.id, 'required') : undefined"
                        :disabled="disabled || optionsLoading"
                        class="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-gray-100"
                        @change="changeEnrollment(entry, ($event.target as HTMLSelectElement).value)"
                    >
                        <option value="" disabled>{{ $t('report.editor.lesson_entries.select_course') }}</option>
                        <option v-for="option in enrollmentOptions" :key="option.id" :value="option.id">
                            {{ option.course_name }}
                        </option>
                    </select>
                </div>
                <div class="min-w-0">
                    <label :for="fieldId(entry.id, 'lesson')" class="mb-1 block text-xs font-medium text-gray-700">
                        {{ $t('report.editor.lesson_label') }}
                    </label>
                    <select
                        :id="fieldId(entry.id, 'lesson')"
                        :name="fieldId(entry.id, 'lesson')"
                        :value="entry.lesson_id || ''"
                        required
                        :aria-invalid="isEntryIncomplete(entry)"
                        :aria-describedby="isEntryIncomplete(entry) ? fieldId(entry.id, 'required') : undefined"
                        :disabled="disabled || !lessonsFor(entry).length"
                        class="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-gray-100"
                        @change="changeLesson(entry, ($event.target as HTMLSelectElement).value)"
                    >
                        <option value="">{{ $t('report.editor.select_lesson') }}</option>
                        <option v-for="lesson in lessonsFor(entry)" :key="lesson.id" :value="lesson.id">
                            {{ $t('report.editor.progress_check.lesson', { sequence: lesson.sequence, title: lesson.title }) }}
                        </option>
                    </select>
                    <p v-if="isEntryIncomplete(entry)" :id="fieldId(entry.id, 'required')" class="mt-1 text-xs font-medium text-red-700" role="status">
                        {{ $t('report.editor.lesson_entries.select_lesson_required') }}
                    </p>
                </div>
            </div>

            <div class="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                <div class="min-w-0">
                    <label :for="fieldId(entry.id, 'start')" class="mb-1 block text-xs font-medium text-gray-700">
                        {{ $t('report.editor.progress_start_label') }}
                    </label>
                    <select
                        :id="fieldId(entry.id, 'start')"
                        :name="fieldId(entry.id, 'start')"
                        :value="progressStart(entry)"
                        :disabled="disabled"
                        class="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-gray-100"
                        @change="changeProgress(entry, 'start', ($event.target as HTMLSelectElement).value)"
                    >
                        <option value="">{{ $t('report.editor.select_progress') }}</option>
                        <option v-for="letter in letters" :key="letter" :value="letter">{{ letter }}</option>
                    </select>
                </div>
                <div class="min-w-0">
                    <label :for="fieldId(entry.id, 'end')" class="mb-1 block text-xs font-medium text-gray-700">
                        {{ $t('report.editor.progress_end_label') }}
                    </label>
                    <select
                        :id="fieldId(entry.id, 'end')"
                        :name="fieldId(entry.id, 'end')"
                        :value="progressEnd(entry)"
                        :disabled="disabled"
                        class="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-gray-100"
                        @change="changeProgress(entry, 'end', ($event.target as HTMLSelectElement).value)"
                    >
                        <option value="">{{ $t('report.editor.select_progress') }}</option>
                        <option v-for="letter in letters" :key="letter" :value="letter">{{ letter }}</option>
                    </select>
                </div>
                <label class="flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-gray-700">
                    <input
                        type="checkbox"
                        :id="fieldId(entry.id, 'completed')"
                        :name="fieldId(entry.id, 'completed')"
                        :checked="entry.is_completed"
                        :disabled="disabled"
                        class="h-5 w-5 rounded border-gray-300 accent-amber-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
                        @change="updateEntry(entry.id, { is_completed: ($event.target as HTMLInputElement).checked })"
                    >
                    <span>{{ $t('report.editor.lesson_completed') }}</span>
                </label>
            </div>

            <div class="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-2">
                <label :for="fieldId(entry.id, 'primary')" class="flex min-h-11 items-center gap-2 px-1 text-sm font-medium text-gray-700">
                    <input
                        type="radio"
                        :id="fieldId(entry.id, 'primary')"
                        :name="`${editorId}-primary-entry`"
                        :checked="entry.id === primaryEntryId"
                        :disabled="disabled"
                        class="h-4 w-4 accent-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                        @change="$emit('update:primaryEntryId', entry.id)"
                    >
                    <span>{{ $t('report.editor.lesson_entries.primary') }}</span>
                </label>
                <button
                    type="button"
                    :disabled="disabled"
                    class="min-h-11 rounded-md px-3 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    @click="removeEntry(entry.id)"
                >
                    {{ $t('report.editor.lesson_entries.remove', { index: index + 1 }) }}
                </button>
            </div>
        </fieldset>
        <span class="sr-only" aria-live="polite">{{ announcement }}</span>
    </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ReportLessonEntryDTO } from '@/models/OccurrenceReport'
import { createLessonEntryId } from '@/models/ReportEditorSnapshot'
import type { LessonEntryOption } from '@/services/report/ReportQueryService'

const props = withDefaults(defineProps<{
    entries: ReportLessonEntryDTO[]
    primaryEntryId: string | null
    editorId: string
    defaultEnrollmentId: string
    defaultCourseName?: string
    defaultLessons?: Array<{ id?: string; sequence?: number; title?: string }>
    options?: LessonEntryOption[]
    optionsLoading?: boolean
    optionsError?: string
    disabled?: boolean
}>(), {
    defaultCourseName: '',
    defaultLessons: () => [],
    options: () => [],
    optionsLoading: false,
    optionsError: '',
    disabled: false,
})

const emit = defineEmits<{
    'update:entries': [entries: ReportLessonEntryDTO[]]
    'update:primaryEntryId': [id: string | null]
    'retry-options': []
}>()

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const { t } = useI18n()
const announcement = ref('')
const enrollmentOptions = computed(() => {
    const options = [...props.options]
    if (props.defaultEnrollmentId && !options.some(option => option.id === props.defaultEnrollmentId)) {
        options.unshift({
            id: props.defaultEnrollmentId,
            course_id: '',
            course_name: props.defaultCourseName,
            lessons: props.defaultLessons.filter((lesson): lesson is { id: string; sequence?: number; title?: string } => Boolean(lesson.id)).map(lesson => ({
                id: lesson.id,
                sequence: lesson.sequence ?? 0,
                title: lesson.title ?? '',
            })),
        })
    }
    return options
})

function fieldId(entryId: string, name: string) {
    return `${props.editorId}-entry-${entryId}-${name}`
}

function optionFor(entry: ReportLessonEntryDTO) {
    return enrollmentOptions.value.find(option => option.id === entry.enrollment_id)
}

function courseName(entry: ReportLessonEntryDTO) {
    return optionFor(entry)?.course_name || entry.course_name || ''
}

function isEntryIncomplete(entry: ReportLessonEntryDTO) {
    return !entry.enrollment_id || !entry.course_id || !entry.lesson_id
}

function lessonsFor(entry: ReportLessonEntryDTO) {
    const lessons = optionFor(entry)?.lessons ?? []
    if (entry.lesson_id && !lessons.some(lesson => lesson.id === entry.lesson_id)) {
        return [...lessons, {
            id: entry.lesson_id,
            sequence: entry.lesson_sequence ?? 0,
            title: entry.lesson_title || '',
        }]
    }
    return lessons
}

function progressStart(entry: ReportLessonEntryDTO) {
    return entry.progress_letter?.split('-')[0] || ''
}

function progressEnd(entry: ReportLessonEntryDTO) {
    return entry.progress_letter?.split('-')[1] || ''
}

function updateEntry(entryId: string, patch: Partial<ReportLessonEntryDTO>) {
    emit('update:entries', props.entries.map(entry => entry.id === entryId ? { ...entry, ...patch } : entry))
}

function changeEnrollment(entry: ReportLessonEntryDTO, enrollmentId: string) {
    const option = enrollmentOptions.value.find(item => item.id === enrollmentId)
    updateEntry(entry.id, {
        enrollment_id: enrollmentId,
        lesson_id: null,
        is_completed: false,
        progress_letter: null,
        course_id: option?.course_id,
        course_name: option?.course_name,
        lesson_sequence: undefined,
        lesson_title: undefined,
    })
}

function changeLesson(entry: ReportLessonEntryDTO, lessonId: string) {
    const lesson = lessonsFor(entry).find(item => item.id === lessonId)
    const option = optionFor(entry)
    updateEntry(entry.id, {
        lesson_id: lessonId || null,
        course_id: option?.course_id,
        course_name: option?.course_name,
        lesson_sequence: lesson?.sequence,
        lesson_title: lesson?.title,
    })
}

function changeProgress(entry: ReportLessonEntryDTO, edge: 'start' | 'end', letter: string) {
    const start = edge === 'start' ? letter : progressStart(entry)
    const end = edge === 'end' ? letter : progressEnd(entry)
    updateEntry(entry.id, { progress_letter: start && end ? `${start}-${end}` : start || end || null })
}

function addEntry() {
    const enrollmentId = props.defaultEnrollmentId || enrollmentOptions.value[0]?.id || ''
    const option = enrollmentOptions.value.find(item => item.id === enrollmentId)
    const entry: ReportLessonEntryDTO = {
        id: createLessonEntryId(),
        enrollment_id: enrollmentId,
        course_id: option?.course_id || undefined,
        course_name: option?.course_name,
        lesson_id: null,
        is_completed: false,
        progress_letter: null,
    }
    emit('update:entries', [...props.entries, entry])
    if (!props.primaryEntryId) emit('update:primaryEntryId', entry.id)
    announcement.value = t('report.editor.lesson_entries.added', { index: props.entries.length + 1 })
}

function removeEntry(entryId: string) {
    const index = props.entries.findIndex(entry => entry.id === entryId)
    const next = props.entries.filter(entry => entry.id !== entryId)
    emit('update:entries', next)
    if (props.primaryEntryId === entryId) emit('update:primaryEntryId', next[Math.min(index, next.length - 1)]?.id ?? null)
    announcement.value = t('report.editor.lesson_entries.removed', { index: index + 1 })
}
</script>
