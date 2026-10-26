<template>
    <div
        class="flex flex-col bg-gray-50 overflow-hidden h-[calc(100dvh-4rem)] lg:h-[calc(100vh-5rem)] -mx-3 -mb-2 lg:-mx-6 lg:-mb-2 relative">
        <BasePageHeader :overline="t('nav.incomplete_reports')" :title="t('report.incomplete_reports_title')"
            :subtitle="scope === 'all' ? t('report.incomplete_reports_subtitle_all') : t('report.incomplete_reports_subtitle')" :hide-background="true" :compact="true"
            :inline-actions-mobile="true"
            class="z-20 bg-white/80 backdrop-blur-md border-b border-gray-100 shadow-sm px-4 sm:px-6 lg:px-8">
            <template #icon>
                <div
                    class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600 shadow-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 sm:h-6 sm:w-6" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
            </template>
            <template #actions>
                <div class="flex items-center gap-2 sm:gap-4">

                    <!-- Stats Badge -->
                    <div
                        class="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-xl border border-gray-100 shadow-inner">
                        <div class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></div>
                        <span class="text-xs font-black text-gray-500 uppercase tracking-widest">
                            {{ totalReports }} {{ t('common.items') }}</span>
                    </div>

                    <div class="h-8 w-px bg-gray-100 mx-2 hidden sm:block"></div>

                    <!-- Sidebar Toggle (Desktop) -->
                    <button @click="isSidebarCollapsed = !isSidebarCollapsed"
                        class="hidden xl:flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white border border-gray-100 shadow-sm text-gray-400 hover:text-emerald-600 hover:border-emerald-100 transition-all active:scale-95"
                        :title="isSidebarCollapsed ? t('nav.expand') : t('nav.collapse')">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 transition-transform duration-500"
                            :class="{ 'rotate-180': isSidebarCollapsed }" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                    </button>

                    <!-- Refresh Buttons -->
                    <div class="flex items-center bg-gray-50 p-1 rounded-xl border border-gray-100 shrink-0 shadow-sm">
                        <button @click="requestRefresh"
                            class="p-1.5 sm:p-2 rounded-lg hover:bg-white hover:text-amber-600 hover:shadow-sm transition-all text-gray-400 active:scale-95"
                            :class="{ 'animate-spin opacity-50 pointer-events-none': isRefreshing }"
                            :disabled="isRefreshing" :title="t('report.refresh_all')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    </div>
                </div>
            </template>
        </BasePageHeader>

        <!-- Confirm Modal for Full Refresh -->
        <ConfirmModal :is-open="showRefreshConfirm" :title="$t('report.refresh_all')"
            :message="$t('report.refresh_all_confirm')" :confirm-text="$t('common.refresh')"
            @confirm="handleRefreshConfirm" @close="showRefreshConfirm = false" />

        <div class="flex-1 min-h-0 flex relative overflow-hidden">
            <!-- Left Pane: Report List -->
            <div class="w-full xl:w-1/3 xl:min-w-[400px] xl:max-w-md bg-white flex flex-col h-full z-10 transition-all duration-500 border-r border-gray-100 min-h-0"
                :class="{
                    'hidden xl:flex': selectedReport,
                    'xl:!w-0 xl:!min-w-0 xl:!max-w-0 xl:opacity-0 xl:pointer-events-none xl:-translate-x-full': isSidebarCollapsed
                }">

                <!-- Scope Switch -->
                <div v-if="canListAllReports"
                    class="px-4 pt-4 bg-gray-50/30 flex items-center gap-2" data-testid="incomplete-scope-switch">
                    <span class="text-xs font-black text-gray-500 uppercase tracking-widest">{{ t('report.incomplete_scope') }}</span>
                    <div class="flex bg-gray-100 p-1 rounded-xl border border-gray-100">
                        <button type="button" @click="setScope('my_notifications')" data-scope="my_notifications"
                            class="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all"
                            :class="scope === 'my_notifications' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                            {{ t('report.incomplete_scope_my_notifications') }}
                        </button>
                        <button type="button" @click="setScope('all')" data-scope="all"
                            class="px-3 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all"
                            :class="scope === 'all' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                            {{ t('report.incomplete_scope_all') }}
                        </button>
                    </div>
                </div>

                <!-- Search/Filter Bar for List -->
                <div class="p-4 border-b border-gray-50 bg-gray-50/30 flex items-center gap-2">
                    <div class="relative group flex-1">
                        <div
                            class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-300 group-focus-within:text-emerald-500 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input type="text" v-model="searchQuery"
                            class="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-100 rounded-xl text-sm font-bold text-gray-700 placeholder:text-gray-300 outline-none focus:ring-4 focus:ring-emerald-500/5 focus:border-emerald-200 transition-all shadow-sm"
                            :placeholder="t('report.search_placeholder')"  :aria-label="t('report.search_placeholder')"/>
                    </div>

                    <!-- Refresh Button -->
                    <button @click="loadReports(false)"
                        class="shrink-0 p-2.5 rounded-xl bg-white border border-gray-100 shadow-sm text-gray-400 hover:text-emerald-600 hover:border-emerald-100 transition-all active:scale-95"
                        :class="{ 'animate-spin opacity-50 pointer-events-none': loading }" :disabled="loading"
                        :title="t('common.refresh')">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                    </button>
                </div>

                <div v-if="loading" class="flex-1 flex flex-col items-center justify-center p-8 text-gray-500">
                    <div class="relative w-12 h-12 mb-2">
                        <div class="absolute inset-0 rounded-2xl bg-emerald-100 animate-ping opacity-25"></div>
                        <div
                            class="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-white border border-emerald-50 shadow-sm">
                            <svg class="animate-spin h-6 w-6 text-emerald-500" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                    stroke-width="4" />
                                <path class="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                        </div>
                    </div>
                    <p class="text-sm font-black text-gray-400 uppercase tracking-widest">{{ $t('common.loading') }}</p>
                </div>

                <div v-else-if="filteredReports.length === 0"
                    class="flex-1 flex flex-col items-center justify-center p-8 text-gray-400 text-center bg-gradient-to-b from-white to-gray-50">
                    <div
                        class="w-20 h-20 bg-emerald-50 rounded-[2.5rem] flex items-center justify-center mb-6 shadow-inner">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-emerald-200" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </div>
                    <p class="font-black text-gray-900 text-lg uppercase tracking-tight mb-2">{{
                        $t('report.all_caught_up') }}
                    </p>
                    <p class="text-sm font-medium text-gray-400 max-w-[200px] mx-auto leading-relaxed">{{
                        $t('report.no_incomplete_reports') }}</p>
                </div>

                <div v-else class="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50/30 custom-scrollbar">
                    <div v-for="report in filteredReports" :key="report.id" @click="selectReport(report)"
                        @keydown.enter="selectReport(report)" @keydown.space="selectReport(report)" role="button"
                        :tabindex="0"
                        class="group p-4 rounded-2xl border bg-white cursor-pointer transition-all duration-300 shadow-sm flex flex-col active:scale-[0.98] hover:shadow-xl hover:shadow-emerald-500/5 hover:-translate-y-0.5"
                        :class="selectedReport?.id === report.id
                            ? 'border-emerald-500 ring-4 ring-emerald-500/5 shadow-lg shadow-emerald-500/10 relative z-10 translate-x-1'
                            : 'border-gray-100 hover:border-emerald-200'">

                        <div class="flex items-start justify-between gap-4 mb-3">
                            <div class="flex-1 min-w-0">
                                <div
                                    class="font-black text-gray-900 text-lg leading-tight truncate group-hover:text-emerald-600 transition-colors">
                                    {{ report.studentName }}</div>
                                <div class="flex items-center gap-2 mt-1.5">
                                    <div
                                        class="px-2 py-0.5 rounded-lg bg-gray-50 border border-gray-100 text-[12px] font-black text-gray-500 uppercase tracking-tighter shadow-inner">
                                        {{ formatDate(report.date) }}
                                    </div>
                                    <div class="text-[12px] font-bold text-emerald-600/70">
                                        {{ formatTimeRange(report.startTime, report.endTime) }}
                                    </div>
                                </div>
                            </div>
                            <div
                                class="shrink-0 w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-300 group-hover:bg-emerald-50 group-hover:text-emerald-500 transition-all shadow-inner">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M9 5l7 7-7 7" />
                                </svg>
                            </div>
                        </div>

                        <div
                            class="flex items-center gap-2 text-xs text-gray-500 font-bold bg-gray-50/50 p-2 rounded-xl border border-gray-100/50 mb-3">
                            <span class="truncate">{{ report.className }}</span>
                            <span v-if="report.classroomName" class="shrink-0 text-gray-300 text-[8px]">•</span>
                            <span v-if="report.classroomName" class="truncate text-gray-400">{{ report.classroomName
                                }}</span>
                        </div>

                        <div class="flex gap-1.5 flex-wrap">
                            <div v-for="tag in [
                                { show: report.missingContent, label: $t('report.missing_content'), color: 'rose' },
                                { show: report.missingLesson, label: $t('report.missing_unit'), color: 'indigo' },
                                { show: report.missingProgress, label: $t('report.missing_progress'), color: 'amber' },
                                { show: report.missingParticipation, label: $t('report.missing_participation'), color: 'blue' },
                                { show: report.missingBehavior, label: $t('report.missing_behavior'), color: 'purple' }
                            ].filter(t => t.show)" :key="tag.label"
                                :class="`px-2 py-1 rounded-lg text-[11px] font-black uppercase tracking-widest bg-${tag.color}-50 text-${tag.color}-600 border border-${tag.color}-100 shadow-sm shadow-${tag.color}-500/5`">
                                {{ tag.label }}
                            </div>
                        </div>

                        <div v-if="report.updatedAt"
                            class="mt-4 pt-3 border-t border-gray-50 flex items-center justify-between">
                            <div class="flex items-center gap-1.5 text-[11px] font-bold text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {{ new Date(report.updatedAt || report.lastEditedAt).toLocaleDateString(preferences.locale, {
                                    month:
                                        'short', day: 'numeric'
                                }) }}
                            </div>
                            <div class="text-[11px] font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded-md">
                                {{ new Date(report.updatedAt || report.lastEditedAt).toLocaleTimeString(preferences.locale, {
                                    hour:
                                        '2-digit',
                                    minute: '2-digit'
                                }) }}
                            </div>
                        </div>
                    </div>

                    <div v-if="totalReports > pageSize"
                        class="sticky bottom-0 flex items-center justify-between gap-3 px-2 py-3 bg-white/95 backdrop-blur border-t border-gray-100">
                        <button type="button" :disabled="pageOffset === 0 || loading" @click="goToPage(-1)"
                            class="px-3 py-2 rounded-xl border border-gray-100 text-xs font-black text-gray-500 disabled:opacity-40">
                            {{ t('common.previous') }}
                        </button>
                        <span class="text-xs font-bold text-gray-400">{{ pageNumber }} / {{ totalPages }}</span>
                        <button type="button" :disabled="pageOffset + pageSize >= totalReports || loading" @click="goToPage(1)"
                            class="px-3 py-2 rounded-xl border border-gray-100 text-xs font-black text-gray-500 disabled:opacity-40">
                            {{ t('common.next') }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Right Pane: Editor -->
            <div class="min-w-0 flex-1 bg-gray-50 p-3 sm:p-3 flex flex-col relative w-full xl:w-auto h-full min-h-0 overflow-hidden"
                :class="{ 'hidden xl:flex': !selectedReport }">

                <div v-if="selectedReport" class="flex-1 flex flex-col max-w-7xl mx-auto w-full h-full min-h-0">
                    <!-- Context Banner -->
                    <div
                        class="bg-white p-3 sm:p-3 lg:p-3 rounded-[2.5rem] shadow-xl shadow-gray-200/40 border border-gray-100/50 mb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 animate-in fade-in slide-in-from-bottom-4 shrink-0 overflow-hidden relative group">

                        <!-- Background Decoration -->
                        <div
                            class="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-700 opacity-50 pointer-events-none">
                        </div>

                        <div class="flex items-center gap-4 sm:gap-4 relative z-10">
                            <div class="flex items-center gap-3">
                                <!-- Back Button (Mobile) -->
                                <button @click="selectedReport = null"
                                    class="xl:hidden p-3 -ml-2 text-gray-400 hover:text-emerald-600 bg-gray-50 hover:bg-white rounded-2xl active:scale-95 transition-all shadow-sm"
                                    :aria-label="t('common.back') || 'Back to list'"
                                    :title="t('common.back') || 'Back to list'">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M15 19l-7-7 7-7" />
                                    </svg>
                                </button>

                                <!-- Date Card -->
                                <div
                                    class="text-center bg-white p-3 rounded-[1.5rem] border border-gray-100 min-w-[80px] sm:min-w-[100px] shadow-xl shadow-emerald-500/5">
                                    <div
                                        class="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none mb-1">
                                        {{ formatWeekday(selectedReport.date) }}
                                    </div>
                                    <div class="text-2xl sm:text-4xl font-black text-gray-900 leading-none my-1">
                                        {{ new Date(selectedReport.date).getDate() }}
                                    </div>
                                    <div v-if="selectedReport.startTime"
                                        class="text-[11px] font-black text-emerald-600/70 whitespace-nowrap uppercase tracking-tighter">
                                        {{ formatTimeRange(selectedReport.startTime, selectedReport.endTime) }}
                                    </div>
                                </div>
                            </div>

                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-3 mb-1.5">
                                    <h3 class="font-black text-xl sm:text-2xl text-gray-900 tracking-tight truncate">
                                        {{ selectedReport.studentName }}
                                    </h3>
                                    <router-link v-if="selectedReport.fullStudent?.id"
                                        :to="`/dashboard/student/${selectedReport.fullStudent.id}`"
                                        class="relative w-10 h-10 flex items-center justify-center text-emerald-600 bg-emerald-50 hover:bg-emerald-600 hover:text-white rounded-xl transition-all shrink-0 shadow-sm border border-emerald-100/50 group/link"
                                        :aria-label="t('report.view_student_profile')">
                                        <svg xmlns="http://www.w3.org/2000/svg"
                                            class="h-4 w-4 group-hover/link:scale-110 transition-transform" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                                        </svg>
                                    </router-link>
                                </div>
                                <div class="flex items-center gap-3 flex-wrap">
                                    <div
                                        class="px-2.5 py-1 rounded-xl bg-gray-50 border border-gray-100 text-xs font-bold text-gray-500 shadow-inner">
                                        {{ selectedReport.className }}
                                    </div>
                                    <div v-if="selectedReport.classroomName"
                                        class="flex items-center gap-2 text-xs font-bold text-gray-300">
                                        <div class="w-1.5 h-1.5 rounded-full bg-gray-200"></div>
                                        <span>{{ selectedReport.classroomName }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Right Stats (Desktop) -->
                        <div class="hidden sm:flex flex-col items-end shrink-0 relative z-10">
                            <div class="text-[10px] font-black text-gray-300 uppercase tracking-[0.2em] mb-2 px-1">{{
                                $t('report.report_id') }}</div>
                            <div
                                class="bg-gray-50/80 px-4 py-2 rounded-xl border border-gray-100/50 font-mono text-[10px] font-bold text-gray-400 shadow-inner">
                                #{{ selectedReport.id.split('-')[0].toUpperCase() }}
                            </div>
                        </div>
                    </div>

                    <!-- Scrollable Editor Area -->
                    <div
                        class="flex-1 overflow-y-auto rounded-[3rem] bg-white shadow-2xl shadow-gray-200/50 border border-gray-100/50 relative min-h-0 custom-scrollbar">
                        <ReportEditor :key="selectedReport.id + '-' + editorRefreshKey" :report-id="selectedReport.id"
                            :enrollment-id="selectedReport.enrollmentId" :class-occurrence-id="selectedReport.occurrenceId"
                            :initial-content="selectedReport.content"
                            :initial-content-document="selectedReport.contentDocument"
                            :initial-version="selectedReport.version"
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
                            :initial-contact-notes-document="selectedReport.contactNotesDocument"
                            :initial-class-notes="selectedReport.classNotes"
                            :initial-class-notes-document="selectedReport.classNotesDocument"
                            :initial-progress-start="selectedReport.progressStart"
                            :initial-progress-end="selectedReport.progressEnd"
                            :initial-report-external-link="selectedReport.externalLink"
                            :source-identity="selectedReport.sourceIdentity"
                            :initial-student-id="selectedReport.fullStudent?.id" @save-success="handleSaveSuccess"
                            @save-error="handleSaveError" @restored="handleReportRestored"
                            class="!rounded-none !shadow-none !border-none" />

                        <!-- Loading Overlay for Editor -->
                        <div v-if="editorLoading"
                            class="absolute inset-0 z-30 flex flex-col items-center justify-center bg-white/60 backdrop-blur-[2px] transition-all duration-300">
                            <div class="w-16 h-16 relative">
                                <div class="absolute inset-0 rounded-3xl bg-emerald-100 animate-ping opacity-20"></div>
                                <div
                                    class="relative w-16 h-16 rounded-3xl bg-white flex items-center justify-center shadow-lg border border-emerald-50">
                                    <svg class="animate-spin h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                            stroke-width="4" />
                                        <path class="opacity-75" fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                </div>
                            </div>
                            <p class="text-xs font-black text-gray-400 uppercase tracking-widest mt-6 animate-pulse">
                                {{ $t('common.loading') }}
                            </p>
                        </div>
                    </div>
                </div>

                <div v-else
                    class="flex-1 flex flex-col items-center justify-center text-gray-300 bg-gradient-to-b from-gray-50 to-white p-8">
                    <div
                        class="w-32 h-32 bg-white rounded-[3rem] shadow-2xl shadow-gray-200/50 flex items-center justify-center mb-8 border border-gray-50 relative group">
                        <div
                            class="absolute inset-0 bg-emerald-50 rounded-[3rem] scale-0 group-hover:scale-100 transition-transform duration-500">
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg"
                            class="h-16 w-16 text-gray-200 group-hover:text-emerald-300 transition-colors duration-500 relative z-10"
                            fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <p class="text-xl font-black text-gray-900 uppercase tracking-tight mb-2">
                        {{ $t('report.select_incomplete_to_edit') }}
                    </p>
                    <p class="text-sm font-medium text-gray-400 max-w-xs text-center leading-relaxed">
                        {{ $t('report.select_incomplete_hint') }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch, onBeforeUnmount } from 'vue'
import { ReportQueryService } from '@/services/report/ReportQueryService'
import { sourceIdentityFromRow } from '@/utils/sourceReportLink'
import ReportEditor from '@/components/ReportEditor.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import BasePageHeader from '@/components/common/BasePageHeader.vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import { apiResourceClient } from '@/services/api/ApiResourceClient'
import { DateUtils } from '@/utils/DateUtils'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { useRoute, useRouter } from 'vue-router'
import { PermissionPolicyService } from '@/services/rbac/PermissionPolicyService'

type IncompleteReportScope = 'my_notifications' | 'all'
const LIST_ALL_REPORTS_PERMISSION = 'teaching.reports.list'

const { locale, t } = useI18n()
const toast = useToast()
const { reportError } = useFeedback()
const preferences = usePreferencesStore()
const route = useRoute()
const router = useRouter()

const scope = ref<IncompleteReportScope>(route.query.scope === 'all' ? 'all' : 'my_notifications')
const canListAllReports = ref(false)

const loading = ref(true)
const isRefreshing = ref(false)
const showRefreshConfirm = ref(false)
const isSidebarCollapsed = ref(false)
const editorRefreshKey = ref(0)
const incompleteReports = ref<any[]>([])
const selectedReport = ref<any>(null)
const editorLoading = ref(false)
const activeLessons = ref<any[]>([])
const searchQuery = ref('')
const pageSize = 25
const pageOffset = ref(0)
const totalReports = ref(0)
const reportSort = ref<'date' | '-date' | 'updated_at' | '-updated_at'>('-date')
const pageRequestId = ref(0)
let searchTimer: ReturnType<typeof setTimeout> | undefined

const filteredReports = computed(() => incompleteReports.value)
const pageNumber = computed(() => Math.floor(pageOffset.value / pageSize) + 1)
const totalPages = computed(() => Math.max(1, Math.ceil(totalReports.value / pageSize)))

async function loadReports(refreshEditor = true) {
    const requestId = ++pageRequestId.value
    loading.value = true
    if (refreshEditor) {
        isRefreshing.value = true
        editorLoading.value = true
    }

    try {
        const response = await ReportQueryService.getGlobalIncompleteReportsPage(scope.value, {
            limit: pageSize,
            offset: pageOffset.value,
            search: searchQuery.value.trim(),
            sort: reportSort.value,
        })
        if (requestId !== pageRequestId.value) return
        const normalized = (response.data || []).map((r: any) => {
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
                missingContent: r.missingContent,
                missingLesson: r.missingLesson,
                missingProgress: r.missingProgress,
                missingParticipation: r.missingParticipation,
                missingBehavior: r.missingBehavior,
                isIncomplete: true,
                isMissing: false,
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
                sourceIdentity: sourceIdentityFromRow(r),
                updatedAt: r.updatedAt || r.updated_at,
                isCompleted: r.isCompleted || r.is_completed,
                fullStudent: r.fullStudent
            }
        })

        const total = Number(response.meta?.total ?? 0)
        if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid incomplete report total')
        if (pageOffset.value >= total && total > 0) {
            pageOffset.value = Math.floor((total - 1) / pageSize) * pageSize
            return loadReports(refreshEditor)
        }

        incompleteReports.value = normalized
        totalReports.value = total

        if (!selectedReport.value && normalized.length > 0) {
            selectReport(normalized[0])
        } else if (selectedReport.value) {
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
            toast.success(t('report.refresh_success'))
        }
    } catch (err) {
        console.error(err)
        incompleteReports.value = []
        selectedReport.value = null
        reportError(err, 'report.load_error')
    } finally {
        loading.value = false
        isRefreshing.value = false
    }
}

function goToPage(delta: number) {
    const nextOffset = pageOffset.value + delta * pageSize
    if (nextOffset < 0 || nextOffset >= totalReports.value) return
    pageOffset.value = nextOffset
    void loadReports(false)
}

function setScope(next: IncompleteReportScope) {
    if (next === scope.value) return
    scope.value = next
    pageOffset.value = 0
    void router.replace({ query: { ...route.query, scope: next === 'all' ? 'all' : undefined } })
    void loadReports(false)
}

watch(searchQuery, () => {
    pageOffset.value = 0
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => { void loadReports(false) }, 300)
})

