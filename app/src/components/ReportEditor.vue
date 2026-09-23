<template>
    <div class="report-editor bg-white rounded-lg shadow-sm p-4 sm:p-6 relative min-h-[400px]" @focusin="handleEditorFieldFocus" @focusout="handleEditorFieldBlur">
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

        <!-- Header -->
        <div v-if="effectiveCollaborationEnabled && collaborationStatus === 'connecting'"
            class="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700"
            role="status">
            {{ $t('report.editor.collaboration_connecting', 'Collaboration is connecting. You can continue editing.') }}
        </div>
        <div v-else-if="effectiveCollaborationEnabled && (collaborationStatus === 'error' || collabInitialState === 'error')"
            class="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs text-amber-800"
            role="status">
            {{ $t('report.editor.collaboration_fallback', 'Collaboration unavailable; switched to single-user editing. Saving remains available.') }}
            <span v-if="collaborationError" class="sr-only">{{ collaborationError }}</span>
        </div>
        <div v-else-if="effectiveCollaborationEnabled && collaborationRecovered"
            class="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
            role="status">
            {{ $t('report.editor.collaboration_recovered', 'Real-time collaboration has been restored.') }}
        </div>

        <div class="flex items-center justify-between gap-3">
            <h3 class="text-lg font-semibold text-gray-800">
                {{ props.title || $t('report.editor.title') }}
            </h3>
            <div v-if="onlineParticipantCount > 0" class="flex items-center gap-1 text-xs text-slate-500" aria-live="polite">
                <span class="font-semibold text-emerald-700">{{ onlineParticipantCount }} online</span>
                <span v-for="peer in activePeers.slice(0, 3)" :key="peer.clientId"
                    class="rounded-full px-2 py-0.5 font-medium"
                    :style="{ color: peer.user?.color, backgroundColor: (peer.user?.color || '#94a3b8') + '20' }">
                    {{ peer.user?.name || 'Collaborator' }}<span v-if="peer.activity?.field"> - {{ peer.activity.field }}</span>
                </span>
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

            <!-- Delete Button -->
            <button v-if="props.reportId" @click="handleDeleteReport"
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

        <!-- Lesson Selection & Completion  -->
        <div class="grid grid-cols-1">
            <!-- Lesson Selection -->
            <div class="mb-6">
                <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                        <label class="block text-sm font-medium text-gray-700">
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
                        class="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold bg-blue-50 px-2 py-1 rounded-lg border border-blue-100 hover:border-blue-300 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        {{ $t('report.editor.view_external_report') || $t('report.editor.course_folder') }}
                    </a>
                </div>
                <BaseDropdown data-collab-field="lesson" v-model="selectedLessonId" :options="lessonOptions" :disabled="disabled"
                    theme="emerald" />
            </div>

            <!-- Report External Link Input -->
            <div class="mb-4">
                <label class="block text-xs font-medium text-gray-600 mb-1">
                    {{ $t('report.editor.report_link_label') }}
                </label>
                <div class="flex gap-2">
                    <input data-collab-field="external_link" type="url" v-model="reportExternalLink" placeholder="https://..."
                        class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
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
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                {{ $t('report.editor.attendance_title') }}
            </h4>

            <div data-collab-field="attendance" class="flex items-center gap-4 mb-3">
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="pending" v-model="attendanceStatus"
                        :disabled="disabled || isSystemManagedAbsence"
                        class="w-4 h-4 text-gray-400 border-gray-300 focus:ring-gray-400" />
                    <span class="text-sm font-medium text-gray-700">{{ $t('attendance.pending') }}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="present" v-model="attendanceStatus"
                        :disabled="disabled || isSystemManagedAbsence"
                        class="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500" />
                    <span class="text-sm font-medium text-gray-700">{{ $t('attendance.present') }}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="absent" v-model="attendanceStatus"
                        :disabled="disabled || isSystemManagedAbsence"
                        class="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500" />
                    <span class="text-sm font-medium text-gray-700">{{ $t('attendance.absent') }}</span>
                </label>
            </div>

            <!-- Absence Reason (conditional) -->
            <div v-if="attendanceStatus === 'absent'" class="mt-3">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    {{ $t('report.editor.absence_reason_label') }} <span class="text-red-600">*</span>
                </label>

                <!-- System-managed absence reason (read-only) -->
                <div v-if="isSystemManagedAbsence"
                    class="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-600" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div class="flex-1">
                        <p class="text-sm font-semibold text-amber-800">
                            {{ getSystemManagedAbsenceLabel() }}
                        </p>
                        <p class="text-xs text-amber-700 mt-1">
                            {{ $t('report.editor.system_managed_absence_notice',
                                'This absence is managed by the system and cannot be modified.') }}
                        </p>
                    </div>
                </div>

                <!-- User-selectable absence reason -->
                <BaseDropdown v-else v-model="absenceReason" :options="absenceReasonOptions" theme="red" />
                <p v-if="showAbsenceError && !isSystemManagedAbsence" class="mt-1 text-sm text-red-600">{{
                    $t('report.editor.absence_reason_required') }}</p>
            </div>
        </div>

        <!-- Progress Letter (for lesson chapter record) -->
        <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-3">
                {{ $t('report.editor.progress_label') }}
            </label>

            <div class="mb-4">
                <label class="flex items-center gap-2 cursor-pointer w-fit">
                    <input data-collab-field="completion" type="checkbox" v-model="isCompleted"
                        class="w-5 h-5 text-amber-600 border-gray-300 rounded focus:ring-amber-500" />
                    <span class="text-sm font-medium text-gray-700">{{ $t('report.editor.lesson_completed') }}</span>
                </label>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <!-- Start Progress -->
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">
                        {{ $t('report.editor.progress_start_label') }}
                    </label>
                    <BaseDropdown data-collab-field="progress" v-model="progressStart" :options="progressOptions" theme="amber" />
                </div>

                <!-- End Progress -->
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">
                        {{ $t('report.editor.progress_end_label') }}
                    </label>
                    <BaseDropdown data-collab-field="progress" v-model="progressEnd" :options="progressOptions" theme="amber" />
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
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    {{ $t('report.editor.class_participation_label') }}
                </label>
                <div class="flex items-center gap-2">
                    <RatingInput data-collab-field="class_participation" v-model="classParticipation" :show-value="true" />
                </div>
            </div>
            <div class="flex-1 min-w-[165px]">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    {{ $t('report.editor.classroom_behavior_label') }}
                </label>
                <div class="flex items-center gap-2">
                    <RatingInput data-collab-field="classroom_behavior" v-model="classroomBehavior" :show-value="true" />
                </div>
            </div>
        </div>

        <!-- Editor Font Size Stepper -->
        <div class="flex items-center gap-4 mb-4 justify-end">
            <div class="flex items-center gap-1 bg-gray-50 border border-gray-100 rounded-xl p-1 shadow-sm select-none">
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
            <label class="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <svg class="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
                {{ $t('report.editor.contact_notes_label') }}
            </label>
            <CollaborativeTextEditor
                :key="'collab-contact-notes'"
                ref="contactNotesEditorRef"
                v-if="ready && ydoc"
                v-model="contactNotesEditorValue"
                field-name="contactNotes_xml"
                :ydoc="ydoc"
                :provider="awarenessProvider"
                :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="preferences.editorSettings.toolbarVisible"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                preset="notes"
                :font-scale="preferences.editorFontScale"
                :min-height="120"
                :user="collaborationUser"
                :placeholder="$t('report.editor.contact_notes_placeholder')"
                @change="handleTextEditorChange('contactNotes', $event)"
                @activity="handleCollaborationActivity('contactNotes', $event)" />
            <!-- Fallback standard editor if ydoc not ready -->
            <TextEditor v-else :key="'plain-contact-notes'" v-model="contactNotesEditorValue" preset="notes" :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="preferences.editorSettings.toolbarVisible"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                :font-scale="preferences.editorFontScale" :min-height="120"
                :placeholder="$t('report.editor.contact_notes_placeholder')"
                @change="handleTextEditorChange('contactNotes', $event)" />
        </div>

        <!-- Class Notes -->
        <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
                <svg class="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                {{ $t('report.editor.class_notes_label') }}
                <span class="text-xs text-gray-500 font-normal">{{ $t('report.editor.class_notes_subtitle') }}</span>
            </label>
            <CollaborativeTextEditor
                :key="'collab-class-notes'"
                ref="classNotesEditorRef"
                v-if="ready && ydoc"
                v-model="classNotesEditorValue"
                field-name="classNotes_xml"
                :ydoc="ydoc"
                :provider="awarenessProvider"
                :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="preferences.editorSettings.toolbarVisible"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                preset="notes"
                :font-scale="preferences.editorFontScale"
                :min-height="140"
                mono
                :user="collaborationUser"
                :placeholder="$t('report.editor.class_notes_placeholder')"
                @change="handleTextEditorChange('classNotes', $event)"
                @activity="handleCollaborationActivity('classNotes', $event)" />
            <TextEditor v-else :key="'plain-class-notes'" v-model="classNotesEditorValue" preset="notes" :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="preferences.editorSettings.toolbarVisible"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                :font-scale="preferences.editorFontScale" :min-height="140" mono
                :placeholder="$t('report.editor.class_notes_placeholder')"
                @change="handleTextEditorChange('classNotes', $event)" />
        </div>

        <!-- Learning Report (Main Content) -->
        <div class="mb-6">
            <label class="block text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
                <span class="flex items-center gap-2">
                    <svg class="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    {{ $t('report.editor.learning_report_label') }}
                    <span class="text-xs text-gray-500 font-normal">{{ $t('report.editor.learning_report_subtitle')
                        }}</span>
                </span>
                <span v-if="wordCount > 0" class="text-xs text-gray-500">
                    {{ wordCount }} {{ $t('report.editor.word_count') }} · {{ characterCount }} {{
                        $t('report.editor.character_count') }}
                </span>
            </label>
            <CollaborativeTextEditor
                :key="'collab-content'"
                ref="contentEditorRef"
                v-if="ready && ydoc"
                v-model="contentEditorValue"
                field-name="content_xml"
                :ydoc="ydoc"
                :provider="awarenessProvider"
                :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="preferences.editorSettings.toolbarVisible"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                preset="report"
                :font-scale="preferences.editorFontScale"
                :min-height="300"
                mono
                :user="collaborationUser"
                :placeholder="props.placeholder || $t('report.editor.learning_report_placeholder')"
                @change="handleTextEditorChange('content', $event)"
                @activity="handleCollaborationActivity('content', $event)" />
            <TextEditor v-else :key="'plain-content'" v-model="contentEditorValue" preset="report"
                :placeholder="props.placeholder || $t('report.editor.learning_report_placeholder')"
                :disabled="props.disabled"
                :formatting-enabled="preferences.editorSettings.formattingEnabled"
                :toolbar-visible="preferences.editorSettings.toolbarVisible"
                :style-controls-enabled="preferences.editorSettings.styleControlsEnabled"
                :font-scale="preferences.editorFontScale" :min-height="300" mono
                @change="handleTextEditorChange('content', $event)" />
        </div>

        <!-- Error Display -->
        <div v-if="saveError" class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <strong>{{ $t('report.editor.error') }}:</strong> {{ saveError }}
        </div>

        <!-- Manual Save Button (Optional) -->
        <div v-if="showManualSave" class="mt-4">
            <button @click="() => saveNow()" :disabled="isSaving || !hasUnsavedChanges || !canSave"
                class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition">
                {{ isSaving ? $t('report.saving') : $t('report.editor.save_now') }}
            </button>
        </div>

        <ReportReferencePanel :show="showReferencePanel" :lesson-id="selectedLessonId"
            :student-id="props.initialStudentId" :current-report-id="props.reportId" @close="showReferencePanel = false"
            @copy="handleCopyContent" />

        <ConfirmModal :is-open="confirmState.isOpen" :title="confirmState.title" :message="confirmState.message"
            :confirm-text="confirmState.confirmText" :is-dangerous="confirmState.isDangerous"
            :is-loading="confirmState.isLoading" @confirm="handleConfirmAction" @close="confirmState.isOpen = false" />

        <CopyTemplateEditorModal ref="courseTemplateModal" v-model="showCourseCopyTemplateModal"
            :title="$t('report.editor.copy_course_template_title')"
            :hint="$t('report.editor.copy_course_template_hint')"
            :variable-title="$t('report.editor.copy_course_template_variables')"
            :content-title="$t('report.editor.copy_course_template_content')"
            :preview-title="$t('report.editor.copy_course_template_preview_title')"
            :preview-hint="$t('report.editor.copy_course_template_preview_hint')"
            :preview-empty="$t('report.editor.copy_course_template_preview_empty')"
            :template-text="courseCopyTemplateText" :template-document="courseCopyTemplateDocument" :preview-text="courseTemplatePreviewText"
            :variable-count="courseTemplateVariables.length" :is-loading="isLoadingCourseCopyTemplate"
            :loading-text="$t('report.editor.copy_course_template_loading')"
            :loading-hint="$t('report.editor.copy_course_template_loading_hint')"
            :save-loading="isSavingCourseCopyTemplate" :cancel-text="$t('common.cancel')" :save-text="$t('common.save')"
            :saving-text="$t('report.saving')" @update:template-text="courseCopyTemplateText = $event"
            @update:template-document="courseCopyTemplateDocument = $event"
            @save="saveCourseCopyTemplate">
            <template #controls>
                <div class="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                    <div class="flex flex-col gap-2 md:flex-row md:items-end">
                        <div class="flex-1">
                            <label class="block text-xs font-bold uppercase tracking-wide text-amber-900 mb-1">
                                {{ $t('report.editor.copy_course_template_load_from') }}
                            </label>
                            <BaseDropdown v-model="selectedCourseTemplateLoadKey"
                                :options="courseTemplateLoadOptionsDropdown" theme="amber" />
                        </div>
                        <button @click="loadSelectedCourseTemplate"
                            class="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-amber-600"
                            :disabled="!selectedCourseTemplateLoadKey">
                            {{ $t('report.editor.copy_course_template_load_action') }}
                        </button>
                    </div>
                </div>
            </template>
            <template #variables>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div v-for="variable in courseTemplateVariables" :key="variable.key"
                        class="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <p class="text-sm font-bold leading-tight text-gray-900">{{ variable.label }}</p>
                                <p class="mt-1 text-xs leading-5 text-gray-500">{{ variable.description }}</p>
                            </div>
                            <button @click="insertCourseTemplateVariable(variable.key)"
                                class="shrink-0 whitespace-nowrap rounded-lg bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                                :title="variable.token">
                                {{ variable.token }}
                            </button>
                        </div>

                        <div v-if="variable.modeOptions?.length" class="space-y-1">
                            <label class="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                {{ $t('report.editor.copy_course_template_variable_mode_label') }}
                            </label>
                            <BaseDropdown v-model="selectedCourseTemplateModes[variable.key]"
                                :options="variable.modeOptions || []" theme="emerald" />
                        </div>

                        <div>
                            <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                                {{ $t('report.editor.copy_course_template_preview_title') }}
                            </p>
                            <p
                                class="min-h-[3.25rem] whitespace-pre-wrap break-words rounded-xl border border-gray-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                                {{ variable.previewValue || '—' }}
                            </p>
                        </div>
                    </div>
                </div>
            </template>
        </CopyTemplateEditorModal>

        <CopyTemplateEditorModal ref="reportTemplateModal" v-model="showReportTemplateManagerModal"
            :title="$t('report.editor.template_manager_title')" :hint="$t('report.editor.template_manager_hint')"
            :variable-title="$t('report.editor.template_manager_fields')"
            :preview-title="$t('report.editor.template_preview_title')"
            :preview-hint="$t('report.editor.template_preview_hint')"
            :preview-empty="$t('report.editor.template_preview_empty')" :preview-text="reportTemplatePreviewText"
            :preview-sections="reportTemplatePreviewSections" :variable-count="reportTemplateVariables.length"
            :is-loading="isLoadingTemplateManager" :loading-text="$t('report.editor.template_manager_loading')"
            :loading-hint="$t('report.editor.template_manager_loading_hint')" :save-loading="isSavingTemplate"
            :save-disabled="!templateDraftName.trim()" :cancel-text="$t('common.cancel')"
            :save-text="$t('report.editor.template_save_action')" :saving-text="$t('report.saving')"
            :editable-fields="reportTemplateEditableFields" :variable-preview="reportTemplateVariablePreview"
            @update:editable-fields-content="onEditableFieldsUpdate" @insert-variable="insertReportTemplateVariable"
            @save="saveTemplateDraft">
            <template #controls>
                <div class="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3 space-y-3">
                    <div class="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
                        <div>
                            <label class="block text-xs font-bold uppercase tracking-wide text-amber-900 mb-1">
                                {{ $t('report.editor.template_select_label') }}
                            </label>
                            <BaseDropdown v-model="selectedTemplateId" :options="templateOptionsDropdown" theme="amber"
                                @change="handleTemplateSelectionChange" />
                        </div>
                        <button @click="createNewTemplateDraft"
                            class="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-100">
                            {{ $t('report.editor.template_new_action') }}
                        </button>
                        <button @click="deleteSelectedTemplate" :disabled="!selectedTemplateId"
                            class="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50">
                            {{ $t('common.delete') }}
                        </button>
                    </div>

                    <div class="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto] md:items-end">
                        <div>
                            <label class="block text-xs font-bold uppercase tracking-wide text-amber-900 mb-1">
                                {{ $t('report.editor.template_name_label') }}
                            </label>
                            <input v-model="templateDraftName" type="text"
                                :placeholder="$t('report.editor.template_name_placeholder')"
                                class="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        <button @click="applyTemplateDraftToReport"
                            class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-700">
                            {{ $t('report.editor.template_apply_to_report') }}
                        </button>
                    </div>

                    <div class="rounded-xl border border-purple-200 bg-purple-50/60 p-3 space-y-2">
                        <div class="flex flex-wrap gap-2">
                            <button v-for="variable in reportTemplateVariables" :key="variable.key"
                                @click="insertVariableToFocusedField(variable.key)"
                                @mouseenter="handleTemplateVariableMouseEnter(variable.key, $event)"
                                @mouseleave="handleTemplateVariableMouseLeave"
                                class="relative rounded-lg bg-purple-100 px-2 py-1 text-xs font-semibold text-purple-800 transition hover:bg-purple-200"
                                :title="variable.description">
                                {{ variable.token }}
                            </button>
                        </div>
                        <p class="text-xs text-purple-700">{{ $t('report.editor.template_variable_auto_insert_hint') }}
                        </p>

                        <!-- Variable Mode Selectors -->
                        <div v-if="reportTemplateVariables.some(v => v.modes?.length)"
                            class="mt-2 pt-2 border-t border-purple-200/50">
                            <div class="flex flex-wrap gap-4">
                                <div v-for="variable in reportTemplateVariables.filter(v => v.modes?.length)"
                                    :key="variable.key" class="space-y-1">
                                    <label
                                        class="block text-[10px] font-bold uppercase tracking-wider text-purple-900/60">
                                        {{ variable.label }} {{
                                            $t('report.editor.copy_course_template_variable_mode_label') }}
                                    </label>
                                    <BaseDropdown v-model="selectedReportTemplateModes[variable.key]"
                                        :options="(variable.modes || []).map(m => ({ label: $t(`report.editor.copy_course_template_variable_modes.${m.value}`), value: m.value }))"
                                        theme="emerald" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </template>

            <template #variables>
                <!-- Variables section can be empty as we're using inline variable buttons in controls -->
            </template>
        </CopyTemplateEditorModal>

        <ReportVersionHistoryModal v-if="props.reportId" v-model:is-open="showVersionHistoryModal"
            :report-id="props.reportId" :current-version="version" :available-lessons="availableLessons"
            @restored="handleReportRestored" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, type WatchStopHandle } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAutoSave, type AutoSaveErrorContext } from '@/composables/useAutoSave'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import { useAuthStore } from '@/stores/useAuthStore'
