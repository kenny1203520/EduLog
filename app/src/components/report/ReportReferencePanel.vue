<template>
    <Teleport to="body">
        <div v-if="show" class="fixed inset-0 z-[120] overflow-hidden pointer-events-none">
            <!-- Backdrop Overlay -->
            <div class="absolute inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto cursor-pointer transition-opacity duration-300"
                @click="$emit('close')"></div>

            <div
                class="absolute inset-y-0 right-0 z-[130] w-full sm:w-[600px] bg-gray-50/98 backdrop-blur-xl shadow-[-20px_0_60px_rgba(0,0,0,0.15)] flex flex-col pointer-events-auto transition-transform duration-500 cubic-bezier(0.4, 0, 0.2, 1) animate-in slide-in-from-right ring-1 ring-black/5">

                <!-- Header Section (Fixed at top) -->
                <div class="shrink-0 bg-white/80 backdrop-blur-md border-b border-indigo-100/30 sticky top-0 z-50">
                    <!-- Title Bar -->
                    <div class="px-4 py-3 sm:px-6 sm:py-5 flex items-center justify-between gap-4">
                        <div class="flex items-center gap-3">
                            <div
                                class="p-2 sm:p-2.5 bg-indigo-50 rounded-xl sm:rounded-2xl ring-1 ring-indigo-100/50 shadow-sm">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 sm:h-6 sm:w-6 text-indigo-600"
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                            </div>
                            <div>
                                <h2
                                    class="font-black text-gray-900 text-lg sm:text-xl tracking-tight leading-none mb-1 sm:mb-1.5">
                                    {{ $t('report.reference_panel.title') }}
                                </h2>
                                <div class="flex items-center gap-1.5">
                                    <span class="w-1 h-1 rounded-full bg-indigo-500 animate-pulse"></span>
                                    <p class="text-[9px] font-black text-indigo-400 uppercase tracking-[0.2em]">{{
                                        activeTab === 'peer' ? $t('report.reference_panel.peer_reports') :
                                            $t('report.reference_panel.student_history') }}</p>
                                </div>
                            </div>
                        </div>
                        <button @click="$emit('close')"
                            class="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all shrink-0 active:scale-90 group"
                            :aria-label="$t('common.close')">
                            <svg xmlns="http://www.w3.org/2000/svg"
                                class="h-5 w-5 sm:h-6 sm:w-6 group-hover:rotate-90 transition-transform duration-300"
                                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <!-- Tabs Bar -->
                    <div class="flex px-4 sm:px-6 gap-6 sm:gap-8 overflow-x-auto no-scrollbar">
                        <button @click="switchTab('peer')"
                            class="relative py-3 sm:py-4 text-xs sm:text-sm font-black transition-all whitespace-nowrap group"
                            :class="activeTab === 'peer' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'">
                            {{ $t('report.reference_panel.peer_reports') }}
                            <div v-if="activeTab === 'peer'"
                                class="absolute bottom-0 left-0 right-0 h-0.5 sm:h-1 bg-indigo-600 rounded-t-full shadow-[0_-2px_10px_rgba(79,70,229,0.3)]">
                            </div>
                        </button>
                        <button @click="switchTab('history')"
                            class="relative py-3 sm:py-4 text-xs sm:text-sm font-black transition-all whitespace-nowrap group"
                            :class="activeTab === 'history' ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-600'">
                            {{ $t('report.reference_panel.student_history') }}
                            <div v-if="activeTab === 'history'"
                                class="absolute bottom-0 left-0 right-0 h-0.5 sm:h-1 bg-indigo-600 rounded-t-full shadow-[0_-2px_10px_rgba(79,70,229,0.3)]">
                            </div>
                        </button>
                    </div>
                </div>

                <!-- Filters Bar -->
                <div
                    class="px-4 py-3 sm:px-6 sm:py-4 bg-white/40 border-b border-indigo-50/50 space-y-3 sm:space-y-4 backdrop-blur-sm relative z-40">
                    <!-- Search -->
                    <div class="relative group">
                        <input v-model="searchQuery" type="text"
                            :placeholder="$t('report.reference_panel.search_placeholder')"
                            class="w-full pl-10 pr-4 py-2.5 sm:pl-12 sm:py-3.5 bg-white border border-gray-100 rounded-xl sm:rounded-2xl text-xs sm:text-sm font-medium focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 shadow-sm transition-all placeholder:text-gray-300"
                            @keyup.enter="refreshData"  :aria-label="$t('report.reference_panel.search_placeholder')"/>
                        <svg xmlns="http://www.w3.org/2000/svg"
                            class="h-4 w-4 sm:h-5 sm:w-5 text-gray-300 absolute left-3.5 sm:left-4.5 top-3 sm:top-4 transition-colors group-focus-within:text-indigo-600"
                            fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>

                    <!-- Contextual Filters & Sort -->
                    <div class="flex flex-wrap gap-2 sm:gap-3">
                        <template v-if="activeTab === 'peer'">
                            <BaseDropdown v-model="filterClassroom" :options="classroomOptions"
                                :placeholder="$t('report.reference_panel.filter_by_classroom')" theme="indigo"
                                class="flex-1 min-w-[140px]" @change="handleClassroomChange" />

                            <BaseDropdown v-model="filterSession" :options="sessionOptions"
                                :placeholder="$t('report.reference_panel.filter_by_session')" theme="indigo"
                                class="flex-1 min-w-[140px]" @change="refreshData" />
                        </template>

                        <template v-else>
                            <BaseDropdown v-model="filterCourse" :options="courseOptions"
                                :placeholder="$t('report.reference_panel.filter_by_course')" theme="indigo"
                                class="flex-1 min-w-[140px]" @change="refreshData" />
                        </template>

                        <BaseDropdown v-model="sortBy" :options="sortOptions" theme="indigo" align="auto"
                            class="flex-1 min-w-[120px]" menuWidthClass="w-48" @change="refreshData" />
                    </div>
                </div>

                <!-- Content List -->
                <div
                    class="flex-1 overflow-y-auto overscroll-y-contain p-4 sm:p-6 space-y-6 sm:space-y-8 scroll-smooth no-scrollbar">
                    <div v-if="loading" class="flex flex-col items-center justify-center py-20 sm:py-32 gap-5">
                        <div class="relative">
                            <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-full border-4 border-indigo-50 animate-pulse">
                            </div>
                            <div
                                class="absolute inset-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full border-t-4 border-indigo-600 animate-spin">
                            </div>
                        </div>
                        <span
                            class="text-[10px] sm:text-xs font-black text-indigo-600 uppercase tracking-widest animate-pulse">{{
                                $t('common.loading') }}</span>
                    </div>

                    <div v-else-if="loadError"
                        class="flex flex-col items-center justify-center py-20 sm:py-32 gap-4 text-center bg-red-50/60 rounded-[2rem] sm:rounded-[2.5rem] border-2 border-dashed border-red-200">
                        <p class="text-xs sm:text-sm font-bold text-red-700">{{ loadError }}</p>
                        <button type="button" @click="refreshData"
                            class="px-4 py-2 rounded-md bg-indigo-600 text-white text-xs sm:text-sm font-medium hover:bg-indigo-700 transition-colors">
                            {{ $t('common.refresh') }}
                        </button>
                    </div>

                    <div v-else-if="reports.length === 0"
                        class="flex flex-col items-center justify-center py-20 sm:py-32 text-gray-400 bg-white/40 rounded-[2rem] sm:rounded-[2.5rem] border-2 border-dashed border-gray-200/60 shadow-inner">
                        <svg class="w-12 h-12 sm:w-16 sm:h-16 mb-4 sm:mb-6 opacity-20" fill="none" stroke="currentColor"
                            viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p class="text-xs sm:text-sm font-bold tracking-tight">{{
                            $t('report.reference_panel.no_results') }}</p>
                    </div>

                    <div v-else v-for="report in reports" :key="reportCardKey(report)"
                        class="group bg-white rounded-[1.5rem] sm:rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-2xl hover:shadow-indigo-500/10 hover:border-indigo-100 transition-all duration-500 overflow-hidden">
                        <!-- Card Header Section -->
                        <div
                            class="px-5 py-4 sm:px-7 sm:py-6 border-b border-gray-50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sm:gap-5 bg-gradient-to-br from-white to-indigo-50/20">
                            <div class="flex-1 min-w-0">
                                <h4
                                    class="text-base sm:text-lg font-black text-gray-900 truncate tracking-tight group-hover:text-indigo-600 transition-colors duration-300">
                                    {{ formatHeader(report) }}
                                </h4>
                                <div class="flex flex-wrap items-center gap-1.5 sm:gap-2 mt-2 sm:mt-2.5">
                                    <div
                                        class="flex items-center gap-1 sm:gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 bg-white rounded-full border border-gray-100 shadow-sm">
                                        <svg class="w-2.5 h-2.5 sm:w-3 sm:h-3 text-indigo-500" fill="none"
                                            stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2-2v12a2 2 0 002 2z" />
                                        </svg>
                                        <span
                                            class="text-[9px] sm:text-[10px] font-black text-gray-600 uppercase tracking-widest">
                                            {{ formatDate(report) }}
                                        </span>
                                    </div>
                                    <span v-if="report.is_completed"
                                        class="text-[9px] sm:text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-600 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full ring-1 ring-emerald-100/50">
                                        {{ $t('report.completed') }}
                                    </span>
                                    <span v-else
                                        class="text-[9px] sm:text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-600 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full ring-1 ring-rose-100/50">
                                        {{ $t('report.incomplete') }}
                                    </span>
                                    <span v-if="getReportProgress(report)"
                                        class="text-[9px] sm:text-[10px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-700 px-2 sm:px-3 py-0.5 sm:py-1 rounded-full ring-1 ring-indigo-100/50">
                                        {{ getReportProgress(report) }}
                                    </span>
                                </div>
                            </div>
                            <button @click="copyContent(report.content)"
                                class="shrink-0 w-full sm:w-auto px-5 py-2.5 sm:px-6 sm:py-3 bg-gray-900 text-white rounded-[1rem] sm:rounded-[1.25rem] text-[10px] sm:text-[11px] font-black shadow-lg sm:shadow-xl shadow-gray-200 hover:bg-indigo-600 hover:shadow-indigo-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                                :title="$t('report.reference_panel.copy_content')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                {{ $t('report.reference_panel.copy_content') }}
                            </button>
                        </div>

                        <!-- Notes Sections (Conditional) -->
                        <div v-if="!report.is_linked_lesson_entry"
                            class="px-5 py-3 sm:px-7 sm:py-5 bg-gray-50/40 border-b border-gray-100/60 space-y-3 sm:space-y-4">
                            <!-- Contact Notes -->
                            <div v-if="report.contact_notes"
                                class="flex flex-col gap-1.5 sm:gap-2 relative group/note transition-all duration-300"
                                :class="shouldShowToggle(report.contact_notes, 'notes') ? (isExpanded(report.id, 'contact') ? 'pb-7 sm:pb-8' : 'pb-5 sm:pb-6') : ''">
                                <div class="flex gap-3 sm:gap-4">
                                    <div
                                        class="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-amber-50 flex items-center justify-center border border-amber-100/50 text-[10px] sm:text-xs">
                                        📞
                                    </div>
                                    <div class="flex-1">
                                        <span
                                            class="text-[12px] sm:text-[13px] font-black text-amber-600 uppercase tracking-widest block mb-0.5 sm:mb-1">
                                            {{ $t('report.reference_panel.contact') }}
                                        </span>
                                        <RichTextViewer class="text-[13px] sm:text-[14px] text-gray-600 font-medium leading-relaxed"
                                            :content="report.contact_notes_document || report.contact_notes"
                                            preset="notes"
                                            :class="(shouldShowToggle(report.contact_notes, 'notes') && !isExpanded(report.id, 'contact')) ? 'line-clamp-2' : ''">
                                        </RichTextViewer>
                                    </div>
                                </div>
                                <!-- Toggle for Contact -->
                                <div v-if="shouldShowToggle(report.contact_notes, 'notes')"
                                    class="absolute bottom-0 right-0">
                                    <button @click="toggleExpanded(report.id, 'contact')"
                                        class="text-[8px] sm:text-[9px] font-black text-amber-600 hover:bg-amber-50 flex items-center gap-1 sm:gap-1.5 bg-white px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl border border-amber-100 shadow-sm transition-all active:scale-95">
                                        {{ isExpanded(report.id, 'contact') ? $t('common.show_less') :
                                            $t('common.show_more') }}
                                        <svg class="w-2 sm:w-2.5 h-2 sm:h-2.5 transition-transform duration-300"
                                            :class="isExpanded(report.id, 'contact') ? 'rotate-180' : ''" fill="none"
                                            stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                                d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            <!-- Class Notes -->
                            <div v-if="report.class_notes"
                                class="flex flex-col gap-1.5 sm:gap-2 relative group/note transition-all duration-300"
                                :class="shouldShowToggle(report.class_notes, 'notes') ? (isExpanded(report.id, 'class') ? 'pb-7 sm:pb-8' : 'pb-5 sm:pb-6') : ''">
                                <div class="flex gap-3 sm:gap-4">
                                    <div
                                        class="shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl bg-blue-50 flex items-center justify-center border border-blue-100/50 text-[10px] sm:text-xs">
                                        📝
                                    </div>
                                    <div class="flex-1">
                                        <span
                                            class="text-[12px] sm:text-[13px] font-black text-blue-600 uppercase tracking-widest block mb-0.5 sm:mb-1">
                                            {{ $t('report.reference_panel.class_notes') }}
                                        </span>
                                        <RichTextViewer class="text-[13px] sm:text-[14px] text-gray-600 font-medium leading-relaxed"
                                            :content="report.class_notes_document || report.class_notes"
                                            preset="notes"
                                            :class="(shouldShowToggle(report.class_notes, 'notes') && !isExpanded(report.id, 'class')) ? 'line-clamp-2' : ''">
                                        </RichTextViewer>
                                    </div>
                                </div>
                                <!-- Toggle for Class -->
                                <div v-if="shouldShowToggle(report.class_notes, 'notes')"
                                    class="absolute bottom-0 right-0">
                                    <button @click="toggleExpanded(report.id, 'class')"
                                        class="text-[10px] sm:text-[11px] font-black text-blue-600 hover:bg-blue-50 flex items-center gap-1 sm:gap-1.5 bg-white px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg sm:rounded-xl border border-blue-100 shadow-sm transition-all active:scale-95">
                                        {{ isExpanded(report.id, 'class') ? $t('common.show_less') :
                                            $t('common.show_more') }}
                                        <svg class="w-2 sm:w-2.5 h-2 sm:h-2.5 transition-transform duration-300"
                                            :class="isExpanded(report.id, 'class') ? 'rotate-180' : ''" fill="none"
                                            stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                                d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- Main Content Section -->
                        <div class="p-5 sm:p-7 bg-white relative">
                            <RichTextViewer class="text-[14px] sm:text-[15px] text-gray-700 font-medium leading-relaxed transition-all duration-500"
                                :content="report.content_document || report.content" preset="report"
                                :class="shouldShowToggle(report.content, 'content') ? (isExpanded(report.id, 'content') ? 'pb-14 sm:pb-16' : 'line-clamp-[10] sm:line-clamp-[12] max-h-[350px] sm:max-h-[420px] overflow-hidden pb-20 sm:pb-24') : ''">
                            </RichTextViewer>

                            <!-- Toggle for Content -->
                            <div v-if="shouldShowToggle(report.content, 'content')"
                                :class="isExpanded(report.id, 'content') ? 'mt-6 sm:mt-8 flex justify-center' : 'absolute bottom-0 left-0 right-0 p-6 sm:p-8 flex justify-center bg-gradient-to-t from-white via-white/98 to-transparent pt-16 sm:pt-24'">
                                <button @click="toggleExpanded(report.id, 'content')"
                                    class="px-6 py-2.5 sm:px-7 sm:py-3 bg-gray-50 border border-gray-200 rounded-[1rem] sm:rounded-[1.25rem] shadow-sm text-[10px] sm:text-[11px] font-black text-gray-600 hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-all duration-300 active:scale-95 flex items-center gap-2 sm:gap-2.5">
                                    {{ isExpanded(report.id, 'content') ? $t('common.show_less') :
                                        $t('common.show_more') }}
                                    <svg class="w-3.5 h-3.5 sm:w-4 h-4 transition-transform duration-300"
                                        :class="isExpanded(report.id, 'content') ? 'rotate-180' : ''" fill="none"
                                        stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M19 9l-7 7-7-7" />
                                    </svg>
                                </button>
                            </div>

                            <!-- Micro-ID -->
                            <div
                                class="absolute bottom-2 right-4 text-[9px] sm:text-[10px] font-black text-indigo-100 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none tracking-widest select-none">
                                REF#{{ report.id.substring(0, 8).toUpperCase() }}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Footer / Pagination Section -->
                <div
                    class="shrink-0 px-4 py-3 sm:px-6 sm:py-5 border-t border-indigo-50/50 bg-white/90 backdrop-blur-md flex flex-col gap-3 sm:gap-4 shadow-[0_-20px_50px_rgba(0,0,0,0.04)] relative z-40">
                    <div class="flex items-center justify-between gap-3">
                        <div
                            class="bg-gray-50 p-1 rounded-lg sm:rounded-xl border border-gray-100 flex-1 min-w-0 flex items-center gap-2">
                            <span
                                class="text-[10px] sm:text-[12px] font-black text-gray-400 uppercase tracking-widest pl-2 truncate">
                                {{ $t('report.reference_panel.items_per_page') }}
                            </span>
                            <BaseDropdown v-model="pageSize" :options="pageSizeOptions" theme="indigo"
                                widthClass="w-16 sm:w-20" menuWidthClass="w-24 sm:w-32"
                                @change="handlePageSizeChange" />
                        </div>
                        <div
                            class="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 bg-indigo-50/50 rounded-lg sm:rounded-xl border border-indigo-100/50 shrink-0">
                            <span
                                class="text-[10px] sm:text-[12px] font-black text-indigo-400 uppercase tracking-widest">{{
                                    $t('report.reference_panel.total') }}</span>
                            <span class="text-indigo-600 font-black text-[10px] sm:text-xs">{{ totalCount }}</span>
                        </div>
                    </div>

                    <div v-if="totalCount > pageSize"
                        class="flex items-center justify-between bg-white rounded-xl sm:rounded-[1.5rem] p-1 sm:p-1.5 border border-indigo-50 shadow-sm">
                        <button @click="prevPage" :disabled="currentPage === 1 || loading"
                            class="p-2 sm:p-3 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg sm:rounded-2xl disabled:opacity-30 disabled:hover:bg-transparent transition-all active:scale-90">
                            <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                    d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <div class="text-[10px] sm:text-[12px] font-black text-gray-900 tracking-tighter uppercase">
                            {{ $t('report.reference_panel.page') }} <span
                                class="text-indigo-600 text-base sm:text-lg mx-0.5 sm:mx-1">{{
                                    currentPage }}</span> <span class="text-gray-300 mx-0.5 sm:mx-1">/</span> {{ totalPages
                                }}
                        </div>
                        <button @click="nextPage" :disabled="currentPage === totalPages || loading"
                            class="p-2 sm:p-3 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg sm:rounded-2xl disabled:opacity-30 disabled:hover:bg-transparent transition-all active:scale-90">
                            <svg class="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                    d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>

                    <!-- Secondary Close Button (Mobile Only) -->
                    <button @click="$emit('close')"
                        class="sm:hidden w-full py-3.5 bg-gray-900 text-white rounded-xl font-black text-xs hover:bg-indigo-600 shadow-xl shadow-gray-300 transition-all active:scale-95 flex items-center justify-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        {{ $t('common.close') }}
                    </button>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { AggregateService } from '@/services/api/AggregateService'