onBeforeUnmount(() => {
    if (searchTimer) clearTimeout(searchTimer)
    pageRequestId.value++
})

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

watch(selectedReport, async (newVal) => {
    if (!newVal || !newVal.courseId) {
        activeLessons.value = []
        editorLoading.value = false
        return
    }

    editorLoading.value = true
    try {
        const response = await apiResourceClient.list<any>('lessons', { courseId: newVal.courseId, sort: 'sequence', perPage: 100 })
        activeLessons.value = response.data || []
    } catch (e) {
        console.error('Failed to load lessons for report context', e)
        activeLessons.value = []
    } finally {
        editorLoading.value = false
    }
})


async function handleSaveSuccess() {
    await loadReports(false)
}

function handleReportRestored() {
    toast.success(t('report.editor.restore_success'))
    loadReports(true)
}

function handleSaveError(msg: string) {
    console.error('Report editor save failed:', msg)
}

function formatDate(dateVal: string | Date) {
    return DateUtils.displayDate(dateVal, locale.value, preferences.timeZone)
}

function formatDateTime(report: any) {
    const date = DateUtils.displayDate(report.date, locale.value, preferences.timeZone)
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
    const date = typeof dateVal === 'string' ? DateUtils.parseLocalDate(dateVal) : dateVal
    return date?.toLocaleDateString(locale.value, { weekday: 'short' }) || ''
}

onMounted(async () => {
    const permissionCheck = PermissionPolicyService.hasPermission(LIST_ALL_REPORTS_PERMISSION)
    if (scope.value === 'all') {
        // A shared ?scope=all link must not query the broader scope for users who lack it.
        canListAllReports.value = await permissionCheck
        if (!canListAllReports.value) {
            scope.value = 'my_notifications'
            void router.replace({ query: { ...route.query, scope: undefined } })
        }
        void loadReports()
        return
    }
    void loadReports()
    canListAllReports.value = await permissionCheck
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
