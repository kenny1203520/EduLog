<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFeedback } from '@/composables/useFeedback'
import BaseDropdown from '@/components/common/BaseDropdown.vue'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { StudentService } from '@/services/student/StudentService'
import { TeacherService } from '@/services/teacher/TeacherService'
import { useAuthStore } from '@/stores/useAuthStore'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { buildKodingCodeCheckUrl, getKodingCredentials, type KodingCredential } from '@/utils/koding'

interface KodingTarget {
    enrollmentId?: string
    id?: string
    studentName?: string
    courseDisplayName?: string
    displayName?: string
    courseId?: string
    kodingAdmissionId?: string
}

interface KodingComparisonCandidate {
    key: string
    type: 'student' | 'teacher'
    label: string
    userId?: string | null
    courseIds?: string[]
    credentials: KodingCredential[]
}

const props = defineProps<{
    isOpen: boolean
    target: KodingTarget | null
    initialLessonId?: string | null
    initialLessonSequence?: string | number | null
}>()

const emit = defineEmits<{
    (e: 'close'): void
}>()

const { t, locale } = useI18n()
const { errorKey, reportError } = useFeedback()
const authStore = useAuthStore()
const preferences = usePreferencesStore()

const isLoadingCandidates = ref(false)
const isLoadingLessons = ref(false)
const showOnlyCourseStudents = ref(true)
const candidates = ref<KodingComparisonCandidate[]>([])
const lessonOptions = ref<Array<{ label: string; value: string }>>([])
const form = ref({
    lesson: '',
    candidateKey: '',
    credentialId: ''
})

const targetTitle = computed(() => props.target?.courseDisplayName || props.target?.displayName || '')

const filteredCandidates = computed(() => {
    const courseId = props.target?.courseId
    if (!showOnlyCourseStudents.value || !courseId) return candidates.value

    return candidates.value.filter(candidate => {
        if (candidate.type === 'teacher') return true
        return candidate.courseIds?.includes(courseId) || false
    })
})

const candidateOptions = computed(() => [
    { label: t('classroom.koding_select_comparison'), value: '' },
    ...filteredCandidates.value.map(candidate => ({
        label: `${candidate.label} (${t(`classroom.koding_candidate_${candidate.type}`)})`,
        value: candidate.key
    }))
])

const selectedCandidate = computed(() => {
    return filteredCandidates.value.find(candidate => candidate.key === form.value.candidateKey) || null
})

const selectedCandidateCredentials = computed(() => selectedCandidate.value?.credentials || [])

const credentialOptions = computed(() => [
    { label: t('classroom.koding_select_account'), value: '' },
    ...selectedCandidateCredentials.value.map(credential => ({
        label: credential.username || t('classroom.koding_unnamed_account'),
        value: credential.id || credential.username || ''
    }))
])

watch(() => props.isOpen, async (isOpen) => {
    if (isOpen) {
        await initialize()
    }
})

watch([showOnlyCourseStudents, filteredCandidates], () => {
    if (!form.value.candidateKey) return
    const stillVisible = filteredCandidates.value.some(candidate => candidate.key === form.value.candidateKey)
    if (stillVisible) return

    form.value.candidateKey = ''
    form.value.credentialId = ''
})

async function initialize() {
    showOnlyCourseStudents.value = true
    form.value = {
        lesson: props.initialLessonSequence ? String(props.initialLessonSequence) : '',
        candidateKey: '',
        credentialId: ''
    }
    lessonOptions.value = [{ label: t('classroom.koding_select_lesson'), value: '' }]

    await Promise.all([
        loadLessons(),
        loadCandidates()
    ])
}