import { SessionService } from '@/services/session/SessionService'
import { useI18n } from 'vue-i18n'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import RichTextViewer from '@/components/text-editor/RichTextViewer.vue'
import { useFeedback } from '@/composables/useFeedback'
import { DateUtils } from '@/utils/dateUtils'
import { ReportQueryService } from '@/services/report/ReportQueryService'

const { t, locale } = useI18n()
const { reportError } = useFeedback()

// Computed Options for BaseDropdown
const classroomOptions = computed(() => [
    { label: t('report.reference_panel.filter_by_classroom'), value: '' },
    ...classrooms.value.map(c => ({ label: c.name, value: c.id }))
])

const sessionOptions = computed(() => [
    { label: t('report.reference_panel.filter_by_session'), value: '' },
    ...filteredSessions.value.map(s => ({ label: s.name, value: s.id }))
])

const courseOptions = computed(() => [
    { label: t('report.reference_panel.filter_by_course'), value: '' },
    ...courses.value.map(c => ({ label: c.display_name || c.subject, value: c.id }))
])

const sortOptions = computed(() => [
    { label: t('report.reference_panel.newest'), value: 'desc' },
    { label: t('report.reference_panel.oldest'), value: 'asc' }
])

const pageSizeOptions = [
    { label: '10', value: 10 },
    { label: '20', value: 20 },
    { label: '50', value: 50 }
]

