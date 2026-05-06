<template>
    <div
        class="flex flex-col bg-gray-50 overflow-hidden h-[calc(100dvh-4rem)] lg:h-[calc(100vh-5rem)] -m-4 lg:-mx-8 lg:-mb-8 relative">
        <!-- Header -->
        <div
            class="flex-none bg-white shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] z-20">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex justify-between items-center">
                <div class="flex items-center gap-3 sm:gap-4">
                    <div
                        class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shadow-inner">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 sm:h-6 sm:w-6" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div>
                        <h1 class="text-lg sm:text-2xl font-black text-gray-900 tracking-tight leading-tight">
                            {{ $t('report.incomplete_reports_title') }}
                        </h1>
                        <p class="text-[10px] sm:text-xs font-medium text-gray-400 mt-0.5 line-clamp-1">
                            {{ $t('report.incomplete_reports_subtitle') }}
                        </p>
                    </div>
                </div>

                <div class="flex items-center gap-2 sm:gap-4">
                    <div
                        class="text-[10px] sm:text-sm font-bold text-gray-500 bg-gray-100 px-2 sm:px-3 py-1.5 rounded-lg whitespace-nowrap">
                        {{ incompleteReports.length }} {{ $t('common.items') }}
                    </div>
                    <button @click="requestRefresh"
                        class="text-emerald-600 hover:text-emerald-700 p-1.5 sm:p-2 rounded-full hover:bg-emerald-50 transition"
                        :class="{ 'animate-spin opacity-50 pointer-events-none': isRefreshing }"
                        :disabled="isRefreshing" :title="$t('report.refresh_all')">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>

        <!-- Confirm Modal for Full Refresh -->
        <ConfirmModal :is-open="showRefreshConfirm" :title="$t('report.refresh_all')"
            :message="$t('report.refresh_all_confirm')" :confirm-text="$t('common.refresh')"
            @confirm="handleRefreshConfirm" @close="showRefreshConfirm = false" />

        <div class="flex-1 min-h-0 flex relative overflow-hidden">
            <!-- Left Pane: Report List -->
            <div class="w-full md:w-1/3 md:min-w-[360px] md:max-w-md bg-white flex flex-col h-full z-10 transition-all duration-300 border-r border-gray-100 min-h-0"
                :class="{
                    'hidden md:flex': selectedReport,
                    'md:!w-0 md:!min-w-0 md:!max-w-0 md:opacity-0 md:pointer-events-none md:-translate-x-full': isSidebarCollapsed
                }">

                <!-- List Header with Action Buttons -->
                <div
                    class="flex-none px-6 py-5 bg-gradient-to-b from-white to-gray-50/30 flex items-center justify-between gap-3">
                    <div class="flex-1">
                        <h2 class="text-sm font-black text-gray-400 uppercase tracking-widest">{{
                            $t('report.incomplete_reports') }}</h2>
                        <p class="text-xs text-gray-400 font-medium mt-0.5">{{ $t('report.select_to_complete') }}</p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button @click="loadReports(false)"
                            class="p-2 rounded-full hover:bg-white transition text-gray-400 hover:text-emerald-600 active:scale-95"
                            :class="{ 'animate-spin opacity-50 pointer-events-none': loading }" :disabled="loading"
                            :title="$t('common.refresh')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                        <!-- Collapse Button (Desktop) -->
                        <button @click="isSidebarCollapsed = true"
                            class="hidden md:flex p-2 rounded-full hover:bg-white transition text-gray-400 hover:text-emerald-600 active:scale-95"
                            :title="$t('nav.collapse')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                            </svg>
                        </button>
                    </div>
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

                <div v-else class="flex-1 overflow-y-auto p-3 space-y-2 bg-gray-50/50 custom-scrollbar">
                    <div v-for="report in incompleteReports" :key="report.id" @click="selectReport(report)"
                        @keydown.enter="selectReport(report)" @keydown.space="selectReport(report)" role="button"
                        :tabindex="0"
                        class="p-4 rounded-2xl border bg-white cursor-pointer transition-all shadow-sm flex flex-col justify-between active:scale-[0.98] hover:shadow-md"
                        :class="selectedReport?.id === report.id
                            ? 'border-emerald-500 ring-2 ring-emerald-500 shadow-md relative z-10'
                            : 'border-gray-200 hover:border-emerald-300'">

                        <div>
                            <div class="font-bold text-gray-900 text-base mb-2 break-words line-clamp-2">{{
                                report.studentName }}</div>
                            <div
                                class="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-1 rounded-lg flex-shrink-0 inline-block">
                                {{ formatDate(report.date) }} ({{ formatWeekday(report.date) }}) {{
                                    formatTimeRange(report.startTime, report.endTime) }}
                            </div>
                        </div>

                        <div class="flex items-center gap-2 text-sm text-gray-600 my-3 flex-wrap">
                            <span class="font-medium flex-1 break-words line-clamp-1" :title="report.className">{{
                                report.className }}</span>
                            <span v-if="report.classroomName" class="text-gray-400">•</span>
                            <span v-if="report.classroomName" class="text-gray-600 break-words">{{ report.classroomName
                            }}</span>
                        </div>

                        <div class="flex gap-1.5 flex-wrap">
                            <span v-if="report.missingContent"
                                class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                                {{ $t('report.missing_content') }}
                            </span>
                            <span v-if="report.missingProgress"
                                class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200">
                                {{ $t('report.missing_progress') }}
                            </span>
                            <span v-if="report.missingParticipation"
                                class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                                {{ $t('report.missing_participation') }}
                            </span>
                            <span v-if="report.missingBehavior"
                                class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200">
                                {{ $t('report.missing_behavior') }}
                            </span>
                        </div>

                        <div v-if="report.updatedAt"
                            class="mt-3 text-[10px] text-gray-400 flex items-center justify-end gap-1 flex-shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {{ new Date(report.updatedAt || report.lastEditedAt).toLocaleDateString(undefined, {
                                month:
                            'short', day: 'numeric' }) }} {{ new Date(report.updatedAt ||
                                report.lastEditedAt).toLocaleTimeString([], {
                                    hour:
                                        '2-digit', minute: '2-digit'
                            }) }}
                        </div>
                    </div>
                </div>
            </div>

            <!-- Right Pane: Editor -->
            <div class="flex-1 bg-gray-50 p-4 sm:p-8 flex flex-col relative w-full md:w-auto h-full min-h-0 overflow-hidden"
                :class="{ 'hidden md:flex': !selectedReport }">
                <div v-if="selectedReport" class="flex-1 flex flex-col max-w-7xl mx-auto w-full h-full min-h-0">
                    <!-- Context Banner -->
                    <div
                        class="bg-white p-4 sm:p-5 rounded-2xl sm:rounded-3xl shadow-xl shadow-gray-200/40 border border-gray-100/50 mb-4 sm:mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 animate-in fade-in slide-in-from-bottom-4 shrink-0">
                        <div class="flex items-center gap-3 sm:gap-5">
                            <div class="flex items-center gap-2">
                                <!-- Back Button (Mobile) -->
                                <button @click="selectedReport = null"
                                    class="sm:hidden p-2 -ml-1 text-gray-400 hover:text-emerald-600 rounded-xl active:bg-gray-100 transition-all duration-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>
                                <!-- Expand Sidebar Button (Desktop) -->
                                <button v-if="isSidebarCollapsed" @click="isSidebarCollapsed = false"
                                    class="hidden md:flex p-2 -ml-1 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-all duration-300 shadow-sm border border-emerald-100"
                                    :title="$t('nav.expand')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                    </svg>
                                </button>
                            </div>
                            <div
                                class="text-center bg-gray-50 p-2 sm:p-3 rounded-2xl sm:rounded-3xl border border-gray-100 min-w-[70px] sm:min-w-[90px] shadow-inner">
                                <div
                                    class="text-[8px] sm:text-[10px] font-black text-gray-400 uppercase tracking-tighter">
                                    {{
                                        formatWeekday(selectedReport.date) }}</div>
                                <div class="text-xl sm:text-3xl font-black text-gray-900 leading-none my-0.5 sm:my-1">{{
                                    new
                                        Date(selectedReport.date).getDate()
                                    }}</div>
                                <div v-if="selectedReport.startTime"
                                    class="text-[8px] sm:text-[10px] font-bold text-emerald-600 whitespace-nowrap">
                                    {{ formatTimeRange(selectedReport.startTime, selectedReport.endTime) }}
                                </div>
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 sm:gap-3">
                                    <h3 class="font-black text-base sm:text-lg text-gray-900 tracking-tight truncate">
                                        {{ selectedReport.studentName }}</h3>
                                    <router-link v-if="selectedReport.fullStudent?.id"
                                        :to="`/dashboard/students/${selectedReport.fullStudent.id}`" target="_blank"
                                        class="text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 p-1.5 rounded-lg transition-all shrink-0 shadow-sm"
                                        title="開啟學生個人資料">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                        </svg>
                                    </router-link>
                                </div>
                                <div
                                    class="text-[11px] sm:text-sm font-medium text-gray-400 flex items-center gap-1.5 sm:gap-2 flex-wrap mt-1">
                                    <span class="bg-gray-100 px-1.5 py-0.5 rounded-md truncate max-w-[120px]">{{
                                        selectedReport.className
                                        }}</span>
                                    <span v-if="selectedReport.classroomName" class="flex items-center gap-1">
                                        <div class="w-1 h-1 rounded-full bg-gray-300"></div>
                                        <span class="text-gray-400 truncate max-w-[80px]">{{
                                            selectedReport.classroomName }}</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div class="hidden sm:block text-right flex-shrink-0">
                            <div class="text-[10px] text-gray-400 font-black uppercase tracking-[0.2em] mb-1 px-1">{{
                                $t('report.report_id') }}</div>
                            <div
                                class="font-mono text-gray-400 text-[10px] select-all bg-gray-50 px-3 py-1.5 rounded-xl inline-block border border-gray-100 shadow-inner">
                                #{{ selectedReport.id.slice(0, 8) }}
                            </div>
                        </div>
                    </div>

                    <!-- Scrollable Editor Area -->
                    <div
                        class="flex-1 overflow-y-auto rounded-[2.5rem] bg-white shadow-2xl shadow-gray-200/50 border border-gray-100/50 relative min-h-0 custom-scrollbar">
                        <ReportEditor :key="selectedReport.id + '-' + editorRefreshKey" :report-id="selectedReport.id"
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
                            :initial-progress-start="selectedReport.progressStart"
                            :initial-progress-end="selectedReport.progressEnd"
                            :initial-report-external-link="selectedReport.externalLink"
                            :initial-student-id="selectedReport.fullStudent?.id" @save-success="handleSaveSuccess"
                            @save-error="handleSaveError" @restored="handleReportRestored"
                            class="!rounded-none !shadow-none !border-none" />

                        <!-- Loading Overlay for Editor -->
                        <div v-if="editorLoading"
                            class="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/60 backdrop-blur-[2px] transition-all duration-300">
                            <svg class="animate-spin h-12 w-12 text-emerald-500 mb-4" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                    stroke-width="4" />
                                <path class="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            <p class="text-sm font-black text-gray-400 uppercase tracking-[0.2em] animate-pulse">
                                {{ $t('common.loading') }}
                            </p>
                        </div>
                    </div>
                </div>

                <div v-else
                    class="flex-1 flex flex-col items-center justify-center text-gray-300 bg-gradient-to-b from-gray-50 to-white p-8">
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
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'

