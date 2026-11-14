<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'
import ReportEditor from '@/components/report/ReportEditor.vue'
import QuickAttendancePanel from '@/components/classroom/QuickAttendancePanel.vue'
import StudentRosterPanel from '@/components/classroom/StudentRosterPanel.vue'
import TransferredOutStudents from '@/components/classroom/TransferredOutStudents.vue'
import SessionHeader from '@/components/classroom/SessionHeader.vue'
import OccurrenceNavigatorCard from '@/components/classroom/OccurrenceNavigatorCard.vue'
import ClassHeldCard from '@/components/classroom/ClassHeldCard.vue'
import TeacherAttendanceCard from '@/components/classroom/TeacherAttendanceCard.vue'
import StudentFilterBar from '@/components/classroom/StudentFilterBar.vue'
import MakeupStudentModal from '@/components/classroom/MakeupStudentModal.vue'
import TeacherAssignmentModal from '@/components/classroom/TeacherAssignmentModal.vue'
import AttendanceCopyTemplateModal from '@/components/classroom/AttendanceCopyTemplateModal.vue'
import ConflictModal from '@/components/report/ConflictModal.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import KodingCodeCheckModal from '@/components/enrollment/KodingCodeCheckModal.vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/dateUtils'
import { useSessionWorkspace } from '@/composables/session/useSessionWorkspace'
import type { ReportEditorExpose } from '@/composables/session/useSessionReportEditor'
import { useAttendanceCopyTemplate } from '@/composables/session/useAttendanceCopyTemplate'
import { useMakeupEnrollment } from '@/composables/session/useMakeupEnrollment'

const preferences = usePreferencesStore()
const quickReportEditorRef = useTemplateRef<ReportEditorExpose>('quickReportEditor')

const {
    sessionId, session, sessionTimeLabel, loading, occurrenceLoadError, loadData,
    todayOccurrence, selectedDateKey, displayedOccurrenceDate, occurrenceNavigationLabel,
    previousOccurrence, nextOccurrence, isOccurrenceLoading, moveOccurrence, goToToday,
    isCalendarExpanded, toggleCalendarPanel, sessionOccurrences, isPlannedClassDate,
    reportCompletionByDate, joinFlagsByDate, calendarToday, handleCalendarDateSelect, handleCalendarRangeChange,
    isOccurrenceInHoliday, toggleIsConducted,
    realtimeBadge, realtimeStatusMessage, realtimeStatusDetail, lastRealtimeUpdateAt, lastRealtimeUpdateLabel,
    realtimeRefreshError, isRealtimeRefreshing, retryRealtimeAction,
    requestRefreshSchedule, showRefreshConfirm, isRefreshing, handleConfirmRefresh,
    teacherAttendanceRows, teacherAttendanceCounts, canManageTeacherAttendance, toggleTeacherAttendance, teacherRosterFailed, teacherLeaveFailed, loadOccurrenceTeachers,
    openTeacherEditModal, showTeacherEditModal, teacherSearchQuery, currentSessionTeachers, filteredTeachers,
    addTeacherForToday, removeAssignment,
    studentSearchQuery, studentAttendanceFilter, filteredEnrollments, allRosterEnrollments, hasActiveStudentFilters,
    clearStudentFilters, focusRosterStudent, highlightedEnrollmentId,
    isLoadingProgressGaps, progressGapCheckFailed, retryStudentProgressGaps,
    completionFailed, retryReportCompletion, reportLoadFailed, retryOccurrenceReports,
    progressSummaryFailed, retryProgressSummary,
    isQuickAttendanceExpanded, quickAttendanceStudents, selectedEnrollmentIds, attendanceCounts, occupiedRosterCount,
    setAttendance, batchSetAttendance, toggleEnrollmentSelection, toggleSelectAll, studentRosterItems,
    transferredOutStudents, cancellingTransferId, pendingTransferCancel, openTransferTarget, confirmTransferCancel,
    reportMap, savingMap, refreshRosterForDate,
    showKodingCheckModal, kodingTargetEnrollment, kodingInitialLessonId, openStudentKodingCheck,
    showSplitView, selectedEnrollmentId, courseLessons, selectedEditorReport, selectedEditorEnrollment,
    toggleSplitView, closeSplitView, handleEditorUpdate, handleReportExternalLinkUpdate, handleSaveSuccess,
    handleSaveError, handleConflict, handleReportRestored,
    showConflictModal, conflictServerVersion, conflictLocalVersion, conflictServerReport, conflictLocalReport,
    closeConflictModal, resolveConflict,
} = useSessionWorkspace(quickReportEditorRef)

