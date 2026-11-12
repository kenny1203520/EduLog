<template>
    <div class="report-editor bg-white rounded-lg shadow-sm relative min-h-[400px]" :class="props.compact ? 'p-3' : 'p-4 sm:p-6'" @focusin="handleEditorFieldFocus" @focusout="handleEditorFieldBlur">
        <!-- Loading Overlay -->
        <div v-if="props.loading"
            class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/60 backdrop-blur-[2px] rounded-lg transition-all duration-300">
            <svg class="animate-spin h-10 w-10 text-emerald-500 mb-2" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span class="text-sm font-bold text-gray-500">{{ $t('report.loading_full') }}</span>
        </div>

        <!-- Header (compact: title dropped, status and tools share one row) -->
        <div :class="props.compact ? 'mb-3 flex flex-wrap items-center gap-x-3 gap-y-1' : 'contents'" data-testid="report-editor-header">
        <div class="flex items-center justify-between gap-3">
            <h3 v-if="!props.compact" class="text-lg font-semibold text-gray-800">
                {{ props.title || $t('report.editor.title') }}
            </h3>
            <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <div v-if="onlineParticipantCount > 0" class="flex items-center gap-1 text-xs text-slate-500" aria-live="polite">
                <span class="font-semibold text-emerald-700">{{ onlineParticipantCount }} online</span>
                <span v-for="peer in activePeers.slice(0, 3)" :key="peer.clientId"
                    class="rounded-full px-2 py-0.5 font-medium"
                    :style="{ color: peer.user?.color, backgroundColor: (peer.user?.color || '#94a3b8') + '20' }">
                    {{ peer.user?.name || 'Collaborator' }}<span v-if="peer.activity?.field"> - {{ peer.activity.field }}</span>
                </span>
            </div>
            <RealtimeStatusBadge v-if="effectiveCollaborationEnabled"
                :tone="collaborationBadge.tone"
                :label="collaborationBadge.label"
                :message="collaborationBadge.message"
                :detail="collaborationError ? `${$t('report.editor.collaboration_error_detail')} ${collaborationError}` : null"
                :can-retry="collaborationBadge.canRetry"
                :retry-label="$t('report.editor.collaboration_retry')"
                :status-label="$t('report.editor.collaboration_badge_aria')"
                @retry="reconnectCollaboration" />
            </div>
        </div>

        <div class="flex items-center gap-4">
            <!-- Reference Panel Toggle -->
            <button @click="showReferencePanel = !showReferencePanel"
                class="text-sm font-medium text-gray-600 hover:text-indigo-600 flex items-center gap-1 focus:outline-none"
                :title="$t('report.reference_panel.title')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <span class="hidden sm:inline">{{ $t('report.reference_panel.title') }}</span>
            </button>


            <button @click="showVersionHistoryModal = true"
                class="text-sm font-medium text-gray-600 hover:text-blue-600 flex items-center gap-1 focus:outline-none"
                :title="$t('report.editor.version_history_title')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span class="hidden sm:inline">{{ $t('report.editor.version_history') }}</span>
            </button>

            <button @click="openReportTemplateManagerModal"
                class="text-sm font-medium text-gray-600 hover:text-emerald-600 flex items-center gap-1 focus:outline-none"
                :title="$t('report.editor.templates')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                </svg>
                <span class="hidden sm:inline">{{ $t('report.editor.templates') }}</span>
            </button>

            <!-- Save Status Indicator -->
            <div class="flex items-center gap-2 text-sm ml-auto">
                <span v-if="isSaving" class="text-blue-600 flex items-center gap-1">
                    <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    {{ $t('report.saving') }}
                </span>
                <span v-else-if="saveProblemStatus" :class="saveProblemStatus.className" role="status" data-testid="report-save-problem">
                    {{ saveProblemStatus.text }}
                </span>
                <span v-else-if="lastSaved" class="text-gray-500">
                    {{ getLastSavedString() }}
                </span>
                <span v-else-if="hasUnsavedChanges" class="text-amber-600">
                    {{ $t('report.editor.unsaved_changes') }}
                </span>
                <span v-else class="text-green-600">
                    {{ $t('report.editor.all_saved') }}
                </span>
            </div>

            <!-- Delete Button (not in the side panel: too easy to hit by mistake there) -->
            <button v-if="props.reportId && !props.compact" @click="handleDeleteReport" data-testid="report-delete"
                class="text-sm font-medium text-red-500 hover:text-red-700 flex items-center gap-1 focus:outline-none"
                :title="$t('report.editor.delete_report')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span class="hidden sm:inline">{{ $t('report.editor.delete_report') }}</span>
            </button>
        </div>
        </div>

        <!-- Unsaved draft kept on this device -->
        <ReportDraftRecoveryBanner v-if="pendingDraftRecovery"
            :action="pendingDraftRecovery.action"
            :time="draftRecoveryTime"
            @restore="restoreLocalDraft"
            @discard="discardLocalDraft" />

        <!-- Lesson Selection & Completion  -->
        <div class="grid grid-cols-1">
            <!-- Lesson Selection -->
            <div :class="props.compact ? 'mb-4' : 'mb-6'">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                        <label v-if="false" :for="`${editorId}-lesson`" class="block text-sm font-medium text-gray-700">
                            {{ $t('report.editor.lesson_label') }}
                        </label>
                        <button v-if="selectedLessonId" @click="copyCourseInfo"
                            class="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                            :title="$t('report.editor.copy_course_info')">
                            <svg v-if="!justCopiedCourse" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                            <span v-else class="text-[10px] font-bold text-emerald-600 animate-pulse">{{
                                $t('report.editor.copy_success_simple') }}</span>
                        </button>
                        <button @click="openCourseCopyTemplateModal"
                            class="p-1 text-gray-400 hover:text-indigo-600 transition-colors"
                            :title="$t('report.editor.copy_course_template_settings')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M11.983 5.5l1.165-2.09a1 1 0 011.733 0l1.165 2.09 2.34.414a1 1 0 01.557 1.69l-1.6 1.641.294 2.303a1 1 0 01-1.414 1.04L14 11.61l-2.223.978a1 1 0 01-1.414-1.04l.294-2.303-1.6-1.64a1 1 0 01.557-1.691l2.369-.414zM5 15h14M7 19h10" />
                            </svg>
                        </button>
                    </div>
                    <!-- Enrollment External Link Button -->
                    <a v-if="safeExternalHref(initialEnrollmentExternalLink)" :href="safeExternalHref(initialEnrollmentExternalLink) || undefined" target="_blank" rel="noopener noreferrer"
                        :title="$t('report.editor.view_external_report')" :aria-label="$t('report.editor.view_external_report')"
                        class="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold bg-blue-50 px-2 py-1 rounded-lg border border-blue-100 hover:border-blue-300 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        <span v-if="!props.compact">{{ $t('report.editor.view_external_report') || $t('report.editor.course_folder') }}</span>
                    </a>
                </div>
                <ReportLessonEntriesEditor
                    v-model:entries="lessonEntries"
                    v-model:primary-entry-id="primaryLessonEntryId"
                    :editor-id="editorId"
                    :default-enrollment-id="props.enrollmentId || ''"
                    :default-course-name="props.courseDisplayName || props.courseName"
                    :default-lessons="props.availableLessons"
                    :options="lessonEntryOptions"
                    :options-loading="lessonEntryOptionsLoading"
                    :options-error="lessonEntryOptionsError"
                    :disabled="props.disabled"
                    @retry-options="loadLessonEntryOptions"
                />
                <BaseDropdown v-if="false" :id="`${editorId}-lesson`" data-collab-field="lesson" v-model="selectedLessonId" :options="lessonOptions" :disabled="disabled"
                    theme="emerald" />
                <ReportProgressCheck
                    :compact="props.compact"
                    :loading="progressContextLoading"
                    :error="progressContextError"
                    :gaps="progressGaps"
                    :previous="previousProgressReport"
                    :summary="progressSummary"
                    @retry="loadProgressContext"
                    @view-previous="viewPreviousProgressReport" />
            </div>

            <!-- Source report (imported) -->
            <SourceReportLink v-if="!props.compact" :identity="sourceIdentity" class="mb-4" />

            <!-- Report External Link Input -->
            <div v-if="!props.compact" class="mb-4">
                <label class="block text-xs font-medium text-gray-600 mb-1" for="edulog-reporteditor-225-17005">
                    {{ $t('report.editor.report_link_label') }}
                </label>
                <div class="flex gap-2">
                    <input data-collab-field="external_link" type="url" v-model="reportExternalLink" placeholder="https://..."
                        class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"  id="edulog-reporteditor-225-17005"/>
                    <a v-if="safeExternalHref(reportExternalLink)" :href="safeExternalHref(reportExternalLink) || undefined" target="_blank" rel="noopener noreferrer"
                        class="flex items-center justify-center w-10 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 text-gray-600">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                    </a>
                </div>
            </div>
        </div>

        <!-- Attendance Section -->
        <ReportAttendanceSection
            v-model:attendance-status="attendanceStatus"
            v-model:absence-reason="absenceReason"
            :editor-id="editorId"
            :disabled="disabled"
            :is-system-managed-absence="isSystemManagedAbsence"
            :system-managed-label="getSystemManagedAbsenceLabel()"
            :show-absence-error="showAbsenceError" />

        <!-- Progress Letter (for lesson chapter record) -->
        <div v-if="false" class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-3" for="edulog-reporteditor-308-22308">
                {{ $t('report.editor.progress_label') }}
            </label>

            <div class="mb-4">
                <label class="flex items-center gap-2 cursor-pointer w-fit">
                    <input data-collab-field="completion" type="checkbox" v-model="isCompleted"
                        class="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500"  id="edulog-reporteditor-308-22308"/>
                    <span class="text-sm font-medium text-gray-700">{{ $t('report.editor.lesson_completed') }}</span>
                </label>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <!-- Start Progress -->
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1" for="edulog-reporteditor-323-23049">
                        {{ $t('report.editor.progress_start_label') }}
                    </label>
                    <BaseDropdown data-collab-field="progress" v-model="progressStart" :options="progressOptions" theme="amber"  id="edulog-reporteditor-323-23049"/>
                </div>

                <!-- End Progress -->
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1" for="edulog-reporteditor-331-23445">
                        {{ $t('report.editor.progress_end_label') }}
                    </label>
                    <BaseDropdown data-collab-field="progress" v-model="progressEnd" :options="progressOptions" theme="amber"  id="edulog-reporteditor-331-23445"/>
                </div>
            </div>

            <!-- Progress Display -->
            <div v-if="progressStart || progressEnd" class="mt-2 text-sm text-amber-700">
                <span v-if="progressStart && progressEnd">
                    {{ $t('report.editor.progress_range_display', { start: progressStart, end: progressEnd }) }}
                </span>
                <span v-else-if="progressStart">
                    {{ $t('report.editor.progress_from', { start: progressStart }) }}
                </span>
                <span v-else-if="progressEnd">
                    {{ $t('report.editor.progress_to', { end: progressEnd }) }}
                </span>
            </div>
        </div>

        <!-- Evaluation Section -->
        <div class="flex flex-wrap gap-4 mb-6">
            <div class="flex-1 min-w-[165px]">
                <p class="block text-sm font-medium text-gray-700 mb-2">
                    {{ $t('report.editor.class_participation_label') }}
                </p>
                <div class="flex items-center gap-2">
                    <RatingInput data-collab-field="class_participation" v-model="classParticipation" :show-value="true" />
                </div>
            </div>
            <div class="flex-1 min-w-[165px]">
                <p class="block text-sm font-medium text-gray-700 mb-2">
                    {{ $t('report.editor.classroom_behavior_label') }}
                </p>
                <div class="flex items-center gap-2">
                    <RatingInput data-collab-field="classroom_behavior" v-model="classroomBehavior" :show-value="true" />
                </div>
            </div>
        </div>

        <!-- Editor Font Size Stepper -->
        <div v-if="!props.compact" class="flex items-center gap-4 mb-4 justify-end">
            <div class="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-xl p-1 shadow-sm select-none touch-manipulation">
                <button @click="preferences.adjustEditorScale(-preferences.STEP)"
                    class="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-all font-bold text-xs shadow-sm">
                    -A
                </button>
                <div class="px-3 min-w-[3.5rem] text-center">
                    <span class="text-xs font-bold text-emerald-600">{{ preferences.editorFontScale }}%</span>
                </div>
                <button @click="preferences.adjustEditorScale(preferences.STEP)"
                    class="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-500 hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-all font-bold text-xs shadow-sm">
                    +A
                </button>
            </div>
        </div>

        <!-- Contact Notes -->
        <div class="mb-6">
            <div class="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <svg class="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
                {{ $t('report.editor.contact_notes_label') }}
                <button v-if="props.compact && preferences.editorSettings.formattingEnabled" type="button" data-testid="format-toggle-contact"
                    class="ml-auto inline-flex min-h-[36px] cursor-pointer items-center rounded-md px-2 text-xs font-semibold transition-colors duration-200"
                    :class="panelUi.toolbars.contact ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:bg-gray-100'"
                    :aria-pressed="panelUi.toolbars.contact" :aria-label="$t('report.editor.formatting_toggle_label', { field: $t('report.editor.contact_notes_label') })"
                    @click.prevent="panelUi.toolbars.contact = !panelUi.toolbars.contact">{{ $t('report.editor.formatting_toggle') }}</button>
            </div>
            <CollaborativeTextEditor
                :key="'collab-contact-notes'"
                ref="contactNotesEditor"
                v-if="ready && ydoc"
                v-model="contactNotesEditorValue"
                field-name="contactNotes_xml"
                :ydoc="ydoc"
                :provider="awarenessProvider"
                :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="toolbarVisible('contact')"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                preset="notes"
                :font-scale="preferences.editorFontScale"
                :min-height="120"
                :user="collaborationUser"
                :placeholder="$t('report.editor.contact_notes_placeholder')"
                :aria-label="$t('report.editor.contact_notes_label')"
                @change="handleTextEditorChange('contactNotes', $event)"
                @activity="handleCollaborationActivity('contactNotes', $event)" />
            <!-- Fallback standard editor if ydoc not ready -->
            <TextEditor v-else :key="'plain-contact-notes'" ref="contactNotesEditor" v-model="contactNotesEditorValue" preset="notes" :disabled="props.disabled"
                :aria-label="$t('report.editor.contact_notes_label')"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="toolbarVisible('contact')"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                :font-scale="preferences.editorFontScale" :min-height="120"
                :placeholder="$t('report.editor.contact_notes_placeholder')"
                @change="handleTextEditorChange('contactNotes', $event)" />
        </div>

        <!-- Class Notes -->
        <div class="mb-6">
            <div class="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <svg class="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                {{ $t('report.editor.class_notes_label') }}
                <span class="text-xs text-gray-500 font-normal">{{ $t('report.editor.class_notes_subtitle') }}</span>
                <button v-if="props.compact && preferences.editorSettings.formattingEnabled" type="button" data-testid="format-toggle-class"
                    class="ml-auto inline-flex min-h-[36px] cursor-pointer items-center rounded-md px-2 text-xs font-semibold transition-colors duration-200"
                    :class="panelUi.toolbars.class ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:bg-gray-100'"
                    :aria-pressed="panelUi.toolbars.class" :aria-label="$t('report.editor.formatting_toggle_label', { field: $t('report.editor.class_notes_label') })"
                    @click.prevent="panelUi.toolbars.class = !panelUi.toolbars.class">{{ $t('report.editor.formatting_toggle') }}</button>
            </div>
            <CollaborativeTextEditor
                :key="'collab-class-notes'"
                ref="classNotesEditor"
                v-if="ready && ydoc"
                v-model="classNotesEditorValue"
                field-name="classNotes_xml"
                :ydoc="ydoc"
                :provider="awarenessProvider"
                :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="toolbarVisible('class')"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                preset="notes"
                :font-scale="preferences.editorFontScale"
                :min-height="140"
                mono
                :user="collaborationUser"
                :placeholder="$t('report.editor.class_notes_placeholder')"
                :aria-label="$t('report.editor.class_notes_label')"
                @change="handleTextEditorChange('classNotes', $event)"
                @activity="handleCollaborationActivity('classNotes', $event)" />
            <TextEditor v-else :key="'plain-class-notes'" ref="classNotesEditor" v-model="classNotesEditorValue" preset="notes" :disabled="props.disabled"
                :aria-label="$t('report.editor.class_notes_label')"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="toolbarVisible('class')"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                :font-scale="preferences.editorFontScale" :min-height="140" mono
                :placeholder="$t('report.editor.class_notes_placeholder')"
                @change="handleTextEditorChange('classNotes', $event)" />
        </div>

        <!-- Learning Report (Main Content) -->
        <div class="mb-6">
            <div class="block text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                <span class="flex items-center gap-2">
                    <svg class="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {{ $t('report.editor.learning_report_label') }}
                    <span class="text-xs text-gray-500 font-normal">{{ $t('report.editor.learning_report_subtitle')
                        }}</span>
                </span>
                <span class="flex items-center gap-3">
                    <button v-if="props.compact && preferences.editorSettings.formattingEnabled" type="button" data-testid="format-toggle-learning"
                    class="inline-flex min-h-[36px] cursor-pointer items-center rounded-md px-2 text-xs font-semibold transition-colors duration-200"
                    :class="panelUi.toolbars.learning ? 'bg-emerald-50 text-emerald-700' : 'text-gray-500 hover:bg-gray-100'"
                    :aria-pressed="panelUi.toolbars.learning" :aria-label="$t('report.editor.formatting_toggle_label', { field: $t('report.editor.learning_report_label') })"
                    @click.prevent="panelUi.toolbars.learning = !panelUi.toolbars.learning">{{ $t('report.editor.formatting_toggle') }}</button>
                    <span v-if="wordCount > 0" class="text-xs text-gray-500">
                        {{ wordCount }} {{ $t('report.editor.word_count') }} · {{ characterCount }} {{
                            $t('report.editor.character_count') }}
                    </span>
                    <button v-if="!props.disabled" type="button" data-testid="ai-panel-open"
                        :disabled="!props.reportId"
                        :title="props.reportId ? $t('ai.open_button_hint') : $t('ai.open_button_disabled')"
                        class="inline-flex min-h-[36px] cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 transition-colors duration-200 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                        @click.prevent="showAiPanel = true">
                        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                        {{ $t('ai.open_button') }}
                    </button>
                </span>
            </div>
            <div class="rounded-lg transition-shadow duration-700 motion-reduce:transition-none"
                :class="aiInsertFlash ? 'ring-2 ring-emerald-400 ring-offset-2' : ''">
            <CollaborativeTextEditor
                :key="'collab-content'"
                ref="contentEditor"
                v-if="ready && ydoc"
                v-model="contentEditorValue"
                field-name="content_xml"
                :ydoc="ydoc"
                :provider="awarenessProvider"
                :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="toolbarVisible('learning')"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                preset="report"
                :font-scale="preferences.editorFontScale"
                :min-height="300"
                mono
                :user="collaborationUser"
                :placeholder="props.placeholder || $t('report.editor.learning_report_placeholder')"
                :aria-label="$t('report.editor.learning_report_label')"
                @change="handleTextEditorChange('content', $event)"
                @activity="handleCollaborationActivity('content', $event)" />
            <TextEditor v-else :key="'plain-content'" ref="contentEditor" v-model="contentEditorValue" preset="report"
                :aria-label="$t('report.editor.learning_report_label')"
                :placeholder="props.placeholder || $t('report.editor.learning_report_placeholder')"
                :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="toolbarVisible('learning')"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                :font-scale="preferences.editorFontScale" :min-height="300" mono
                @change="handleTextEditorChange('content', $event)" />
            </div>
        </div>

        <!-- Error Display -->
        <div v-if="saveError" class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <strong>{{ $t('report.editor.error') }}:</strong> {{ saveErrorMessage || saveError }}
        </div>

        <!-- Manual Save Button (Optional) -->
        <div v-if="showManualSave" class="mt-4">
            <button @click="() => saveNow()" :disabled="isSaving || !hasUnsavedChanges || !canSave"
                class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                {{ isSaving ? $t('report.saving') : $t('report.editor.save_now') }}
            </button>
        </div>

        <ReportReferencePanel :show="showReferencePanel" :lesson-id="selectedLessonId"
            :student-id="props.initialStudentId" :enrollment-id="props.enrollmentId" :current-report-id="props.reportId" @close="closeReferencePanel"
            :focused-report-id="focusedProgressReport?.id" :focused-lesson-sequence="focusedProgressReport?.lesson.sequence"
            :focused-lesson-title="focusedProgressReport?.lesson.title" :focused-course-name="props.courseDisplayName || props.courseName"
            :focused-student-name="props.initialStudentName"
            @copy="handleCopyContent" />

        <AiReportPanel :show="showAiPanel" :report-id="props.reportId"
            :templates="savedTemplates.map(t => ({ id: t.id, name: t.name }))"
            :has-content="Boolean(localContent?.trim())" :before-generate="flushBeforeAi"
            @close="showAiPanel = false" @insert="handleAiInsert" @replace="handleAiReplace" />

        <ConfirmModal :is-open="confirmState.isOpen" :title="confirmState.title" :message="confirmState.message"
            :confirm-text="confirmState.confirmText" :is-dangerous="confirmState.isDangerous"
            :is-loading="confirmState.isLoading" @confirm="handleConfirmAction" @close="confirmState.isOpen = false" />

        <CourseCopyTemplateModal
            v-model="showCourseCopyTemplateModal"
            v-model:load-key="selectedCourseTemplateLoadKey"
            v-model:modes="selectedCourseTemplateModes"
            :template-text="courseCopyTemplateText"
            :template-document="courseCopyTemplateDocument"
            :preview-text="courseTemplatePreviewText"
            :variables="courseTemplateVariables"
            :load-options="courseTemplateLoadOptionsDropdown"
            :is-loading="isLoadingCourseCopyTemplate"
            :is-saving="isSavingCourseCopyTemplate"
            @update:template-text="courseCopyTemplateText = $event"
            @update:template-document="courseCopyTemplateDocument = $event"
            @load-selected="loadSelectedCourseTemplate"
            @save="saveCourseCopyTemplate" />

        <ReportTemplateManagerModal
            v-model="showReportTemplateManagerModal"
            v-model:selected-template-id="selectedTemplateId"
            v-model:draft-name="templateDraftName"
            v-model:modes="selectedReportTemplateModes"
            :preview-text="reportTemplatePreviewText"
            :preview-sections="reportTemplatePreviewSections"
            :variables="reportTemplateVariables"
            :variable-preview="reportTemplateVariablePreview"
            :editable-fields="reportTemplateEditableFields"
            :template-options="templateOptionsDropdown"
            :is-loading="isLoadingTemplateManager"
            :is-saving="isSavingTemplate"
            @update:editable-fields-content="onEditableFieldsUpdate"
            @insert-variable="insertReportTemplateVariable"
            @selection-change="syncTemplateDraftFromSelection"
            @new-draft="createNewTemplateDraft"
            @delete="deleteSelectedTemplate"
            @apply="applyTemplateDraftToReport"
            @save="saveTemplateDraft" />

        <ReportVersionHistoryModal v-if="props.reportId" v-model:is-open="showVersionHistoryModal"
            :report-id="props.reportId" :current-version="version" :available-lessons="availableLessons"
            @restored="handleReportRestored" />
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import RatingInput from '@/components/ui/RatingInput.vue'
import RealtimeStatusBadge from '@/components/ui/RealtimeStatusBadge.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import ConfirmModal from '@/components/ui/ConfirmModal.vue'
import TextEditor from '@/components/text-editor/TextEditor.vue'
import CollaborativeTextEditor from '@/components/text-editor/CollaborativeTextEditor.vue'
import type { TextEditorHandle } from '@/components/text-editor/types'
import ReportReferencePanel from '@/components/report/ReportReferencePanel.vue'
import AiReportPanel from '@/components/report/ai/AiReportPanel.vue'
import ReportVersionHistoryModal from '@/components/report/ReportVersionHistoryModal.vue'
import SourceReportLink from '@/components/report/SourceReportLink.vue'
import ReportDraftRecoveryBanner from '@/components/report/ReportDraftRecoveryBanner.vue'
import ReportProgressCheck from '@/components/report/ReportProgressCheck.vue'
import ReportAttendanceSection from '@/components/report/ReportAttendanceSection.vue'
import ReportLessonEntriesEditor from '@/components/report/ReportLessonEntriesEditor.vue'
import CourseCopyTemplateModal from '@/components/report/CourseCopyTemplateModal.vue'
import ReportTemplateManagerModal from '@/components/report/ReportTemplateManagerModal.vue'
import type { ReportEditorEmit, ReportEditorEmits, ReportEditorProps } from '@/components/report/reportEditorContract'
import { usePanelUiState, type PanelToolbar } from '@/composables/usePanelUiState'
import { useConfirmDialog } from '@/composables/useConfirmDialog'
import { useReportEditorSession } from '@/composables/report/useReportEditorSession'
import { useReportProgressContext } from '@/composables/report/useReportProgressContext'
import { useCourseCopyTemplate } from '@/composables/report/useCourseCopyTemplate'
import { useReportTemplateManager } from '@/composables/report/useReportTemplateManager'
import { safeExternalHref } from '@/utils/safeExternalHref'
import { ReportQueryService, type LessonEntryOption } from '@/services/report/ReportQueryService'