const { locale, t } = useI18n()
const toast = useToast()

const loading = ref(true)
const isRefreshing = ref(false)
const showRefreshConfirm = ref(false)
const isSidebarCollapsed = ref(false)
const editorRefreshKey = ref(0)
const incompleteReports = ref<any[]>([])
const selectedReport = ref<any>(null)
const editorLoading = ref(false)
const activeLessons = ref<any[]>([]) // Lessons for dropdown

async function loadReports(refreshEditor = true) {
    loading.value = true
    if (refreshEditor) {
        isRefreshing.value = true
        editorLoading.value = true
    }

    try {
        const raw = await OccurrenceReportService.getGlobalIncompleteReports()
        // Normalize fields to view expectations
        const normalized = (raw || []).map((r: any) => {
            const progress = r.progressLetter || r.progress_letter || ''
            let start = ''
            let end = ''
            if (progress && typeof progress === 'string') {
                const parts = progress.split('-')
                start = parts[0] || ''
                end = parts[1] || ''
            }

            return {
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
                endTime: r.endTime || r.effectiveEndTime,
                content: r.content || '',
                lessonId: r.lessonId || r.lesson_id || null,
                missingContent: typeof r.missingContent === 'boolean' ? r.missingContent : !(r.content && r.content.trim().length > 0),
                missingLesson: typeof r.missingLesson === 'boolean' ? r.missingLesson : !r.lessonId,
                missingProgress: r.missingProgress,
                missingParticipation: r.missingParticipation,
                missingBehavior: r.missingBehavior,
                version: r.version,
                attendanceStatus: r.attendanceStatus || r.attendance_status,
                absenceReason: r.absenceReason || r.absence_reason,
                classParticipation: r.classParticipation || r.class_participation,
                classroomBehavior: r.classroomBehavior || r.classroom_behavior,
                contactNotes: r.contactNotes || r.contact_notes,
                classNotes: r.classNotes || r.class_notes,
                progressLetter: progress,
                progressStart: start,
                progressEnd: end,
                externalLink: r.externalLink || r.external_link,
                updatedAt: r.updatedAt || r.updated_at,
                isCompleted: r.isCompleted || r.is_completed,
                fullStudent: r.fullStudent
            }
        })

        incompleteReports.value = normalized

        // Auto-select first if none selected
        if (!selectedReport.value && normalized.length > 0) {
            selectReport(normalized[0])
        } else if (selectedReport.value) {
            // Re-sync selected report with new data from list
            const found = normalized.find(r => r.id === selectedReport.value.id)
            if (found) {
                selectedReport.value = found
                if (refreshEditor) {
                    editorRefreshKey.value++
                }
            } else {
                selectedReport.value = null
            }
        }

        if (refreshEditor) {
            toast.success(t('report.refresh_success') || 'Refreshed successfully')
        }
    } catch (err) {
        console.error(err)
        toast.error(t('report.load_error'))
    } finally {
        loading.value = false
        isRefreshing.value = false
    }
}