const {
    showAttendanceTemplateModal, attendanceTemplateText, attendanceTemplateDocument, attendanceTemplateScope,
    isLoadingAttendanceTemplate, isSavingAttendanceTemplate, attendanceTemplateLoadOptionsDropdown,
    selectedAttendanceTemplateLoadKey, selectedAttendanceTemplateModes, attendanceTemplateVariables,
    attendanceTemplatePreviewText, loadSelectedAttendanceTemplate, openAttendanceTemplateModal,
    saveAttendanceTemplate, copyAttendanceInfo,
} = useAttendanceCopyTemplate({ sessionId, session, todayOccurrence, rosterEnrollments: allRosterEnrollments, reportMap })

const makeupModal = ref<InstanceType<typeof MakeupStudentModal> | null>(null)
const {
    showAddStudentModal, isAddingStudent, makeupSubmitError, makeupSearch, selectedMakeupStudentId,
    selectedMakeupEnrollmentId, makeupJoinDate, makeupStudentOptions, makeupEnrollmentOptions,
    selectedMakeupEnrollment, handleMakeupStudentChange, openAddStudentModal, closeAddStudentModal,
    submitAddStudentToClass,
} = useMakeupEnrollment({
    sessionId,
    todayOccurrence,
    selectedDateKey,
    refreshRosterForDate,
    focusSubmitError: () => makeupModal.value?.focusSubmitError(),
})
</script>