import RatingInput from '@/components/common/RatingInput.vue'
import BaseDropdown from '@/components/common/BaseDropdown.vue'
import TextEditor from '@/components/common/text-editor/TextEditor.vue'
import CollaborativeTextEditor from '@/components/common/text-editor/CollaborativeTextEditor.vue'
import { insertTextAtSelection, type RichTextDocumentV1, type TextEditorChange, type TextEditorContent, type TextEditorHandle, type TextEditorMetrics } from '@/components/common/text-editor/types'
import { calculateTextEditorMetrics, createTextEditorContent, renderTemplateContent } from '@/components/common/text-editor/content'
import { createEditorNotifier, type EditorNotification } from '@/components/common/text-editor/notifier'
import { DEFAULT_EDITOR_USER_SETTINGS, normalizeEditorUserSettings, type EditorUserSettings } from '@/components/common/text-editor/settings'
import CopyTemplateEditorModal from '@/components/common/CopyTemplateEditorModal.vue'
import ReportReferencePanel from '@/components/ReportReferencePanel.vue'
import ReportVersionHistoryModal from '@/components/ReportVersionHistoryModal.vue'
import { ReportTemplateService } from '@/services/report/ReportTemplateService'
import { CopyTemplateService, type CopyTemplateLoadOption } from '@/services/copy_template/CopyTemplateService'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { useToast } from 'vue-toastification'
import { useReportCollab } from '@/composables/useReportCollab'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import type {
    OccurrenceReportDTO,
    ReportDraftSnapshot,
    SaveReportResult
} from '@/models/OccurrenceReport'
import {
    COURSE_TEMPLATE_VARIABLE_DEFINITIONS,
    SYSTEM_COURSE_TEMPLATE,
    formatCopyTemplateToken,
    renderCopyTemplate,
    createNumberFormatters
} from '@/utils/copyTemplate'
import { copyRichTextToClipboard } from '@/utils/clipboard'
import { formatNumber } from '@/utils/numberFormatting'
import { safeExternalHref } from '@/utils/safeExternalHref'
import { mergeReportConflict } from '@/services/report/ReportConflictMerge'

import type { Lesson } from '@/models/Course'

interface Props {
    reportId?: string // 報告ID
    initialVersion?: number // 報告版本
    loading?: boolean // 是否載入中
    placeholder?: string // 報告預設文字
    disabled?: boolean // 是否禁用
    showManualSave?: boolean // 是否顯示手動儲存
    debounceMs?: number // 停止輸入後多久自動儲存(ms)
    enrollmentId?: string // 課程報名ID
    classOccurrenceId?: string // 課堂上課日期時間ID
    title?: string // 報告標題
    courseName?: string // 課程名稱
    courseStage?: string // 課程階段
    courseDisplayName?: string // 課程顯示名稱
    initialClassroomName?: string // 教室名稱
    initialSessionName?: string // 班級名稱
    initialSessionTime?: string // 班級時段
    initialStudentName?: string // 學生姓名
    initialStudentId?: string // 學生ID
    student?: any // 學生
    initialLessonId?: string // 課次
    availableLessons?: Lesson[] // 可選課次清單
    initialReportExternalLink?: string // 外部連結
    initialIsCompleted?: boolean // 是否完整完成
    initialProgressStart?: string // 進度開始
    initialProgressEnd?: string // 進度結束
    initialAttendanceStatus?: 'present' | 'absent' | 'pending' // 出缺勤狀態
    initialAbsenceReason?: string // 缺勤原因
    initialClassParticipation?: number // 課堂參與
    initialClassroomBehavior?: number // 課堂秩序
    initialContactNotes?: string // 聯絡欄
    initialContactNotesDocument?: RichTextDocumentV1 | null
    initialClassNotes?: string // 課堂筆記/紀錄
    initialClassNotesDocument?: RichTextDocumentV1 | null
    initialContent?: string // 學習報告
    initialContentDocument?: RichTextDocumentV1 | null
    autoSaveEnabled?: boolean
    collaborationEnabled?: boolean
    notificationsEnabled?: boolean
    initialEnrollmentExternalLink?: string // 課程外部連結
    initialCreatedAt?: string // 建立時間
    compact?: boolean // 是否為緊湊模式 (for split view)
}

const props = withDefaults(defineProps<Props>(), {
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
    availableLessons: () => [],
    initialReportExternalLink: '',
    initialIsCompleted: false,
    initialProgressStart: undefined,
    initialProgressEnd: undefined,
    initialAttendanceStatus: 'pending',
    initialAbsenceReason: undefined,
    initialClassParticipation: 0,
    initialClassroomBehavior: 0,
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
    initialCreatedAt: '',
    compact: false,
})

const emit = defineEmits<{
    'update:content': [content: string]
    'save-success': [report: OccurrenceReportDTO]
    'update:report-external-link': [value: string]
    'save-error': [error: string]
    'conflict': [serverReport: OccurrenceReportDTO, localReport: OccurrenceReportDTO]
    'deleted': []
    'restored': [report: OccurrenceReportDTO]
    'notification': [notification: EditorNotification]
    'metrics-change': [metrics: Record<'content' | 'contactNotes' | 'classNotes' | 'total', TextEditorMetrics>]
}>()