const props = withDefaults(defineProps<ReportEditorProps>(), {
    reportId: undefined,
    initialVersion: 1,
    loading: false,
    placeholder: '',
    disabled: false,
    showManualSave: false,
    debounceMs: 2000,
    title: undefined,
    courseName: '',
    courseStage: '',
    courseDisplayName: '',
    initialClassroomName: '',
    initialSessionName: '',
    initialSessionTime: '',
    initialStudentName: '',
    initialStudentId: '',
    initialLessonId: '',
    initialLessonEntries: () => [],
    initialPrimaryLessonEntryId: null,
    availableLessons: () => [],
    initialReportExternalLink: '',
    initialIsCompleted: false,
    initialProgressStart: undefined,
    initialProgressEnd: undefined,
    initialAttendanceStatus: 'pending',
    initialAbsenceReason: undefined,
    initialClassParticipation: null,
    initialClassroomBehavior: null,
    initialContactNotes: '',
    initialContactNotesDocument: null,
    initialClassNotes: '',
    initialClassNotesDocument: null,
    initialContent: '',
    initialContentDocument: null,
    autoSaveEnabled: undefined,
    collaborationEnabled: undefined,
    notificationsEnabled: undefined,
    initialEnrollmentExternalLink: '',
    sourceIdentity: null,
    initialCreatedAt: '',
    compact: false,
})
const editorId = useId()

