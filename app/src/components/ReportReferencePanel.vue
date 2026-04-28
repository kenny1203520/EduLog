<template>
    <div v-if="show" class="fixed inset-0 z-[55] overflow-hidden pointer-events-none">
        <!-- Backdrop Overlay -->
        <div class="absolute inset-0 bg-black/30 backdrop-blur-[2px] pointer-events-auto cursor-pointer transition-opacity"
            @click="$emit('close')"></div>

        <div
            class="absolute inset-y-0 right-0 z-[60] w-full sm:w-[540px] bg-white shadow-2xl border-l flex flex-col pointer-events-auto transition-transform duration-300 animate-in slide-in-from-right pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <!-- Header -->
            <div class="px-6 py-4 border-b flex items-center justify-between bg-white gap-4">
                <h2 class="font-black text-gray-900 flex items-center gap-2.5 text-lg tracking-tight min-w-0">
                    <div class="p-2 bg-indigo-50 rounded-xl shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                    </div>
                    <span class="truncate">{{ $t('report.reference_panel.title') }}</span>
                </h2>
                <button @click="$emit('close')"
                    class="p-3 -mr-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all shrink-0 active:scale-95"
                    :aria-label="$t('common.close')">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Tabs -->
            <div class="flex px-4 bg-white">
                <button @click="switchTab('peer')" class="flex-1 py-4 text-sm font-black transition-all border-b-4"
                    :class="activeTab === 'peer' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'">
                    {{ $t('report.reference_panel.peer_reports') }}
                </button>
                <button @click="switchTab('history')" class="flex-1 py-4 text-sm font-black transition-all border-b-4"
                    :class="activeTab === 'history' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-400 hover:text-gray-600'">
                    {{ $t('report.reference_panel.student_history') }}
                </button>
            </div>

            <!-- Filters Bar -->
            <div class="p-4 border-b bg-gray-50/50 space-y-3">
                <!-- Search -->
                <div class="relative group">
                    <input v-model="searchQuery" type="text"
                        :placeholder="$t('report.reference_panel.search_placeholder')"
                        class="w-full pl-10 pr-4 py-2.5 border-2 border-gray-100 rounded-2xl text-sm focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 bg-white shadow-sm transition-all"
                        @keyup.enter="refreshData" />
                    <svg xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5 text-gray-400 absolute left-3.5 top-2.5 transition-colors group-focus-within:text-indigo-600"
                        fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </div>

                <!-- Contextual Filters & Sort -->
                <div class="flex flex-wrap gap-2">
                    <template v-if="activeTab === 'peer'">
                        <select v-model="filterClassroom"
                            class="flex-1 min-w-[120px] text-xs border rounded px-2 py-1 bg-white focus:ring-indigo-500"
                            @change="handleClassroomChange">
                            <option value="">{{ $t('report.reference_panel.filter_by_classroom') }}</option>
                            <option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}</option>
                        </select>
                        <select v-model="filterSession"
                            class="flex-1 min-w-[120px] text-xs border rounded px-2 py-1 bg-white focus:ring-indigo-500"
                            @change="refreshData">
                            <option value="">{{ $t('report.reference_panel.filter_by_session') }}</option>
                            <option v-for="s in filteredSessions" :key="s.id" :value="s.id">{{ s.name }}</option>
                        </select>
                    </template>
                    <template v-else>
                        <select v-model="filterCourse"
                            class="flex-1 min-w-[120px] text-xs border rounded px-2 py-1 bg-white focus:ring-indigo-500"
                            @change="refreshData">
                            <option value="">{{ $t('report.reference_panel.filter_by_course') }}</option>
                            <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.display_name || c.subject }}
                            </option>
                        </select>
                    </template>
                    <!-- Sort -->
                    <select v-model="sortBy"
                        class="flex-1 sm:w-24 min-w-[80px] text-xs border rounded px-2 py-1 bg-white focus:ring-indigo-500 shadow-sm"
                        @change="refreshData">
                        <option value="desc">{{ $t('report.reference_panel.newest') }}</option>
                        <option value="asc">{{ $t('report.reference_panel.oldest') }}</option>
                    </select>
                </div>
            </div>

            <!-- Content List -->
            <div class="flex-1 overflow-y-auto overscroll-y-contain bg-gray-100 p-4 space-y-4">
                <div v-if="loading" class="flex justify-center py-12">
                    <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
                </div>

                <div v-else-if="reports.length === 0"
                    class="text-center py-12 text-gray-400 text-sm bg-white rounded-xl border border-dashed border-gray-300">
                    {{ $t('report.reference_panel.no_results') }}
                </div>

                <div v-else v-for="report in reports" :key="report.id"
                    class="bg-white rounded-xl border shadow-sm overflow-hidden border-gray-200">
                    <!-- Card Header -->
                    <div class="px-5 py-4 bg-white border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="text-base font-black text-gray-900 truncate tracking-tight">
                                {{ formatHeader(report) }}
                            </div>
                            <div class="flex items-center gap-2 mt-1">
                                <span
                                    class="text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-lg border border-indigo-100">
                                    {{ formatDate(report) }}
                                </span>
                                <span v-if="getReportProgress(report)"
                                    class="text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-lg border border-emerald-100">
                                    {{ getReportProgress(report) }}
                                </span>
                            </div>
                        </div>
                        <button @click="copyContent(report.content)"
                            class="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-black shadow-lg shadow-gray-200 hover:bg-indigo-600 transition-all active:scale-95 flex items-center gap-2"
                            :title="$t('report.reference_panel.copy_content')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            {{ $t('report.reference_panel.copy_content') }}
                        </button>
                    </div>

                    <!-- Secondary Info (Notes) -->
                    <div class="px-4 py-2 bg-gray-50/50 border-b grid grid-cols-1 gap-2 border-gray-100">
                        <div v-if="report.contact_notes" class="flex gap-2">
                            <span
                                class="text-[10px] items-center py-0.5 px-1.5 rounded-md bg-blue-100 text-blue-800 font-bold whitespace-nowrap self-start">📞
                                {{ $t('report.reference_panel.contact') }}</span>
                            <p class="text-[11px] text-gray-600 italic line-clamp-2">
                                {{ report.contact_notes }}
                            </p>
                        </div>
                        <div v-if="report.class_notes" class="flex gap-2">
                            <span
                                class="text-[10px] items-center py-0.5 px-1.5 rounded-md bg-purple-100 text-purple-800 font-bold whitespace-nowrap self-start">📝
                                {{ $t('report.reference_panel.class_notes') }}</span>
                            <p class="text-[11px] text-gray-600 italic line-clamp-2">
                                {{ report.class_notes }}
                            </p>
                        </div>
                    </div>

                    <!-- Main Content -->
                    <div class="p-4 bg-white relative group">
                        <div
                            class="text-sm text-gray-700 whitespace-pre-wrap font-mono line-clamp-[12] leading-relaxed">
                            {{ report.content }}
                        </div>
                        <div
                            class="absolute bottom-1 right-2 text-[8px] text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                            ID: {{ report.id.substring(0, 8) }}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Pagination Footer -->
            <div class="px-4 py-3 border-t bg-white flex flex-col gap-3 shadow-[0_-4px_10px_rgba(0,0,0,0.03)]">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-400 whitespace-nowrap">{{
                            $t('report.reference_panel.items_per_page')
                            }}</span>
                        <select v-model="pageSize" class="text-xs border rounded p-1 bg-gray-50 focus:ring-indigo-500"
                            @change="handlePageSizeChange">
                            <option :value="10">10</option>
                            <option :value="20">20</option>
                            <option :value="50">50</option>
                        </select>
                    </div>
                    <div class="text-xs text-gray-500 font-medium">
                        {{ $t('report.reference_panel.total') }}: <span class="text-indigo-600">{{ totalCount }}</span>
                    </div>
                </div>

                <div v-if="totalCount > pageSize" class="flex items-center justify-center gap-4">
                    <button @click="prevPage" :disabled="currentPage === 1 || loading"
                        class="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div class="text-sm font-semibold text-gray-700">
                        {{ $t('report.reference_panel.page') }} {{ currentPage }} / {{ totalPages }}
                    </div>
                    <button @click="nextPage" :disabled="currentPage === totalPages || loading"
                        class="p-2 text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>

                <!-- Secondary Close Button (Mobile Only) -->
                <button @click="$emit('close')"
                    class="sm:hidden w-full mt-4 py-3.5 bg-gray-100 text-gray-700 rounded-xl font-black text-sm hover:bg-gray-200 transition-all active:scale-95 flex items-center justify-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {{ $t('common.close') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import { CourseCatalogService } from '@/services/CourseCatalogService'