interface Template {
    id: string
    name: string
    content: string
    contactNotes?: string
    classNotes?: string
    contentDocument?: RichTextDocumentV1
    contactNotesDocument?: RichTextDocumentV1
    classNotesDocument?: RichTextDocumentV1
}

interface ReportTemplateVariableItem {
    key: string
    token: string
    label: string
    description: string
    modes?: Array<{ value: string; label: string }>
}

// Templates State
const showReferencePanel = ref(false)
const showVersionHistoryModal = ref(false)
const savedTemplates = ref<Template[]>([])
const justCopiedCourse = ref(false)
const isSavingTemplate = ref(false)
const isLoadingTemplateManager = ref(false)
const showCourseCopyTemplateModal = ref(false)
let courseTemplateRequestGeneration = 0
const courseCopyTemplateText = ref(SYSTEM_COURSE_TEMPLATE)
const courseCopyTemplateDocument = ref(createTextEditorContent(SYSTEM_COURSE_TEMPLATE, { templateVariables: true }).richText)
const isLoadingCourseCopyTemplate = ref(false)
const isSavingCourseCopyTemplate = ref(false)
const selectedCourseTemplateModes = ref<Record<string, string>>({
    course_primary_name: 'space'
})
const courseTemplateLoadOptions = ref<Array<CopyTemplateLoadOption & { displayLabel: string }>>([])
const selectedCourseTemplateLoadKey = ref('')
const showReportTemplateManagerModal = ref(false)
let reportTemplateRequestGeneration = 0
const reportTemplateModal = ref<InstanceType<typeof CopyTemplateEditorModal> | null>(null)
const courseTemplateModal = ref<InstanceType<typeof CopyTemplateEditorModal> | null>(null)
const selectedTemplateId = ref('')
const templateDraftName = ref('')
const templateDraftContent = ref('')
const templateDraftContentDocument = ref(createTextEditorContent('', { templateVariables: true }).richText)
const templateDraftContactNotes = ref('')
const templateDraftContactNotesDocument = ref(createTextEditorContent('', { templateVariables: true }).richText)
const templateDraftClassNotes = ref('')
const templateDraftClassNotesDocument = ref(createTextEditorContent('', { templateVariables: true }).richText)
const selectedReportTemplateModes = ref<Record<string, string>>({
    lesson: 'arabic'
})

const preferences = usePreferencesStore()
const toast = useToast()
const effectiveAutoSaveEnabled = computed(() => props.autoSaveEnabled ?? preferences.editorSettings.autoSave.enabled)
const effectiveCollaborationEnabled = computed(() => props.collaborationEnabled ?? preferences.editorSettings.collaboration.enabled)
const effectiveNotificationsEnabled = computed(() => props.notificationsEnabled ?? preferences.editorSettings.notificationsEnabled)
const editorNotifier = createEditorNotifier(notification => emit('notification', notification), toast, effectiveNotificationsEnabled.value)
watch(effectiveNotificationsEnabled, enabled => editorNotifier.setEnabled(enabled))

// Confirm Modal State
const confirmState = ref({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDangerous: false,
    isLoading: false,
    action: null as Function | null
})

const openConfirm = (title: string, message: string, action: Function, isDangerous = false) => {
    confirmState.value = {
        isOpen: true,
        title,
        message,
        confirmText: t('common.confirm', 'Confirm'),
        isDangerous,
        isLoading: false,
        action
    }
}

const handleConfirmAction = async () => {
    if (confirmState.value.action) {
        try {
            confirmState.value.isLoading = true
            await confirmState.value.action()
            confirmState.value.isOpen = false
        } catch (e) {
            console.error(e)
        } finally {
            confirmState.value.isLoading = false
        }
    } else {
        confirmState.value.isOpen = false
    }
}

const handleCopyContent = (text: string) => {
    if (!text) return
    if (isTextEditorHandle(contentEditorRef.value)) {
        const current = contentEditorRef.value.getText()
        contentEditorRef.value.replaceText(current + (current ? '\n\n' : '') + text, { emitChange: true })
    } else {
        const current = localContent.value || ''
        localContent.value = current + (current ? '\n\n' : '') + text
        handleInput()
    }
}

async function loadTemplates() {
    if (!authStore.user?.id) return
    try {
        const res = await ReportTemplateService.getTemplates(authStore.user.id)
        savedTemplates.value = res.map(t => ({
            id: t.id!,
            name: t.name,
            content: t.content,
            contentDocument: t.contentDocument,
            contactNotes: t.contactNotes,
            contactNotesDocument: t.contactNotesDocument,
            classNotes: t.classNotes,
            classNotesDocument: t.classNotesDocument
        }))
    } catch (e) {
        console.error('Failed to load templates', e)
    }
}

const reportTemplateVariables = computed<ReportTemplateVariableItem[]>(() => {
    const keys = [
        'classroom_name',
        'session_name',
        'session_time',
        'student_name',
        'course_name',
        'lesson',
        'lesson_name',
        'progress',
        'progress_start',
        'progress_end',
        'is_completed'
    ]

    return keys.map(key => {
        const definition = key === 'lesson'
            ? { modes: [{ value: 'arabic', label: 'arabic' }, { value: 'roman', label: 'roman' }, { value: 'chinese', label: 'chinese' }, { value: 'formal', label: 'formal' }] }
            : {}

        return {
            key,
            token: formatCopyTemplateToken(key, selectedReportTemplateModes.value[key]),
            label: t(`report.editor.template_variable_descriptions.${key}`),
            description: t(`report.editor.template_variable_descriptions.${key}`),
            ...definition
        }
    })
})

const lessonOptions = computed(() => [
    { label: t('report.editor.select_lesson'), value: '' },
    ...props.availableLessons.map(lesson => ({
        label: `Lesson ${(lesson as any).sequence}: ${(lesson as any).title}`,
        value: lesson.id
    }))
])

const absenceReasonOptions = computed(() => [
    { label: t('report.editor.select_reason'), value: '' },
    ...([
        'busy_with_schoolwork',
        'school_event',
        'family_matter',
        'sick_or_injured',
        'reason_not_provided',
        'travel_abroad',
        'family_ceremony',
        'school_activity',
        'suspension',
        'other'
    ].map(key => ({
        label: t(`report.editor.absence_reasons.${key}`),
        value: t(`report.editor.absence_reasons.${key}`)
    })))
])

const progressOptions = computed(() => [
    { label: t('report.editor.select_progress'), value: '' },
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => ({ label: l, value: l }))
])

const templateOptionsDropdown = computed(() => [
    { label: t('report.editor.template_new_option'), value: '' },
    ...savedTemplates.value.map(t => ({ label: t.name, value: t.id }))
])

const courseTemplateLoadOptionsDropdown = computed(() => courseTemplateLoadOptions.value.map(opt => ({
    label: opt.displayLabel,
    value: opt.key
})))

function buildReportTemplateContext() {
    const lesson = selectedCoursePreviewLesson.value
    const studentName = props.initialStudentName
        || props.student?.studentName
        || props.student?.name
        || props.student?.fullName
        || ''
    const sessionName = props.initialSessionName || ''
    const classroomName = props.initialClassroomName || ''
    const sessionTime = props.initialSessionTime || ''
    const courseName = [props.courseName, props.courseDisplayName].filter(Boolean).join(' ').trim()

    return {
        classroom_name: classroomName,
        session_name: sessionName,
        session_time: sessionTime,
        student_name: studentName,
        course_name: courseName,
        lesson: lesson?.sequence !== undefined ? String(lesson.sequence) : '',
        lesson_name: lesson?.title || '',
        progress: progressLetter.value || '',
        progress_start: progressStart.value || '',
        progress_end: progressEnd.value || '',
        is_completed: isCompleted.value ? t('report.completed') : t('report.incomplete')
    }
}

function renderReportTemplateText(text: string): string {
    if (!text.trim()) {
        return ''
    }
    const formatters = {
        lesson: createNumberFormatters('lesson')
    }
    return renderCopyTemplate(text, buildReportTemplateContext(), formatters).trim()
}

const reportTemplatePreviewSections = computed(() => {
    return [
        {
            title: t('report.editor.contact_notes_label'),
            content: renderReportTemplateText(templateDraftContactNotes.value)
        },
        {
            title: t('report.editor.class_notes_label'),
            content: renderReportTemplateText(templateDraftClassNotes.value)
        },
        {
            title: t('report.editor.learning_report_label'),
            content: renderReportTemplateText(templateDraftContent.value)
        }
    ]
})

const reportTemplatePreviewText = computed(() => {
    return reportTemplatePreviewSections.value
        .map(section => `[${section.title}]\n${section.content}`)
        .join('\n\n')
        .trim()
})

// Variable preview mapping for tooltip display
const reportTemplateVariablePreview = computed<Record<string, string>>(() => {
    const context = buildReportTemplateContext()
    return Object.entries(context).reduce((acc, [key, value]) => {
        const mode = selectedReportTemplateModes.value[key]
        if (mode) {
            acc[key] = formatNumber(value, mode)
        } else {
            acc[key] = String(value || '')
        }
        return acc
    }, {} as Record<string, string>)
})

// Editable fields structure for multi-field modal
const reportTemplateEditableFields = computed<Array<{ id: string; label: string; content: string; document: RichTextDocumentV1 }>>(() => {
    return [
        {
            id: 'contact',
            label: t('report.editor.contact_notes_label'),
            content: templateDraftContactNotes.value
            ,document: templateDraftContactNotesDocument.value
        },
        {
            id: 'class',
            label: t('report.editor.class_notes_label'),
            content: templateDraftClassNotes.value
            ,document: templateDraftClassNotesDocument.value
        },
        {
            id: 'report',
            label: t('report.editor.learning_report_label'),
            content: templateDraftContent.value
            ,document: templateDraftContentDocument.value
        }
    ]
})

function insertReportTemplateVariable(fieldId: string, variable: string, caret = -1, selectionEnd = -1) {
    const mode = selectedReportTemplateModes.value[variable]
    const token = formatCopyTemplateToken(variable, mode)
    const insertAtSelection = (content: string) => {
        const start = caret < 0 ? content.length : caret
        const end = selectionEnd < 0 ? content.length : selectionEnd
        return insertTextAtSelection(content, token, start, end)
    }
    if (fieldId === 'contact') {
        templateDraftContactNotes.value = insertAtSelection(templateDraftContactNotes.value)
        templateDraftContactNotesDocument.value = createTextEditorContent(templateDraftContactNotes.value, { templateVariables: true }).richText
        return
    }
    if (fieldId === 'class') {
        templateDraftClassNotes.value = insertAtSelection(templateDraftClassNotes.value)
        templateDraftClassNotesDocument.value = createTextEditorContent(templateDraftClassNotes.value, { templateVariables: true }).richText
        return
    }
    templateDraftContent.value = insertAtSelection(templateDraftContent.value)
    templateDraftContentDocument.value = createTextEditorContent(templateDraftContent.value, { templateVariables: true }).richText
}

function insertVariableToFocusedField(variable: string) {
    reportTemplateModal.value?.insertVariableAtFocus?.(variable)
}

function handleTemplateVariableMouseEnter(variable: string, event: MouseEvent) {
    reportTemplateModal.value?.showVariablePreview?.(variable, event)
}

function handleTemplateVariableMouseLeave() {
    reportTemplateModal.value?.hideVariablePreview?.()
}

function onEditableFieldsUpdate(fields: Array<{ id: string; label: string; content: string; document?: RichTextDocumentV1 }>) {
    fields.forEach(field => {
        if (field.id === 'contact') {
            templateDraftContactNotes.value = field.content
            if (field.document) templateDraftContactNotesDocument.value = field.document
        } else if (field.id === 'class') {
            templateDraftClassNotes.value = field.content
            if (field.document) templateDraftClassNotesDocument.value = field.document
        } else if (field.id === 'report') {
            templateDraftContent.value = field.content
            if (field.document) templateDraftContentDocument.value = field.document
        }
    })
}


const selectedCoursePreviewLesson = computed(() => {
    return props.availableLessons.find(l => l.id === selectedLessonId.value) || props.availableLessons[0] || null
})