const props = defineProps<{
    show: boolean
    lessonId?: string
    studentId?: string
    enrollmentId?: string
    currentReportId?: string
    focusedReportId?: string
    focusedLessonSequence?: number
    focusedLessonTitle?: string
    focusedCourseName?: string
    focusedStudentName?: string
}>()

const emit = defineEmits(['close', 'copy'])

const activeTab = ref<'peer' | 'history'>('peer')
const searchQuery = ref('')
const loading = ref(false)
const loadError = ref<string | null>(null)

// Data State
const reports = ref<any[]>([])
const totalCount = ref(0)
const regularReportCount = ref(0)
const linkedReportCount = ref(0)
const currentPage = ref(1)
const pageSize = ref(10)

// Filters State
const filterClassroom = ref('')
const filterSession = ref('')
const filterCourse = ref('')
const sortBy = ref<'asc' | 'desc'>('desc')

// Expansion State
const expandedStates = ref<Record<string, boolean>>({})

function toggleExpanded(reportId: string, field: string = 'all') {
    const key = `${reportId}-${field}`
    expandedStates.value[key] = !expandedStates.value[key]
}

function isExpanded(reportId: string, field: string = 'all') {
    return expandedStates.value[`${reportId}-${field}`] || false
}

function shouldShowToggle(content: string | null | undefined, type: 'notes' | 'content'): boolean {
    if (!content) return false
    const lines = content.split('\n').length
    if (type === 'notes' && lines > 3) return true
    if (type === 'content' && lines > 12) return true
    if (type === 'notes' && content.length > 100) return true
    if (type === 'content' && content.length > 400) return true
    return false
}

