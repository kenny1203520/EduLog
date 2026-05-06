<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue' // Added watch
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { Course, Lesson, type CourseDTO } from '@/models/Course'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'

import ConfirmModal from '../components/common/ConfirmModal.vue'

const { t } = useI18n()
const toast = useToast()
const courses = ref<Course[]>([])
const loading = ref(true)
const iscreateModalOpen = ref(false)
const editingCourse = ref<Course | null>(null)
const isSaving = ref(false)

// Generic Confirm Modal State
const genericConfirm = ref({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDangerous: false,
    isLoading: false,
    action: null as (() => any) | null
})

function openConfirm(message: string, action: () => any, title?: string, isDangerous = false) {
    genericConfirm.value = {
        isOpen: true,
        title: title || t('common.confirm'),
        message,
        confirmText: t('common.confirm'),
        isDangerous,
        isLoading: false,
        action
    }
}

async function handleGenericConfirm() {
    if (genericConfirm.value.action) {
        try {
            genericConfirm.value.isLoading = true
            await genericConfirm.value.action()
            genericConfirm.value.isOpen = false
        } catch (e) {
            console.error(e)
        } finally {
            genericConfirm.value.isLoading = false
        }
    } else {
        genericConfirm.value.isOpen = false
    }
}

// Form for new/edit course
const courseForm = ref<Partial<CourseDTO>>({
    subject: '',
    stage: '',
    display_name: '',
    description: ''
})

const pagination = ref({ page: 1, perPage: 10, total: 0 })

// ... (existing form and state)

// ... (existing form and state)

const groupedCourses = computed(() => {
    const groups: Record<string, Course[]> = {}
    courses.value.forEach(c => {
        if (!groups[c.subject]) {
            groups[c.subject] = []
        }
        groups[c.subject]!.push(c)
    })
    return groups
})

const selectedCourseId = ref<string | null>(null)
const selectedCourse = computed(() => {
    return courses.value.find(c => c.id === selectedCourseId.value) || null
})

// Auto-select first course when courses are loaded
watch(courses, (newCourses) => {
    if (newCourses.length > 0 && !selectedCourseId.value) {
        selectedCourseId.value = newCourses[0]?.id || null
    }
})

function selectCourse(id: string) {
    selectedCourseId.value = id
}

onMounted(async () => {
    await fetchCourses()
})