import { ClassroomService } from '@/services/ClassroomService'
import { SessionService } from '@/services/SessionService'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
    show: boolean
    lessonId?: string
    studentId?: string
    currentReportId?: string
}>()

const emit = defineEmits(['close', 'copy'])

const activeTab = ref<'peer' | 'history'>('peer')
const searchQuery = ref('')
const loading = ref(false)

// Data State
const reports = ref<any[]>([])
const totalCount = ref(0)
const currentPage = ref(1)
const pageSize = ref(10)

// Filters State
const filterClassroom = ref('')
const filterSession = ref('')
const filterCourse = ref('')
const sortBy = ref<'asc' | 'desc'>('desc')

// Lookups
const classrooms = ref<any[]>([])
const allSessions = ref<any[]>([])
const courses = ref<any[]>([])

const totalPages = computed(() => Math.ceil(totalCount.value / pageSize.value) || 1)

const filteredSessions = computed(() => {
    if (!filterClassroom.value) return allSessions.value
    return allSessions.value.filter(s => s.classroom_id === filterClassroom.value)
})

// Lifecycle
onMounted(async () => {
    await loadFilterOptions()
})

// Watch panel visibility
watch(() => props.show, (newVal) => {
    if (newVal) {
        refreshData()
    }
})

// Tab handling
function switchTab(tab: 'peer' | 'history') {
    if (activeTab.value === tab) return
    activeTab.value = tab
    currentPage.value = 1
    // Don't clear search query, but we reset filtering?
    refreshData()
}