// Lookups
const classrooms = ref<any[]>([])
const allSessions = ref<any[]>([])
const courses = ref<any[]>([])

const totalPages = computed(() => Math.max(
    Math.ceil(regularReportCount.value / pageSize.value),
    Math.ceil(linkedReportCount.value / pageSize.value),
    1
))

const filteredSessions = computed(() => {
    if (!filterClassroom.value) return allSessions.value
    return allSessions.value.filter(s => s.classroom_id === filterClassroom.value)
})

// Lifecycle
onMounted(async () => {
    await loadFilterOptions()
    window.addEventListener('keydown', handleKeyDown)
})

onUnmounted(() => {
    window.removeEventListener('keydown', handleKeyDown)
})

function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && props.show) {
        emit('close')
    }
}

let refreshRequestId = 0
watch(() => [props.show, props.focusedReportId] as const, ([isOpen, reportId]) => {
    if (!isOpen) return
    if (reportId) activeTab.value = 'history'
    void refreshData()
})

// Tab handling
function switchTab(tab: 'peer' | 'history') {
    if (activeTab.value === tab) return
    activeTab.value = tab
    currentPage.value = 1
    // Don't clear search query, but we reset filtering?
    void refreshData()
}

async function loadFilterOptions() {
    try {
        const crsP = CourseCatalogService.getCourseOptions(1, 1000)
        const sessionsP = SessionService.getAllClassSessionOptions()

        // Try aggregate for classrooms first
        try {
            const [crs, agg, sessions] = await Promise.all([crsP, AggregateService.getAllClassroomsOverview(''), sessionsP])
            courses.value = crs.data
            classrooms.value = (agg.classrooms || []).map((d: any) => d)
            allSessions.value = sessions.data
        } catch (e) {
            const [crs, cls, sessions] = await Promise.all([crsP, ClassroomService.getAllClassrooms(), sessionsP])
            courses.value = crs.data
            classrooms.value = cls.data
            allSessions.value = sessions.data
        }
    } catch (e) {
        console.error('Failed to load filters:', e)
        reportError(e)
    }
}