const courseTemplateVariables = computed(() => {
    const lesson = selectedCoursePreviewLesson.value
    const courseName = props.courseName || ''
    const courseDisplayName = props.courseDisplayName || ''

    return COURSE_TEMPLATE_VARIABLE_DEFINITIONS.map(definition => {
        let previewValue = ''

        switch (definition.key) {
            case 'course_name':
                previewValue = courseName || 'Course Name'
                break
            case 'course_display_name':
                previewValue = courseDisplayName || 'Course Display Name'
                break
            case 'course_primary_name': {
                const selectedMode = selectedCourseTemplateModes.value[definition.key] || definition.defaultMode || definition.modes?.[0]?.value || 'space'
                previewValue = formatCoursePrimaryName(courseName, courseDisplayName, selectedMode)
                break
            }
            case 'lesson_label':
                previewValue = t('report.lesson_label')
                break
            case 'lesson_sequence': {
                const selectedMode = selectedCourseTemplateModes.value[definition.key] || definition.defaultMode || 'arabic'
                previewValue = formatNumber(lesson?.sequence, selectedMode) || '1'
                break
            }
            case 'lesson_title':
                previewValue = lesson?.title || 'Lesson Title'
                break
            default:
                previewValue = definition.key
                break
        }

        return {
            ...definition,
            token: formatCopyTemplateToken(definition.key, getSelectedCourseTemplateMode(definition.key)),
            label: t(`report.editor.copy_course_template_variable_labels.${definition.key}`),
            description: t(`report.editor.copy_course_template_variable_descriptions.${definition.key}`),
            previewValue,
            modeOptions: (definition.modes || []).map(mode => ({
                ...mode,
                label: t(`report.editor.copy_course_template_variable_modes.${mode.value}`)
            }))
        }
    })
})

const courseTemplatePreviewText = computed(() => {
    const lesson = selectedCoursePreviewLesson.value
    const courseName = props.courseName || ''
    const courseDisplayName = props.courseDisplayName || ''
    const coursePrimaryName = [courseName, courseDisplayName].filter(Boolean).join(' ').trim() || courseName || courseDisplayName || ''

    const context = {
        course_name: courseName,
        course_display_name: courseDisplayName,
        course_primary_name: coursePrimaryName,
        lesson_label: t('report.lesson_label'),
        lesson_sequence: lesson?.sequence ?? '',
        lesson_title: lesson?.title || ''
    }

    const formatter = (mode: string) => formatCoursePrimaryName(courseName, courseDisplayName, mode)

    return courseCopyTemplateText.value.trim()
        ? renderCopyTemplate(courseCopyTemplateText.value, context, {
            course_primary_name: {
                space: () => formatter('space'),
                slash: () => formatter('slash'),
                newline: () => formatter('newline'),
                bullet: () => formatter('bullet')
            },
            lesson_sequence: createNumberFormatters('lesson_sequence')
        }).trim()
        : ''
})

function getSelectedCourseTemplateMode(variable: string): string | undefined {
    return selectedCourseTemplateModes.value[variable] || COURSE_TEMPLATE_VARIABLE_DEFINITIONS.find(item => item.key === variable)?.defaultMode
}

function formatCoursePrimaryName(courseName: string, courseDisplayName: string, mode: string): string {
    const parts = [courseName, courseDisplayName].filter(Boolean)

    if (parts.length === 0) {
        return ''
    }

    switch (mode) {
        case 'slash':
            return parts.join(' / ')
        case 'newline':
            return parts.join('\n')
        case 'bullet':
            return parts.join(' • ')
        default:
            return parts.join(' ')
    }
}

function copyCourseInfo() {
    const lesson = props.availableLessons.find(l => l.id === selectedLessonId.value)
    if (!lesson) return

    const cName = props.courseName || ''
    const dName = props.courseDisplayName || ''

    const coursePrimaryName = [cName, dName].filter(Boolean).join(' ').trim() || cName || dName || ''
    const context = {
        course_name: cName,
        course_display_name: dName,
        course_primary_name: coursePrimaryName,
        lesson_label: t('report.lesson_label'),
        lesson_sequence: lesson.sequence,
        lesson_title: lesson.title
    }

    const formatters = {
                course_primary_name: {
                    space: () => formatCoursePrimaryName(cName, dName, 'space'),
                    slash: () => formatCoursePrimaryName(cName, dName, 'slash'),
                    newline: () => formatCoursePrimaryName(cName, dName, 'newline'),
                    bullet: () => formatCoursePrimaryName(cName, dName, 'bullet')
                },
                lesson_sequence: createNumberFormatters('lesson_sequence')
            }
    const copyPromise = CopyTemplateService.getEffectiveCourseTemplate()
        .then(({ templateText, templateDocument }) => {
            const rendered = renderTemplateContent(
                templateDocument || templateText,
                (key, mode) => renderCopyTemplate(
                    formatCopyTemplateToken(key, mode || undefined),
                    context,
                    formatters
                ),
                text => renderCopyTemplate(text, context, formatters)
            )
            const fallback = `${coursePrimaryName} Lesson ${lesson.sequence} ${lesson.title}`.trim()
            return rendered.plainText.trim() ? rendered : createTextEditorContent(fallback)
        })

    copyRichTextToClipboard(copyPromise)
        .then((success) => {
            if (success) {
                justCopiedCourse.value = true
                setTimeout(() => { justCopiedCourse.value = false }, 2000)
            } else {
                toast.error(t('report.editor.copy_course_template_copy_failed'))
            }
        })
        .catch(error => {
            console.error('Failed to copy course info', error)
            toast.error(t('report.editor.copy_course_template_copy_failed'))
        })
}

function insertCourseTemplateVariable(variable: string) {
    const mode = getSelectedCourseTemplateMode(variable)
    courseTemplateModal.value?.insertVariableAtFocus?.(formatCopyTemplateToken(variable, mode))
}

async function openCourseCopyTemplateModal() {
    const requestGeneration = ++courseTemplateRequestGeneration
    showCourseCopyTemplateModal.value = true
    courseCopyTemplateText.value = SYSTEM_COURSE_TEMPLATE
    courseCopyTemplateDocument.value = createTextEditorContent(SYSTEM_COURSE_TEMPLATE, { templateVariables: true }).richText
    selectedCourseTemplateModes.value = {
        course_primary_name: 'space'
    }

    try {
        isLoadingCourseCopyTemplate.value = true
        const bundle = await CopyTemplateService.getEditorBundle('course_copy')
        if (requestGeneration !== courseTemplateRequestGeneration || !showCourseCopyTemplateModal.value) return
        const options = bundle.options
        const template = bundle.current?.templateText || null
        courseTemplateLoadOptions.value = options.map(item => ({
            ...item,
            displayLabel: item.label === 'system_default'
                ? t('report.editor.copy_course_template_source_system')
                : item.label === 'user_default'
                    ? t('report.editor.copy_course_template_source_user_default')
                    : item.label
        }))
        selectedCourseTemplateLoadKey.value = courseTemplateLoadOptions.value[0]?.key || ''
        courseCopyTemplateText.value = template || SYSTEM_COURSE_TEMPLATE
        const loaded = courseTemplateLoadOptions.value.find(item => item.scopeType === 'user_default')
        courseCopyTemplateDocument.value = loaded?.templateDocument || createTextEditorContent(courseCopyTemplateText.value, { templateVariables: true }).richText
    } catch (error) {
        console.error('Failed to load course copy template', error)
        toast.error(t('report.editor.copy_course_template_load_failed'))
    } finally {
        if (requestGeneration === courseTemplateRequestGeneration) isLoadingCourseCopyTemplate.value = false
    }
}

watch(showCourseCopyTemplateModal, value => { if (!value) courseTemplateRequestGeneration++ })

function loadSelectedCourseTemplate() {
    const option = courseTemplateLoadOptions.value.find(item => item.key === selectedCourseTemplateLoadKey.value)
    if (!option) {
        return
    }

    courseCopyTemplateText.value = option.templateText || SYSTEM_COURSE_TEMPLATE
    courseCopyTemplateDocument.value = option.templateDocument || createTextEditorContent(courseCopyTemplateText.value, { templateVariables: true }).richText
}

async function saveCourseCopyTemplate() {
    const templateText = courseCopyTemplateText.value.trim()
    if (!templateText) {
        toast.error(t('report.editor.copy_course_template_empty_error'))
        return
    }

    try {
        isSavingCourseCopyTemplate.value = true
        await CopyTemplateService.saveCourseTemplateAsUserDefault({ plainText: templateText, richText: courseCopyTemplateDocument.value })
        toast.success(t('report.editor.copy_course_template_saved'))
        showCourseCopyTemplateModal.value = false
    } catch (error) {
        console.error('Failed to save course copy template', error)
        toast.error(t('report.editor.copy_course_template_save_failed'))
    } finally {
        isSavingCourseCopyTemplate.value = false
    }
}

function applyTemplate(template: Template) {
    const renderContent = (value: RichTextDocumentV1 | string | undefined) => renderTemplateContent(
        value || '',
        (key, mode) => renderReportTemplateText(formatCopyTemplateToken(key, mode || selectedReportTemplateModes.value[key])),
        renderReportTemplateText
    )
    const renderedContent = renderContent(template.contentDocument || template.content)
    const renderedContactNotes = renderContent(template.contactNotesDocument || template.contactNotes)
    const renderedClassNotes = renderContent(template.classNotesDocument || template.classNotes)

    let changed = false

    if (ydoc.value) {
        if (renderedContent.plainText && isTextEditorHandle(contentEditorRef.value)) {
            if (contentEditorRef.value.getText()) contentEditorRef.value.insertText('\n\n')
            contentEditorRef.value.insertContent(renderedContent)
        }
        if (renderedContactNotes.plainText && isTextEditorHandle(contactNotesEditorRef.value)) {
            if (contactNotesEditorRef.value.getText()) contactNotesEditorRef.value.insertText('\n\n')
            contactNotesEditorRef.value.insertContent(renderedContactNotes)
        }
        if (renderedClassNotes.plainText && isTextEditorHandle(classNotesEditorRef.value)) {
            if (classNotesEditorRef.value.getText()) classNotesEditorRef.value.insertText('\n\n')
            classNotesEditorRef.value.insertContent(renderedClassNotes)
        }
        changed = true
    } else {
        if (!localContent.value.trim() && renderedContent.plainText) {
            localContent.value = renderedContent.plainText
            contentDocument.value = renderedContent.richText
            changed = true
        }

        if (!contactNotes.value.trim() && renderedContactNotes.plainText) {
            contactNotes.value = renderedContactNotes.plainText
            contactNotesDocument.value = renderedContactNotes.richText
            changed = true
        }

        if (!classNotes.value.trim() && renderedClassNotes.plainText) {
            classNotes.value = renderedClassNotes.plainText
            classNotesDocument.value = renderedClassNotes.richText
            changed = true
        }
    }

    if (changed) {
        handleInput()
    }

    showReportTemplateManagerModal.value = false
}

function createNewTemplateDraft() {
    selectedTemplateId.value = ''
    templateDraftName.value = ''
    templateDraftContent.value = localContent.value || ''
    templateDraftContentDocument.value = contentDocument.value
    templateDraftContactNotes.value = contactNotes.value || ''
    templateDraftContactNotesDocument.value = contactNotesDocument.value
    templateDraftClassNotes.value = classNotes.value || ''
    templateDraftClassNotesDocument.value = classNotesDocument.value
}

function syncTemplateDraftFromSelection() {
    const selected = savedTemplates.value.find(item => item.id === selectedTemplateId.value)
    if (!selected) {
        createNewTemplateDraft()
        return
    }

    templateDraftName.value = selected.name
    templateDraftContent.value = selected.content || ''
    templateDraftContentDocument.value = selected.contentDocument || createTextEditorContent(selected.content || '', { templateVariables: true }).richText
    templateDraftContactNotes.value = selected.contactNotes || ''
    templateDraftContactNotesDocument.value = selected.contactNotesDocument || createTextEditorContent(selected.contactNotes || '', { templateVariables: true }).richText
    templateDraftClassNotes.value = selected.classNotes || ''
    templateDraftClassNotesDocument.value = selected.classNotesDocument || createTextEditorContent(selected.classNotes || '', { templateVariables: true }).richText
}

function handleTemplateSelectionChange() {
    syncTemplateDraftFromSelection()
}

async function openReportTemplateManagerModal() {
    const requestGeneration = ++reportTemplateRequestGeneration
    showReportTemplateManagerModal.value = true
    try {
        isLoadingTemplateManager.value = true
        await loadTemplates()
        if (requestGeneration !== reportTemplateRequestGeneration || !showReportTemplateManagerModal.value) return
        if (savedTemplates.value.length > 0) {
            selectedTemplateId.value = savedTemplates.value[0].id
            syncTemplateDraftFromSelection()
        } else {
            createNewTemplateDraft()
        }
    } catch (error) {
        console.error('Failed to open template manager', error)
    } finally {
        isLoadingTemplateManager.value = false
    }
}