async function loadLessons() {
    const courseId = props.target?.courseId
    if (!courseId) return

    isLoadingLessons.value = true
    try {
        const lessons = await CourseCatalogService.getLessonsByCourse(courseId)
        lessonOptions.value = [
            { label: t('classroom.koding_select_lesson'), value: '' },
            ...lessons
                .filter(lesson => lesson.sequence !== undefined && lesson.sequence !== null)
                .sort((left, right) => Number(left.sequence) - Number(right.sequence))
                .map(lesson => ({
                    label: `L${lesson.sequence} ${lesson.title}`,
                    value: String(lesson.sequence)
                }))
        ]

        if (props.initialLessonId) {
            const matchedLesson = lessons.find(lesson => lesson.id === props.initialLessonId)
            if (matchedLesson?.sequence !== undefined && matchedLesson.sequence !== null) {
                form.value.lesson = String(matchedLesson.sequence)
            }
        }
    } catch (error) {
        console.error(error)
        lessonOptions.value = [{ label: t('classroom.koding_select_lesson'), value: '' }]
    } finally {
        isLoadingLessons.value = false
    }
}

async function loadCandidates() {
    isLoadingCandidates.value = true
    try {
        const [studentsResult, teachersResult] = await Promise.all([
            StudentService.getAll(1, 10000),
            TeacherService.getAllTeachersWithCredentials()
        ])

        const studentCandidates = studentsResult.data.map(student => ({
            key: `student:${student.id}`,
            type: 'student' as const,
            label: student.displayName,
            courseIds: Array.from(new Set(student.enrollments.map(enrollment => enrollment.courseId).filter(Boolean))),
            credentials: getKodingCredentials(student.credentials)
        }))

        const teacherCandidates = teachersResult.map(teacher => ({
            key: `teacher:${teacher.id}`,
            type: 'teacher' as const,
            label: teacher.name,
            userId: teacher.user_id,
            credentials: getKodingCredentials(teacher.teacher_credentials)
        }))

        const activeLocale = typeof locale.value === 'string' ? locale.value : preferences.locale
        candidates.value = [...studentCandidates, ...teacherCandidates].sort((left, right) =>
            left.label.localeCompare(right.label, activeLocale)
        )
        selectCurrentUserTeacher()
    } catch (error: any) {
        console.error(error)
        reportError(error, 'classroom.koding_load_candidates_failed')
    } finally {
        isLoadingCandidates.value = false
    }
}

function selectCurrentUserTeacher() {
    const userId = authStore.user?.id
    if (!userId) return

    const teacherCandidate = candidates.value.find(candidate =>
        candidate.type === 'teacher' &&
        candidate.userId === userId &&
        candidate.credentials.length > 0
    )

    if (!teacherCandidate) return

    form.value.candidateKey = teacherCandidate.key
    handleCandidateChange(teacherCandidate.key)
}

function handleCandidateChange(candidateKey?: string) {
    const key = candidateKey ?? form.value.candidateKey
    const candidate = filteredCandidates.value.find(item => item.key === key)
    const credentials = candidate?.credentials || []
    form.value.credentialId = credentials.length === 1
        ? (credentials[0].id || credentials[0].username || '')
        : ''
}

function getSelectedUsername(): string {
    const credential = selectedCandidateCredentials.value.find(item =>
        (item.id || item.username || '') === form.value.credentialId
    )

    return credential?.username?.trim() || ''
}

function close() {
    emit('close')
}

function launchKodingCheck() {
    const admissionId = props.target?.kodingAdmissionId?.trim() || ''
    const lesson = form.value.lesson.trim()
    const userName = getSelectedUsername()

    if (!admissionId) {
        errorKey('classroom.koding_missing_admission_id')
        return
    }

    if (!lesson) {
        errorKey('classroom.koding_missing_lesson')
        return
    }

    if (!selectedCandidate.value) {
        errorKey('classroom.koding_missing_comparison')
        return
    }

    if (selectedCandidateCredentials.value.length === 0) {
        errorKey('classroom.koding_no_account')
        return
    }

    if (!userName) {
        errorKey('classroom.koding_missing_account')
        return
    }

    const url = buildKodingCodeCheckUrl({ admissionId, userName, lesson })
    window.open(url, '_blank', 'noopener,noreferrer')
    close()
}
</script>