async function refreshData() {
    if (!props.show) return
    const requestId = ++refreshRequestId

    // Auto-switch to history if no lessonId but studentId is present
    if (!props.lessonId && props.studentId && activeTab.value === 'peer') {
        activeTab.value = 'history'
    }

    loading.value = true
    loadError.value = null
    reports.value = []
    totalCount.value = 0
    regularReportCount.value = 0
    linkedReportCount.value = 0
    try {
        if (activeTab.value === 'history' && props.focusedReportId) {
            const report = await ReportQueryService.getReportById(props.focusedReportId)
            if (requestId !== refreshRequestId) return
            const dto = report.toDTO()
            reports.value = [{
                ...dto,
                updated_at: dto.updated_at,
                class_occurrences: { occurrence_date: dto.occurrence_date },
                lessons: { sequence: props.focusedLessonSequence, title: props.focusedLessonTitle },
                enrollments: { courses: { display_name: props.focusedCourseName }, students: { name: props.focusedStudentName } }
            }]
            regularReportCount.value = 1
            totalCount.value = 1
            return
        }
        const commonParams = {
            excludeReportId: props.currentReportId,
            page: currentPage.value,
            pageSize: pageSize.value,
            sortBy: sortBy.value,
            search: searchQuery.value.trim() || undefined
        }

        let res
        let regularCount = 0
        let linkedCount = 0
        let linkedRows: any[] = []
        if (activeTab.value === 'peer') {
            if (!props.lessonId) {
                reports.value = []
                totalCount.value = 0
                loading.value = false
                return
            }
            res = await ReportQueryService.getReportsByLesson(props.lessonId, {
                ...commonParams,
                classroomId: filterClassroom.value,
                sessionId: filterSession.value
            })
            regularCount = res.count
        } else {
            if (!props.studentId) {
                reports.value = []
                totalCount.value = 0
                loading.value = false
                return
            }
            const [studentHistory, linkedHistory] = await Promise.all([
                ReportQueryService.getReportsByStudent(props.studentId, {
                    ...commonParams,
                    courseId: filterCourse.value
                }),
                props.enrollmentId
                    ? ReportQueryService.getLinkedLessonReportHistory(props.enrollmentId, {
                        limit: pageSize.value,
                        offset: (currentPage.value - 1) * pageSize.value,
                        search: commonParams.search,
                        courseId: filterCourse.value || undefined,
                        sort: sortBy.value === 'asc' ? 'occurrence_date' : '-occurrence_date',
                    })
                    : Promise.resolve({ data: [], count: 0 }),
            ])
            res = studentHistory
            regularCount = studentHistory.count
            linkedCount = linkedHistory.count
            linkedRows = linkedHistory.data.map(row => ({
                ...row,
                enrollment_id: props.enrollmentId,
                is_linked_lesson_entry: true,
                lessons: row.lessons || { sequence: row.lesson_sequence, title: row.lesson_title },
                class_occurrences: row.class_occurrences || { occurrence_date: row.occurrence_date },
                enrollments: row.enrollments || { courses: { display_name: row.course_name } },
            }))
        }
        if (requestId === refreshRequestId) {
            regularReportCount.value = regularCount
            linkedReportCount.value = linkedCount
            if (linkedRows.length) {
                const linkedParentIds = new Set(linkedRows.map(row => row.id))
                reports.value = [
                    ...res.data.filter((report: any) => !linkedParentIds.has(report.id)),
                    ...linkedRows,
                ]
            } else reports.value = res.data
            totalCount.value = regularCount + linkedCount
        }
    } catch (e) {
        if (requestId !== refreshRequestId) return
        console.error('Failed to load reports:', e)
        reports.value = []
        totalCount.value = 0
        regularReportCount.value = 0
        linkedReportCount.value = 0
        loadError.value = t('report.reference_panel.load_error')
        reportError(e)
    } finally {
        if (requestId === refreshRequestId) loading.value = false
    }
}