async function saveTemplateDraft() {
    if (!authStore.user?.id) return
    if (!templateDraftName.value.trim()) {
        toast.error(t('report.editor.template_name_required'))
        return
    }

    try {
        isSavingTemplate.value = true
        const saved = await ReportTemplateService.saveTemplate({
            id: selectedTemplateId.value || undefined,
            name: templateDraftName.value.trim(),
            content: templateDraftContent.value,
            content_document: templateDraftContentDocument.value,
            contact_notes: templateDraftContactNotes.value,
            contact_notes_document: templateDraftContactNotesDocument.value,
            class_notes: templateDraftClassNotes.value,
            class_notes_document: templateDraftClassNotesDocument.value,
            instructor_id: authStore.user.id
        })

        await loadTemplates()
        selectedTemplateId.value = saved.id || ''
        syncTemplateDraftFromSelection()
        toast.success(t('report.editor.template_saved'))
    } catch (error) {
        console.error('Failed to save template draft', error)
        toast.error(t('report.editor.template_load_error'))
    } finally {
        isSavingTemplate.value = false
    }
}

async function applyTemplateDraftToReport() {
    if (props.reportId) {
        try {
            const serverReport = await OccurrenceReportService.getReportById(props.reportId)
            if (serverReport.version !== version.value) {
                toast.error(t('report.editor.restore_conflict_error'))
                return
            }
        } catch (e) {
            console.error('Failed to check version before applying template', e)
        }
    }

    const draft: Template = {
        id: selectedTemplateId.value || 'draft',
        name: templateDraftName.value || t('report.editor.template_new_option'),
        content: templateDraftContent.value,
        contentDocument: templateDraftContentDocument.value,
        contactNotes: templateDraftContactNotes.value,
        contactNotesDocument: templateDraftContactNotesDocument.value,
        classNotes: templateDraftClassNotes.value,
        classNotesDocument: templateDraftClassNotesDocument.value
    }
    applyTemplate(draft)
}

function deleteSelectedTemplate() {
    const id = selectedTemplateId.value
    if (!id) {
        return
    }

    openConfirm(
        t('report.editor.delete_template_title', 'Delete Template'),
        t('report.editor.delete_template_confirm', 'Are you sure you want to delete this template?'),
        async () => {
            try {
                await ReportTemplateService.deleteTemplate(id)
                savedTemplates.value = savedTemplates.value.filter(item => item.id !== id)
                selectedTemplateId.value = savedTemplates.value[0]?.id || ''
                syncTemplateDraftFromSelection()
                toast.success(t('report.editor.template_deleted') || 'Template deleted')
            } catch (error) {
                console.error('Failed to delete template', error)
            }
        },
        true
    )
}

async function handleDeleteReport() {
    if (!props.reportId) return

    openConfirm(
        t('report.editor.delete_report_title', 'Delete Report'),
        t('report.editor.delete_report_confirm', 'Are you sure you want to delete this report? This will revert the student\'s progress.'),
        async () => {
            try {
                await OccurrenceReportService.deleteReportAndRevertProgress(props.reportId!)
                toast.success(t('report.editor.delete_success') || 'Report deleted')
                emit('deleted')
            } catch (e: any) {
                console.error('Failed to delete report', e)
                saveError.value = e.message
            }
        },
        true // Dangerous
    )
}

onMounted(() => {
    loadTemplates()
})

// Collab logic
const collaborationUser = computed(() => ({ name: authStore.user?.user_metadata?.full_name || 'Teacher', color: '#60A5FA' }))

const reportIdRef = computed(() => props.reportId || '')
const initialReportVersionRef = computed(() => props.initialVersion)
const {
    ydoc,
    provider: awarenessProvider,
    ready,
    error: collaborationError,
    initialState: collabInitialState,
    saveSnapshot,
    setBaseReportVersion,
    status: collaborationStatus,
    activePeers,
    onlineParticipantCount,
    setEnabled: setCollaborationEnabled,
    configure: configureCollaboration
} = useReportCollab(reportIdRef as any, initialReportVersionRef, computed(() => ({
    enabled: effectiveCollaborationEnabled.value,
    snapshotDebounceMs: preferences.editorSettings.collaboration.snapshotDebounceMs,
    presenceEnabled: preferences.editorSettings.collaboration.presenceEnabled
})))

const collaborationRecovered = ref(false)
let collaborationHadError = false
let collaborationRecoveryTimer: ReturnType<typeof setTimeout> | null = null
watch(collaborationStatus, nextStatus => {
    if (nextStatus === 'error') collaborationHadError = true
    if (nextStatus === 'ready' && collaborationHadError) {
        collaborationHadError = false
        collaborationRecovered.value = true
        if (collaborationRecoveryTimer) clearTimeout(collaborationRecoveryTimer)
        collaborationRecoveryTimer = setTimeout(() => {
            collaborationRecovered.value = false
            collaborationRecoveryTimer = null
        }, 4000)
    }
})

const contactNotesEditorRef = ref<TextEditorHandle | null>(null)
const classNotesEditorRef = ref<TextEditorHandle | null>(null)
const contentEditorRef = ref<TextEditorHandle | null>(null)
const collabWatchStops: WatchStopHandle[] = []
let collabEditorGeneration = 0
let reportEditorUnmounted = false

function isTextEditorHandle(value: unknown): value is TextEditorHandle {
    if (!value || typeof value !== 'object') return false
    const handle = value as Partial<TextEditorHandle>
    return typeof handle.getText === 'function'
        && typeof handle.getContent === 'function'
        && typeof handle.replaceContent === 'function'
}

function handleEditorFieldFocus(event: FocusEvent) {
    const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-collab-field]') : null
    const field = element?.dataset.collabField
    const awareness = awarenessProvider.value?.awareness
    if (field && awareness) awareness.setLocalStateField('activity', { field, focused: true })
}

function handleEditorFieldBlur(event: FocusEvent) {
    const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-collab-field]') : null
    const field = element?.dataset.collabField
    const awareness = awarenessProvider.value?.awareness
    if (field && awareness && (!event.relatedTarget || !(event.relatedTarget instanceof Node) || !element?.contains(event.relatedTarget))) {
        awareness.setLocalStateField('activity', { field, focused: false })
    }
}

function handleCollaborationActivity(field: string, activity: { caret: number; selectionEnd: number; focused?: boolean }) {
    const awareness = awarenessProvider.value?.awareness
    if (!awareness) return
    awareness.setLocalStateField('activity', { field, ...activity })
}
let collabMetaMap: any = null
let collabMetaObserver: ((event: any) => void) | null = null
let isApplyingRemoteCollab = false

function cleanupReportCollabBindings() {
    collabWatchStops.splice(0).forEach((stop) => stop())

    if (collabMetaMap && collabMetaObserver) {
        collabMetaMap.unobserve(collabMetaObserver)
    }
    collabMetaMap = null
    collabMetaObserver = null

}

function withCollabGuard(fn: () => void) {
    isApplyingRemoteCollab = true
    try {
        fn()
    } finally {
        isApplyingRemoteCollab = false
    }
}

function syncTextRefsFromEditors() {
    if (isTextEditorHandle(contentEditorRef.value)) {
        const content = contentEditorRef.value.getContent()
        localContent.value = content.plainText
        contentDocument.value = content.richText
    }
    if (isTextEditorHandle(contactNotesEditorRef.value)) {
        const content = contactNotesEditorRef.value.getContent()
        contactNotes.value = content.plainText
        contactNotesDocument.value = content.richText
    }
    if (isTextEditorHandle(classNotesEditorRef.value)) {
        const content = classNotesEditorRef.value.getContent()
        classNotes.value = content.plainText
        classNotesDocument.value = content.richText
    }
}

function setEditorContentSilently(editorRef: { value: TextEditorHandle | null }, content: TextEditorContent) {
    if (isTextEditorHandle(editorRef.value)) editorRef.value.replaceContent(content)
}

function writeReportMeta(metaMap: any) {
    const managedReason = canonicalSystemManagedReason()
    metaMap.set('attendanceStatus', managedReason ? canonicalSystemManagedStatus() : attendanceStatus.value)
    metaMap.set('absenceReason', managedReason || absenceReason.value)
    metaMap.set('classParticipation', classParticipation.value)
    metaMap.set('classroomBehavior', classroomBehavior.value)
    metaMap.set('isCompleted', isCompleted.value)
    metaMap.set('progressStart', progressStart.value)
    metaMap.set('progressEnd', progressEnd.value)
    metaMap.set('selectedLessonId', selectedLessonId.value)
    metaMap.set('reportExternalLink', reportExternalLink.value)
    metaMap.set('version', version.value)
}

