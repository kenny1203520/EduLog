<template>
    <div v-if="show"
        class="fixed inset-y-0 right-0 z-[60] w-[500px] bg-white shadow-2xl border-l flex flex-col transition-transform duration-300">
        <!-- Header -->
        <div class="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
            <h2 class="font-bold text-gray-700 flex items-center gap-2 text-base">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                {{ $t('report.reference_panel.title') }}
            </h2>
            <button @click="$emit('close')" class="text-gray-400 hover:text-gray-600 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>

        <!-- Tabs -->
        <div class="flex border-b">
            <button @click="switchTab('peer')" class="flex-1 py-3 text-sm font-semibold transition-colors border-b-2"
                :class="activeTab === 'peer' ? 'border-indigo-600 text-indigo-600 bg-indigo-50' : 'border-transparent text-gray-500 hover:text-gray-700'">
                {{ $t('report.reference_panel.peer_reports') }}
            </button>
            <button @click="switchTab('history')" class="flex-1 py-3 text-sm font-semibold transition-colors border-b-2"
                :class="activeTab === 'history' ? 'border-indigo-600 text-indigo-600 bg-indigo-50' : 'border-transparent text-gray-500 hover:text-gray-700'">
                {{ $t('report.reference_panel.student_history') }}
            </button>
        </div>

        <!-- Filters Bar -->
        <div class="p-3 border-b bg-gray-50 grid grid-cols-1 gap-2">
            <!-- Search -->
            <div class="relative">
                <input v-model="searchQuery" type="text" :placeholder="$t('report.reference_panel.search_placeholder')"
                    class="w-full pl-9 pr-4 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white shadow-sm"
                    @keyup.enter="refreshData" />
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 absolute left-3 top-2.5"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
            </div>

            <!-- Contextual Filters & Sort -->
            <div class="flex gap-2">
                <template v-if="activeTab === 'peer'">
                    <select v-model="filterClassroom"
                        class="flex-1 text-xs border rounded px-2 py-1 bg-white focus:ring-indigo-500"
                        @change="handleClassroomChange">
                        <option value="">{{ $t('report.reference_panel.filter_by_classroom') }}</option>
                        <option v-for="c in classrooms" :key="c.id" :value="c.id">{{ c.name }}</option>
                    </select>
                    <select v-model="filterSession"
                        class="flex-1 text-xs border rounded px-2 py-1 bg-white focus:ring-indigo-500"
                        @change="refreshData">
                        <option value="">{{ $t('report.reference_panel.filter_by_session') }}</option>
                        <option v-for="s in filteredSessions" :key="s.id" :value="s.id">{{ s.name }}</option>
                    </select>
                </template>
                <template v-else>
                    <select v-model="filterCourse"
                        class="flex-1 text-xs border rounded px-2 py-1 bg-white focus:ring-indigo-500"
                        @change="refreshData">
                        <option value="">{{ $t('report.reference_panel.filter_by_course') }}</option>
                        <option v-for="c in courses" :key="c.id" :value="c.id">{{ c.display_name || c.subject }}
                        </option>
                    </select>
                </template>
                <!-- Sort -->
                <select v-model="sortBy"
                    class="w-24 text-xs border rounded px-2 py-1 bg-white focus:ring-indigo-500 shadow-sm"
                    @change="refreshData">
                    <option value="desc">Newest</option>
                    <option value="asc">Oldest</option>
                </select>
            </div>
        </div>

        <!-- Content List -->
        <div class="flex-1 overflow-y-auto bg-gray-100 p-4 space-y-4">
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
                <div class="px-4 py-3 bg-white border-b flex justify-between items-start">
                    <div class="flex-1 min-w-0">
                        <div class="text-sm font-bold text-indigo-900 truncate">
                            {{ formatHeader(report) }}
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                            <span class="text-[10px] font-mono bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                                {{ formatDate(report) }}
                            </span>
                            <span v-if="getReportProgress(report)"
                                class="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded border border-emerald-100 italic">
                                Progress: {{ getReportProgress(report) }}
                            </span>
                        </div>
                    </div>
                    <button @click="copyContent(report.content)"
                        class="text-xs bg-gray-50 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg flex items-center gap-1.5 border border-gray-200 transition-all font-medium whitespace-nowrap"
                        :title="$t('report.reference_panel.copy_content')">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                    </button>
                </div>

                <!-- Secondary Info (Notes) -->
                <div class="px-4 py-2 bg-gray-50/50 border-b grid grid-cols-1 gap-2 border-gray-100">
                    <div v-if="report.contact_notes" class="flex gap-2">
                        <span
                            class="text-[10px] items-center py-0.5 px-1.5 rounded-md bg-blue-100 text-blue-800 font-bold whitespace-nowrap self-start">📞
                            Contact</span>
                        <p class="text-[11px] text-gray-600 italic line-clamp-2">
                            {{ report.contact_notes }}
                        </p>
                    </div>
                    <div v-if="report.class_notes" class="flex gap-2">
                        <span
                            class="text-[10px] items-center py-0.5 px-1.5 rounded-md bg-purple-100 text-purple-800 font-bold whitespace-nowrap self-start">📝
                            Notes</span>
                        <p class="text-[11px] text-gray-600 italic line-clamp-2">
                            {{ report.class_notes }}
                        </p>
                    </div>
                </div>

                <!-- Main Content -->
                <div class="p-4 bg-white relative group">
                    <div class="text-sm text-gray-700 whitespace-pre-wrap font-mono line-clamp-[12] leading-relaxed">
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
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-400 whitespace-nowrap">{{ $t('report.reference_panel.items_per_page')
                    }}</span>
                    <select v-model="pageSize" class="text-xs border rounded p-1 bg-gray-50 focus:ring-indigo-500"
                        @change="handlePageSizeChange">
                        <option :value="10">10</option>
                        <option :value="20">20</option>
                        <option :value="50">50</option>
                    </select>
                </div>
                <div class="text-xs text-gray-500 font-medium">
                    Total: <span class="text-indigo-600">{{ totalCount }}</span>
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
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import { CourseService } from '@/services/CourseService'

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
            CourseService.getCourses(1, 1000),
            CourseService.getClassrooms(1, 1000),
            CourseService.getClassSessions(1, 1000)
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
        if (!s) return 'Unknown Student'
        return s.english_name ? `${s.english_name} (${s.first_name})` : `${s.first_name} ${s.last_name || ''}`
    } else {
        const session = report.class_occurrences?.class_sessions
        const course = session?.courses

        let courseName = 'Unknown Course'
        if (course) {
            if (Array.isArray(course)) {
                courseName = course[0]?.name || courseName
            } else {
                courseName = course.name || courseName
            }
        }

        const lessonSeq = report.lessons?.sequence ? `#${report.lessons.sequence}` : ''
        return `${courseName} ${lessonSeq}`.trim()
    }
}

function copyContent(content: string) {
    emit('copy', content)
}
</script>