function handleClassroomChange() {
    filterSession.value = '' // Reset session filter when classroom changes
    void refreshData()
}

function handlePageSizeChange() {
    currentPage.value = 1
    void refreshData()
}

function prevPage() {
    if (currentPage.value > 1) {
        currentPage.value--
        void refreshData()
    }
}

function nextPage() {
    if (currentPage.value < totalPages.value) {
        currentPage.value++
        void refreshData()
    }
}

function formatDate(report: any) {
    const occurrence = Array.isArray(report.class_occurrences) ? report.class_occurrences[0] : report.class_occurrences
    // occurrence_date is a calendar day; new Date('YYYY-MM-DD') would parse it as UTC midnight.
    const date = occurrence?.occurrence_date
        ? DateUtils.parseLocalDate(occurrence.occurrence_date)
        : report.occurrence_date ? DateUtils.parseLocalDate(report.occurrence_date)
            : report.updated_at ? new Date(report.updated_at) : undefined
    return date ? date.toLocaleDateString(locale.value) : '-'
}

function getReportProgress(report: any) {
    if (report.progress_letter) return report.progress_letter
    if (report.progress_start && report.progress_end) {
        return `${report.progress_start}-${report.progress_end}`
    }
    return report.progress_start || report.progress_end || ''
}

function formatHeader(report: any) {
    if (activeTab.value === 'peer') {
        const s = report.enrollments?.students
        return s.name || t('common.unknown_student')
    } else {
        const course = report.enrollments?.courses
        const lesson = report.lessons

        let courseName = t('common.unknown_course')
        if (course) {
            courseName = course.display_name || course.subject || report.course_name || courseName
        } else if (report.course_name) {
            courseName = report.course_name
        }

        const lessonInfo = lesson
            ? `#${lesson.sequence} ${lesson.title}`
            : report.lesson_title ? `#${report.lesson_sequence} ${report.lesson_title}` : ''
        return `${courseName} ${lessonInfo}`.trim()
    }
}

function reportCardKey(report: any) {
    return report.is_linked_lesson_entry
        ? `${report.id}:${report.enrollment_id}:${report.lesson_id}`
        : report.id
}

function copyContent(content: string) {
    emit('copy', content)
}
</script>