const emit = defineEmits<ReportEditorEmits>()
const { t } = useI18n()

const showReferencePanel = ref(false)
const showVersionHistoryModal = ref(false)
const showAiPanel = ref(false)

// Compact mode keeps each formatting toolbar behind its own 格式 toggle, remembered in this browser.
const panelUi = usePanelUiState()

const { confirmState, openConfirm, handleConfirmAction } = useConfirmDialog()

const contentEditorRef = useTemplateRef<TextEditorHandle>('contentEditor')
const contactNotesEditorRef = useTemplateRef<TextEditorHandle>('contactNotesEditor')
const classNotesEditorRef = useTemplateRef<TextEditorHandle>('classNotesEditor')

const {
    savedTemplates, isSavingTemplate, isLoadingTemplateManager, showReportTemplateManagerModal, selectedTemplateId,
    templateDraftName, selectedReportTemplateModes, reportTemplateVariables, templateOptionsDropdown,
    reportTemplatePreviewSections, reportTemplatePreviewText, reportTemplateVariablePreview,
    reportTemplateEditableFields, loadTemplates, insertReportTemplateVariable, onEditableFieldsUpdate,
    createNewTemplateDraft, syncTemplateDraftFromSelection, openReportTemplateManagerModal, saveTemplateDraft,
    applyTemplateDraftToReport, deleteSelectedTemplate,
} = useReportTemplateManager({
    context: () => reportTemplateContext(),
    currentFields: () => ({
        content: session.localContent.value,
        contentDocument: session.contentDocument.value,
        contactNotes: session.contactNotes.value,
        contactNotesDocument: session.contactNotesDocument.value,
        classNotes: session.classNotes.value,
        classNotesDocument: session.classNotesDocument.value,
    }),
    currentReport: () => ({ reportId: props.reportId, version: session.version.value }),
    insertRendered: rendered => session.insertRenderedTemplate(rendered),
    openConfirm,
})