watch(ready, (isReady) => {
    const generation = ++collabEditorGeneration
    cleanupReportCollabBindings()

    if (isReady && ydoc.value) {
        // Setup reportMeta sync
        const metaMap = ydoc.value.getMap('reportMeta')
        collabMetaMap = metaMap

        // Initialize local fields from map if they exist, otherwise seed them from local state
        withCollabGuard(() => {
            const managedReason = canonicalSystemManagedReason()
            if (managedReason) {
                // The API/props are canonical for system-managed attendance;
                // never hydrate these two fields from a stale Yjs document.
                attendanceStatus.value = canonicalSystemManagedStatus()
                absenceReason.value = managedReason
                metaMap.set('attendanceStatus', attendanceStatus.value)
                metaMap.set('absenceReason', absenceReason.value)
            } else {
                if (metaMap.has('attendanceStatus')) attendanceStatus.value = metaMap.get('attendanceStatus') as any
                else metaMap.set('attendanceStatus', attendanceStatus.value)

                if (metaMap.has('absenceReason')) absenceReason.value = metaMap.get('absenceReason') as any
                else metaMap.set('absenceReason', absenceReason.value)
            }

            if (metaMap.has('classParticipation')) classParticipation.value = Number(metaMap.get('classParticipation') ?? 0)
            else metaMap.set('classParticipation', classParticipation.value)

            if (metaMap.has('classroomBehavior')) classroomBehavior.value = Number(metaMap.get('classroomBehavior') ?? 0)
            else metaMap.set('classroomBehavior', classroomBehavior.value)

            if (metaMap.has('isCompleted')) isCompleted.value = Boolean(metaMap.get('isCompleted'))
            else metaMap.set('isCompleted', isCompleted.value)

            if (metaMap.has('progressStart')) progressStart.value = (metaMap.get('progressStart') as string) || ''
            else metaMap.set('progressStart', progressStart.value)

            if (metaMap.has('progressEnd')) progressEnd.value = (metaMap.get('progressEnd') as string) || ''
            else metaMap.set('progressEnd', progressEnd.value)

            if (metaMap.has('selectedLessonId')) selectedLessonId.value = (metaMap.get('selectedLessonId') as string) || ''
            else metaMap.set('selectedLessonId', selectedLessonId.value)

            if (metaMap.has('reportExternalLink')) reportExternalLink.value = (metaMap.get('reportExternalLink') as string) || ''
            else metaMap.set('reportExternalLink', reportExternalLink.value)

            if (metaMap.has('version')) {
                const remoteVersion = Number(metaMap.get('version') || 0)
                if (remoteVersion > version.value) {
                    version.value = remoteVersion
                    setBaseReportVersion(remoteVersion)
                }
            } else {
                metaMap.set('version', version.value)
            }
        })
        
        collabMetaObserver = (event) => {
            withCollabGuard(() => {
                event.changes.keys.forEach((_: unknown, key: string) => {
                    const newVal = metaMap.get(key)
                    if (key === 'attendanceStatus' || key === 'absenceReason') {
                        const managedReason = canonicalSystemManagedReason()
                        if (managedReason) {
                            if (key === 'attendanceStatus') {
                                const canonicalValue = canonicalSystemManagedStatus()
                                if (newVal !== canonicalValue) metaMap.set(key, canonicalValue)
                                if (attendanceStatus.value !== canonicalValue) attendanceStatus.value = canonicalValue
                            } else {
                                const canonicalValue = managedReason
                                if (newVal !== canonicalValue) metaMap.set(key, canonicalValue)
                                if (absenceReason.value !== canonicalValue) absenceReason.value = canonicalValue
                            }
                        } else if (key === 'attendanceStatus' && newVal !== attendanceStatus.value) {
                            attendanceStatus.value = newVal as any
                        } else if (key === 'absenceReason' && newVal !== absenceReason.value) {
                            // A stale collaboration document may contain a
                            // holiday/suspension marker for a report that the
                            // canonical API says is user-managed. Ignore it.
                            if (!normalizeSystemManagedReason(newVal)) absenceReason.value = newVal as any
                            else if (metaMap.get('absenceReason') !== (props.initialAbsenceReason || '')) metaMap.set('absenceReason', props.initialAbsenceReason || '')
                        }
                    }
                    if (key === 'classParticipation' && Number(newVal ?? 0) !== classParticipation.value) classParticipation.value = Number(newVal ?? 0)
                    if (key === 'classroomBehavior' && Number(newVal ?? 0) !== classroomBehavior.value) classroomBehavior.value = Number(newVal ?? 0)
                    if (key === 'isCompleted' && Boolean(newVal) !== isCompleted.value) isCompleted.value = Boolean(newVal)
                    if (key === 'progressStart' && (newVal || '') !== progressStart.value) progressStart.value = newVal as any || ''
                    if (key === 'progressEnd' && (newVal || '') !== progressEnd.value) progressEnd.value = newVal as any || ''
                    if (key === 'selectedLessonId' && (newVal || '') !== selectedLessonId.value) selectedLessonId.value = newVal as any || ''
                    if (key === 'reportExternalLink' && (newVal || '') !== reportExternalLink.value) reportExternalLink.value = safeExternalHref(String(newVal || '')) || ''
                    if (key === 'version') {
                        // A peer's save advanced the report's DB version. Their
                        // content is CRDT-merged into our editor already, but
                        // `version` is also the optimistic-concurrency token this
                        // editor sends with ITS OWN next save (see onSave below) --
                        // trusting a broadcast for that would let a save through
                        // whose local snapshot was never confirmed to genuinely be
                        // that version's full state (e.g. after a dropped realtime
                        // message). So only the snapshot guard is updated here;
                        // `version` itself only advances once our own save
                        // succeeds, and until then the server's real CAS check
                        // will correctly surface a conflict instead of a silent
                        // overwrite.
                        const remoteVersion = Number(newVal || 0)
                        if (remoteVersion > version.value) {
                            remoteVersionDrift.value = true
                            setBaseReportVersion(remoteVersion)
                            editorNotifier.notify({
                                code: 'remote-change',
                                level: 'info',
                                message: t('report.editor.remote_update_notice'),
                                toast: true
                            })
                        }
                    }
                })
            })
        }
        metaMap.observe(collabMetaObserver)

        // Listen for local changes to update map
        const setupMapSync = (refVar: any, mapKey: string) => {
            const stop = watch(refVar, (val) => {
                if (isApplyingRemoteCollab || isInitializing.value) return
                if (mapKey === 'attendanceStatus' || mapKey === 'absenceReason') {
                    const managedReason = canonicalSystemManagedReason()
                    if (managedReason) {
                        const canonicalValue = mapKey === 'attendanceStatus'
                            ? canonicalSystemManagedStatus()
                            : managedReason
                        if (metaMap.get(mapKey) !== canonicalValue) metaMap.set(mapKey, canonicalValue)
                        if (val !== canonicalValue) refVar.value = canonicalValue
                        return
                    }
                }
                if (metaMap.get(mapKey) !== val) {
                    metaMap.set(mapKey, val)
                    handleInput()
                }
            }, { flush: 'sync' })
            collabWatchStops.push(stop)
        }
        
        setupMapSync(attendanceStatus, 'attendanceStatus')
        setupMapSync(absenceReason, 'absenceReason')
        setupMapSync(classParticipation, 'classParticipation')
        setupMapSync(classroomBehavior, 'classroomBehavior')
        setupMapSync(isCompleted, 'isCompleted')
        setupMapSync(progressStart, 'progressStart')
        setupMapSync(progressEnd, 'progressEnd')
        setupMapSync(selectedLessonId, 'selectedLessonId')
        setupMapSync(reportExternalLink, 'reportExternalLink')
        
        // Seed XML fragments on initialization if ydoc has no content but local has content
        nextTick(() => {
            if (reportEditorUnmounted || generation !== collabEditorGeneration || !ready.value || !ydoc.value) return
            withCollabGuard(() => {
                let seeded = false

                if (isTextEditorHandle(contentEditorRef.value) && !contentEditorRef.value.getText() && ydoc.value?.getXmlFragment('content_xml').length === 0 && localContent.value) {
                    setEditorContentSilently(contentEditorRef, contentEditorValue.value)
                    seeded = true
                }
                if (isTextEditorHandle(contactNotesEditorRef.value) && !contactNotesEditorRef.value.getText() && ydoc.value?.getXmlFragment('contactNotes_xml').length === 0 && contactNotes.value) {
                    setEditorContentSilently(contactNotesEditorRef, contactNotesEditorValue.value)
                    seeded = true
                }
                if (isTextEditorHandle(classNotesEditorRef.value) && !classNotesEditorRef.value.getText() && ydoc.value?.getXmlFragment('classNotes_xml').length === 0 && classNotes.value) {
                    setEditorContentSilently(classNotesEditorRef, classNotesEditorValue.value)
                    seeded = true
                }

                syncTextRefsFromEditors()

                if (collabInitialState.value === 'stale') {
                    // The persisted collab snapshot was based on an older report
                    // version than the one we just loaded -- something else (a
                    // peer's save, an attendance-only update, a holiday version
                    // bump, ...) advanced the version since it was written. We
                    // have no way to know whether that snapshot held edits that
                    // were never otherwise persisted, so it must not be silently
                    // overwritten with a doc reseeded from the canonical row.
                    // Leave report_collab_docs untouched; it will be properly
                    // superseded once the user's own edits trigger a real save.
                    editorNotifier.notify({
                        code: 'remote-change',
                        level: 'warning',
                        message: t('report.editor.stale_collab_snapshot_notice'),
                        toast: true
                    })
                } else if (seeded || collabInitialState.value !== 'loaded') {
                    void saveSnapshot()
                }
            })

            if (collabInitialState.value === 'loaded') {
                queueRecoveredDraftWhenReady()
            }
        })

    }
})




const authStore = useAuthStore()
const { t } = useI18n()

// Local state
const initialMainContent = createTextEditorContent(props.initialContentDocument || props.initialContent)
const initialContactContent = createTextEditorContent(props.initialContactNotesDocument || props.initialContactNotes)
const initialClassContent = createTextEditorContent(props.initialClassNotesDocument || props.initialClassNotes)
const localContent = ref(initialMainContent.plainText)
const contentDocument = ref(initialMainContent.richText)
// The version our local snapshot is actually based on. This is the optimistic-
// concurrency token sent with every save, so it must only ever advance when our
// local content genuinely catches up with that version: on our own successful
// save, when the parent hands us a freshly-reloaded report, or on an explicit
// canonical reload. A peer's collab broadcast alone must never bump it -- see
// remoteVersionDrift below.
const version = ref(props.initialVersion)
// True once a Yjs broadcast has reported a report version newer than the one
// our local snapshot is based on. We deliberately do NOT fast-forward `version`
// to match: doing so used to let a stale local buffer pass the save's
// optimistic-concurrency check and silently overwrite the peer's saved content.
// Leaving `version` at its true baseline means the next save's CAS check
// (ReportCommandService.saveReport) correctly reports a conflict instead.
const remoteVersionDrift = ref(false)



// Detailed fields
const selectedLessonId = ref(props.initialLessonId || '')
const isCompleted = ref(props.initialIsCompleted)
const progressStart = ref(props.initialProgressStart || '')
const progressEnd = ref(props.initialProgressEnd || '')
const attendanceStatus = ref<'present' | 'absent' | 'pending'>(props.initialAttendanceStatus)
const absenceReason = ref(props.initialAbsenceReason || '')
// These refs are populated only from canonical API/props data. Collaboration
// metadata must never be allowed to promote a normal report into a managed one.
const managedAttendanceReason = ref<'holiday' | 'suspension' | null>(normalizeSystemManagedReason(props.initialAbsenceReason))
const managedAttendanceStatus = ref<'present' | 'absent' | 'pending' | null>(
    managedAttendanceReason.value ? (props.initialAttendanceStatus || 'absent') : null
)
const classParticipation = ref(props.initialClassParticipation ?? 0)
const classroomBehavior = ref(props.initialClassroomBehavior ?? 0)
const contactNotes = ref(initialContactContent.plainText)
const contactNotesDocument = ref(initialContactContent.richText)
const classNotes = ref(initialClassContent.plainText)
const classNotesDocument = ref(initialClassContent.richText)
const reportExternalLink = ref(safeExternalHref(props.initialReportExternalLink) || '')

const contentEditorValue = computed<TextEditorContent>({
    get: () => ({ plainText: localContent.value, richText: contentDocument.value }),
    set: value => { localContent.value = value.plainText; contentDocument.value = value.richText }
})
const contactNotesEditorValue = computed<TextEditorContent>({
    get: () => ({ plainText: contactNotes.value, richText: contactNotesDocument.value }),
    set: value => { contactNotes.value = value.plainText; contactNotesDocument.value = value.richText }
})
const classNotesEditorValue = computed<TextEditorContent>({
    get: () => ({ plainText: classNotes.value, richText: classNotesDocument.value }),
    set: value => { classNotes.value = value.plainText; classNotesDocument.value = value.richText }
})

type AttendanceStatus = 'present' | 'absent' | 'pending'

type ReportSavePayload = {
    lessonId?: string
    isCompleted?: boolean
    progressLetter?: string | null
    attendanceStatus?: AttendanceStatus
    absenceReason?: string | null
    classParticipation?: number
    classroomBehavior?: number
    contactNotes?: string
    contactNotesDocument?: RichTextDocumentV1
    classNotes?: string
    classNotesDocument?: RichTextDocumentV1
    content?: string
    contentDocument?: RichTextDocumentV1
    externalLink?: string
}

function normalizeString(value: string | null | undefined): string {
    return value || ''
}

function normalizeSystemManagedReason(value: unknown): 'holiday' | 'suspension' | null {
    const reason = String(value ?? '').trim().toLowerCase()
    return reason === 'holiday' || reason === 'suspension' ? reason : null
}

function canonicalSystemManagedReason(): 'holiday' | 'suspension' | null {
    // The initial API value is authoritative. A collaboration document may
    // contain stale metadata from before the report became system-managed.
    return managedAttendanceReason.value
}

function canonicalSystemManagedStatus(): AttendanceStatus {
    return managedAttendanceStatus.value || props.initialAttendanceStatus || 'absent'
}

function normalizeAbsenceReason(status: AttendanceStatus, reason: string | null | undefined): string | null {
    return status === 'absent' ? normalizeString(reason) : null
}

function buildCurrentSnapshot(overrides: Partial<ReportDraftSnapshot> = {}): ReportDraftSnapshot {
    const managedReason = canonicalSystemManagedReason()
    const snapshotAttendanceStatus = managedReason ? canonicalSystemManagedStatus() : attendanceStatus.value
    const normalizedReason = snapshotAttendanceStatus === 'absent'
        ? (managedReason || normalizeString(absenceReason.value) || t('report.editor.absence_reasons.reason_not_provided'))
        : null

    return {
        lessonId: selectedLessonId.value || '',
        isCompleted: isCompleted.value,
        progressLetter: progressLetter.value || '',
        attendanceStatus: snapshotAttendanceStatus,
        absenceReason: normalizedReason,
        classParticipation: classParticipation.value,
        classroomBehavior: classroomBehavior.value,
        contactNotes: contactNotes.value || '',
        contactNotesDocument: contactNotesDocument.value,
        classNotes: classNotes.value || '',
        classNotesDocument: classNotesDocument.value,
        content: localContent.value || '',
        contentDocument: contentDocument.value,
        externalLink: safeExternalHref(reportExternalLink.value) || '',
        ...overrides
    }
}

function buildSnapshotFromProps(): ReportDraftSnapshot {
    const initialStatus = props.initialAttendanceStatus || 'pending'
    const managedReason = normalizeSystemManagedReason(props.initialAbsenceReason)
    const initialProgress = props.initialProgressStart && props.initialProgressEnd
        ? `${props.initialProgressStart}-${props.initialProgressEnd}`
        : (props.initialProgressStart || props.initialProgressEnd || '')
    const contact = createTextEditorContent(props.initialContactNotesDocument || props.initialContactNotes || '')
    const classNotesContent = createTextEditorContent(props.initialClassNotesDocument || props.initialClassNotes || '')
    const main = createTextEditorContent(props.initialContentDocument || props.initialContent || '')

    return {
        lessonId: props.initialLessonId || '',
        isCompleted: props.initialIsCompleted ?? false,
        progressLetter: initialProgress,
        attendanceStatus: initialStatus,
        absenceReason: initialStatus === 'absent'
            ? (managedReason || normalizeAbsenceReason(initialStatus, props.initialAbsenceReason))
            : null,
        classParticipation: props.initialClassParticipation ?? 0,
        classroomBehavior: props.initialClassroomBehavior ?? 0,
        contactNotes: contact.plainText,
        contactNotesDocument: contact.richText,
        classNotes: classNotesContent.plainText,
        classNotesDocument: classNotesContent.richText,
        content: main.plainText,
        contentDocument: main.richText,
        externalLink: safeExternalHref(props.initialReportExternalLink) || ''
    }
}

