<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { OccurrenceService } from '@/services/OccurrenceService'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import type { ClassOccurrence } from '@/models/ClassOccurrence'

useI18n()

const router = useRouter()
const stats = ref({
    totalStudents: 0,
    activeCourses: 0,
    todayClasses: 0
})
const todayOccurrences = ref<ClassOccurrence[]>([])
const loading = ref(true)

onMounted(async () => {
    try {
        loading.value = true
        // Fetch today's classes
        const today = new Date()
        const start = new Date(today.setHours(0, 0, 0, 0))
        const end = new Date(today.setHours(23, 59, 59, 999))

        const data = await OccurrenceService.getOccurrencesByDateRange(start, end)
        todayOccurrences.value = data
        stats.value.todayClasses = data.length
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }

    fetchPendingReports()
})

const pendingReports = ref<any[]>([])

async function fetchPendingReports() {
    try {
        const data = await OccurrenceReportService.getPendingReports()
        pendingReports.value = data
    } catch (e) {
        console.error('Failed to pending occurrences:', e)
    }
}

function navigateToSession(id: string) {
    router.push({ name: 'session-details', params: { id } })
}

function openReport(enrollmentId: string) {
    // Navigate to session details with split view open?
    // Or navigate to report editor directly if we had a route?
    // Session details is safest.
    // We need to know the session ID from the pending report logic... 
    // Wait, the pending report data has occurrenceId, but session ID is needed for route.
    // Let's verify what `getPendingReports` returns. 
    // It returns className, etc. but we didn't include sessionId in the push.
    // Let's assume we can get it from the enrollment...? No.
    // We should add sessionId to getPendingReports result.

    // For now, let's just go to reports list
    router.push({ name: 'lesson-reports', params: { enrollmentId } })
}
</script>