<template>
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-3 sm:items-center sm:p-4"
        @click.self="close">
        <div
            class="flex w-full max-w-2xl min-h-0 max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-[1.5rem] bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-[2rem]">
            <div class="shrink-0 border-b border-gray-100 px-5 py-4 sm:px-6 sm:py-5">
                <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                        <h2 class="text-xl font-black text-gray-900 sm:text-2xl">{{ $t('classroom.koding_check_title') }}</h2>
                        <p class="mt-1 break-words text-sm font-semibold text-gray-400">
                            {{ target?.studentName }}<span v-if="target?.studentName && targetTitle"> · </span>{{ targetTitle }}
                        </p>
                    </div>
                    <button @click="close"
                        class="shrink-0 rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            <div class="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
                <div class="rounded-2xl border p-4"
                    :class="target?.kodingAdmissionId ? 'border-emerald-100 bg-emerald-50 text-emerald-900' : 'border-rose-100 bg-rose-50 text-rose-900'">
                    <div class="text-xs font-black uppercase tracking-widest opacity-70">
                        {{ $t('student.internal_courses.koding_admission_id') }}
                    </div>
                    <div class="mt-1 break-all font-mono text-sm font-bold">
                        {{ target?.kodingAdmissionId || $t('classroom.koding_missing_admission_id') }}
                    </div>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                    <div>
                        <label class="mb-2 block text-sm font-bold text-gray-700" for="edulog-kodingcodecheckmodal-38-2384">
                            {{ $t('classroom.koding_lesson') }}
                        </label>
                        <BaseDropdown v-model="form.lesson" :options="lessonOptions" theme="amber"
                            :disabled="isLoadingLessons"  id="edulog-kodingcodecheckmodal-38-2384"/>
                    </div>

                    <div>
                        <label class="mb-2 block text-sm font-bold text-gray-700" for="edulog-kodingcodecheckmodal-46-2777">
                            {{ $t('classroom.koding_comparison') }}
                        </label>
                        <SearchableSelect v-model="form.candidateKey" :options="candidateOptions"
                            :placeholder="$t('classroom.koding_select_comparison')"
                            @update:modelValue="handleCandidateChange"  id="edulog-kodingcodecheckmodal-46-2777"/>
                        <label
                            class="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-sm font-semibold text-amber-900">
                            <input v-model="showOnlyCourseStudents" type="checkbox"
                                class="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-500 focus:ring-amber-500" />
                            <span class="leading-snug">
                                <span class="block">{{ $t('classroom.koding_only_course_students') }}</span>
                                <span class="block text-xs font-bold text-amber-700/80">
                                    {{ $t('classroom.koding_teachers_always_shown') }}
                                </span>
                            </span>
                        </label>
                    </div>
                </div>

                <div v-if="isLoadingCandidates"
                    class="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    {{ $t('classroom.koding_loading_candidates') }}
                </div>

                <div v-if="selectedCandidate && selectedCandidateCredentials.length === 0"
                    class="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                    {{ $t('classroom.koding_no_account') }}
                </div>

                <div v-if="selectedCandidateCredentials.length > 1"
                    class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    {{ $t('classroom.koding_multiple_accounts_warning') }}
                </div>

                <div v-if="selectedCandidateCredentials.length > 0">
                    <label class="mb-2 block text-sm font-bold text-gray-700" for="edulog-kodingcodecheckmodal-82-5046">
                        {{ $t('classroom.koding_account') }}
                    </label>
                    <BaseDropdown v-model="form.credentialId" :options="credentialOptions" theme="amber"  id="edulog-kodingcodecheckmodal-82-5046"/>
                </div>
            </div>

            <div class="flex shrink-0 flex-col-reverse gap-3 border-t border-gray-100 bg-gray-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6 sm:py-5">
                <button @click="close"
                    class="rounded-2xl border border-gray-200 bg-white px-5 py-3 text-sm font-bold text-gray-600 transition hover:bg-gray-100">
                    {{ $t('common.cancel') }}
                </button>
                <button @click="launchKodingCheck"
                    class="rounded-2xl bg-amber-500 px-6 py-3 text-sm font-black text-white shadow-lg shadow-amber-100 transition hover:bg-amber-600">
                    {{ $t('classroom.koding_open_check') }}
                </button>
            </div>
        </div>
    </div>
</template>