<template>
    <div class="space-y-8 animate-in fade-in duration-500">
        <SessionHeader
            :session="session"
            :session-time-label="sessionTimeLabel"
            :realtime-badge="realtimeBadge"
            :realtime-status-message="realtimeStatusMessage"
            :realtime-status-detail="realtimeStatusDetail"
            :last-realtime-update-at="lastRealtimeUpdateAt"
            :last-realtime-update-label="lastRealtimeUpdateLabel"
            :realtime-refresh-error="realtimeRefreshError"
            :is-realtime-refreshing="isRealtimeRefreshing"
            :show-split-view="showSplitView"
            @retry-realtime="retryRealtimeAction"
            @refresh-schedule="requestRefreshSchedule"
            @close-split-view="closeSplitView" />

        <div v-if="loading"
            class="flex flex-col items-center justify-center py-32 bg-white rounded-3xl border border-gray-100 shadow-sm">
            <svg class="animate-spin h-10 w-10 text-emerald-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none"
                viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                </path>
            </svg>
            <span class="text-gray-500 font-black italic tracking-widest">{{ $t('student.loading') }}</span>
        </div>

        <div v-else class="session-workspace w-full">
            <div v-if="occurrenceLoadError" class="flex flex-col items-center justify-center rounded-3xl border border-red-100 bg-white px-6 py-20 text-center shadow-sm">
                <p class="font-black text-red-700">{{ occurrenceLoadError }}</p>
                <button type="button" class="mt-5 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white hover:bg-red-700" @click="loadData">
                    {{ $t('classroom.retry_occurrence_load') }}
                </button>
            </div>
            <div v-else class="session-workspace__grid grid min-w-0 grid-cols-1 gap-6 transition-all duration-500 ease-in-out"
                :class="{ 'session-workspace__grid--editing': showSplitView }">

                <!-- LEFT COLUMN: Student List & Stats -->
                <div class="session-workspace__class-column min-w-0 space-y-6"
                    :class="{ 'session-workspace__class-column--editing': showSplitView }">
                    <OccurrenceNavigatorCard
                        :displayed-date="displayedOccurrenceDate"
                        :navigation-label="occurrenceNavigationLabel"
                        :has-previous="Boolean(previousOccurrence)"
                        :has-next="Boolean(nextOccurrence)"
                        :is-loading="isOccurrenceLoading"
                        :calendar-expanded="isCalendarExpanded"
                        :occurrences="sessionOccurrences"
                        :is-planned-date="isPlannedClassDate"
                        :report-completion="reportCompletionByDate"
                        :join-flags="joinFlagsByDate"
                        :today="calendarToday"
                        :selected-date="selectedDateKey"
                        @previous="moveOccurrence('previous')"
                        @next="moveOccurrence('next')"
                        @today="goToToday"
                        @toggle-calendar="toggleCalendarPanel"
                        @select-date="handleCalendarDateSelect"
                        @range-change="handleCalendarRangeChange" />
                    <div v-if="completionFailed && isCalendarExpanded" class="flex flex-wrap items-center gap-2 text-sm text-slate-700">
                        <span role="status">{{ $t('classroom.report_completion_unavailable') }}</span>
                        <button type="button" class="rounded-lg border px-3 py-2 focus-visible:ring-2" @click="retryReportCompletion">{{ $t('classroom.progress_gap_retry') }}</button>
                    </div>

                    <ClassHeldCard v-if="todayOccurrence"
                        :is-conducted="Boolean(todayOccurrence.isConducted)"
                        :is-holiday="isOccurrenceInHoliday"
                        @copy-attendance="copyAttendanceInfo"
                        @edit-template="openAttendanceTemplateModal"
                        @toggle-conducted="toggleIsConducted" />

                    <TeacherAttendanceCard v-if="todayOccurrence"
                        :rows="teacherAttendanceRows"
                        :counts="teacherAttendanceCounts"
                        :can-manage="canManageTeacherAttendance"
                        :is-holiday="isOccurrenceInHoliday"
                        :roster-failed="teacherRosterFailed"
                        :leave-failed="teacherLeaveFailed"
                        @retry="loadOccurrenceTeachers"
                        @edit="openTeacherEditModal"
                        @toggle-attendance="toggleTeacherAttendance" />

                    <StudentFilterBar
                        v-model:search="studentSearchQuery"
                        v-model:attendance="studentAttendanceFilter"
                        :result-count="filteredEnrollments.length" />
                    <div v-for="notice in [
                        { failed: reportLoadFailed, text: 'occurrence_reports_unavailable', retry: retryOccurrenceReports },
                        { failed: progressSummaryFailed, text: 'progress_summary_unavailable', retry: retryProgressSummary }
                    ].filter(item => item.failed)" :key="notice.text" class="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                        <span role="status">{{ $t('classroom.' + notice.text) }}</span>
                        <button type="button" class="rounded-lg border px-3 py-2 focus-visible:ring-2" @click="notice.retry">{{ $t('classroom.progress_gap_retry') }}</button>
                    </div>

                    <div v-if="todayOccurrence && isLoadingProgressGaps" class="mb-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600" role="status" aria-live="polite" aria-busy="true">
                        <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600 motion-reduce:animate-none" aria-hidden="true"></span>
                        {{ $t('classroom.progress_gap_checking') }}
                    </div>
                    <div v-if="todayOccurrence && progressGapCheckFailed" class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950" role="alert" aria-busy="false">
                        <span>{{ $t('classroom.progress_gap_check_failed') }}</span>
                        <button type="button" class="min-h-11 rounded-lg border border-amber-400 bg-white px-4 py-2 text-xs font-black text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700" @click="retryStudentProgressGaps">
                            {{ $t('classroom.progress_gap_retry') }}
                        </button>
                    </div>
                    <QuickAttendancePanel v-if="todayOccurrence"
                        v-model:expanded="isQuickAttendanceExpanded"
                        :students="quickAttendanceStudents"
                        :selected-ids="[...selectedEnrollmentIds]"
                        :counts="attendanceCounts"
                        :disabled="isOccurrenceInHoliday || isOccurrenceLoading"
                        :empty-message="allRosterEnrollments.length === 0 ? $t('classroom.no_students_enrolled') : $t('classroom.no_matching_students')"
                        :show-clear-filters="allRosterEnrollments.length > 0 && hasActiveStudentFilters"
                        @set-attendance="setAttendance"
                        @batch-set-attendance="batchSetAttendance"
                        @toggle-selection="toggleEnrollmentSelection"
                        @toggle-select-all="toggleSelectAll"
                        @add-student="openAddStudentModal"
                        @focus-student="focusRosterStudent"
                        @clear-filters="clearStudentFilters" />

                    <!-- Stats Bar (Conditional or Compact in Split View?) -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-6" v-if="!showSplitView && todayOccurrence">
                        <div
                            class="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-emerald-100 flex items-center justify-between">
                            <div>
                                <h4 class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-2">{{
                                    $t('classroom.total_students') }}</h4>
                                <p class="text-5xl font-black tracking-tighter">{{ allRosterEnrollments.length }}</p>
                            </div>
                            <div class="bg-white/20 p-4 rounded-3xl">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                                </svg>
                            </div>
                        </div>
                        <div v-if="session"
                            class="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm col-span-2 flex items-center gap-12">
                            <div>
                                <h4 class="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">{{
                                    $t('classroom.capacity_utilization') }}</h4>
                                <div class="flex items-end gap-3">
                                    <p class="text-4xl font-black text-gray-900 tracking-tighter">{{
                                        Math.round((occupiedRosterCount / (session?.capacity || 1)) * 100) }}%</p>
                                    <p class="text-xs font-bold text-gray-400 pb-1">/ {{ session?.capacity }} {{
                                        $t('classroom.capacity') }}</p>
                                </div>
                            </div>
                            <div class="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                                <div class="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                                    :style="{ width: `${Math.min((occupiedRosterCount / (session?.capacity || 1)) * 100, 100)}%` }">
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Responsive Card List -->
                    <StudentRosterPanel
                        :items="studentRosterItems"
                        :result-count="filteredEnrollments.length"
                        :has-occurrence="Boolean(todayOccurrence)"
                        :attendance-disabled="isOccurrenceInHoliday || isOccurrenceLoading"
                        :highlighted-enrollment-id="highlightedEnrollmentId"
                        :empty-message="allRosterEnrollments.length === 0 ? $t('classroom.no_students_enrolled') : $t('classroom.no_matching_students')"
                        :show-clear-filters="allRosterEnrollments.length > 0 && hasActiveStudentFilters"
                        @set-attendance="setAttendance"
                        @quick-edit="toggleSplitView"
                        @koding-check="openStudentKodingCheck"
                        @clear-filters="clearStudentFilters" />
                    <TransferredOutStudents
                        :transfers="transferredOutStudents"
                        :cancelling-transfer-id="cancellingTransferId"
                        @open="openTransferTarget"
                        @cancel="pendingTransferCancel = $event" />
                </div>

                <!-- RIGHT COLUMN: Report Editor -->
                <div v-if="showSplitView && selectedEnrollmentId"
                    class="animate-in slide-in-from-right-4 duration-500 min-w-0 w-full">
                    <div class="session-report-editor sticky top-20 min-h-0 bg-white rounded-[2.5rem] border border-emerald-100 shadow-xl shadow-emerald-50/50 flex flex-col overflow-hidden">
                        <!-- Header: Fixed at top of sticky box -->
                        <div
                            class="flex items-center justify-between p-6 pb-4 shrink-0 bg-white z-20 border-b border-gray-50 shadow-sm shadow-gray-50/20">
                            <div class="flex items-center gap-4 min-w-0">
                                <!-- Avatar and Name -->
                                <div
                                    class="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-black text-xl shrink-0 shadow-lg shadow-emerald-100">
                                    {{selectedEditorEnrollment?.studentName?.charAt(0)}}
                                </div>
                                <div class="min-w-0">
                                    <div class="font-black text-gray-900 text-xl leading-tight truncate">
                                        {{selectedEditorEnrollment?.studentName}}
                                    </div>
                                    <div class="flex items-center gap-1.5 mt-1">
                                        <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                        <div class="text-[11px] font-black uppercase tracking-widest text-emerald-600">
                                            {{ displayedOccurrenceDate }}
                                            <span v-if="todayOccurrence?.effectiveStartTime"
                                                class="ml-1 text-emerald-600">
                                                {{ todayOccurrence.effectiveStartTime.slice(0, 5) }}-{{
                                                    todayOccurrence.effectiveEndTime?.slice(0, 5) }}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button @click="closeSplitView"
                                class="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all flex items-center justify-center group active:scale-90">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <!-- Scrollable Body -->
                        <div class="min-h-0 flex-1 overflow-y-auto p-6 pt-4 custom-scrollbar bg-gray-50/30">
                            <ReportEditor ref="quickReportEditor" v-if="selectedEditorReport"
                                :key="selectedEnrollmentId" :report-id="selectedEditorReport?.id"
                                :initial-version="selectedEditorReport?.version"
                                :loading="savingMap.get(selectedEnrollmentId!)" :show-manual-save="true"
                                :enrollment-id="selectedEditorEnrollment?.id" :class-occurrence-id="todayOccurrence?.id"
                                :title="todayOccurrence ? `${new Date(todayOccurrence.occurrenceDate).toLocaleDateString(preferences.locale)} ${todayOccurrence.effectiveStartTime?.slice(0, 5) || ''}` : undefined"
                                :course-name="selectedEditorEnrollment?.courseSubject + ' ' + selectedEditorEnrollment?.courseStage"
                                :course-display-name="selectedEditorEnrollment?.courseDisplayName"
                                :initial-classroom-name="session?.classroom_name" :initial-session-name="session?.name"
                                :initial-session-time="session ? `${session.start_time?.slice(0, 5) || ''}-${session.end_time?.slice(0, 5) || ''}` : ''"
                                :initial-student-name="selectedEditorEnrollment?.studentName"
                                :initial-student-id="selectedEditorEnrollment?.studentId"
                                :initial-lesson-id="selectedEditorReport?.lessonId"
                                :initial-lesson-entries="selectedEditorReport?.lessonEntries"
                                :initial-primary-lesson-entry-id="selectedEditorReport?.primaryLessonEntryId"
                                :available-lessons="courseLessons"
                                :initial-report-external-link="selectedEditorReport?.externalLink"
                                :source-identity="selectedEditorReport"
                                :initial-is-completed="selectedEditorReport?.isCompleted"
                                :initial-progress-start="selectedEditorReport?.progressStart"
                                :initial-progress-end="selectedEditorReport?.progressEnd"
                                :initial-attendance-status="selectedEditorReport?.attendanceStatus"
                                :initial-absence-reason="selectedEditorReport?.absenceReason"
                                :initial-class-participation="parseFloat(String(selectedEditorReport?.classParticipation ?? 0))"
                                :initial-classroom-behavior="parseFloat(String(selectedEditorReport?.classroomBehavior ?? 0))"
                                :initial-contact-notes="selectedEditorReport?.contactNotes"
                                :initial-contact-notes-document="selectedEditorReport?.contactNotesDocument"
                                :initial-class-notes="selectedEditorReport?.classNotes"
                                :initial-class-notes-document="selectedEditorReport?.classNotesDocument"
                                :initial-content="selectedEditorReport?.content"
                                :initial-content-document="selectedEditorReport?.contentDocument"
                                :initial-enrollment-external-link="selectedEditorEnrollment?.externalLink"
                                @update:content="handleEditorUpdate($event, selectedEnrollmentId!)"
                                @update:report-external-link="handleReportExternalLinkUpdate($event, selectedEnrollmentId!)"
                                @save-success="handleSaveSuccess($event, selectedEnrollmentId!)"
                                @save-error="handleSaveError" @conflict="handleConflict"
                                @restored="handleReportRestored" class="h-full border-none shadow-none rounded-none" />

                            <div v-else class="flex flex-col items-center justify-center py-20 text-gray-400">
                                <p class="font-bold">{{ $t('report.no_report_today') }}</p>
                                <p class="text-xs mt-1">{{ $t('report.is_student_active_hint') }}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Conflict Resolution Modal -->
        <ConflictModal v-if="showConflictModal" :is-open="showConflictModal" :serverVersion="conflictServerVersion"
            :localVersion="conflictLocalVersion" :server-report="conflictServerReport!"
            :local-report="conflictLocalReport!" :available-lessons="courseLessons" @close="closeConflictModal"
            @resolve="resolveConflict" />

        <ConfirmModal :is-open="pendingTransferCancel !== null"
            :title="$t('student.transfer_history.cancel_confirm_title')"
            :message="pendingTransferCancel ? $t('classroom.lesson_transfer.cancel_confirm_message', {
                student: pendingTransferCancel.student_name,
                target: [DateUtils.displayDateWithWeekday(pendingTransferCancel.other_occurrence_date, preferences.locale), pendingTransferCancel.other_session_name].filter(Boolean).join(' ')
            }) : ''"
            :confirm-text="$t('student.transfer_history.cancel_transfer')"
            :cancel-text="$t('student.transfer_history.keep_transfer')"
            :is-dangerous="true"
            :is-loading="cancellingTransferId !== null"
            @confirm="confirmTransferCancel"
            @close="pendingTransferCancel = null" />
        <ConfirmModal v-if="showRefreshConfirm" :is-open="showRefreshConfirm" :title="$t('classroom.refresh_schedule')"
            :message="$t('classroom.refresh_confirm')" :confirm-text="$t('common.refresh')" confirm-type="warning"
            :is-loading="isRefreshing" @confirm="handleConfirmRefresh" @close="showRefreshConfirm = false" />

        <KodingCodeCheckModal :is-open="showKodingCheckModal" :target="kodingTargetEnrollment"
            :initial-lesson-id="kodingInitialLessonId" @close="showKodingCheckModal = false" />

        <MakeupStudentModal v-if="showAddStudentModal" ref="makeupModal"
            v-model:search="makeupSearch"
            v-model:student-id="selectedMakeupStudentId"
            v-model:enrollment-id="selectedMakeupEnrollmentId"
            v-model:join-date="makeupJoinDate"
            :submit-error="makeupSubmitError"
            :busy="isAddingStudent"
            :student-options="makeupStudentOptions"
            :enrollment-options="makeupEnrollmentOptions"
            :selected-enrollment="selectedMakeupEnrollment"
            @student-change="handleMakeupStudentChange"
            @close="closeAddStudentModal"
            @submit="submitAddStudentToClass" />

        <AttendanceCopyTemplateModal
            v-model="showAttendanceTemplateModal"
            v-model:scope="attendanceTemplateScope"
            v-model:load-key="selectedAttendanceTemplateLoadKey"
            v-model:modes="selectedAttendanceTemplateModes"
            :template-text="attendanceTemplateText"
            :template-document="attendanceTemplateDocument"
            :preview-text="attendanceTemplatePreviewText"
            :variables="attendanceTemplateVariables"
            :load-options="attendanceTemplateLoadOptionsDropdown"
            :is-loading="isLoadingAttendanceTemplate"
            :is-saving="isSavingAttendanceTemplate"
            @update:template-text="attendanceTemplateText = $event"
            @update:template-document="attendanceTemplateDocument = $event"
            @load-selected="loadSelectedAttendanceTemplate"
            @save="saveAttendanceTemplate" />

        <TeacherAssignmentModal
            v-model:search-query="teacherSearchQuery"
            :open="showTeacherEditModal"
            :session-id="sessionId"
            :date-label="displayedOccurrenceDate"
            :assignments="currentSessionTeachers"
            :teachers="filteredTeachers"
            @close="showTeacherEditModal = false"
            @add="addTeacherForToday"
            @remove="removeAssignment" />
    </div>
</template>

<style scoped>
.session-workspace {
    container-name: session-workspace;
    container-type: inline-size;
}

.session-workspace__class-column--editing {
    display: none;
}

@container session-workspace (min-width: 1100px) {
    .session-workspace__grid--editing {
        grid-template-columns: minmax(520px, 1fr) minmax(480px, 560px);
    }

    .session-workspace__class-column--editing {
        display: block;
    }
}

.session-report-editor {
    max-height: calc(100vh - 6rem);
    max-height: calc(100dvh - 6rem);
}

.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e2e8f0;
    border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #cbd5e1;
}

/* For Firefox */
.custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: #e2e8f0 transparent;
}
</style>