onMounted(() => {
    void loadTemplates()
})

const session = useReportEditorSession(props, emit as ReportEditorEmit, {
    editors: { content: contentEditorRef, contactNotes: contactNotesEditorRef, classNotes: classNotesEditorRef },
    openConfirm,
})
const {
    preferences, effectiveCollaborationEnabled,
    ydoc, awarenessProvider, ready, collaborationError, activePeers, onlineParticipantCount, reconnectCollaboration,
    collaborationUser, collaborationBadge, handleEditorFieldFocus, handleEditorFieldBlur, handleCollaborationActivity,
    version, localContent, contentEditorValue, contactNotesEditorValue, classNotesEditorValue,
    lessonEntries, primaryLessonEntryId, selectedLessonId, isCompleted, progressStart, progressEnd, progressLetter, attendanceStatus, absenceReason,
    classParticipation, classroomBehavior, reportExternalLink, isSystemManagedAbsence, getSystemManagedAbsenceLabel,
    showAbsenceError, canSave,
    isSaving, lastSaved, hasUnsavedChanges, saveError, saveErrorMessage, saveProblemStatus, getLastSavedString,
    saveNow, handleReportRestored, handleDeleteReport, handleTextEditorChange,
    wordCount, characterCount,
    pendingDraftRecovery, draftRecoveryTime, restoreLocalDraft, discardLocalDraft,
    handleCopyContent, aiInsertFlash, handleAiInsert, handleAiReplace, flushBeforeAi,
} = session