function buildSnapshotFromDto(report: OccurrenceReportDTO): ReportDraftSnapshot {
    const contact = createTextEditorContent(report.contact_notes_document || report.contact_notes || '')
    const classNotesContent = createTextEditorContent(report.class_notes_document || report.class_notes || '')
    const main = createTextEditorContent(report.content_document || report.content || '')
    return {
        lessonId: report.lesson_id || '',
        isCompleted: report.is_completed ?? false,
        progressLetter: report.progress_letter || '',
        attendanceStatus: report.attendance_status || 'pending',
        absenceReason: normalizeSystemManagedReason(report.absence_reason)
            || normalizeAbsenceReason(report.attendance_status || 'pending', report.absence_reason),
        classParticipation: report.class_participation ?? 0,
        classroomBehavior: report.classroom_behavior ?? 0,
        contactNotes: contact.plainText,
        contactNotesDocument: contact.richText,
        classNotes: classNotesContent.plainText,
        classNotesDocument: classNotesContent.richText,
        content: main.plainText,
        contentDocument: main.richText,
        externalLink: report.external_link || ''
    }
}

function buildDirtyPayload(current: ReportDraftSnapshot): { keys: Array<keyof ReportDraftSnapshot>, payload: ReportSavePayload } {
    const previous = savedReportSnapshot.value
    const keys: Array<keyof ReportDraftSnapshot> = []
    const payload: ReportSavePayload = {}

    const addIfChanged = <K extends keyof ReportDraftSnapshot>(
        key: K,
        assign: () => void
    ) => {
        if (JSON.stringify(current[key] ?? null) !== JSON.stringify(previous[key] ?? null)) {
            keys.push(key)
            assign()
        }
    }

    addIfChanged('lessonId', () => {
        payload.lessonId = current.lessonId || undefined
    })
    addIfChanged('isCompleted', () => {
        payload.isCompleted = current.isCompleted
    })
    addIfChanged('progressLetter', () => {
        payload.progressLetter = current.progressLetter || null
    })
    // System-managed attendance is authoritative in the database. Never turn
    // stale collaboration metadata or a translated fallback reason into a
    // mutation, and let other editable fields continue to save normally.
    if (!isSystemManagedAbsence.value) {
        addIfChanged('attendanceStatus', () => {
            payload.attendanceStatus = current.attendanceStatus
        })
        addIfChanged('absenceReason', () => {
            payload.absenceReason = current.absenceReason
        })
    }
    addIfChanged('classParticipation', () => {
        payload.classParticipation = current.classParticipation
    })
    addIfChanged('classroomBehavior', () => {
        payload.classroomBehavior = current.classroomBehavior
    })
    addIfChanged('contactNotes', () => {
        payload.contactNotes = current.contactNotes
    })
    addIfChanged('contactNotesDocument', () => {
        payload.contactNotes = current.contactNotes
        payload.contactNotesDocument = current.contactNotesDocument
    })
    addIfChanged('classNotes', () => {
        payload.classNotes = current.classNotes
    })
    addIfChanged('classNotesDocument', () => {
        payload.classNotes = current.classNotes
        payload.classNotesDocument = current.classNotesDocument
    })
    addIfChanged('content', () => {
        payload.content = current.content
    })
    addIfChanged('contentDocument', () => {
        payload.content = current.content
        payload.contentDocument = current.contentDocument
    })
    addIfChanged('externalLink', () => {
        payload.externalLink = current.externalLink
    })

    return { keys, payload }
}

const savedReportSnapshot = ref<ReportDraftSnapshot>(buildSnapshotFromProps())


// Computed progress letter for backend (combining start-end range)
const progressLetter = computed(() => {
    if (progressStart.value && progressEnd.value) {
        return `${progressStart.value}-${progressEnd.value}`
    } else if (progressStart.value) {
        return progressStart.value
    } else if (progressEnd.value) {
        return progressEnd.value
    }
    return ''
})

// Check if absence reason is system-managed (holiday or suspension)
const isSystemManagedAbsence = computed(() => {
    return canonicalSystemManagedReason() !== null
})

const getSystemManagedAbsenceLabel = () => {
    const reason = canonicalSystemManagedReason()
    if (reason === 'holiday') {
        return `${t('report.editor.absence_reasons.holiday')} (${t('common.system_managed')})`
    } else if (reason === 'suspension') {
        return `${t('report.editor.absence_reasons.suspension')} (${t('common.system_managed')})`
    }
    return absenceReason.value
}

// Validation
const showAbsenceError = computed(() => {
    return attendanceStatus.value === 'absent' && !absenceReason.value && !isSystemManagedAbsence.value
})

const canSave = computed(() => {
    // Auto-set handles missing reason, so we allow saving
    return true
})

function snapshotToLocalReport(snapshot: ReportDraftSnapshot): OccurrenceReportDTO {
    return {
        id: props.reportId,
        enrollment_id: props.enrollmentId || '',
        class_occurrence_id: props.classOccurrenceId || '',
        lesson_id: snapshot.lessonId,
        content: snapshot.content,
        content_document: snapshot.contentDocument,
        is_completed: snapshot.isCompleted,
        progress_letter: snapshot.progressLetter,
        attendance_status: snapshot.attendanceStatus,
        absence_reason: snapshot.absenceReason || '',
        class_participation: snapshot.classParticipation,
        classroom_behavior: snapshot.classroomBehavior,
        contact_notes: snapshot.contactNotes,
        contact_notes_document: snapshot.contactNotesDocument,
        class_notes: snapshot.classNotes,
        class_notes_document: snapshot.classNotesDocument,
        external_link: snapshot.externalLink,
        version: version.value,
        last_edited_at: new Date().toISOString(),
        last_edited_by: authStore.user?.id,
        created_at: props.initialCreatedAt,
        updated_at: new Date().toISOString()
    }
}

// Auto-save setup
const {
    status: autoSaveStatus,
    isSaving,
    lastSaved,
    hasUnsavedChanges,
    saveError,
    saveNow: autoSaveNow,
    triggerAutoSave,
    setEnabled: setAutoSaveEnabled,
    configure: configureAutoSave,
    retry: retrySave,
    drain,
    getLastSavedString,
    reset
} = useAutoSave<ReportDraftSnapshot, SaveReportResult>({
    enabled: effectiveAutoSaveEnabled,
    debounceMs: computed(() => props.debounceMs ?? preferences.editorSettings.autoSave.debounceMs),
    saveOnBlur: computed(() => preferences.editorSettings.autoSave.saveOnBlur),
    saveOnSwitch: computed(() => preferences.editorSettings.autoSave.saveOnSwitch),
    saveOnUnmount: computed(() => preferences.editorSettings.autoSave.saveOnUnmount),
    onSave: async (snapshot) => {
        editorNotifier.notify({ code: 'save-started', level: 'info', message: t('report.saving'), toast: false })
        if (!props.reportId) {
            return { success: false, message: 'No report ID provided', messageKey: 'report.no_report_selected' }
        }

        if (!canSave.value) {
            return { success: false, message: t('report.editor.required_field_error') }
        }

        try {
            const { keys, payload } = buildDirtyPayload(snapshot)
            const isAttendanceOnly = keys.length > 0 && keys.every(key => key === 'attendanceStatus' || key === 'absenceReason')

            if (keys.length === 0) {
                return { success: true, newVersion: version.value }
            }

            const baseSnapshot = savedReportSnapshot.value
            const result = isAttendanceOnly
                ? await OccurrenceReportService.saveAttendanceOnly(
                    props.reportId,
                    version.value,
                    authStore.user?.id,
                    {
                        attendanceStatus: snapshot.attendanceStatus,
                        absenceReason: snapshot.absenceReason
                    }
                )
                : await OccurrenceReportService.saveReport(
                    props.reportId,
                    version.value,
                    authStore.user?.id,
                    payload
                )

            // A CAS conflict is expected when another teacher saves first. If
            // only text changed, Yjs already contains the merged document; if
            // metadata changed on both sides, return field-level conflicts.
            if (result.conflict && result.serverReport) {
                const merge = mergeReportConflict(
                    baseSnapshot,
                    snapshot,
                    result.serverReport,
                    collaborationStatus.value === 'ready'
                )
                if (merge.conflictFields.length > 0) {
                    return { ...result, serverVersion: result.serverReport.version, conflictFields: merge.conflictFields }
                }
                if (merge.changed && result.serverReport.version > version.value) {
                    const mergedResult = await OccurrenceReportService.saveReport(
                        props.reportId,
                        result.serverReport.version,
                        authStore.user?.id,
                        merge.payload as any
                    )
                    if (mergedResult.success) return { ...mergedResult, merged: true }
                    return {
                        ...mergedResult,
                        conflict: mergedResult.conflict || false,
                        serverVersion: mergedResult.serverReport?.version || result.serverReport.version,
                        conflictFields: mergedResult.conflictFields || []
                    }
                }
            }
            return result
        } catch (error: any) {
            const message = error.message || 'Failed to save report'
            return { success: false, message, messageKey: 'errors.unknown' }
        }
    },
    onConflict: (serverReport, snapshot) => {
        editorNotifier.notify({ code: 'save-conflict', level: 'warning', message: t('report.conflict.description'), dedupeKey: `${props.reportId || 'new'}:${version.value}:conflict`, toast: true })
        if (serverReport) {
            emit('conflict', serverReport, snapshotToLocalReport(snapshot))
        }
    },
    onSuccess: async ({ snapshot, result }) => {
        const updatedReport = result.updatedReport
        const newVersion = updatedReport?.version ?? result.newVersion ?? version.value
        version.value = newVersion
        remoteVersionDrift.value = false
        const canonicalManagedReason = normalizeSystemManagedReason(updatedReport?.absence_reason)
        if (canonicalManagedReason) {
            managedAttendanceReason.value = canonicalManagedReason
            managedAttendanceStatus.value = updatedReport?.attendance_status || 'absent'
            attendanceStatus.value = managedAttendanceStatus.value
            absenceReason.value = canonicalManagedReason
            if (collabMetaMap) writeReportMeta(collabMetaMap)
        }
        savedReportSnapshot.value = updatedReport ? buildSnapshotFromDto(updatedReport) : snapshot
        setBaseReportVersion(newVersion)

        if (ydoc.value) {
            const metaMap = ydoc.value.getMap('reportMeta')
            const currentMetaVer = metaMap.get('version') as number || 0
            if (newVersion > currentMetaVer) {
                metaMap.set('version', newVersion)
            }
            void saveSnapshot().catch((error) => console.warn('Collaboration snapshot deferred after canonical save', error))
        }

        if (updatedReport) {
            emit('save-success', updatedReport)
        }
        editorNotifier.notify({ code: 'save-succeeded', level: 'success', message: t('report.save_success'), toast: false })
    },
    onError: (message, result, context?: AutoSaveErrorContext) => {
        emit('save-error', message)
        const errorCode = result?.errorCode
        const messageKey = result?.messageKey
            || (errorCode === 'request_timeout' ? 'errors.request_timeout'
                : errorCode === 'save_outcome_unknown' ? 'errors.save_outcome_unknown'
                    : errorCode === 'permission_denied' ? 'errors.permission_denied'
                : errorCode === 'validation_error' ? 'errors.validation_failed'
                            : errorCode === 'system_managed' ? 'report.editor.system_managed_absence_notice'
                            : errorCode === 'conflict' ? 'errors.conflict'
                                : 'errors.unknown')
        const translated = t(messageKey)
        console.error('Report editor save failed:', {
            reportId: props.reportId,
            revision: context?.revision,
            errorCode,
            message,
            result
        })
        editorNotifier.notify({
            code: 'save-failed',
            level: 'error',
            message: translated,
            dedupeKey: `${props.reportId || 'new'}:${context?.revision ?? 'unknown'}:${errorCode || messageKey}`,
            context: { reportId: props.reportId, revision: context?.revision, errorCode: errorCode || messageKey },
            toast: true
        })
    }

})

