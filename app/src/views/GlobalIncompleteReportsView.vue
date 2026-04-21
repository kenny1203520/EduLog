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
            <div class="w-full md:w-1/3 md:min-w-[350px] md:max-w-md border-r bg-white flex flex-col h-full shadow-[2px_0_10px_rgba(0,0,0,0.02)] z-0 transition-all"
                :class="{ 'hidden md:flex': selectedReport }">

                <!-- Filters (search, etc in future) -->
                <!-- <div class="p-4 border-b">...</div> -->

                <div v-if="loading" class="flex-1 flex flex-col items-center justify-center p-8 text-gray-500">
                    <svg class="animate-spin h-8 w-8 text-emerald-500 mb-3" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <p class="text-sm font-medium">{{ $t('common.loading') }}...</p>
                </div>

                <div v-else-if="incompleteReports.length === 0"
                    class="flex-1 flex flex-col items-center justify-center p-8 text-gray-400 text-center">
                    <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-300" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <p class="font-medium text-gray-600">{{ $t('report.all_caught_up') }}</p>
                    <p class="text-xs mt-1">{{ $t('report.no_incomplete_reports') }}</p>
                </div>

                <div v-else class="flex-1 overflow-y-auto">
                    <div v-for="report in incompleteReports" :key="report.id" @click="selectReport(report)"
                        class="p-4 border-b hover:bg-emerald-50 cursor-pointer transition-colors group relative border-l-4"
                        :class="selectedReport?.id === report.id ? 'bg-emerald-50 border-l-emerald-500' : 'border-l-transparent hover:border-l-emerald-200'">

                        <div class="flex justify-between items-start mb-2">
                            <div class="font-bold text-gray-900 line-clamp-1">{{ report.studentName }}</div>
                            <div class="text-xs font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                {{ formatDate(report.date) }}
                            </div>
                        </div>

                        <div class="flex items-center gap-2 mb-2 text-xs text-gray-600">
                            <span class="truncate max-w-[150px]" :title="report.className">{{ report.className }}</span>
                            <span v-if="report.classroomName" class="text-gray-400">•</span>
                            <span v-if="report.classroomName" class="text-gray-500">{{ report.classroomName }}</span>
                        </div>

                        <div class="flex gap-2 mt-2">
                            <span v-if="report.missingContent"
                                class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-100">
                                {{ $t('report.missing_content') }}
                            </span>
                            <span v-if="report.missingLesson"
                                class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-100">
                                {{ $t('report.missing_unit') }}
                            </span>
                            <span v-if="report.updatedAt"
                                class="ml-auto text-[10px] text-gray-400 flex items-center gap-1">
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
                    </div>
                </div>
            </div>

            <!-- Right Pane: Editor -->
            <div class="flex-1 bg-gray-50 overflow-y-auto p-6 flex flex-col relative w-full md:w-auto"
                :class="{ 'hidden md:flex': !selectedReport }">
                <div v-if="selectedReport" class="flex-1 flex flex-col max-w-4xl mx-auto w-full">
                    <!-- Context Banner -->
                    <div
                        class="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 animate-in fade-in slide-in-from-bottom-2">
                        <div class="flex items-center gap-4">
                            <!-- Back Button (Mobile) -->
                            <button @click="selectedReport = null"
                                class="md:hidden p-2 -ml-2 text-gray-400 hover:text-gray-600 rounded-full">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <div class="text-center bg-gray-50 p-2 rounded-lg border border-gray-100 min-w-[70px]">
                                <div class="text-xs font-bold text-gray-400 uppercase">{{
                                    formatWeekday(selectedReport.date) }}</div>
                                <div class="text-xl font-black text-gray-800">{{ new Date(selectedReport.date).getDate()
                                    }}</div>
                                <div v-if="selectedReport.startTime" class="text-[10px] font-bold text-emerald-600">
                                    {{ selectedReport.startTime.slice(0, 5) }}
                                </div>
                            </div>
                            <div>
                                <h3 class="font-bold text-lg text-gray-900">{{ selectedReport.studentName }}</h3>
                                <div class="text-sm text-gray-500 flex gap-2">
                                    <span>{{ selectedReport.className }}</span>
                                    <span v-if="selectedReport.classroomName">• {{ selectedReport.classroomName
                                        }}</span>
                                </div>
                            </div>
                        </div>
                        <div class="text-right">
                            <div class="text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">{{
                                $t('report.report_id') }}</div>
                            <div class="font-mono text-gray-600 text-xs select-all">#{{ selectedReport.id.slice(0, 8) }}
                            </div>
                        </div>
                    </div>

                    <ReportEditor :key="selectedReport.id" :report-id="selectedReport.id"
                        :initial-content="selectedReport.content" :initial-version="selectedReport.version"
                        :loading="editorLoading"
                        :title="$t('report.report_for_date', { date: formatDateTime(selectedReport) })"
                        :show-manual-save="true" :available-lessons="activeLessons"
                        :course-name="selectedReport.className" :initial-lesson-id="selectedReport.lessonId"
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

                <div v-else class="flex-1 flex flex-col items-center justify-center text-gray-300">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24 mb-4" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p class="text-lg font-medium">
                        {{ $t('report.select_incomplete_to_edit') }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
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
        incompleteReports.value = await OccurrenceReportService.getGlobalIncompleteReports()
        // If selection exists but is no longer in list, clear it? Or keep it?
        // If we want to auto-select first one:
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
