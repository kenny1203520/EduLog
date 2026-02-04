<template>
    <div class="student-reports-view p-6 max-w-7xl mx-auto">
        <!-- Header with Back Button -->
        <div class="mb-6">
            <button @click="router.back()"
                class="mb-4 text-gray-600 hover:text-emerald-600 font-medium flex items-center gap-2 transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                {{ $t('common.back') }}
            </button>
            <h1 class="text-2xl font-bold text-gray-900">
                <span v-if="enrollmentInfo">{{ enrollmentInfo.studentName }} - {{ enrollmentInfo.courseDisplay }}</span>
                <span v-else>{{ $t('report.list_title') }}</span>
            </h1>
        </div>

        <!-- Incomplete Reports Module -->
        <div v-if="incompleteReports.length > 0 && !loading"
            class="mb-6 bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
            <button @click="showIncompleteModule = !showIncompleteModule"
                class="w-full flex items-center justify-between p-4 bg-amber-100/50 hover:bg-amber-100 transition cursor-pointer">
                <div class="flex items-center gap-4">
                    <div
                        class="w-10 h-10 rounded-full bg-amber-200 text-amber-700 flex items-center justify-center shadow-inner">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div class="text-left">
                        <h3 class="font-bold text-amber-900 text-lg">{{ $t('report.incomplete_reports_title') ||
                            'Pending Reports' }}</h3>
                        <p class="text-sm text-amber-700 font-medium">
                            {{ $t('report.incomplete_reports_desc', { count: incompleteReports.length }) || `You have
                            ${incompleteReports.length} report(s) needing attention` }}
                        </p>
                    </div>
                </div>
                <div class="bg-white/50 p-2 rounded-full text-amber-600 transition-transform duration-300"
                    :class="{ 'rotate-180': showIncompleteModule }">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd"
                            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                            clip-rule="evenodd" />
                    </svg>
                </div>
            </button>

            <div v-if="showIncompleteModule" class="divide-y divide-amber-100 bg-white/50 backdrop-blur-sm">
                <div v-for="item in incompleteReports" :key="item.id" @click="handleIncompleteClick(item)"
                    class="p-4 hover:bg-amber-50 transition cursor-pointer flex items-center justify-between group">
                    <div class="flex items-center gap-6">
                        <!-- Date Box -->
                        <div
                            class="flex flex-col items-center w-16 shrink-0 bg-white rounded-lg p-2 border border-amber-100 shadow-sm">
                            <span class="text-xs font-bold text-gray-400 uppercase">{{ formatWeekday(item.date)
                            }}</span>
                            <span class="text-lg font-black text-gray-800">{{ new Date(item.date).getDate() }}</span>
                            <span class="text-[10px] font-bold text-emerald-600 truncate w-full text-center"
                                v-if="item.startTime">{{ item.startTime.slice(0, 5) }}</span>
                        </div>

                        <div>
                            <div class="text-xs text-gray-400 font-bold mb-1">Ver: {{ item.version }}</div>
                            <div class="flex flex-wrap gap-2">
                                <span v-if="item.missingContent"
                                    class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-600 border border-rose-100">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20"
                                        fill="currentColor">
                                        <path fill-rule="evenodd"
                                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                            clip-rule="evenodd" />
                                    </svg>
                                    {{ $t('report.missing_content') || 'Missing Content' }}
                                </span>
                                <span v-if="item.missingLesson"
                                    class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-orange-50 text-orange-600 border border-orange-100">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20"
                                        fill="currentColor">
                                        <path
                                            d="M9 4.804A7.968 7.968 0 005.5 4c-1.255 0-2.443.29-3.5.804v10A7.969 7.969 0 015.5 14c1.669 0 3.218.51 4.5 1.385A7.962 7.962 0 0114.5 14c1.255 0 2.443.29 3.5.804v-10A7.968 7.968 0 0014.5 4c-1.255 0-2.443.29-3.5.804V12a1 1 0 11-2 0V4.804z" />
                                    </svg>
                                    {{ $t('report.missing_unit') || 'Missing Unit' }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Action Arrow -->
                    <div
                        class="w-10 h-10 rounded-full bg-white border border-amber-100 flex items-center justify-center text-amber-300 group-hover:bg-amber-500 group-hover:text-white group-hover:border-amber-500 transition-all shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 transform group-hover:translate-x-0.5 transition-transform" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>
            </div>
        </div>
        <div class="flex justify-between items-end mb-4">
            <!-- Sort Control (List View Only) -->
            <div v-if="viewMode === 'list'" class="mb-1">
                <button @click="toggleSort"
                    class="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                    <span>{{ sortOrder === 'asc' ? $t('common.sort_asc') || 'Oldest First' : $t('common.sort_desc') ||
                        'Newest First' }}</span>
                </button>
            </div>
            <div v-else></div>

            <!-- View Toggle -->
            <div class="bg-gray-100 p-1 rounded-lg inline-flex">
                <button @click="viewMode = 'calendar'"
                    class="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    :class="viewMode === 'calendar' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                    <div class="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {{ $t('common.calendar') || 'Calendar' }}
                    </div>
                </button>
                <button @click="switchToListView" class="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                    :class="viewMode === 'list' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                    <div class="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                        </svg>
                        {{ $t('common.list') || 'List' }}
                    </div>
                </button>
            </div>
        </div>

        <div v-if="loading"
            class="flex flex-col items-center justify-center py-20 text-gray-500 bg-white rounded-2xl shadow-sm border border-gray-100">
            <svg class="animate-spin h-10 w-10 mb-4 text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p class="font-medium">{{ $t('report.loading_full') }}</p>
        </div>

        <!-- LIST VIEW -->
        <div v-else-if="viewMode === 'list'"
            class="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <div v-if="listLoading" class="p-12 flex justify-center">
                <svg class="animate-spin h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                    <path class="opacity-75" fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
            </div>
            <div v-else-if="allReports.length === 0" class="p-12 text-center text-gray-500">
                No reports found.
            </div>
            <div v-else class="divide-y divide-gray-100">
                <div v-for="displayReport in allReportDisplay" :key="displayReport.id"
                    class="p-6 hover:bg-gray-50 flex gap-6 cursor-pointer group relative"
                    :class="{ 'bg-gray-50/50 opacity-80': !displayReport.id }"
                    @click="handleListRowClick(displayReport)">

                    <!-- Placeholder Indicator -->
                    <div v-if="!displayReport.id"
                        class="absolute top-2 right-2 text-[10px] font-bold text-gray-400 border border-gray-200 px-1 rounded uppercase tracking-tighter">
                        Scheduled
                    </div>

                    <!-- Left: Date -->
                    <div class="w-24 shrink-0 flex flex-col items-center">
                        <div class="text-sm font-bold text-gray-900">{{ formatDate(displayReport.date) }}</div>
                        <div class="text-xs font-bold text-emerald-600 mt-0.5">{{ displayReport.startTime.slice(0, 5) }}
                        </div>
                        <div class="text-[10px] text-gray-500 uppercase mt-1">{{ formatWeekday(displayReport.date) }}
                        </div>
                        <div class="mt-2 px-2 py-1 rounded text-xs font-medium"
                            :class="getStatusColor(displayReport.status)">
                            {{ $t(`student.attendance.${displayReport.status}`) }}
                        </div>
                    </div>

                    <!-- Middle: Content -->
                    <div class="flex-1 space-y-3">
                        <div class="flex items-center justify-between">
                            <div class="flex items-center gap-2">
                                <h3 class="font-bold text-gray-900 flex items-center gap-2">
                                    {{ $t('report.lesson_label') }}: {{ displayReport.lessonTitle || '-' }}
                                    <span v-if="displayReport.isCompleted" class="text-emerald-500"
                                        :title="$t('report.completed')">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20"
                                            fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                                clip-rule="evenodd" />
                                        </svg>
                                    </span>
                                </h3>
                                <span v-if="displayReport.progressDisplay"
                                    class="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                                    {{ displayReport.progressDisplay }}
                                </span>
                            </div>
                            <div class="text-xs text-gray-400 font-mono">Ver: {{ displayReport.version }}</div>
                        </div>

                        <!-- Main Content Summary -->
                        <div class="text-sm text-gray-600 line-clamp-3">
                            <span class="font-semibold text-gray-700">{{ $t('report.learning_content') }}:</span>
                            {{ displayReport.content || $t('common.none') }}
                        </div>

                        <!-- Notes Summary -->
                        <div v-if="displayReport.classNotes"
                            class="text-xs text-gray-500 italic bg-amber-50 p-2 rounded border border-amber-100">
                            <span class="font-bold text-amber-700 not-italic">{{ $t('student.notes') }}:</span> {{
                                displayReport.classNotes }}
                        </div>

                        <!-- Contact Notes Summary -->
                        <div v-if="displayReport.contactNotes"
                            class="text-xs text-gray-500 italic bg-blue-50 p-2 rounded border border-blue-100">
                            <span class="font-bold text-blue-700 not-italic">{{ $t('report.contact_notes') ||
                                $t('report.contact_book') || 'Contact' }}:</span> {{
                                    displayReport.contactNotes }}
                        </div>
                    </div>

                    <!-- Right: Ratings -->
                    <div class="w-48 shrink-0 border-l pl-6 space-y-4 flex flex-col justify-center">
                        <div v-if="displayReport.classParticipation">
                            <div class="text-xs text-gray-500 mb-1 flex justify-between">
                                <span>{{ $t('report.participation') }}</span>
                                <span class="font-bold text-gray-900">{{ displayReport.classParticipation }}</span>
                            </div>
                            <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div class="h-full bg-emerald-500"
                                    :style="{ width: (displayReport.classParticipation * 20) + '%' }"></div>
                            </div>
                        </div>
                        <div v-if="displayReport.classroomBehavior">
                            <div class="text-xs text-gray-500 mb-1 flex justify-between">
                                <span>{{ $t('report.behavior') }}</span>
                                <span class="font-bold text-gray-900">{{ displayReport.classroomBehavior }}</span>
                            </div>
                            <div class="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div class="h-full bg-indigo-500"
                                    :style="{ width: (displayReport.classroomBehavior * 20) + '%' }"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div v-else-if="viewMode === 'calendar'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Calendar Section -->
            <div class="lg:col-span-1">
                <OccurrenceCalendar :occurrences="occurrences" :existing-report-ids="existingReportIds"
                    :occurrence-statuses="occurrenceStatuses" @select-occurrence="selectOccurrence" />

                <!-- Class Context Info (Bottom Left) -->
                <div v-if="enrollmentInfo" class="mt-6 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
                    <h3 class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{{
                        $t('classroom.class_info', 'CLASS INFO') }}</h3>
                    <div class="space-y-3">
                        <div class="flex items-center gap-3">
                            <div
                                class="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">{{ $t('classroom.room_name') }}</p>
                                <p class="text-sm font-bold text-gray-800">{{ enrollmentInfo.classroomName || '-' }}</p>
                            </div>
                        </div>
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <p class="text-xs text-gray-500">{{ $t('classroom.session') }}</p>
                                <p class="text-sm font-bold text-gray-800">{{ enrollmentInfo.sessionName || '-' }}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div v-if="occurrences.length === 0"
                    class="mt-4 p-4 bg-amber-50 rounded-xl text-amber-700 text-xs border border-amber-200 shadow-sm">
                    {{ $t('report.no_occurrences') }}
                </div>
            </div>

            <!-- Editor Section -->
            <div class="lg:col-span-1">
                <div v-if="selectedOccurrence && selectedReport">
                    <!-- Occurrence Info Card -->
                    <div
                        class="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-2xl p-5 mb-6 border border-emerald-100 shadow-sm">
                        <h2 class="font-bold text-gray-900 text-lg mb-3 flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-emerald-600" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            {{ formatOccurrenceDateTime(selectedOccurrence) }}
                        </h2>
                        <div class="text-sm text-gray-600 grid grid-cols-2 gap-4">
                            <div v-if="selectedOccurrence.classroomName" class="bg-white/50 p-2 rounded-lg">
                                <span class="font-semibold block text-gray-400 text-[10px] uppercase tracking-wider">{{
                                    $t('classroom.title') }}</span>
                                <span class="text-gray-800 font-medium">{{ selectedOccurrence.classroomName }}</span>
                            </div>
                            <div v-if="selectedOccurrence.sessionName" class="bg-white/50 p-2 rounded-lg">
                                <span class="font-semibold block text-gray-400 text-[10px] uppercase tracking-wider">{{
                                    $t('classroom.session') }}</span>
                                <span class="text-gray-800 font-medium truncate"
                                    :title="selectedOccurrence.sessionName">{{
                                        selectedOccurrence.sessionName }}</span>
                            </div>
                            <div class="bg-white/50 p-2 rounded-lg">
                                <span class="font-semibold block text-gray-400 text-[10px] uppercase tracking-wider">{{
                                    $t('report.status') }}</span>
                                <span class="text-gray-800 font-medium">{{ $t('student.attendance.' +
                                    selectedOccurrence.status) }}</span>
                            </div>
                            <div v-if="selectedOccurrence.effectiveStartTime" class="bg-white/50 p-2 rounded-lg">
                                <span class="font-semibold block text-gray-400 text-[10px] uppercase tracking-wider">{{
                                    $t('report.time') }}</span>
                                <span class="text-gray-800 font-medium">{{ selectedOccurrence.effectiveStartTime }} - {{
                                    selectedOccurrence.effectiveEndTime }}</span>
                            </div>
                            <div v-if="selectedReport.updatedAt || selectedReport.lastEditedAt"
                                class="col-span-2 bg-white/50 p-2 rounded-lg flex items-center justify-between">
                                <div>
                                    <span
                                        class="font-semibold block text-gray-400 text-[10px] uppercase tracking-wider">{{
                                            $t('report.last_updated') }}</span>
                                    <span class="text-gray-800 font-medium">{{ (selectedReport.updatedAt ||
                                        selectedReport.lastEditedAt)?.toLocaleString() }}</span>
                                </div>
                                <span v-if="selectedReport.lastEditedBy"
                                    class="text-[10px] text-gray-400 font-bold italic">By: {{
                                        selectedReport.lastEditedBy }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Report Editor -->
                    <ReportEditor :key="selectedReport.id" :report-id="selectedReport.id"
                        :initial-content="selectedReport.content" :initial-version="selectedReport.version"
                        :loading="reportLoading"
                        :title="$t('report.report_for_date', { date: formatOccurrenceDateTime(selectedOccurrence) })"
                        :show-manual-save="true" :available-lessons="courseLessons"
                        :course-name="enrollmentInfo?.courseDisplay" :initial-lesson-id="selectedReport.lessonId"
                        :initial-is-completed="selectedReport.isCompleted"
                        :initial-attendance-status="selectedReport.attendanceStatus"
                        :initial-absence-reason="selectedReport.absenceReason"
                        :initial-class-participation="selectedReport.classParticipation"
                        :initial-classroom-behavior="selectedReport.classroomBehavior"
                        :initial-contact-notes="selectedReport.contactNotes"
                        :initial-class-notes="selectedReport.classNotes"
                        :initial-report-external-link="selectedReport.externalLink"
                        :initial-enrollment-external-link="enrollmentInfo?.externalLink"
                        :initial-student-id="enrollmentInfo?.studentId" @save-success="handleSaveSuccess"
                        @save-error="handleSaveError" @conflict="handleConflict" @deleted="handleDeleted" />
                </div>

                <!-- Empty State -->
                <div v-else
                    class="bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 p-12 text-center h-full flex flex-col items-center justify-center min-h-[400px]">
                    <div
                        class="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm ring-1 ring-gray-100">
                        <svg class="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <h3 class="text-xl font-bold text-gray-800 mb-3">
                        {{ occurrences.length > 0 ? $t('report.no_occurrence_selected') :
                            $t('report.no_reports_available') }}
                    </h3>
                    <p class="text-gray-500 max-w-sm mx-auto leading-relaxed">
                        {{ occurrences.length > 0 ? $t('report.no_occurrence_selected_desc') :
                            $t('report.no_reports_available_desc') }}
                    </p>
                </div>
            </div>
        </div>

        <!-- Conflict Resolution Modal -->
        <ConflictModal :is-open="showConflictModal" :server-content="conflictServerContent"
            :local-content="conflictLocalContent" @close="closeConflictModal" @resolve="resolveConflict" />

        <!-- Update Available Toast -->
        <div v-if="showUpdateToast"
            class="fixed bottom-24 right-6 bg-blue-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-slide-up z-[100] border border-blue-500 cursor-pointer hover:bg-blue-700 transition"
            @click="refreshReport">
            <div class="bg-white/20 p-1 rounded-full animate-spin-slow">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
            </div>
            <div>
                <p class="font-bold tracking-wide">{{ $t('report.update_available') || 'Update Available' }}</p>
                <p class="text-xs text-blue-100">
                    {{ $t('report.update_available_desc') || 'Report updated by another user. Click to refresh.' }}
                </p>
            </div>
        </div>

        <!-- Success Toast -->
        <div v-if="showSuccessToast"
            class="fixed bottom-6 right-6 bg-emerald-600 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 animate-slide-up z-[100] border border-emerald-500">
            <div class="bg-white/20 p-1 rounded-full">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
            </div>
            <span class="font-bold tracking-wide">{{ successMessage || $t('report.save_success') }}</span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/useAuthStore'
import OccurrenceCalendar from '@/components/OccurrenceCalendar.vue'
import ReportEditor from '@/components/ReportEditor.vue'
import ConflictModal from '@/components/ConflictModal.vue'
import { OccurrenceService } from '@/services/OccurrenceService'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import { CourseService } from '@/services/CourseService'
import { ClassOccurrence } from '@/models/ClassOccurrence'
import { OccurrenceReport } from '@/models/OccurrenceReport'
import { SuspensionService } from '@/services/SuspensionService'
import { Suspension } from '@/models/Suspension'
import type { RealtimeChannel } from '@supabase/supabase-js'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const authStore = useAuthStore()

const loading = ref(true)
const occurrences = ref<ClassOccurrence[]>([])
const selectedOccurrence = ref<ClassOccurrence | null>(null)
const selectedReport = ref<OccurrenceReport | null>(null)
const reportLoading = ref(false)
const showConflictModal = ref(false)
const conflictServerContent = ref('')
const conflictLocalContent = ref('')
const showSuccessToast = ref(false)
const successMessage = ref('')
const showUpdateToast = ref(false) // New toast for updates
const enrollmentInfo = ref<{
    studentName: string,
    courseDisplay: string,
    classroomName?: string,
    sessionName?: string,
    externalLink?: string,
    studentId?: string
} | null>(null)
const courseLessons = ref<any[]>([])
let reportSubscription: RealtimeChannel | null = null

// List View State
import { computed } from 'vue'
const viewMode = ref<'calendar' | 'list'>('calendar')
const listLoading = ref(false)
const allReports = ref<any[]>([])
const suspensions = ref<Suspension[]>([])
const sortOrder = ref<'asc' | 'desc'>('asc')
const showIncompleteModule = ref(false)

const incompleteReports = computed(() => {
    const now = new Date()
    return allReports.value
        .filter(r => {
            // Must be 'present'
            if (r.attendance_status !== 'present') return false

            // Check content completeness
            const hasContent = r.content && r.content.trim().length > 0
            const hasLesson = !!r.lesson_id
            if (hasContent && hasLesson) return false

            // Date Check: Must be today or in the past
            // occurrence_date is typically YYYY-MM-DD string or Date object.
            // If string YYYY-MM-DD, new Date() treats it as UTC or Local midnight depending on browser parsing? 
            // Better to be safe: create date object.
            const occ = r.class_occurrence
            if (!occ || !occ.occurrence_date) return false

            const occDate = new Date(occ.occurrence_date)
            // Reset "now" to end of today to ensure we catch everything from today? 
            // Actually user wants "today included". 
            // If occDate is T00:00:00 today. Now is T13:00:00 today. occDate < Now. Correct.
            // If occDate is T00:00:00 tomorrow. Now is T13:00:00 today. occDate > Now. Correct.
            return occDate <= now
        })
        .map(r => {
            const occ = r.class_occurrence
            let startTime = ''
            if (occ) {
                startTime = occ.actual_start_time || occ.original_start_time || ''
            }
            return {
                id: r.id,
                occurrenceId: r.class_occurrence_id,
                date: occ?.occurrence_date,
                startTime: startTime,
                missingContent: !r.content || r.content.trim().length === 0,
                missingLesson: !r.lesson_id,
                version: r.version
            }
        })
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
})

function toggleSort() {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
}

const allReportDisplay = computed(() => {
    // Base list on ALL occurrences (Calendar/Schedule based) to ensure no gaps
    const mergedList = occurrences.value.map(occ => {
        // Find existing detailed report
        // Note: occurrences.value is populated via loadOccurrences (Historical + Future)
        // allReports.value is populated via switchToListView -> getReportsWithDetails (Historical with Lesson info)

        // We need lookup map for performance if list is long, but N=50 is fine.
        const r = allReports.value.find(rep => rep.class_occurrence_id === occ.id)

        if (r) {
            const lesson = r.lesson
            return {
                id: r.id,
                occurrenceId: r.class_occurrence_id,
                date: occ.occurrenceDate, // Use occurrence date as truth
                startTime: occ.effectiveStartTime || '',
                status: r.attendance_status || (occ.status === 'completed' ? 'present' : 'scheduled'),
                content: r.content,
                classNotes: r.class_notes,
                version: r.version,
                lessonTitle: lesson ? `${lesson.sequence ? `Lesson ${lesson.sequence}` : ''} ${lesson.title || ''}` : '',
                classParticipation: r.class_participation,
                classroomBehavior: r.classroom_behavior,
                isCompleted: r.is_completed,
                contactNotes: r.contact_notes,
                progressDisplay: r.progress_letter
                    ? `Progress: ${r.progress_letter}`
                    : (r.progress_start ? `Progress: ${r.progress_start}${r.progress_end ? `-${r.progress_end}` : ''}` : ''),
                absenceReason: r.absence_reason
            }
        } else {
            // Check suspension status
            // Use formatDate to ensure we use the local date string (YYYY-MM-DD) and avoid UTC shift issues
            const dateStr = occ.formatDate(occ.occurrenceDate)
            const isSuspended = suspensions.value.some(s => {
                const start = s.startDate
                const end = s.endDate
                if (end) {
                    return dateStr >= start && dateStr <= end
                }
                return dateStr >= start
            })

            // Placeholder for missing report
            return {
                id: null,
                occurrenceId: occ.id,
                date: occ.occurrenceDate,
                startTime: occ.effectiveStartTime || '',
                status: isSuspended ? 'cancelled' : (occ.status === 'completed' ? 'present' : (occ.status === 'cancelled' ? 'absent' : 'bookable')),
                content: '',
                classNotes: '',
                version: 0,
                lessonTitle: '-',
                classParticipation: 0,
                classroomBehavior: 0,
                isCompleted: false,
                contactNotes: '',
                progressDisplay: '',
                absenceReason: null
            }
        }
    })

    // Sort based on sortOrder
    return mergedList
        .filter(r => r.status !== 'rescheduled' && r.absenceReason !== 'rescheduled') // Shield against rescheduled stubs
        .sort((a, b) => {
            const timeA = new Date(a.date).getTime()
            const timeB = new Date(b.date).getTime()
            if (timeA !== timeB) {
                return sortOrder.value === 'asc' ? timeA - timeB : timeB - timeA
            }
            // Same date, sort by startTime
            return sortOrder.value === 'asc'
                ? a.startTime.localeCompare(b.startTime)
                : b.startTime.localeCompare(a.startTime)
        })
})

const existingReportIds = computed(() => {
    return new Set(allReports.value.map(r => r.class_occurrence_id))
})

const occurrenceStatuses = computed(() => {
    const statusMap: Record<string, string> = {}

    // 1. Initial base statuses from occurrences
    occurrences.value.forEach(occ => {
        statusMap[occ.id!] = occ.status
    })

    // 2. Overwrite with granular report-level status
    allReports.value.forEach(r => {
        if (r.attendance_status) {
            statusMap[r.class_occurrence_id] = r.attendance_status
        } else if (r.is_completed) {
            statusMap[r.class_occurrence_id] = 'present'
        } else {
            // Report exists but no specific attendance set yet
            statusMap[r.class_occurrence_id] = 'scheduled'
        }
    })

    // 3. Mark as bookable if no report AND it's scheduled
    occurrences.value.forEach(occ => {
        if (!statusMap[occ.id!] || statusMap[occ.id!] === 'scheduled') {
            const hasReport = allReports.value.some(r => r.class_occurrence_id === occ.id)
            if (!hasReport && occ.status === 'scheduled') {
                statusMap[occ.id!] = 'bookable'
            }
        }
    })

    return statusMap
})

function formatWeekday(dateVal: string | Date) {
    return new Date(dateVal).toLocaleDateString(locale.value, { weekday: 'short' })
}

function formatDate(dateVal: string | Date) {
    return new Date(dateVal).toLocaleDateString(locale.value, { month: 'short', day: 'numeric' })
}

function formatOccurrenceDateTime(occ: ClassOccurrence) {
    // We construct a date object for the occurrence
    // Note: d() usage depends on i18n setup, but toLocaleDateString is safer if d() isn't configured with 'short'
    const date = new Date(occ.occurrenceDate).toLocaleDateString(locale.value)
    const time = occ.effectiveStartTime ? occ.effectiveStartTime.slice(0, 5) : ''
    return `${date} ${time}`.trim()
}

function getStatusColor(status: string) {
    switch (status) {
        case 'present': return 'bg-emerald-100 text-emerald-700'
        case 'absent': return 'bg-rose-100 text-rose-700'
        case 'late': return 'bg-amber-100 text-amber-700'
        case 'excused': return 'bg-blue-100 text-blue-700'
        case 'cancelled': return 'bg-gray-100 text-gray-500 line-through'
        case 'scheduled': return 'bg-blue-50 text-blue-600'
        case 'bookable': return 'bg-gray-50 text-gray-400 border border-gray-100'
        default: return 'bg-gray-100 text-gray-700'
    }
}

async function switchToListView() {
    viewMode.value = 'list'
    const enrollmentId = route.params.enrollmentId as string
    if (!enrollmentId) return

    listLoading.value = true
    try {
        // We still fetch details to enrich the rows
        allReports.value = await OccurrenceReportService.getReportsWithDetails(enrollmentId)
        // ensure occurrences are loaded too (just in case they switch view before mounting finished?)
        if (occurrences.value.length === 0) {
            await loadOccurrences()
        }
    } catch (e) {
        console.error('Failed to reload reports list', e)
    } finally {
        listLoading.value = false
    }
}

async function handleIncompleteClick(item: any) {
    viewMode.value = 'calendar'
    const targetOcc = occurrences.value.find(o => o.id === item.occurrenceId)
    if (targetOcc) {
        selectOccurrence(targetOcc)
    }
}

function handleListRowClick(displayReport: any) {
    viewMode.value = 'calendar'
    const targetOcc = occurrences.value.find(o => o.id === displayReport.occurrenceId)
    if (targetOcc) {
        selectOccurrence(targetOcc)
    }
}

// Lifecycle
onMounted(async () => {
    await loadOccurrences()
})

onBeforeUnmount(() => {
    if (reportSubscription) {
        supabase.removeChannel(reportSubscription)
    }
})

// Methods
async function loadOccurrences() {
    try {
        loading.value = true
        const enrollmentId = route.params.enrollmentId as string
        if (!enrollmentId) return

        // 1. Fetch enrollment to get CURRENT session ID (for future)
        const enrollment = await CourseService.getEnrollmentById(enrollmentId)
        if (!enrollment) {
            console.warn('Enrollment not found')
            loading.value = false
            return
        }

        // Store enrollment info for display
        enrollmentInfo.value = {
            studentName: enrollment.studentName || 'Student',
            courseDisplay: `${enrollment.courseSubject}_${enrollment.courseStage}`,
            classroomName: enrollment.classroomName,
            sessionName: enrollment.classSessionName,
            externalLink: enrollment.externalLink,
            studentId: enrollment.studentId
        }

        // 2. Load lessons for this course (needed for editor)
        if (enrollment.courseId) {
            const lessons = await CourseService.getLessonsByCourse(enrollment.courseId)
            courseLessons.value = lessons
        }

        // 3. Load HISTORICAL occurrences from existing reports
        // This ensures we see past classes even if the student transferred sessions
        const reportsWithDetails = await OccurrenceReportService.getReportsWithDetails(enrollmentId)
        allReports.value = reportsWithDetails

        // Map reports to ClassOccurrence objects
        const historicalOccurrences: ClassOccurrence[] = reportsWithDetails.map((r: any) => {
            const occData = r.class_occurrence
            const occ = new ClassOccurrence({
                id: r.class_occurrence_id,
                class_session_id: occData.class_session.id,
                occurrence_date: occData.occurrence_date,
                status: occData.status,
                original_start_time: occData.original_start_time,
                original_end_time: occData.original_end_time,
                actual_start_time: occData.actual_start_time,
                actual_end_time: occData.actual_end_time,
                notes: occData.notes,
                created_at: occData.created_at,
                updated_at: occData.updated_at
            })

            if (occData.class_session) {
                occ.sessionName = occData.class_session.name
                if (occData.class_session.classroom) {
                    occ.classroomName = occData.class_session.classroom.name
                }
            }
            return occ
        })

        // 4. Load FUTURE/CURRENT occurrences for the active session
        // This shows the schedule going forward
        let futureOccurrences: ClassOccurrence[] = []

        if (enrollment.classSessionId) {
            const today = new Date()
            const startDate = new Date(today)
            // Fix: Look back 6 months to cover recent history that might not have reports yet
            startDate.setDate(startDate.getDate() - 180)

            const endDate = new Date(today)
            endDate.setDate(endDate.getDate() + 180) // 6 months forward

            // Collect all session IDs: Current + Historical
            // This ensures we see schedule gaps for previous classes too (if reports exist)
            const relevantSessionIds = new Set<string>([enrollment.classSessionId])
            historicalOccurrences.forEach(occ => {
                if (occ.classSessionId) relevantSessionIds.add(occ.classSessionId)
            })

            futureOccurrences = await OccurrenceService.getOccurrencesByDateRange(
                startDate,
                endDate,
                Array.from(relevantSessionIds)
            )

            // 4a. Auto-Repair Schedule (Gap Filling)
            // If enrollment is active but schedule ran out (e.g. paused for months), generate it now.
            if (enrollment.status === 'active' && enrollment.classSessionId) {
                const currentSessionOccs = futureOccurrences.filter(o => o.classSessionId === enrollment.classSessionId)

                // Find latest date in the window
                let lastDate = startDate // Default to start of window
                if (currentSessionOccs.length > 0) {
                    const sorted = [...currentSessionOccs].sort((a, b) => b.occurrenceDate.getTime() - a.occurrenceDate.getTime())
                    if (sorted[0]) {
                        lastDate = sorted[0].occurrenceDate
                    }
                }

                // If last scheduled date is "too soon" OR if we have very active occurrences (gap detection)
                // We check if "Last Date" is less than "Today + 30 Days"
                const today = new Date()
                const thresholdDate = new Date(today)
                thresholdDate.setDate(thresholdDate.getDate() + 30)

                // Robustness: If we have very few occurrences in this huge window, strictly backfill.
                // Or if the schedule cuts off early.
                if (lastDate < thresholdDate || currentSessionOccs.length < 12) {
                    console.log('⚡ Schedule sparse, exhausted, or gaps detected. Auto-generating occurrences...')

                    // Generate from the VIEW window start to ensure backfilling gaps
                    // upsert ensures we don't duplicate existing ones
                    const genStart = new Date(startDate)

                    await OccurrenceService.generateOccurrences(
                        enrollment.classSessionId,
                        genStart,
                        thresholdDate
                    )

                    // Re-fetch to populate the view
                    futureOccurrences = await OccurrenceService.getOccurrencesByDateRange(
                        startDate,
                        endDate,
                        Array.from(relevantSessionIds)
                    )
                }
            }

            // Filter by Enrollment Start Date (if exists)
            // But be careful: if the student transferred, startDate might be the transfer date.
            // We should not hide legitimate history (existing reports) that occurred before this date.
            let effectiveStartDate = enrollment.startDate as string

            if (historicalOccurrences.length > 0) {
                // Find the earliest report date
                const sortedHistory = [...historicalOccurrences].sort((a, b) =>
                    new Date(a.occurrenceDate).getTime() - new Date(b.occurrenceDate).getTime()
                )
                if (sortedHistory[0]) {
                    const firstReportDate = sortedHistory[0].formatDate(sortedHistory[0].occurrenceDate)

                    // If we have a report BEFORE the official start date, expand the window
                    if (!effectiveStartDate || firstReportDate < effectiveStartDate) {
                        effectiveStartDate = firstReportDate
                    }
                }
            }

            if (effectiveStartDate) {
                futureOccurrences = futureOccurrences.filter(o => o.formatDate(o.occurrenceDate) >= effectiveStartDate)
            }
        }

        // Load Suspensions
        if (enrollment.id) {
            suspensions.value = await SuspensionService.getSuspensions(enrollment.id)
        }

        // 5. Merge and Sort
        // We prioritize historical (report-based) occurrences because they represent confirmed attendance
        const occurrenceMap = new Map<string, ClassOccurrence>()

        // Add future ones first
        futureOccurrences.forEach(o => {
            if (o.id) occurrenceMap.set(o.id, o)
        })

        // Overwrite/Add historical ones (they are the source of truth for the past)
        historicalOccurrences.forEach(o => {
            if (o.id) occurrenceMap.set(o.id, o)
        })

        // 5a. Filter out "Rescheduled" stubs
        // We look at allReports (the source data for reportsWithDetails)
        // 5a. Filter out "Rescheduled" stubs
        // We look at allReports (the source data for reportsWithDetails)
        const rescheduledOccIds = new Set(
            allReports.value
                .filter(r => r.absence_reason === 'rescheduled' || (r.attendance_status === 'absent' && r.absence_reason === 'rescheduled'))
                .map(r => r.class_occurrence_id)
        )

        // Convert back to array, filter, and sort
        const merged = Array.from(occurrenceMap.values()).filter(occ => {
            // Filter by ID
            if (rescheduledOccIds.has(occ.id)) return false
            // Check if occ itself has a rescheduled status (though usually it's in the report)
            if (occ.status === 'rescheduled') return false
            return true
        })
        merged.sort((a, b) => {
            const dateA = new Date(a.occurrenceDate).getTime()
            const dateB = new Date(b.occurrenceDate).getTime()
            if (dateA !== dateB) return dateA - dateB

            const timeA = a.effectiveStartTime || ''
            const timeB = b.effectiveStartTime || ''
            return timeA.localeCompare(timeB)
        })

        occurrences.value = merged

        // 6. Auto-select nearest occurrence (User Request)
        if (merged.length > 0) {
            const today = new Date().getTime()

            // Find the occurrence with the smallest absolute difference from today (Date + Time)
            const closest = merged.reduce((prev, curr) => {
                const getFullTime = (occ: ClassOccurrence) => {
                    const d = new Date(occ.occurrenceDate)
                    if (occ.effectiveStartTime) {
                        const [h, m] = occ.effectiveStartTime.split(':').map(Number)
                        if (h !== undefined) d.setHours(h, m || 0, 0, 0)
                    }
                    return d.getTime()
                }
                const prevDiff = Math.abs(getFullTime(prev) - today)
                const currDiff = Math.abs(getFullTime(curr) - today)
                return currDiff < prevDiff ? curr : prev
            })

            await selectOccurrence(closest)
        }

    } catch (error) {
        console.error('Failed to load occurrences:', error)
    } finally {
        loading.value = false
    }
}

async function selectOccurrence(occurrence: ClassOccurrence) {
    // Cleanup previous subscription
    if (reportSubscription) {
        supabase.removeChannel(reportSubscription)
        reportSubscription = null
    }

    selectedOccurrence.value = occurrence
    try {
        reportLoading.value = true
        // Get or create report for this occurrence
        const enrollmentId = route.params.enrollmentId as string
        if (!enrollmentId || !occurrence.id) return

        const report = await OccurrenceReportService.getOrCreateReport(
            enrollmentId,
            occurrence.id
        )

        // Check if report was already there or if it's new (via presence in allReports)
        const hasExistingReport = allReports.value.some(r => r.class_occurrence_id === occurrence.id)
        if (!hasExistingReport) {
            if (!confirm(t('report.editor.confirm_create_report', 'This class has no report yet. A new one will be created. Continue?'))) {
                reportLoading.value = false
                selectedOccurrence.value = null
                return
            }
        }

        selectedReport.value = report

        // If it was newly created, we might want to refresh allReports to update markers
        if (!hasExistingReport) {
            await switchToListView() // This refreshes allReports
            viewMode.value = 'calendar' // Keep in calendar view
        }

        // Subscribe to Realtime changes for this report
        if (report.id) {
            reportSubscription = supabase
                .channel(`report-${report.id}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'occurrence_reports',
                        filter: `id=eq.${report.id}`
                    },
                    (payload) => {
                        handleRealtimeUpdate(payload)
                    }
                )
                .subscribe()
        }

    } catch (error) {
        console.error('Failed to load report:', error)
    } finally {
        reportLoading.value = false
    }
}

function handleRealtimeUpdate(payload: any) {
    const newRecord = payload.new
    // Ignore our own updates
    if (newRecord.last_edited_by === authStore.user?.id) return

    // If version is newer, prompt user
    if (selectedReport.value && newRecord.version > selectedReport.value.version) {
        showUpdateToast.value = true
    }
}

async function refreshReport() {
    if (!selectedOccurrence.value) return
    showUpdateToast.value = false
    await selectOccurrence(selectedOccurrence.value)
}

function handleSaveSuccess(newVersion: number) {
    if (selectedReport.value) {
        selectedReport.value.version = newVersion
    }

    successMessage.value = t('report.save_success')
    showSuccessToast.value = true
    setTimeout(() => { showSuccessToast.value = false }, 3000)
    switchToListView() // Refresh list view data
    viewMode.value = 'calendar' // But keep calendar active
}

function handleSaveError(error: string) {
    alert(`Failed to save report: ${error}`)
}

function handleDeleted() {
    successMessage.value = t('report.editor.delete_success')
    showSuccessToast.value = true
    setTimeout(() => { showSuccessToast.value = false }, 3000)
    selectedReport.value = null
    selectedOccurrence.value = null
    loadOccurrences() // Full reload to catch progress changes and remove report
}

function handleConflict(serverContent: string) {
    conflictServerContent.value = serverContent
    conflictLocalContent.value = selectedReport.value?.content || ''
    showConflictModal.value = true
}

function closeConflictModal() {
    showConflictModal.value = false
}

async function resolveConflict(resolvedContent: string) {
    if (!selectedReport.value) return

    try {
        const report = await OccurrenceReportService.resolveConflict(
            selectedReport.value.id!,
            resolvedContent,
            authStore.user?.id // Pass user ID
        )

        selectedReport.value = report
        showConflictModal.value = false

        // Show success toast
        showSuccessToast.value = true
        setTimeout(() => {
            showSuccessToast.value = false
        }, 3000)
    } catch (error) {
        console.error('Failed to resolve conflict:', error)
        alert('Failed to resolve conflict')
    }
}
</script>

<style scoped>
@keyframes slide-up {
    from {
        transform: translateY(100%);
        opacity: 0;
    }

    to {
        transform: translateY(0);
        opacity: 1;
    }
}

.animate-slide-up {
    animation: slide-up 0.3s ease-out;
}
</style>