// Computed
const reportMetrics = computed(() => {
    const content = calculateTextEditorMetrics(localContent.value)
    const contact = calculateTextEditorMetrics(contactNotes.value)
    const classMetric = calculateTextEditorMetrics(classNotes.value)
    const total = Object.fromEntries(Object.keys(content).map(key => [key,
        content[key as keyof TextEditorMetrics] + contact[key as keyof TextEditorMetrics] + classMetric[key as keyof TextEditorMetrics]
    ])) as unknown as TextEditorMetrics
    return { content, contactNotes: contact, classNotes: classMetric, total }
})
const wordCount = computed(() => reportMetrics.value.content.wordCount)
const characterCount = computed(() => reportMetrics.value.content.characterCount)
watch(reportMetrics, metrics => emit('metrics-change', metrics), { immediate: true })

// Watchers to sync props to local state (important for Master-Detail views where component is reused)
watch(() => props.initialContent, (newContent) => {
    if (newContent !== localContent.value && !hasUnsavedChanges.value) {
        const content = createTextEditorContent(props.initialContentDocument || newContent)
        localContent.value = content.plainText
        contentDocument.value = content.richText
    }
})

watch(() => props.initialVersion, (newVersion) => {
    version.value = newVersion
    remoteVersionDrift.value = false
    setBaseReportVersion(newVersion)
})

watch(() => props.initialLessonId, (newVal) => {
    if (!hasUnsavedChanges.value) selectedLessonId.value = newVal || ''
})

watch(() => props.initialIsCompleted, (newVal) => {
    if (!hasUnsavedChanges.value) isCompleted.value = newVal ?? false
})

watch(() => props.initialProgressStart, (newVal) => {
    if (!hasUnsavedChanges.value) progressStart.value = newVal || ''
})

watch(() => props.initialProgressEnd, (newVal) => {
    if (!hasUnsavedChanges.value) progressEnd.value = newVal || ''
})

watch(() => props.initialAttendanceStatus, (newVal) => {
    if (normalizeSystemManagedReason(props.initialAbsenceReason)) {
        managedAttendanceStatus.value = newVal || 'absent'
        attendanceStatus.value = newVal || 'absent'
        return
    }
    if (!hasUnsavedChanges.value) attendanceStatus.value = newVal
})

watch(() => props.initialAbsenceReason, (newVal) => {
    const managedReason = normalizeSystemManagedReason(newVal)
    if (managedReason) {
        managedAttendanceReason.value = managedReason
        managedAttendanceStatus.value = props.initialAttendanceStatus || 'absent'
        attendanceStatus.value = props.initialAttendanceStatus || 'absent'
        absenceReason.value = managedReason
        if (collabMetaMap) writeReportMeta(collabMetaMap)
        return
    }
    managedAttendanceReason.value = null
    managedAttendanceStatus.value = null
    if (!hasUnsavedChanges.value) absenceReason.value = newVal || ''
})

watch(() => props.initialClassParticipation, (newVal) => {
    if (!hasUnsavedChanges.value) classParticipation.value = newVal ?? 0
})

watch(() => props.initialClassroomBehavior, (newVal) => {
    if (!hasUnsavedChanges.value) classroomBehavior.value = newVal ?? 0
})

watch(() => props.initialContactNotes, (newVal) => {
    if (!hasUnsavedChanges.value) {
        const content = createTextEditorContent(props.initialContactNotesDocument || newVal || '')
        contactNotes.value = content.plainText
        contactNotesDocument.value = content.richText
    }
})

watch(() => props.initialClassNotes, (newVal) => {
    if (!hasUnsavedChanges.value) {
        const content = createTextEditorContent(props.initialClassNotesDocument || newVal || '')
        classNotes.value = content.plainText
        classNotesDocument.value = content.richText
    }
})

watch(() => props.initialReportExternalLink, (newVal) => {
    if (!hasUnsavedChanges.value) reportExternalLink.value = safeExternalHref(newVal) || ''
})

watch(attendanceStatus, (newStatus) => {
    if (newStatus !== 'absent' && absenceReason.value) {
        absenceReason.value = ''
    }
})

// Note: Progress values are now retained even when isCompleted is toggled
/*
watch(isCompleted, (newValue) => {
    if (newValue) {
        progressStart.value = ''
        progressEnd.value = ''
    }
})
*/

// Watch for changes that should trigger auto-save
watch([
    selectedLessonId,
    isCompleted,
    progressStart,
    progressEnd,
    attendanceStatus,
    absenceReason,
    classParticipation,
    classroomBehavior,
    contactNotes,
    classNotes,
    reportExternalLink
], () => {
    // If collaboration is active, Yjs observers and setupMapSync handle the local input saves.
    // We only use this watcher when collaboration is NOT ready/active.
    if (ready.value && ydoc.value) {
        return
    }
    handleInput()
})

const isInitializing = ref(false)

// Reset auto-save state when switching reports
watch(() => props.reportId, () => {
    isInitializing.value = true
    managedAttendanceReason.value = normalizeSystemManagedReason(props.initialAbsenceReason)
    managedAttendanceStatus.value = managedAttendanceReason.value
        ? (props.initialAttendanceStatus || 'absent')
        : null
    savedReportSnapshot.value = buildSnapshotFromProps()
    reset()
    // 給予極短時間讓 props 傳遞到 local state
    setTimeout(() => {
        isInitializing.value = false
    }, 50)
}, { immediate: true })

// Stay in initializing state while parent is loading
watch(() => props.loading, (newLoading) => {
    if (newLoading) {
        isInitializing.value = true
    } else {
        // 當載入完成後，給予極短時間穩定狀態
        setTimeout(() => {
            isInitializing.value = false
        }, 50)
    }
})

function handleInput() {
    if (isInitializing.value || isApplyingRemoteCollab) {
        // 如果正在初始化（從 props 同步中），我們不觸發自動儲存
        // 這樣可以避免載入報告時立即觸發儲存任務
        return
    }

    emit('update:content', localContent.value)
    emit('update:report-external-link', reportExternalLink.value)

    if (props.reportId) {
        triggerAutoSave(buildCurrentSnapshot())
    }
}

function handleTextEditorChange(
    field: 'content' | 'contactNotes' | 'classNotes',
    change: TextEditorChange
) {
    if (field === 'content') {
        localContent.value = change.content.plainText
        contentDocument.value = change.content.richText
    }
    if (field === 'contactNotes') {
        contactNotes.value = change.content.plainText
        contactNotesDocument.value = change.content.richText
    }
    if (field === 'classNotes') {
        classNotes.value = change.content.plainText
        classNotesDocument.value = change.content.richText
    }

    if (change.source === 'remote') {
        // The shared Y.Doc already merged this edit for us -- it did not
        // originate from this editor instance. Mirror it into local state and
        // upward via the content emits so any display that reads them stays
        // current, but do NOT enqueue an autosave: every connected peer's
        // editor observes the same fragment change, so letting each of them
        // independently re-save the merge would multiply writes for one edit
        // and race every peer's optimistic-concurrency check against the
        // others for no reason -- only the peer who actually typed it should
        // persist it.
        emit('update:content', localContent.value)
        emit('update:report-external-link', reportExternalLink.value)
        return
    }

    handleInput()
}

function queueRecoveredDraftWhenReady(attempt = 0) {
    if (isInitializing.value) {
        if (attempt < 10) {
            setTimeout(() => queueRecoveredDraftWhenReady(attempt + 1), 25)
        }
        return
    }

    syncTextRefsFromEditors()
    const recoveredSnapshot = buildCurrentSnapshot()
    if (buildDirtyPayload(recoveredSnapshot).keys.length > 0) {
        emit('update:content', recoveredSnapshot.content)
        triggerAutoSave(recoveredSnapshot)
    }
}

function saveNow(_options?: { reason?: 'manual' | 'switch' }): Promise<boolean> {
    if (!props.reportId || !canSave.value) {
        return Promise.resolve(true)
    }

    if (!hasUnsavedChanges.value) {
        return Promise.resolve(true)
    }

    syncTextRefsFromEditors()
    return autoSaveNow(buildCurrentSnapshot())
}

function replaceWithCanonicalReport(report: OccurrenceReportDTO, notifyParent = false) {
    version.value = report.version
    remoteVersionDrift.value = false
    const main = createTextEditorContent(report.content_document || report.content || '')
    const contact = createTextEditorContent(report.contact_notes_document || report.contact_notes || '')
    const classNotesContent = createTextEditorContent(report.class_notes_document || report.class_notes || '')
    localContent.value = main.plainText
    contentDocument.value = main.richText
    selectedLessonId.value = report.lesson_id || ''
    isCompleted.value = report.is_completed ?? false
    progressStart.value = report.progress_letter ? report.progress_letter.split('-')[0] : ''
    progressEnd.value = report.progress_letter && report.progress_letter.includes('-') ? report.progress_letter.split('-')[1] : ''
    attendanceStatus.value = report.attendance_status as any
    absenceReason.value = report.absence_reason || ''
    classParticipation.value = report.class_participation ?? 0
    classroomBehavior.value = report.classroom_behavior ?? 0
    contactNotes.value = contact.plainText
    contactNotesDocument.value = contact.richText
    classNotes.value = classNotesContent.plainText
    classNotesDocument.value = classNotesContent.richText
    reportExternalLink.value = safeExternalHref(report.external_link) || ''
    savedReportSnapshot.value = buildSnapshotFromDto(report)
    setBaseReportVersion(report.version)

    if (ydoc.value) {
        const metaMap = ydoc.value.getMap('reportMeta')
        withCollabGuard(() => {
            writeReportMeta(metaMap)
            setEditorContentSilently(contentEditorRef, createTextEditorContent(report.content_document || report.content || ''))
            setEditorContentSilently(contactNotesEditorRef, createTextEditorContent(report.contact_notes_document || report.contact_notes || ''))
            setEditorContentSilently(classNotesEditorRef, createTextEditorContent(report.class_notes_document || report.class_notes || ''))
        })
        void saveSnapshot()
    }

    if (notifyParent) {
        emit('restored', report)
    }

    // Clear unsaved changes flag
    reset()
}

function handleReportRestored(report: OccurrenceReportDTO) {
    replaceWithCanonicalReport(report, true)
}

function getEditorSettings(): EditorUserSettings {
    return structuredClone(preferences.editorSettings)
}

function updateEditorSettings(settings: Partial<EditorUserSettings>): EditorUserSettings {
    preferences.editorSettings = normalizeEditorUserSettings({
        ...preferences.editorSettings,
        ...settings,
        appearance: { ...preferences.editorSettings.appearance, ...settings.appearance },
        autoSave: { ...preferences.editorSettings.autoSave, ...settings.autoSave },
        collaboration: { ...preferences.editorSettings.collaboration, ...settings.collaboration }
    })
    return getEditorSettings()
}

function resetEditorSettings(): EditorUserSettings {
    preferences.editorSettings = normalizeEditorUserSettings(DEFAULT_EDITOR_USER_SETTINGS)
    return getEditorSettings()
}

defineExpose({
    saveNow,
    drain,
    retrySave,
    replaceWithCanonicalReport,
    getSnapshot: buildCurrentSnapshot,
    getMetrics: () => reportMetrics.value,
    autoSaveStatus,
    collaborationStatus,
    activePeers,
    onlineParticipantCount,
    remoteVersionDrift,
    setAutoSaveEnabled,
    configureAutoSave,
    setCollaborationEnabled,
    configureCollaboration,
    getEditorSettings,
    updateEditorSettings,
    resetEditorSettings
})

// Best-effort flush when the tab is closed, refreshed, or backgrounded. Vue's
// onBeforeUnmount never fires for these (the page can be torn down mid-async-
// work, or not unmount the component at all if it's merely backgrounded), so
// up to a full debounce interval of typing -- and any pending Yjs snapshot --
// would otherwise be silently lost. visibilitychange also covers mobile
// Safari, which does not reliably fire pagehide/beforeunload.
function flushOnPageHide() {
    if (hasUnsavedChanges.value) void saveNow()
    void saveSnapshot()
}
function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') flushOnPageHide()
}

onMounted(() => {
    window.addEventListener('pagehide', flushOnPageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)
})

// Warn before leaving with unsaved changes
onBeforeUnmount(async () => {
    reportEditorUnmounted = true
    collabEditorGeneration++
    if (collaborationRecoveryTimer) clearTimeout(collaborationRecoveryTimer)
    collaborationRecoveryTimer = null
    window.removeEventListener('pagehide', flushOnPageHide)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    cleanupReportCollabBindings()
    if (preferences.editorSettings.autoSave.saveOnUnmount) await saveNow()
})
</script>

<style scoped>
.report-editor textarea:focus {
    outline: none;
}
</style>
