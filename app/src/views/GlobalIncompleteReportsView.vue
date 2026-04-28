<template>
    <div class="h-full flex flex-col bg-gray-50">
        <!-- Header -->
        <div class="flex-none p-6 border-b bg-white shadow-sm flex justify-between items-center z-10">
            <div>
                <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    {{ $t('report.incomplete_reports_title') }}
                </h1>
                <p class="text-sm text-gray-500 mt-1 ml-13">
                    {{ $t('report.incomplete_reports_subtitle') }}
                </p>
            </div>

            <div class="flex items-center gap-4">
                <div class="text-sm font-medium text-gray-500 bg-gray-100 px-3 py-1.5 rounded-lg">
                    {{ incompleteReports.length }} {{ $t('common.items') }}
                </div>
                <button @click="loadReports"
                    class="text-emerald-600 hover:text-emerald-700 p-2 rounded-full hover:bg-emerald-50 transition"
                    :title="$t('common.refresh')">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            </div>
        </div>

        <div class="flex-1 overflow-hidden flex relative">
            <!-- Left Pane: Report List -->
            <div class="w-full md:w-1/3 md:min-w-[360px] md:max-w-md border-r bg-white flex flex-col h-full shadow-[2px_0_10px_rgba(0,0,0,0.02)] z-0 transition-all"
                :class="{ 'hidden md:flex': selectedReport }">

                <!-- List Header with Action Buttons -->
                <div class="flex-none px-6 py-4 border-b bg-gradient-to-r from-white to-gray-50 flex items-center justify-between gap-3">
                    <div class="flex-1">
                        <h2 class="text-base font-bold text-gray-900">{{ $t('report.incomplete_reports') }}</h2>
                        <p class="text-xs text-gray-400 font-medium mt-0.5">{{ $t('report.select_to_complete') }}</p>
                    </div>
                    <button @click="loadReports"
                        class="p-2 rounded-full hover:bg-white transition text-gray-400 hover:text-emerald-600 active:scale-95"
                        :title="$t('common.refresh')">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>

                <div v-if="loading" class="flex-1 flex flex-col items-center justify-center p-8 text-gray-500">
                    <svg class="animate-spin h-8 w-8 text-emerald-500 mb-3" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p class="text-sm font-medium">{{ $t('common.loading') }}...</p>
                </div>

                <div v-else-if="incompleteReports.length === 0"
                    class="flex-1 flex flex-col items-center justify-center p-8 text-gray-400 text-center bg-gradient-to-b from-gray-50 to-white">
                    <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-300" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <p class="font-bold text-gray-700 text-base mb-1">{{ $t('report.all_caught_up') }}</p>
                    <p class="text-xs mt-1">{{ $t('report.no_incomplete_reports') }}</p>
                </div>

                <div v-else class="flex-1 overflow-y-auto">
                    <div v-for="report in incompleteReports" :key="report.id" 
                        @click="selectReport(report)"
                        @keydown.enter="selectReport(report)"
                        @keydown.space="selectReport(report)"
                        role="button"
                        :tabindex="0"
                        class="p-5 border-b hover:bg-emerald-50 cursor-pointer transition-all group relative border-l-4 min-h-[120px] flex flex-col justify-between active:bg-emerald-100"
                        :class="selectedReport?.id === report.id 
                            ? 'bg-emerald-50 border-l-emerald-500 shadow-sm' 
                            : 'border-l-transparent hover:border-l-emerald-300'">

                        <div>
                            <div class="font-bold text-gray-900 text-base mb-2 break-words line-clamp-2">{{ report.studentName }}</div>
                            <div class="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded flex-shrink-0">
                                {{ formatDate(report.date) }}
                            </div>
                        </div>

                        <div class="flex items-center gap-2 text-sm text-gray-600 mb-3 flex-wrap">
                            <span class="font-medium flex-1 break-words line-clamp-1" :title="report.className">{{ report.className }}</span>
                            <span v-if="report.classroomName" class="text-gray-400">•</span>
                            <span v-if="report.classroomName" class="text-gray-600 break-words">{{ report.classroomName }}</span>
                        </div>

                        <div class="flex gap-2 flex-wrap">
                            <span v-if="report.missingContent"
                                class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-200">
                                {{ $t('report.missing_content') }}
                            </span>
                            <span v-if="report.missingLesson"
                                class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">
                                {{ $t('report.missing_unit') }}
                            </span>
                            <span v-if="report.updatedAt"
                                class="text-xs text-gray-400 flex items-center gap-1 ml-auto flex-shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {{ new Date(report.updatedAt || report.lastEditedAt).toLocaleTimeString([], {
                                    hour:
                                        '2-digit', minute: '2-digit'
                                }) }}
                            </span>
                        </div>
                        
                        <!-- Selection Indicator -->
                        <div v-if="selectedReport?.id === report.id" class="absolute top-2 right-2">
                            <div class="w-3 h-3 bg-emerald-500 rounded-full"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Pane: Editor -->
            <div class="flex-1 bg-gray-50 overflow-y-auto p-6 flex flex-col relative w-full md:w-auto"
                :class="{ 'hidden md:flex': !selectedReport }">
                <div v-if="selectedReport" class="flex-1 flex flex-col max-w-4xl mx-auto w-full">
                    <!-- Context Banner -->
                    <div
                        class="bg-white p-6 sm:p-5 rounded-2xl sm:rounded-xl shadow-sm border border-gray-100 mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-2">
                        <div class="flex items-center gap-4">
                            <!-- Back Button (Mobile) -->
                            <button @click="selectedReport = null"
                                class="sm:hidden p-2.5 -ml-2 text-gray-400 hover:text-gray-600 rounded-lg active:bg-gray-100 transition">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <div class="text-center bg-gray-50 p-3 rounded-xl border border-gray-100 min-w-[80px]">
                                <div class="text-xs font-bold text-gray-400 uppercase">{{
                                    formatWeekday(selectedReport.date) }}</div>
                                <div class="text-2xl font-black text-gray-800">{{ new Date(selectedReport.date).getDate()
                                    }}</div>
                                <div v-if="selectedReport.startTime" class="text-[10px] font-bold text-emerald-600">
                                    {{ selectedReport.startTime.slice(0, 5) }}
                                </div>
                            </div>
                            <div class="flex-1">
                                <h3 class="font-bold text-lg sm:text-base text-gray-900 line-clamp-2 break-words">{{ selectedReport.studentName }}</h3>
                                <div class="text-sm sm:text-xs text-gray-500 flex gap-2 flex-wrap">
                                    <span>{{ selectedReport.className }}</span>
                                    <span v-if="selectedReport.classroomName">• {{ selectedReport.classroomName
                                        }}</span>
                                </div>
                            </div>
                        </div>
                        <div class="text-right sm:flex-shrink-0">
                            <div class="text-xs text-gray-400 font-bold uppercase tracking-wider mb-2">{{
                                $t('report.report_id') }}</div>
                            <div class="font-mono text-gray-600 text-xs select-all bg-gray-50 px-3 py-2 rounded-lg inline-block">#{{ selectedReport.id.slice(0, 8) }}
                            </div>
                        </div>
                    </div>

                    <ReportEditor 
                        :key="selectedReport.id" 
                        :report-id="selectedReport.id"
                        :initial-content="selectedReport.content" :initial-version="selectedReport.version"
                        :loading="editorLoading"
                        :title="$t('report.report_for_date', { date: formatDateTime(selectedReport) })"
                        :show-manual-save="true" :available-lessons="activeLessons"
                        :course-name="selectedReport.className" :initial-lesson-id="selectedReport.lessonId"
                        :initial-student-name="selectedReport.studentName"
                        :initial-is-completed="selectedReport.isCompleted"
                        :initial-attendance-status="selectedReport.attendanceStatus"
                        :initial-absence-reason="selectedReport.absenceReason"
                        :initial-class-participation="selectedReport.classParticipation"
                        :initial-classroom-behavior="selectedReport.classroomBehavior"
                        :initial-contact-notes="selectedReport.contactNotes"
                        :initial-class-notes="selectedReport.classNotes"
                        :initial-report-external-link="selectedReport.externalLink"
                        :initial-student-id="selectedReport.fullStudent?.id" @save-success="handleSaveSuccess"
                        @save-error="handleSaveError" />
                </div>

                <div v-else class="flex-1 flex flex-col items-center justify-center text-gray-300 bg-gradient-to-b from-gray-50 to-white p-8">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24 mb-4" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p class="text-lg font-bold text-gray-600">
                        {{ $t('report.select_incomplete_to_edit') }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
// import { LessonService } from '@/services/LessonService' // Removed: file not found
import ReportEditor from '@/components/ReportEditor.vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'

const { locale, t } = useI18n()
const toast = useToast()

const loading = ref(true)
const incompleteReports = ref<any[]>([])
const selectedReport = ref<any>(null)
const editorLoading = ref(false)
const activeLessons = ref<any[]>([]) // Lessons for dropdown

async function loadReports() {
    loading.value = true
    try {
        const raw = await OccurrenceReportService.getGlobalIncompleteReports()
        // Normalize fields to view expectations
        incompleteReports.value = (raw || []).map((r: any) => ({
            id: r.id || r.reportId,
            reportId: r.reportId || r.id,
            enrollmentId: r.enrollmentId,
            occurrenceId: r.occurrenceId,
            studentName: r.studentName || (r.fullStudent?.name) || 'Unknown',
            courseId: r.courseId,
            className: r.className || r.sessionName || '-',
            classroomName: r.classroomName || '-',
            date: r.date || r.occurrenceDate,
            startTime: r.startTime || r.effectiveStartTime,
            content: r.content || '',
            lessonId: r.lessonId || r.lesson_id || null,
            missingContent: typeof r.missingContent === 'boolean' ? r.missingContent : !(r.content && r.content.trim().length > 0),
            missingLesson: typeof r.missingLesson === 'boolean' ? r.missingLesson : !r.lessonId,
            version: r.version,
            attendanceStatus: r.attendanceStatus || r.attendance_status,
            updatedAt: r.updatedAt || r.updated_at,
            isCompleted: r.isCompleted || r.is_completed
        }))

        // Auto-select first if none selected
        if (!selectedReport.value && incompleteReports.value.length > 0) {
            selectReport(incompleteReports.value[0])
        }
    } catch (err) {
        console.error(err)
        toast.error(t('report.load_error'))
    } finally {
        loading.value = false
    }
}

async function selectReport(report: any) {
    if (selectedReport.value?.id === report.id) return

    selectedReport.value = report
    activeLessons.value = [] // Clear immediately to prevent selection mismatch
    editorLoading.value = true

    try {
        // Lessons will be fetched by the watcher on selectedReport
    } catch (e) {
        console.error(e)
    } finally {
        editorLoading.value = false
    }
}

// Watch for selection and fetch lessons
import { watch } from 'vue'
import { supabase } from '@/lib/supabase'

watch(selectedReport, async (newVal) => {
    if (!newVal || !newVal.courseId) {
        activeLessons.value = []
        return
    }

    // Fetch course lessons using courseId from report
    try {
        const { data: lessons, error } = await supabase
            .from('lessons')
            .select('id, title, sequence')
            .eq('course_id', newVal.courseId)
            .order('sequence', { ascending: true })

        if (error) throw error
        activeLessons.value = lessons || []
    } catch (e) {
        console.error('Failed to load lessons for report context', e)
        activeLessons.value = []
    }
})

async function handleSaveSuccess(updatedReport: any) {
    toast.success(t('report.save_success'))

    // Update the local list item
    const idx = incompleteReports.value.findIndex(r => r.id === updatedReport.id)
    if (idx !== -1) {
        // Update content/lesson status
        const item = incompleteReports.value[idx]
        item.content = updatedReport.content
        item.lessonId = updatedReport.lesson_id
        item.version = updatedReport.version
        item.missingContent = !updatedReport.content || updatedReport.content.trim().length === 0
        item.missingLesson = !updatedReport.lesson_id
        item.updatedAt = new Date().toISOString()

        // If it's no longer incomplete, should we remove it?
        // User workflow: "Review and complete". If valid, remove from list.
        if (!item.missingContent && !item.missingLesson) {
            // Remove from list to give sense of progress
            incompleteReports.value.splice(idx, 1)
            selectedReport.value = null // Clear selection

            // Auto-select next
            if (incompleteReports.value.length > 0) {
                selectReport(incompleteReports.value[0])
            }
        }

        // Also update selectedReport to reflect changes if not removed
        if (selectedReport.value?.id === updatedReport.id) {
            selectedReport.value = { ...selectedReport.value, ...item }
        }
    }
}

function handleSaveError(msg: string) {
    toast.error(msg)
}

function formatDate(dateVal: string | Date) {
    return new Date(dateVal).toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
}

function formatDateTime(report: any) {
    const date = new Date(report.date).toLocaleDateString(locale.value)
    const time = report.startTime ? report.startTime.slice(0, 5) : ''
    return `${date} ${time}`.trim()
}

function formatWeekday(dateVal: string | Date) {
    return new Date(dateVal).toLocaleDateString(locale.value, { weekday: 'short' })
}

onMounted(() => {
    loadReports()
})
</script>

<style scoped>
/* Custom scrollbar for better density */
::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}

::-webkit-scrollbar-track {
    background: transparent;
}

::-webkit-scrollbar-thumb {
    background: #e5e7eb;
    border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
    background: #d1d5db;
}
</style>