const lessonEntryOptions = ref<LessonEntryOption[]>([])
const lessonEntryOptionsLoading = ref(false)
const lessonEntryOptionsError = ref('')
let lessonEntryOptionsRequest = 0
async function loadLessonEntryOptions() {
    const reportId = props.reportId
    if (props.disabled || !reportId || props.loading) {
        lessonEntryOptionsRequest += 1
        lessonEntryOptions.value = []
        lessonEntryOptionsError.value = ''
        lessonEntryOptionsLoading.value = false
        return
    }
    const request = ++lessonEntryOptionsRequest
    lessonEntryOptionsLoading.value = true
    lessonEntryOptionsError.value = ''
    try {
        const result = await ReportQueryService.getLessonEntryOptions(reportId)
        if (request === lessonEntryOptionsRequest && props.reportId === reportId) lessonEntryOptions.value = result.enrollments || []
    } catch {
        if (request === lessonEntryOptionsRequest && props.reportId === reportId) {
            lessonEntryOptionsError.value = t('report.editor.lesson_entries.options_error')
        }
    } finally {
        if (request === lessonEntryOptionsRequest) lessonEntryOptionsLoading.value = false
    }
}

watch([() => props.reportId, () => props.loading, () => props.disabled], () => { void loadLessonEntryOptions() }, { immediate: true })

