<template>
    <div class="report-editor bg-white rounded-lg shadow-sm p-4 sm:p-6 relative min-h-[400px]">
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
        <h3 class="text-lg font-semibold text-gray-800">
            {{ props.title || $t('report.editor.title') }}
        </h3>

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
                    <a v-if="initialEnrollmentExternalLink" :href="initialEnrollmentExternalLink" target="_blank"
                        class="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold bg-blue-50 px-2 py-1 rounded-lg border border-blue-100 hover:border-blue-300 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        {{ $t('report.editor.view_external_report') || $t('report.editor.course_folder') }}
                    </a>
                </div>
                <BaseDropdown v-model="selectedLessonId" :options="lessonOptions" :disabled="disabled"
                    theme="emerald" />
            </div>

            <!-- Report External Link Input -->
            <div class="mb-4">
                <label class="block text-xs font-medium text-gray-600 mb-1">
                    {{ $t('report.editor.report_link_label') }}
                </label>
                <div class="flex gap-2">
                    <input type="url" v-model="reportExternalLink" placeholder="https://..."
                        class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500" />
                    <a v-if="reportExternalLink" :href="reportExternalLink" target="_blank"
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

            <div class="flex items-center gap-4 mb-3">
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="pending" v-model="attendanceStatus"
                        class="w-4 h-4 text-gray-400 border-gray-300 focus:ring-gray-400" />
                    <span class="text-sm font-medium text-gray-700">{{ $t('attendance.pending') }}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="present" v-model="attendanceStatus"
                        class="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500" />
                    <span class="text-sm font-medium text-gray-700">{{ $t('attendance.present') }}</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value="absent" v-model="attendanceStatus"
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
                    <input type="checkbox" v-model="isCompleted"
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
                    <BaseDropdown v-model="progressStart" :options="progressOptions" theme="amber" />
                </div>

                <!-- End Progress -->
                <div>
                    <label class="block text-xs font-medium text-gray-600 mb-1">
                        {{ $t('report.editor.progress_end_label') }}
                    </label>
                    <BaseDropdown v-model="progressEnd" :options="progressOptions" theme="amber" />
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
                    <RatingInput v-model="classParticipation" :show-value="true" />
                </div>
            </div>
            <div class="flex-1 min-w-[165px]">
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    {{ $t('report.editor.classroom_behavior_label') }}
                </label>
                <div class="flex items-center gap-2">
                    <RatingInput v-model="classroomBehavior" :show-value="true" />
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
            <TipTapCollabEditor 
                ref="contactNotesEditorRef"
                v-if="ready && ydoc"
                field-name="contactNotes_xml" 
                :ydoc="ydoc" 
                :provider="awarenessProvider" 
                :disabled="props.disabled" 
                :font-scale="preferences.editorFontScale"
                :min-height="90"
                :user="{ name: authStore.user?.user_metadata?.full_name || 'Teacher', color: '#60A5FA' }"
                :placeholder="$t('report.editor.contact_notes_placeholder')" />
            <!-- Fallback standard editor if ydoc not ready -->
            <textarea v-else v-model="contactNotes" rows="2"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
                :style="{ fontSize: `${preferences.editorFontScale}%` }"
                :placeholder="$t('report.editor.contact_notes_placeholder')"></textarea>
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
            <TipTapCollabEditor 
                ref="classNotesEditorRef"
                v-if="ready && ydoc"
                field-name="classNotes_xml" 
                :ydoc="ydoc" 
                :provider="awarenessProvider" 
                :disabled="props.disabled" 
                :font-scale="preferences.editorFontScale"
                :min-height="140"
                mono
                :user="{ name: authStore.user?.user_metadata?.full_name || 'Teacher', color: '#A78BFA' }"
                :placeholder="$t('report.editor.class_notes_placeholder')" />
            <textarea v-else v-model="classNotes" rows="4"
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y font-mono"
                :style="{ fontSize: `${preferences.editorFontScale}%` }"
                :placeholder="$t('report.editor.class_notes_placeholder')"></textarea>
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
            <TipTapCollabEditor 
                ref="contentEditorRef"
                v-if="ready && ydoc"
                field-name="content_xml" 
                :ydoc="ydoc" 
                :provider="awarenessProvider" 
                :disabled="props.disabled" 
                :font-scale="preferences.editorFontScale"
                :min-height="300"
                mono
                :user="{ name: authStore.user?.user_metadata?.full_name || 'Teacher', color: '#34D399' }"
                :placeholder="props.placeholder || $t('report.editor.learning_report_placeholder')" />
            <textarea v-else v-model="localContent" @input="handleInput"
                :placeholder="props.placeholder || $t('report.editor.learning_report_placeholder')"
                :disabled="props.disabled"
                class="w-full min-h-[300px] p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-y font-mono"
                :class="{ 'bg-gray-50': props.disabled, 'opacity-50': props.disabled }"
                :style="{ fontSize: `${preferences.editorFontScale}%` }" />
        </div>

        <!-- Error Display -->
        <div v-if="saveError" class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            <strong>{{ $t('report.editor.error') }}:</strong> {{ saveError }}
        </div>

        <!-- Manual Save Button (Optional) -->
        <div v-if="showManualSave" class="mt-4">
            <button @click="saveNow" :disabled="isSaving || !hasUnsavedChanges || !canSave"
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

        <CopyTemplateEditorModal v-model="showCourseCopyTemplateModal"
            :title="$t('report.editor.copy_course_template_title')"
            :hint="$t('report.editor.copy_course_template_hint')"
            :variable-title="$t('report.editor.copy_course_template_variables')"
            :content-title="$t('report.editor.copy_course_template_content')"
            :preview-title="$t('report.editor.copy_course_template_preview_title')"
            :preview-hint="$t('report.editor.copy_course_template_preview_hint')"
            :preview-empty="$t('report.editor.copy_course_template_preview_empty')"
            :template-text="courseCopyTemplateText" :preview-text="courseTemplatePreviewText"
            :variable-count="courseTemplateVariables.length" :is-loading="isLoadingCourseCopyTemplate"
            :loading-text="$t('report.editor.copy_course_template_loading')"
            :loading-hint="$t('report.editor.copy_course_template_loading_hint')"
            :save-loading="isSavingCourseCopyTemplate" :cancel-text="$t('common.cancel')" :save-text="$t('common.save')"
            :saving-text="$t('report.saving')" @update:template-text="courseCopyTemplateText = $event"
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
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAutoSave } from '@/composables/useAutoSave'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import { useAuthStore } from '@/stores/useAuthStore'
import RatingInput from '@/components/common/RatingInput.vue'
import BaseDropdown from '@/components/common/BaseDropdown.vue'
import TipTapCollabEditor from '@/components/common/TipTapCollabEditor.vue'
import CopyTemplateEditorModal from '@/components/common/CopyTemplateEditorModal.vue'
import ReportReferencePanel from '@/components/ReportReferencePanel.vue'
import ReportVersionHistoryModal from '@/components/ReportVersionHistoryModal.vue'
import { ReportTemplateService } from '@/services/report/ReportTemplateService'
import { CopyTemplateService, type CopyTemplateLoadOption } from '@/services/copy_template/CopyTemplateService'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { useToast } from 'vue-toastification'
import { useReportCollab } from '@/composables/useReportCollab'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import {
    COURSE_TEMPLATE_VARIABLE_DEFINITIONS,
    SYSTEM_COURSE_TEMPLATE,
    formatCopyTemplateToken,
    renderCopyTemplate,
    createNumberFormatters
} from '@/utils/copyTemplate'
import { copyToClipboard } from '@/utils/clipboard'
import { formatNumber } from '@/utils/numberFormatting'

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
    initialClassNotes?: string // 課堂筆記/紀錄
    initialContent?: string // 學習報告
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
    initialClassNotes: '',
    initialContent: '',
    initialEnrollmentExternalLink: '',
    initialCreatedAt: '',
    compact: false,
})