function requestRefresh() {
    showRefreshConfirm.value = true
}

async function handleRefreshConfirm() {
    showRefreshConfirm.value = false
    await loadReports(true)
}

async function selectReport(report: any) {
    if (selectedReport.value?.id === report.id) return
    selectedReport.value = report
}

// Watch for selection and fetch lessons
import { watch } from 'vue'
import { supabase } from '@/lib/supabase'

watch(selectedReport, async (newVal) => {
    if (!newVal || !newVal.courseId) {
        activeLessons.value = []
        editorLoading.value = false
        return
    }

    // Fetch course lessons using courseId from report
    editorLoading.value = true
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
    } finally {
        editorLoading.value = false
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

function handleReportRestored() {
    toast.success(t('report.editor.restore_success'))

    // Refresh the list to reflect restored data and recalculate completeness
    loadReports(true)
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

function formatTimeRange(start?: string, end?: string) {
    if (!start) return ''
    const startStr = start.slice(0, 5)
    if (!end) return startStr
    return `${startStr} - ${end.slice(0, 5)}`
}

function formatWeekday(dateVal: string | Date) {
    return new Date(dateVal).toLocaleDateString(locale.value, { weekday: 'short' })
}

onMounted(() => {
    loadReports()
})
</script>

<style scoped>
.custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgba(0, 0, 0, 0.1) transparent;
}

.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.1);
    border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.2);
}
</style>