async function loadFilterOptions() {
    try {
        const [crs, cls, sessions] = await Promise.all([
            CourseCatalogService.getCourses(1, 1000),
            ClassroomService.getClassrooms(1, 1000),
            SessionService.getClassSessions(1, 1000)
        ])
        courses.value = crs.data
        classrooms.value = cls.data
        allSessions.value = sessions.data
    } catch (e) {
        console.error('Failed to load filters:', e)
    }
}

async function refreshData() {
    if (!props.show) return

    // Auto-switch to history if no lessonId but studentId is present
    if (!props.lessonId && props.studentId && activeTab.value === 'peer') {
        activeTab.value = 'history'
    }

    loading.value = true
    try {
        const commonParams = {
            excludeReportId: props.currentReportId,
            page: currentPage.value,
            pageSize: pageSize.value,
            sortBy: sortBy.value,
            search: searchQuery.value.trim() || undefined
        }

        let res
        if (activeTab.value === 'peer') {
            if (!props.lessonId) {
                reports.value = []
                totalCount.value = 0
                loading.value = false
                return
            }
            res = await OccurrenceReportService.getReportsByLesson(props.lessonId, {
                ...commonParams,
                classroomId: filterClassroom.value,
                sessionId: filterSession.value
            })
        } else {
            if (!props.studentId) {
                reports.value = []
                totalCount.value = 0
                loading.value = false
                return
            }
            res = await OccurrenceReportService.getReportsByStudent(props.studentId, {
                ...commonParams,
                courseId: filterCourse.value
            })
        }
        reports.value = res.data
        totalCount.value = res.count
    } catch (e) {
        console.error('Failed to load reports:', e)
    } finally {
        loading.value = false
    }
}

function handleClassroomChange() {
    filterSession.value = '' // Reset session filter when classroom changes
    refreshData()
}

function handlePageSizeChange() {
    currentPage.value = 1
    refreshData()
}

function prevPage() {
    if (currentPage.value > 1) {
        currentPage.value--
        refreshData()
    }
}

function nextPage() {
    if (currentPage.value < totalPages.value) {
        currentPage.value++
        refreshData()
    }
}

function formatDate(report: any) {
    const d = report.class_occurrences?.occurrence_date || report.updated_at
    if (!d) return '-'
    return new Date(d).toLocaleDateString()
}

function getReportProgress(report: any) {
    return report.progress_letter || ''
}

function formatHeader(report: any) {
    if (activeTab.value === 'peer') {
        const s = report.enrollments?.students
        return s.name || t('common.unknown_student')
    } else {
        const course = report.enrollments?.courses
        const lesson = report.lessons

        let courseName = t('common.unknown_course')
        if (course) {
            courseName = course.display_name || course.subject || courseName
        }

        const lessonInfo = lesson ? `#${lesson.sequence} ${lesson.title}` : ''
        return `${courseName} ${lessonInfo}`.trim()
    }
}

function copyContent(content: string) {
    emit('copy', content)
}
</script>