const emit = defineEmits<{
    'update:content': [content: string]
    'save-success': [version: number]
    'update:report-external-link': [value: string]
    'save-error': [error: string]
    'conflict': [serverReport: OccurrenceReportDTO, localReport: OccurrenceReportDTO]
    'deleted': []
    'restored': [report: OccurrenceReportDTO]
}>()

interface Template {
    id: string
    name: string
    content: string
    contactNotes?: string
    classNotes?: string
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
const courseCopyTemplateText = ref(SYSTEM_COURSE_TEMPLATE)
const isLoadingCourseCopyTemplate = ref(false)
const isSavingCourseCopyTemplate = ref(false)
const selectedCourseTemplateModes = ref<Record<string, string>>({
    course_primary_name: 'space'
})
const courseTemplateLoadOptions = ref<Array<CopyTemplateLoadOption & { displayLabel: string }>>([])
const selectedCourseTemplateLoadKey = ref('')
const showReportTemplateManagerModal = ref(false)
const reportTemplateModal = ref<InstanceType<typeof CopyTemplateEditorModal> | null>(null)
const selectedTemplateId = ref('')
const templateDraftName = ref('')
const templateDraftContent = ref('')
const templateDraftContactNotes = ref('')
const templateDraftClassNotes = ref('')
const selectedReportTemplateModes = ref<Record<string, string>>({
    lesson: 'arabic'
})

const preferences = usePreferencesStore()
const toast = useToast()

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
    if (ydoc.value && contentEditorRef.value?.editor) {
        const editor = contentEditorRef.value.editor
        const current = editor.getText()
        editor.commands.focus('end')
        editor.commands.insertContent((current ? '\n\n' : '') + text)
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
            contactNotes: t.contactNotes,
            classNotes: t.classNotes
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
const reportTemplateEditableFields = computed<Array<{ id: string; label: string; content: string }>>(() => {
    return [
        {
            id: 'contact',
            label: t('report.editor.contact_notes_label'),
            content: templateDraftContactNotes.value
        },
        {
            id: 'class',
            label: t('report.editor.class_notes_label'),
            content: templateDraftClassNotes.value
        },
        {
            id: 'report',
            label: t('report.editor.learning_report_label'),
            content: templateDraftContent.value
        }
    ]
})

function insertReportTemplateVariable(fieldId: string, variable: string) {
    const mode = selectedReportTemplateModes.value[variable]
    const token = formatCopyTemplateToken(variable, mode)
    if (fieldId === 'contact') {
        templateDraftContactNotes.value += token
        return
    }
    if (fieldId === 'class') {
        templateDraftClassNotes.value += token
        return
    }
    templateDraftContent.value += token
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

function onEditableFieldsUpdate(fields: Array<{ id: string; label: string; content: string }>) {
    fields.forEach(field => {
        if (field.id === 'contact') {
            templateDraftContactNotes.value = field.content
        } else if (field.id === 'class') {
            templateDraftClassNotes.value = field.content
        } else if (field.id === 'report') {
            templateDraftContent.value = field.content
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

    const copyPromise = CopyTemplateService.getEffectiveCourseTemplate()
        .then(({ templateText }) => {
            const text = renderCopyTemplate(templateText, context, {
                course_primary_name: {
                    space: () => formatCoursePrimaryName(cName, dName, 'space'),
                    slash: () => formatCoursePrimaryName(cName, dName, 'slash'),
                    newline: () => formatCoursePrimaryName(cName, dName, 'newline'),
                    bullet: () => formatCoursePrimaryName(cName, dName, 'bullet')
                },
                lesson_sequence: createNumberFormatters('lesson_sequence')
            }).trim()
            const fallback = `${coursePrimaryName} Lesson ${lesson.sequence} ${lesson.title}`.trim()
            return text || fallback
        })

    copyToClipboard(copyPromise)
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
    courseCopyTemplateText.value += formatCopyTemplateToken(variable, mode)
}

async function openCourseCopyTemplateModal() {
    showCourseCopyTemplateModal.value = true
    courseCopyTemplateText.value = SYSTEM_COURSE_TEMPLATE
    selectedCourseTemplateModes.value = {
        course_primary_name: 'space'
    }

    try {
        isLoadingCourseCopyTemplate.value = true
        const [template, options] = await Promise.all([
            CopyTemplateService.getCourseUserDefaultTemplate(),
            CopyTemplateService.getTemplateLoadOptions('course_copy')
        ])
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
    } catch (error) {
        console.error('Failed to load course copy template', error)
        toast.error(t('report.editor.copy_course_template_load_failed'))
    } finally {
        isLoadingCourseCopyTemplate.value = false
    }
}

function loadSelectedCourseTemplate() {
    const option = courseTemplateLoadOptions.value.find(item => item.key === selectedCourseTemplateLoadKey.value)
    if (!option) {
        return
    }

    courseCopyTemplateText.value = option.templateText || SYSTEM_COURSE_TEMPLATE
}

async function saveCourseCopyTemplate() {
    const templateText = courseCopyTemplateText.value.trim()
    if (!templateText) {
        toast.error(t('report.editor.copy_course_template_empty_error'))
        return
    }

    try {
        isSavingCourseCopyTemplate.value = true
        await CopyTemplateService.saveCourseTemplateAsUserDefault(templateText)
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
    const renderedContent = renderReportTemplateText(template.content || '')
    const renderedContactNotes = renderReportTemplateText(template.contactNotes || '')
    const renderedClassNotes = renderReportTemplateText(template.classNotes || '')

    let changed = false

    if (ydoc.value) {
        if (renderedContent && contentEditorRef.value?.editor) {
            const editor = contentEditorRef.value.editor
            if (editor.isEmpty) editor.commands.setContent(renderedContent)
            else {
                editor.commands.focus('end')
                editor.commands.insertContent('\n\n' + renderedContent)
            }
        }
        if (renderedContactNotes && contactNotesEditorRef.value?.editor) {
            const editor = contactNotesEditorRef.value.editor
            if (editor.isEmpty) editor.commands.setContent(renderedContactNotes)
            else {
                editor.commands.focus('end')
                editor.commands.insertContent('\n\n' + renderedContactNotes)
            }
        }
        if (renderedClassNotes && classNotesEditorRef.value?.editor) {
            const editor = classNotesEditorRef.value.editor
            if (editor.isEmpty) editor.commands.setContent(renderedClassNotes)
            else {
                editor.commands.focus('end')
                editor.commands.insertContent('\n\n' + renderedClassNotes)
            }
        }
        changed = true
    } else {
        if (!localContent.value.trim() && renderedContent) {
            localContent.value = renderedContent
            changed = true
        }

        if (!contactNotes.value.trim() && renderedContactNotes) {
            contactNotes.value = renderedContactNotes
            changed = true
        }

        if (!classNotes.value.trim() && renderedClassNotes) {
            classNotes.value = renderedClassNotes
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
    templateDraftContactNotes.value = contactNotes.value || ''
    templateDraftClassNotes.value = classNotes.value || ''
}

function syncTemplateDraftFromSelection() {
    const selected = savedTemplates.value.find(item => item.id === selectedTemplateId.value)
    if (!selected) {
        createNewTemplateDraft()
        return
    }

    templateDraftName.value = selected.name
    templateDraftContent.value = selected.content || ''
    templateDraftContactNotes.value = selected.contactNotes || ''
    templateDraftClassNotes.value = selected.classNotes || ''
}

function handleTemplateSelectionChange() {
    syncTemplateDraftFromSelection()
}

async function openReportTemplateManagerModal() {
    showReportTemplateManagerModal.value = true
    try {
        isLoadingTemplateManager.value = true
        await loadTemplates()
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
            contact_notes: templateDraftContactNotes.value,
            class_notes: templateDraftClassNotes.value,
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
                toast.error(t('report.editor.restore_conflict_error', '版本衝突：已有其他使用者修改了此報告。請先重新載入取得最新版本。'))
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
        contactNotes: templateDraftContactNotes.value,
        classNotes: templateDraftClassNotes.value
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
const reportIdRef = computed(() => props.reportId || '')
const { ydoc, provider: awarenessProvider, ready, saveSnapshot } = useReportCollab(reportIdRef as any)

const contactNotesEditorRef = ref<any>(null)
const classNotesEditorRef = ref<any>(null)
const contentEditorRef = ref<any>(null)

watch(ready, (isReady) => {
    if (isReady && ydoc.value) {
        // Setup reportMeta sync
        const metaMap = ydoc.value.getMap('reportMeta')

        // Initialize local fields from map if they exist, otherwise seed them from local state
        if (metaMap.has('attendanceStatus')) attendanceStatus.value = metaMap.get('attendanceStatus') as any
        else if (attendanceStatus.value) metaMap.set('attendanceStatus', attendanceStatus.value)

        if (metaMap.has('absenceReason')) absenceReason.value = metaMap.get('absenceReason') as any
        else if (absenceReason.value) metaMap.set('absenceReason', absenceReason.value)

        if (metaMap.has('classParticipation')) classParticipation.value = metaMap.get('classParticipation') as any
        else if (classParticipation.value !== undefined) metaMap.set('classParticipation', classParticipation.value)

        if (metaMap.has('classroomBehavior')) classroomBehavior.value = metaMap.get('classroomBehavior') as any
        else if (classroomBehavior.value !== undefined) metaMap.set('classroomBehavior', classroomBehavior.value)

        if (metaMap.has('isCompleted')) isCompleted.value = metaMap.get('isCompleted') as any
        else if (isCompleted.value !== undefined) metaMap.set('isCompleted', isCompleted.value)

        if (metaMap.has('progressStart')) progressStart.value = metaMap.get('progressStart') as any
        else if (progressStart.value) metaMap.set('progressStart', progressStart.value)

        if (metaMap.has('progressEnd')) progressEnd.value = metaMap.get('progressEnd') as any
        else if (progressEnd.value) metaMap.set('progressEnd', progressEnd.value)

        if (metaMap.has('selectedLessonId')) selectedLessonId.value = metaMap.get('selectedLessonId') as any
        else if (selectedLessonId.value) metaMap.set('selectedLessonId', selectedLessonId.value)

        if (metaMap.has('reportExternalLink')) reportExternalLink.value = metaMap.get('reportExternalLink') as any
        else if (reportExternalLink.value) metaMap.set('reportExternalLink', reportExternalLink.value)

        if (metaMap.has('version')) {
            const remoteVersion = metaMap.get('version') as number
            if (remoteVersion > version.value) {
                version.value = remoteVersion
            }
        } else {
            metaMap.set('version', version.value)
        }
        
        metaMap.observe((event) => {
            event.changes.keys.forEach((_, key) => {
                const newVal = metaMap.get(key)
                if (key === 'attendanceStatus' && newVal !== attendanceStatus.value) attendanceStatus.value = newVal as any
                if (key === 'absenceReason' && newVal !== absenceReason.value) absenceReason.value = newVal as any
                if (key === 'classParticipation' && newVal !== classParticipation.value) classParticipation.value = newVal as any
                if (key === 'classroomBehavior' && newVal !== classroomBehavior.value) classroomBehavior.value = newVal as any
                if (key === 'isCompleted' && newVal !== isCompleted.value) isCompleted.value = newVal as any
                if (key === 'progressStart' && newVal !== progressStart.value) progressStart.value = newVal as any
                if (key === 'progressEnd' && newVal !== progressEnd.value) progressEnd.value = newVal as any
                if (key === 'selectedLessonId' && newVal !== selectedLessonId.value) selectedLessonId.value = newVal as any
                if (key === 'reportExternalLink' && newVal !== reportExternalLink.value) reportExternalLink.value = newVal as any
                if (key === 'version') {
                    const remoteVersion = newVal as number
                    if (remoteVersion > version.value) {
                        version.value = remoteVersion
                    }
                }
            })
        })

        let isInternalUpdate = false
        // Listen for local changes to update map
        const setupMapSync = (refVar: any, mapKey: string) => {
            watch(refVar, (val) => {
                if (isInternalUpdate) return
                if (metaMap.get(mapKey) !== val) {
                    isInternalUpdate = true
                    metaMap.set(mapKey, val)
                    isInternalUpdate = false
                    handleInput()
                }
            })
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
            if (!ydoc.value) return
            if (contentEditorRef.value?.editor && ydoc.value.getXmlFragment('content_xml').length === 0 && localContent.value) {
                contentEditorRef.value.editor.commands.setContent(localContent.value)
            }
            if (contactNotesEditorRef.value?.editor && ydoc.value.getXmlFragment('contactNotes_xml').length === 0 && contactNotes.value) {
                contactNotesEditorRef.value.editor.commands.setContent(contactNotes.value)
            }
            if (classNotesEditorRef.value?.editor && ydoc.value.getXmlFragment('classNotes_xml').length === 0 && classNotes.value) {
                classNotesEditorRef.value.editor.commands.setContent(classNotes.value)
            }
        })

        // Setup text sync for saving
        ydoc.value.getXmlFragment('content_xml').observe((event) => {
            if (event.transaction.local) {
                handleInput()
            } else {
                if (contentEditorRef.value?.editor) {
                    localContent.value = contentEditorRef.value.editor.getText()
                }
                emit('update:content', localContent.value)
            }
        })
        ydoc.value.getXmlFragment('contactNotes_xml').observe((event) => {
            if (event.transaction.local) {
                handleInput()
            } else {
                if (contactNotesEditorRef.value?.editor) {
                    contactNotes.value = contactNotesEditorRef.value.editor.getText()
                }
            }
        })
        ydoc.value.getXmlFragment('classNotes_xml').observe((event) => {
            if (event.transaction.local) {
                handleInput()
            } else {
                if (classNotesEditorRef.value?.editor) {
                    classNotes.value = classNotesEditorRef.value.editor.getText()
                }
            }
        })
    }
})




const authStore = useAuthStore()
const { t } = useI18n()

// Local state
const localContent = ref(props.initialContent)
const version = ref(props.initialVersion)



// Detailed fields
const selectedLessonId = ref(props.initialLessonId || '')
const isCompleted = ref(props.initialIsCompleted)
const progressStart = ref(props.initialProgressStart || '')
const progressEnd = ref(props.initialProgressEnd || '')
const attendanceStatus = ref<'present' | 'absent' | 'pending'>(props.initialAttendanceStatus)
const absenceReason = ref(props.initialAbsenceReason || '')
const classParticipation = ref(props.initialClassParticipation ?? 0)
const classroomBehavior = ref(props.initialClassroomBehavior ?? 0)
const contactNotes = ref(props.initialContactNotes || '')
const classNotes = ref(props.initialClassNotes || '')
const reportExternalLink = ref(props.initialReportExternalLink || '')


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
    const reason = absenceReason.value?.toLowerCase() || ''
    return reason === 'holiday' || reason === 'suspension'
})

const getSystemManagedAbsenceLabel = () => {
    const reason = absenceReason.value?.toLowerCase() || ''
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

// Auto-save setup
const {
    isSaving,
    lastSaved,
    hasUnsavedChanges,
    saveError,
    saveNow: autoSaveNow,
    triggerAutoSave,
    getLastSavedString,
    reset
} = useAutoSave({
    debounceMs: props.debounceMs,
    onSave: async (content) => {
        if (!props.reportId) {
            return { success: false, message: 'No report ID provided' }
        }

        if (!canSave.value) {
            return { success: false, message: t('report.editor.required_field_error') }
        }

        // Auto-fill absence reason if missing
        let finalAbsenceReason = absenceReason.value
        if (attendanceStatus.value === 'absent' && !finalAbsenceReason) {
            finalAbsenceReason = t('report.editor.absence_reasons.reason_not_provided')
            absenceReason.value = finalAbsenceReason
        }

        const saveContent = (ydoc.value && contentEditorRef.value?.editor) ? contentEditorRef.value.editor.getText() : content
        const saveContact = (ydoc.value && contactNotesEditorRef.value?.editor) ? contactNotesEditorRef.value.editor.getText() : contactNotes.value
        const saveClass = (ydoc.value && classNotesEditorRef.value?.editor) ? classNotesEditorRef.value.editor.getText() : classNotes.value

        try {
            // Also take a snapshot for version history
            if (ready.value && props.reportId && authStore.user?.id) {
                await saveSnapshot()
            }

            const result = await OccurrenceReportService.saveReport(
                props.reportId,
                version.value,
                authStore.user?.id,
                {
                    lessonId: selectedLessonId.value || undefined,
                    isCompleted: isCompleted.value,
                    progressLetter: progressLetter.value || undefined,
                    attendanceStatus: attendanceStatus.value,
                    absenceReason: finalAbsenceReason || undefined,
                    classParticipation: classParticipation.value,
                    classroomBehavior: classroomBehavior.value,
                    contactNotes: saveContact,
                    classNotes: saveClass,
                    content: saveContent,
                    externalLink: reportExternalLink.value
                }
            )

            const localReportPayload: OccurrenceReportDTO = {
                id: props.reportId,
                enrollment_id: props.enrollmentId || '',
                class_occurrence_id: props.classOccurrenceId || '',
                lesson_id: selectedLessonId.value || '',
                content: content,
                is_completed: isCompleted.value,

                progress_letter: progressLetter.value || '',
                attendance_status: attendanceStatus.value,
                absence_reason: finalAbsenceReason || '',
                class_participation: classParticipation.value,
                classroom_behavior: classroomBehavior.value,
                contact_notes: contactNotes.value,
                class_notes: classNotes.value,
                external_link: reportExternalLink.value,

                version: version.value,
                last_edited_at: new Date().toISOString(),
                last_edited_by: authStore.user?.id,
                created_at: props.initialCreatedAt,
                updated_at: new Date().toISOString(),
            }

            if (result.conflict) {
                emit('conflict', result.serverReport!, localReportPayload)
                return result
            }

            return result
        } catch (error: any) {
            const message = error.message || 'Failed to save report'
            emit('save-error', message)
            return { success: false, message }
        }
    },
    onConflict: (serverReport) => {
        // Construct local payload for comparison
        const localReportPayload: OccurrenceReportDTO = {
            id: props.reportId,
            enrollment_id: props.enrollmentId || '',
            class_occurrence_id: props.classOccurrenceId || '',
            lesson_id: selectedLessonId.value || '',
            content: localContent.value,
            is_completed: isCompleted.value,

            progress_letter: progressLetter.value || '',
            attendance_status: attendanceStatus.value,
            absence_reason: absenceReason.value || '',
            class_participation: classParticipation.value,
            classroom_behavior: classroomBehavior.value,
            contact_notes: contactNotes.value,
            class_notes: classNotes.value,
            external_link: reportExternalLink.value,

            version: version.value,
            last_edited_at: new Date().toISOString(),
            last_edited_by: authStore.user?.id,
            created_at: props.initialCreatedAt,
            updated_at: new Date().toISOString(),
        }
        emit('conflict', serverReport!, localReportPayload)
    },
    onSuccess: (newVersion) => {
        version.value = newVersion
        if (ydoc.value) {
            const metaMap = ydoc.value.getMap('reportMeta')
            const currentMetaVer = metaMap.get('version') as number || 0
            if (newVersion > currentMetaVer) {
                metaMap.set('version', newVersion)
            }
        }
        emit('save-success', newVersion)
    },
    onError: (message) => {
        emit('save-error', message)
    }
})

// Computed
const wordCount = computed(() => {
    if (!localContent.value) return 0
    return localContent.value.trim().split(/\s+/).filter(w => w.length > 0).length
})

const characterCount = computed(() => {
    return localContent.value.length
})

// Watchers to sync props to local state (important for Master-Detail views where component is reused)
watch(() => props.initialContent, (newContent) => {
    if (newContent !== localContent.value && !hasUnsavedChanges.value) {
        localContent.value = newContent
    }
})

watch(() => props.initialVersion, (newVersion) => {
    version.value = newVersion
})

watch(() => props.initialLessonId, (newVal) => {
    selectedLessonId.value = newVal || ''
})

watch(() => props.initialIsCompleted, (newVal) => {
    isCompleted.value = newVal ?? false
})

watch(() => props.initialProgressStart, (newVal) => {
    progressStart.value = newVal || ''
})

watch(() => props.initialProgressEnd, (newVal) => {
    progressEnd.value = newVal || ''
})

watch(() => props.initialAttendanceStatus, (newVal) => {
    attendanceStatus.value = newVal
})

watch(() => props.initialAbsenceReason, (newVal) => {
    absenceReason.value = newVal || ''
})

watch(() => props.initialClassParticipation, (newVal) => {
    classParticipation.value = newVal ?? 0
})

watch(() => props.initialClassroomBehavior, (newVal) => {
    classroomBehavior.value = newVal ?? 0
})

watch(() => props.initialContactNotes, (newVal) => {
    contactNotes.value = newVal || ''
})

watch(() => props.initialClassNotes, (newVal) => {
    classNotes.value = newVal || ''
})

watch(() => props.initialReportExternalLink, (newVal) => {
    reportExternalLink.value = newVal || ''
})

// Business rule: absent → incomplete
watch(attendanceStatus, (newStatus) => {
    if (newStatus === 'absent') {
        isCompleted.value = false
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
    if (isInitializing.value) {
        // 如果正在初始化（從 props 同步中），我們不觸發自動儲存
        // 這樣可以避免載入報告時立即觸發儲存任務
        return
    }

    if (ydoc.value) {
        if (contentEditorRef.value?.editor) {
            localContent.value = contentEditorRef.value.editor.getText()
        }
        if (contactNotesEditorRef.value?.editor) {
            contactNotes.value = contactNotesEditorRef.value.editor.getText()
        }
        if (classNotesEditorRef.value?.editor) {
            classNotes.value = classNotesEditorRef.value.editor.getText()
        }
    }

    emit('update:content', localContent.value)
    emit('update:report-external-link', reportExternalLink.value)

    if (props.reportId) {
        triggerAutoSave(localContent.value)
    }
}


function saveNow() {
    if (!props.reportId || !canSave.value) {
        return Promise.resolve()
    }

    return autoSaveNow(localContent.value)
}

function handleReportRestored(report: OccurrenceReportDTO) {
    version.value = report.version
    localContent.value = report.content || ''
    selectedLessonId.value = report.lesson_id || ''
    isCompleted.value = report.is_completed ?? false
    progressStart.value = report.progress_letter ? report.progress_letter.split('-')[0] : ''
    progressEnd.value = report.progress_letter && report.progress_letter.includes('-') ? report.progress_letter.split('-')[1] : ''
    attendanceStatus.value = report.attendance_status as any
    absenceReason.value = report.absence_reason || ''
    classParticipation.value = report.class_participation ?? 0
    classroomBehavior.value = report.classroom_behavior ?? 0
    contactNotes.value = report.contact_notes || ''
    classNotes.value = report.class_notes || ''
    reportExternalLink.value = report.external_link || ''

    if (ydoc.value) {
        const metaMap = ydoc.value.getMap('reportMeta')
        metaMap.set('version', report.version)

        if (contentEditorRef.value?.editor) {
            contentEditorRef.value.editor.commands.setContent(report.content || '')
        }
        if (contactNotesEditorRef.value?.editor) {
            contactNotesEditorRef.value.editor.commands.setContent(report.contact_notes || '')
        }
        if (classNotesEditorRef.value?.editor) {
            classNotesEditorRef.value.editor.commands.setContent(report.class_notes || '')
        }
    }

    // Emit the event to parent
    emit('restored', report)

    // Clear unsaved changes flag
    reset()
}

defineExpose({
    saveNow
})

// Warn before leaving with unsaved changes
onBeforeUnmount(() => {
    void saveNow()
})
</script>

<style scoped>
.report-editor textarea:focus {
    outline: none;
}
</style>