const toolbarVisible = (field: PanelToolbar) => props.compact ? panelUi.toolbars[field] : preferences.editorSettings.toolbarVisible

const {
    progressContextLoading, progressContextError, focusedProgressReport, progressGaps, previousProgressReport,
    progressSummary, loadProgressContext, focusPreviousProgressReport, clearFocusedProgressReport,
} = useReportProgressContext({
    enrollmentId: () => props.enrollmentId,
    classOccurrenceId: () => props.classOccurrenceId,
    reportId: () => props.reportId,
    availableLessons: () => props.availableLessons,
    selectedLessonId,
})

const {
    justCopiedCourse, showCourseCopyTemplateModal, courseCopyTemplateText, courseCopyTemplateDocument,
    isLoadingCourseCopyTemplate, isSavingCourseCopyTemplate, selectedCourseTemplateModes,
    selectedCourseTemplateLoadKey, courseTemplateLoadOptionsDropdown, courseTemplateVariables,
    courseTemplatePreviewText, copyCourseInfo, openCourseCopyTemplateModal, loadSelectedCourseTemplate,
    saveCourseCopyTemplate,
} = useCourseCopyTemplate({
    courseName: () => props.courseName,
    courseDisplayName: () => props.courseDisplayName,
    availableLessons: () => props.availableLessons,
    selectedLessonId,
})