<template>
    <div class="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <!-- Hero Header -->
        <div class="relative overflow-hidden bg-gray-900 rounded-[3rem] p-12 text-white shadow-2xl">
            <div class="absolute -top-24 -right-24 w-96 h-96 bg-emerald-600/20 blur-[100px] rounded-full"></div>
            <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                <div class="max-w-xl">
                    <h1 class="text-5xl font-black tracking-tighter mb-4 leading-none">
                        {{ $t('dashboard.greeting') }},<br>
                        <span class="text-emerald-400">{{ $t('dashboard.app_name') }}</span>
                    </h1>
                    <p class="text-xl text-gray-400 font-bold italic">
                        {{ $t('dashboard.tagline') }}
                    </p>
                </div>
                <div
                    class="hidden lg:block absolute right-1/4 top-1/2 -translate-y-1/2 opacity-20 transform -rotate-12 scale-150">
                    <img src="/pwa-512x512.png" alt="" class="w-64 h-64 grayscale contrast-200" />
                </div>
                <div class="flex gap-4 shrink-0">
                    <button @click="router.push({ name: 'students' })"
                        class="bg-white text-gray-900 px-8 py-4 rounded-2xl font-black text-lg hover:bg-emerald-50 transition-all shadow-xl active:scale-95">
                        {{ $t('dashboard.manage_students_btn') }}
                    </button>
                    <button @click="router.push({ name: 'courses' })"
                        class="bg-emerald-600 text-white px-8 py-4 rounded-2xl font-black text-lg hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-900/40 active:scale-95">
                        {{ $t('dashboard.explore_courses_btn') }}
                    </button>
                </div>
            </div>
        </div>

        <!-- PENDING REPORTS SECTION -->
        <div v-if="pendingReports.length > 0" class="space-y-4">
            <div class="flex items-center justify-between px-2">
                <h3 class="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
                    <span class="flex h-3 w-3 rounded-full bg-amber-500"></span>
                    {{ $t('dashboard.pending_reports') }}
                </h3>
                <span class="text-sm font-bold text-gray-400">{{ $t('dashboard.missing_count', {
                    count:
                    pendingReports.length }) }}</span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div v-for="report in pendingReports" :key="report.id" @click="openReport(report.enrollmentId)"
                    class="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group">
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-black">
                                {{ report.studentName.charAt(0) }}
                            </div>
                            <div>
                                <h4 class="font-black text-gray-900">{{ report.studentName }}</h4>
                                <p class="text-xs font-bold text-gray-400">{{ report.className }}</p>
                            </div>
                        </div>
                        <span class="px-2 py-1 bg-gray-50 text-gray-400 text-[10px] font-black uppercase rounded-lg">
                            {{ new Date(report.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                            }}
                        </span>
                    </div>
                    <div class="flex items-center justify-between mt-2">
                        <span class="text-xs font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                            {{ report.isMissing ? $t('dashboard.missing') : $t('dashboard.incomplete') }}
                        </span>
                        <svg xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 text-gray-300 group-hover:text-emerald-500 transition-colors" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                    </div>
                </div>
            </div>
        </div>

        <!-- Quick Stats -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div
                class="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-xl transition-all group">
                <div
                    class="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-6 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                </div>
                <h4 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{{
                    $t('dashboard.stats.active_students') || 'Active Students' }}</h4>
                <p class="text-4xl font-black text-gray-900 tracking-tighter">{{ stats.totalStudents }}</p>
            </div>
            <div
                class="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-xl transition-all group">
                <div
                    class="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center text-blue-600 mb-6 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </div>
                <h4 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{{
                    $t('dashboard.stats.today_classes') }}</h4>
                <p class="text-4xl font-black text-gray-900 tracking-tighter">{{ stats.todayClasses }}</p>
            </div>
            <div
                class="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm hover:shadow-xl transition-all group text-emerald-600">
                <div
                    class="w-14 h-14 bg-emerald-600 text-white rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-emerald-200 group-hover:scale-110 transition-transform font-black">
                    %
                </div>
                <h4 class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{{
                    $t('dashboard.stats.productivity') }}</h4>
                <p class="text-4xl font-black text-gray-900 tracking-tighter">{{ $t('dashboard.stats.ready') }}</p>
            </div>
        </div>

        <!-- Today's Classes List -->
        <div class="bg-white rounded-[3rem] border border-gray-100 shadow-sm p-10">
            <div class="flex items-center justify-between mb-10">
                <div>
                    <h3 class="text-3xl font-black text-gray-900 tracking-tight">{{ $t('dashboard.schedule.title') }}
                    </h3>
                    <p class="text-sm font-bold text-gray-400 mt-1 italic">{{ $t('dashboard.schedule.subtitle') }}</p>
                </div>
                <button @click="router.push({ name: 'classrooms' })"
                    class="text-emerald-600 font-black text-sm flex items-center gap-2 hover:translate-x-1 transition-transform">
                    {{ $t('dashboard.schedule.view_classrooms') }}
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                            d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                </button>
            </div>

            <div v-if="loading" class="flex flex-col items-center py-20 bg-gray-50/50 rounded-2xl">
                <svg class="animate-spin h-8 w-8 text-emerald-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none"
                    viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                    </path>
                </svg>
                <p class="text-gray-400 font-bold italic tracking-widest">{{ $t('dashboard.schedule.loading') }}</p>
            </div>

            <div v-else-if="todayOccurrences.length > 0" class="divide-y divide-gray-50">
                <div v-for="occ in todayOccurrences" :key="occ.id" @click="navigateToSession(occ.classSessionId)"
                    class="py-8 flex items-center justify-between group cursor-pointer hover:px-4 transition-all">
                    <div class="flex items-center gap-8">
                        <div class="w-2 h-20 bg-emerald-500 rounded-full group-hover:scale-y-110 transition-transform">
                        </div>
                        <div>
                            <div class="flex items-center gap-3 mb-2"
                                v-if="occ.effectiveStartTime && occ.effectiveEndTime">
                                <span
                                    class="text-[10px] font-black text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full uppercase tracking-widest">
                                    {{ occ.effectiveStartTime.slice(0, 5) }} - {{ occ.effectiveEndTime.slice(0, 5) }}
                                </span>
                                <span v-if="occ.classroomName"
                                    class="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                    • {{ occ.classroomName }}
                                </span>
                            </div>
                            <h4
                                class="text-2xl font-black text-gray-900 group-hover:text-emerald-700 transition-colors">
                                {{ occ.displayString }}</h4>
                        </div>
                    </div>
                    <div class="flex items-center gap-4 group-hover:translate-x-2 transition-transform">
                        <div class="text-right">
                            <p class="text-xs font-black text-gray-400 uppercase tracking-widest">{{ occ.status }}</p>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-emerald-600" fill="none"
                            viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>
            </div>

            <div v-else class="text-center py-20 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
                <div
                    class="w-16 h-16 bg-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-gray-100">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-300" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </div>
                <h4 class="text-xl font-black text-gray-900 mb-1">{{ $t('dashboard.schedule.no_classes') }}</h4>
                <p class="text-gray-400 font-medium italic">{{ $t('dashboard.schedule.no_classes_sub') }}</p>
            </div>
        </div>
    </div>
</template>