async function fetchCourses() {
    try {
        loading.value = true
        const res = await CourseCatalogService.getCourses(pagination.value.page, pagination.value.perPage)
        courses.value = res.data
        pagination.value.total = res.count
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
}

watch(() => pagination.value.page, fetchCourses)
watch(() => pagination.value.perPage, () => { pagination.value.page = 1; fetchCourses() })

// ... (rest of functions)

function openCreateModal() {
    courseForm.value = { subject: '', stage: '', display_name: '', description: '' }
    editingCourse.value = null
    iscreateModalOpen.value = true
}

function openEditModal(course: Course) {
    editingCourse.value = course
    courseForm.value = {
        subject: course.subject,
        stage: course.stage,
        display_name: course.displayNameValue,
        description: course.description
    }
    iscreateModalOpen.value = true
}

async function saveCourse() {
    try {
        isSaving.value = true
        if (editingCourse.value && editingCourse.value.id) {
            // Update
            await CourseCatalogService.updateCourse(editingCourse.value.id, courseForm.value)
        } else {
            // Create
            await CourseCatalogService.createCourse(courseForm.value)
        }
        await fetchCourses()
        iscreateModalOpen.value = false
        toast.success(t('course.save_success') || 'Course saved successfully')
    } catch (e) {
        toast.error('Error saving course: ' + e)
    } finally {
        isSaving.value = false
    }
}

// Lesson Management
const editingLessonId = ref<string | null>(null)
const lessonForm = ref({
    title: '',
    sequence: 1
})
const addingLessonToCourseId = ref<string | null>(null)

function startAddLesson(course: Course) {
    addingLessonToCourseId.value = course.id!
    lessonForm.value = {
        title: '',
        sequence: course.lessons.length + 1
    }
}

function editLesson(lesson: Lesson) {
    editingLessonId.value = lesson.id!
    lessonForm.value = {
        title: lesson.title,
        sequence: lesson.sequence
    }
}

async function saveLesson(courseId: string) {
    if (!lessonForm.value.title.trim()) return

    try {
        isSaving.value = true
        if (editingLessonId.value) {
            // Update
            await CourseCatalogService.updateLesson(editingLessonId.value, {
                title: lessonForm.value.title,
                sequence: lessonForm.value.sequence
            })
            editingLessonId.value = null
        } else {
            // Create
            await CourseCatalogService.createLesson({
                course_id: courseId,
                title: lessonForm.value.title,
                sequence: lessonForm.value.sequence
            })
            addingLessonToCourseId.value = null
        }

        await fetchCourses()
        toast.success(t('course.lesson_save_success') || 'Lesson saved successfully')
    } catch (e) {
        console.error(e)
        toast.error('Error saving lesson: ' + e)
    } finally {
        isSaving.value = false
    }
}

function cancelLessonEdit() {
    editingLessonId.value = null
    addingLessonToCourseId.value = null
}

async function deleteCourse(id: string) {
    openConfirm(t('course.confirm_delete'), async () => {
        try {
            await CourseCatalogService.deleteCourse(id)
            await fetchCourses()
            toast.success(t('course.delete_success') || 'Course deleted successfully')
        } catch (e) {
            toast.error(e as string)
        }
    }, t('common.delete'), true)
}

async function deleteLesson(id: string) {
    openConfirm(t('course.lesson_confirm_delete'), async () => {
        try {
            await CourseCatalogService.deleteLesson(id)
            await fetchCourses()
            toast.success(t('course.lesson_delete_success') || 'Lesson deleted successfully')
        } catch (e) {
            toast.error(e as string)
        }
    }, t('common.delete'), true)
}
</script>

<template>
    <div class="h-[calc(100vh-8rem)] flex flex-col">
        <!-- Header -->
        <div class="flex items-center justify-between mb-6 shrink-0">
            <h1 class="text-3xl font-black text-gray-900 tracking-tight">{{ $t('nav.courses') }}</h1>
            <button @click="openCreateModal"
                class="bg-emerald-600 text-white px-6 py-3 rounded-2xl hover:bg-emerald-700 transition shadow-lg shadow-emerald-200 flex items-center gap-2 font-bold active:scale-95">
                <span class="text-xl">+</span> {{ $t('common.add') }}
            </button>
        </div>

        <!-- Loading State -->
        <div v-if="loading"
            class="flex-1 flex flex-col items-center justify-center text-gray-400 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm">
            <svg class="animate-spin h-10 w-10 mb-4 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none"
                viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                </path>
            </svg>
            <p class="font-bold italic tracking-widest">{{ $t('student.loading') }}...{{ $t('common.syncing') }}</p>
        </div>

        <!-- Main Layout -->
        <div v-else class="flex-1 flex gap-8 overflow-hidden relative">
            <!-- Sidebar: Course List -->
            <div class="w-full lg:w-80 flex flex-col bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden border-r-4 border-r-emerald-500/10 transition-transform duration-300 absolute inset-0 z-10 lg:static lg:transform-none"
                :class="selectedCourseId ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'">
                <div class="p-6 border-b border-gray-50 bg-gray-50/30">
                    <h3 class="text-xs font-black text-emerald-600 uppercase tracking-widest">{{ $t('course.list_title')
                    }}</h3>
                </div>
                <div class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                    <div v-for="(group, subject) in groupedCourses" :key="subject">
                        <h4
                            class="px-2 text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <span class="w-1 h-3 bg-emerald-400 rounded-full"></span>
                            {{ subject }}
                        </h4>
                        <div class="space-y-1">
                            <button v-for="course in group" :key="course.id" @click="selectCourse(course.id!)"
                                class="w-full text-left px-4 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden"
                                :class="selectedCourseId === course.id
                                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-100 translate-x-1'
                                    : 'hover:bg-gray-50 text-gray-700'">
                                <div class="font-bold relative z-10">{{ course.displayName }}</div>
                                <div class="text-[10px] opacity-70 relative z-10"
                                    :class="selectedCourseId === course.id ? 'text-emerald-50' : 'text-gray-400'">
                                    {{ course.stage }} · {{ course.lessons.length }} {{ $t('course.lessons_count_short')
                                    }}
                                </div>
                            </button>
                        </div>
                    </div>

                    <!-- Empty List -->
                    <div v-if="courses.length === 0" class="text-center py-10 opacity-50">
                        <p class="text-sm italic">{{ $t('course.no_courses') }}</p>
                    </div>
                </div>

                <!-- Pagination in Sidebar -->
                <div class="p-4 border-t border-gray-50 bg-gray-50/20" v-if="pagination.total > 0">
                    <div
                        class="flex items-center justify-between text-[10px] font-black text-gray-400 uppercase tracking-wider mb-2">
                        <span>{{ pagination.page }} / {{ Math.ceil(pagination.total / pagination.perPage) }}</span>
                        <span>{{ $t('common.total') }}: {{ pagination.total }}</span>
                    </div>
                    <div class="flex gap-2">
                        <button @click="pagination.page--" :disabled="pagination.page === 1"
                            class="flex-1 py-2 bg-white border border-gray-100 rounded-lg disabled:opacity-30 hover:bg-emerald-50 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mx-auto" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                    d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <button @click="pagination.page++"
                            :disabled="pagination.page >= Math.ceil(pagination.total / pagination.perPage)"
                            class="flex-1 py-2 bg-white border border-gray-100 rounded-lg disabled:opacity-30 hover:bg-emerald-50 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mx-auto" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                    d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Detail Pane: Selected Course Lessons -->
            <div class="flex-1 flex flex-col bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden relative w-full lg:w-auto h-full absolute lg:static inset-0 z-20 bg-white transition-transform duration-300"
                :class="selectedCourseId ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'">
                <div v-if="selectedCourse"
                    class="flex-1 flex flex-col overflow-hidden animate-in fade-in slide-in-from-right-4 duration-500">
                    <!-- Detail Header -->
                    <div
                        class="p-6 lg:p-10 pb-6 border-b border-gray-50 bg-gradient-to-br from-white to-gray-50/50 relative">
                        <!-- Mobile Back Button -->
                        <button @click="selectedCourseId = null"
                            class="lg:hidden absolute top-4 left-4 p-2 text-gray-400 hover:text-gray-600 bg-white rounded-full shadow-sm border border-gray-100 z-30">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>

                        <div class="flex flex-col lg:flex-row items-start justify-between gap-6 mb-4 mt-8 lg:mt-0">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-3 mb-2 flex-wrap">
                                    <span
                                        class="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                                        {{ selectedCourse.subject }}
                                    </span>
                                    <span
                                        class="px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-100">
                                        {{ selectedCourse.stage }}
                                    </span>
                                </div>
                                <h2
                                    class="text-3xl lg:text-4xl font-black text-gray-900 tracking-tight leading-tight mb-2 break-words">
                                    {{
                                        selectedCourse.displayName }}</h2>
                                <p class="text-gray-500 font-medium italic text-lg leading-relaxed max-w-2xl">
                                    {{ selectedCourse.description || $t('common.no_description') }}
                                </p>
                            </div>
                            <div class="flex gap-2 self-end lg:self-start">
                                <button @click="openEditModal(selectedCourse)"
                                    class="p-3 lg:p-4 bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-2xl transition-all shadow-sm border border-gray-100 active:scale-90"
                                    :title="$t('common.edit')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                    </svg>
                                </button>
                                <button @click="deleteCourse(selectedCourse.id!)"
                                    class="p-3 lg:p-4 bg-gray-50 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all shadow-sm border border-gray-100 active:scale-90"
                                    :title="$t('common.delete')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Lessons List -->
                    <div class="flex-1 overflow-y-auto p-6 lg:p-10 pt-6 custom-scrollbar space-y-8">
                        <div>
                            <div class="flex items-center justify-between mb-6">
                                <h3 class="text-xl font-black text-gray-900 tracking-tight flex items-center gap-3">
                                    <span class="w-2 h-6 bg-emerald-500 rounded-full"></span>
                                    {{ $t('course.lessons_title') }}
                                    <span
                                        class="ml-2 px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-lg font-bold">
                                        {{ selectedCourse.lessons.length }}
                                    </span>
                                </h3>
                                <button @click="startAddLesson(selectedCourse)"
                                    class="text-emerald-600 font-black text-sm flex items-center gap-2 hover:translate-x-1 transition-transform">
                                    + {{ $t('course.add_lesson') }}
                                </button>
                            </div>

                            <div class="space-y-4">
                                <!-- Add Lesson Row -->
                                <div v-if="addingLessonToCourseId === selectedCourse.id"
                                    class="bg-emerald-50 rounded-2xl p-6 border-2 border-dashed border-emerald-200 animate-in zoom-in duration-300">
                                    <div class="flex flex-col lg:flex-row gap-4">
                                        <div class="w-full lg:w-16 space-y-1">
                                            <label
                                                class="text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">#SEQ</label>
                                            <input v-model.number="lessonForm.sequence" type="number"
                                                class="w-full bg-white border-emerald-100 rounded-xl px-3 py-2 text-center font-black focus:ring-emerald-500 focus:border-emerald-500">
                                        </div>
                                        <div class="flex-1 space-y-1">
                                            <label
                                                class="text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                                    $t('course.lesson_title') }}</label>
                                            <input v-model="lessonForm.title"
                                                class="w-full bg-white border-emerald-100 rounded-xl px-4 py-2 font-bold focus:ring-emerald-500 focus:border-emerald-500"
                                                @keyup.enter="saveLesson(selectedCourse.id!)" auto-focus>
                                        </div>
                                    </div>
                                    <div class="flex justify-end gap-3 mt-4">
                                        <button @click="cancelLessonEdit"
                                            class="px-4 py-2 text-gray-500 font-bold hover:text-gray-700 transition-colors">{{
                                                $t('common.cancel') }}</button>
                                        <button @click="saveLesson(selectedCourse.id!)" :disabled="isSaving"
                                            class="px-6 py-2 bg-emerald-600 text-white rounded-xl font-black hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all flex items-center gap-2">
                                            <svg v-if="isSaving" class="animate-spin h-4 w-4" fill="none"
                                                viewBox="0 0 24 24">
                                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                                    stroke-width="4"></circle>
                                                <path class="opacity-75" fill="currentColor"
                                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                                </path>
                                            </svg>
                                            {{ $t('common.save') }}
                                        </button>
                                    </div>
                                </div>

                                <!-- Lesson Items -->
                                <div draggable="true" v-for="lesson in selectedCourse.lessons" :key="lesson.id"
                                    class="group flex flex-col lg:flex-row items-center gap-4 bg-white border border-gray-100 p-4 rounded-2xl hover:shadow-md transition-all hover:bg-gray-50/50">
                                    <!-- Edit State -->
                                    <div v-if="editingLessonId === lesson.id"
                                        class="flex-1 w-full flex flex-col lg:flex-row gap-4 items-center animate-in fade-in duration-300">
                                        <input v-model.number="lessonForm.sequence" type="number"
                                            class="w-full lg:w-16 text-center bg-gray-50 border-gray-100 rounded-xl py-2 font-black">
                                        <input v-model="lessonForm.title"
                                            class="flex-1 w-full bg-gray-50 border-gray-100 rounded-xl px-4 py-2 font-bold"
                                            @keyup.enter="saveLesson(selectedCourse.id!)">
                                        <div class="flex gap-2 w-full lg:w-auto justify-end">
                                            <button @click="saveLesson(selectedCourse.id!)" :disabled="isSaving"
                                                class="text-emerald-600 font-black text-sm px-3 py-1 hover:bg-emerald-50 rounded-lg flex items-center gap-2">
                                                <svg v-if="isSaving" class="animate-spin h-3 w-3" fill="none"
                                                    viewBox="0 0 24 24">
                                                    <circle class="opacity-25" cx="12" cy="12" r="10"
                                                        stroke="currentColor" stroke-width="4"></circle>
                                                    <path class="opacity-75" fill="currentColor"
                                                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                                    </path>
                                                </svg>
                                                {{ $t('common.save') }}
                                            </button>
                                            <button @click="cancelLessonEdit" :disabled="isSaving"
                                                class="text-gray-400 font-bold text-sm px-3 py-1 hover:bg-gray-100 rounded-lg">
                                                {{ $t('common.cancel') }}
                                            </button>
                                        </div>
                                    </div>

                                    <!-- View State -->
                                    <div v-else class="flex-1 w-full flex items-center justify-between">
                                        <div class="flex items-center gap-6">
                                            <span
                                                class="w-10 h-10 bg-gray-50 text-gray-400 rounded-xl flex items-center justify-center font-black text-xs border border-gray-100">
                                                {{ lesson.sequence }}
                                            </span>
                                            <span class="text-xl font-bold text-gray-800 tracking-tight">{{ lesson.title
                                            }}</span>
                                        </div>
                                        <div
                                            class="flex gap-1 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-all">
                                            <button @click="editLesson(lesson)"
                                                class="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all h-10 w-10 flex items-center justify-center shadow-sm bg-white"
                                                :title="$t('common.edit')">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                                    viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        stroke-width="3"
                                                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </button>
                                            <button @click="deleteLesson(lesson.id!)"
                                                class="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all h-10 w-10 flex items-center justify-center shadow-sm bg-white"
                                                :title="$t('common.delete')">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                                    viewBox="0 0 24 24" stroke="currentColor">
                                                    <path stroke-linecap="round" stroke-linejoin="round"
                                                        stroke-width="3" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <!-- Empty Lessons State -->
                                <div v-if="selectedCourse.lessons.length === 0 && addingLessonToCourseId === null"
                                    class="text-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
                                    <div
                                        class="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm border border-gray-100">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-300"
                                            fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                        </svg>
                                    </div>
                                    <h4 class="text-lg font-black text-gray-900 mb-1">{{ $t('course.no_lessons_title')
                                    }}</h4>
                                    <p class="text-gray-400 font-medium italic text-sm">{{ $t('course.no_lessons_sub')
                                    }}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Empty State (No Course Selected) -->
                <div v-else class="flex-1 flex flex-col items-center justify-center p-10 bg-gray-50/30">
                    <div
                        class="w-24 h-24 bg-white rounded-[2rem] flex items-center justify-center mb-8 shadow-xl border border-gray-100 animate-bounce duration-3000">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-emerald-400" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                    </div>
                    <h3 class="text-2xl font-black text-gray-900 mb-2 invisible lg:visible">{{
                        $t('course.select_course_hint') }}</h3>
                </div>
            </div>
        </div>

        <!-- Create/Edit Modal -->
        <div v-if="iscreateModalOpen"
            class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div
                class="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
                <h3 class="text-xl font-bold mb-6 text-gray-800">{{ editingCourse ? $t('course.edit_course') :
                    $t('course.add_course') }}</h3>
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('course.subject')
                        }}</label>
                        <input v-model="courseForm.subject" :placeholder="$t('course.subject_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('course.stage') }}</label>
                        <input v-model="courseForm.stage" :placeholder="$t('course.stage_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">
                            {{ $t('course.display_name') }}
                            <span class="text-xs text-gray-400 block font-normal mt-0.5">{{
                                $t('course.display_name_hint') }}</span>
                        </label>
                        <input v-model="courseForm.display_name" :placeholder="$t('course.display_name_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('course.description')
                        }}</label>
                        <textarea v-model="courseForm.description" rows="3"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500"></textarea>
                    </div>
                </div>
                <div class="flex justify-end gap-3 mt-8 pt-4 border-t border-gray-50">
                    <button @click="iscreateModalOpen = false" :disabled="isSaving"
                        class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">{{
                            $t('common.cancel') }}</button>
                    <button @click="saveCourse" :disabled="isSaving"
                        class="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm font-bold transition-all flex items-center gap-2">
                        <svg v-if="isSaving" class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                        {{ editingCourse ? $t('course.save_changes') : $t('common.add') }}
                    </button>
                </div>
            </div>
        </div>

        <ConfirmModal :is-open="genericConfirm.isOpen" :title="genericConfirm.title" :message="genericConfirm.message"
            :confirm-text="genericConfirm.confirmText" :is-dangerous="genericConfirm.isDangerous"
            :is-loading="genericConfirm.isLoading" @confirm="handleGenericConfirm"
            @close="genericConfirm.isOpen = false" />
    </div>
</template>