/** Values for `{{variable}}` tokens in report templates. */
function reportTemplateContext() {
    const lesson = props.availableLessons.find(l => l.id === selectedLessonId.value) || props.availableLessons[0] || null
    const studentName = props.initialStudentName
        || props.student?.studentName
        || props.student?.name
        || props.student?.fullName
        || ''
    return {
        classroom_name: props.initialClassroomName || '',
        session_name: props.initialSessionName || '',
        session_time: props.initialSessionTime || '',
        student_name: studentName,
        course_name: [props.courseName, props.courseDisplayName].filter(Boolean).join(' ').trim(),
        lesson: lesson?.sequence !== undefined ? String(lesson.sequence) : '',
        lesson_name: lesson?.title || '',
        progress: progressLetter.value || '',
        progress_start: progressStart.value || '',
        progress_end: progressEnd.value || '',
        is_completed: isCompleted.value ? t('report.completed') : t('report.incomplete')
    }
}

const lessonOptions = computed(() => [
    { label: t('report.editor.select_lesson'), value: '' },
    ...props.availableLessons.map(lesson => ({
        label: `Lesson ${(lesson as any).sequence}: ${(lesson as any).title}`,
        value: lesson.id
    }))
])

const progressOptions = computed(() => [
    { label: t('report.editor.select_progress'), value: '' },
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => ({ label: l, value: l }))
])

function viewPreviousProgressReport() {
    if (focusPreviousProgressReport()) showReferencePanel.value = true
}

function closeReferencePanel() {
    showReferencePanel.value = false
    clearFocusedProgressReport()
}

defineExpose({
    saveNow,
    drain: session.drain,
    retrySave: session.retrySave,
    replaceWithCanonicalReport: session.replaceWithCanonicalReport,
    getSnapshot: session.buildCurrentSnapshot,
    getMetrics: () => session.reportMetrics.value,
    autoSaveStatus: session.autoSaveStatus,
    collaborationStatus: session.collaborationStatus,
    activePeers,
    onlineParticipantCount,
    remoteVersionDrift: session.remoteVersionDrift,
    setAutoSaveEnabled: session.setAutoSaveEnabled,
    configureAutoSave: session.configureAutoSave,
    setCollaborationEnabled: session.setCollaborationEnabled,
    configureCollaboration: session.configureCollaboration,
    getEditorSettings: session.getEditorSettings,
    updateEditorSettings: session.updateEditorSettings,
    resetEditorSettings: session.resetEditorSettings
})
</script>

<style scoped>
.report-editor textarea:focus {
    outline: none;
}
</style>
