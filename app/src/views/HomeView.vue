<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { OccurrenceService } from '@/services/occurrence/OccurrenceService'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import type { ClassOccurrence } from '@/models/ClassOccurrence'
import { useAuthStore } from '@/stores/useAuthStore'
import { TeacherService } from '@/services/teacher/TeacherService'
import { StudentService } from '@/services/student/StudentService'
import { CourseCatalogService } from '@/services/course/CourseCatalogService'

const router = useRouter()
const stats = ref({
    totalStudents: 0,
    activeCourses: 0,
    todayClasses: 0
})
const todayOccurrences = ref<ClassOccurrence[]>([])
const loading = ref(true)

const nextClass = computed(() => {
    if (!todayOccurrences.value.length) return null
    const now = new Date()
    const currentTimeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

    // Find the first class that hasn't started yet
    const upcoming = todayOccurrences.value.filter(occ => occ.effectiveStartTime && occ.effectiveStartTime >= currentTimeString)
    if (upcoming.length > 0) {
        return upcoming[0]
    }

    // If all classes have started, find the first one that is currently ongoing (start <= now <= end)
    const ongoing = todayOccurrences.value.filter(occ => occ.effectiveStartTime && occ.effectiveEndTime && occ.effectiveStartTime <= currentTimeString && occ.effectiveEndTime >= currentTimeString)
    if (ongoing.length > 0) {
        return ongoing[0]
    }

    // If all are past, return null
    return null
})

onMounted(async () => {
    try {
        loading.value = true

        // Fetch background stats in parallel
        Promise.all([
            StudentService.getAll(1, 1).then(res => { stats.value.totalStudents = res.count }).catch(e => console.error(e)),
            CourseCatalogService.getCourses(1, 1).then(res => { stats.value.activeCourses = res.count }).catch(e => console.error(e)),
            fetchPendingReports()
        ])

        // Fetch today's classes
        const today = new Date()
        const start = new Date(today.setHours(0, 0, 0, 0))
        const end = new Date(today.setHours(23, 59, 59, 999))

        const data = await OccurrenceService.getOccurrencesByDateRange(start, end)
        const auth = useAuthStore()
        const userId = auth.user?.id

        // Fetch teacher profile if logged in
        const teacherProfile = userId ? await TeacherService.getTeacherByUserId(userId) : null
        const teacherId = teacherProfile?.id

        // Visible if:
        // 1. Current user is assigned to the occurrence (teacherId is in teacherIds)
        // 2. Teacher is marked attending (teacherAttendance[teacherId] is true)
        // 3. Class is conducted (isConducted is true)
        const visible = (data || []).filter(d => {
            // Must be conducted
            if (d.isConducted !== true) return false

            // If we have a teacher profile, filter by assignment and attendance
            if (teacherId) {
                const isAssigned = d.teacherIds?.includes(teacherId)
                const isAttending = d.teacherAttendance && d.teacherAttendance[teacherId] === true
                return isAssigned && isAttending
            }

            // If no teacher profile is linked to this user, don't show any classes
            return false
        })

        // Sort by start time
        visible.sort((a, b) => {
            const timeA = a.effectiveStartTime || '23:59:59'
            const timeB = b.effectiveStartTime || '23:59:59'
            return timeA.localeCompare(timeB)
        })

        todayOccurrences.value = visible
        stats.value.todayClasses = visible.length
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
})

const pendingReports = ref<any[]>([])

async function fetchPendingReports() {
    try {
        const data = await OccurrenceReportService.getPendingReports()
        pendingReports.value = data
    } catch (e) {
        console.error('Failed to fetch pending occurrences:', e)
    }
}

function navigateToSession(id: string) {
    router.push({ name: 'session-details', params: { id } })
}

function openReport(enrollmentId: string) {
    router.push({ name: 'lesson-reports', params: { enrollmentId } })
}

function navigateToGlobalIncomplete() {
    router.push({ name: 'incomplete-reports' })
}

</script>

<template>
    <div class="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <!-- Hero Header -->
        <div class="relative overflow-hidden bg-gray-900 rounded-[2.5rem] p-8 lg:p-10 text-white shadow-2xl">
            <div class="absolute -top-24 -right-24 w-96 h-96 bg-emerald-600/20 blur-[100px] rounded-full"></div>
            <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div class="max-w-xl">
                    <h1 class="text-4xl lg:text-5xl font-black tracking-tighter mb-3 leading-none">
                        {{ $t('dashboard.greeting') }},<br>
                        <span class="text-emerald-400">{{ $t('dashboard.app_name') }}</span>
                    </h1>
                    <p class="text-lg text-gray-400 font-bold italic">
                        {{ $t('dashboard.tagline') }}
                    </p>
                </div>
                <div
                    class="hidden lg:block absolute right-1/4 top-1/2 -translate-y-1/2 opacity-10 transform -rotate-12 scale-125">
                    <img src="/pwa-512x512.png" alt="" class="w-64 h-64 grayscale contrast-200" />
                </div>
                <div class="flex gap-4 shrink-0 mt-4 md:mt-0">
                    <button @click="router.push({ name: 'students' })"
                        class="bg-white/10 backdrop-blur-sm text-white border border-white/20 px-6 py-3 rounded-2xl font-black hover:bg-white hover:text-gray-900 transition-all shadow-xl active:scale-95">
                        {{ $t('dashboard.manage_students_btn') }}
                    </button>
                    <button @click="router.push({ name: 'courses' })"
                        class="bg-emerald-500 text-white px-6 py-3 rounded-2xl font-black hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-900/40 active:scale-95">
                        {{ $t('dashboard.explore_courses_btn') }}
                    </button>
                </div>
            </div>
        </div>

        <!-- Main Dashboard Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">

            <!-- LEFT COLUMN: Schedule -->
            <div class="lg:col-span-8 space-y-8">

                <!-- Next Class Highlight -->
                <div v-if="nextClass"
                    class="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-[2.5rem] border border-emerald-100 p-8 shadow-sm relative overflow-hidden group">
                    <div
                        class="absolute top-0 right-0 w-64 h-64 bg-emerald-200/40 rounded-full blur-3xl -mr-20 -mt-20 transition-transform group-hover:scale-110">
                    </div>
                    <div class="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div>
                            <div class="flex items-center gap-2 mb-3">
                                <span class="flex h-3 w-3 rounded-full bg-emerald-500 animate-pulse"></span>
                                <span class="text-xs font-black text-emerald-600 uppercase tracking-widest">{{
                                    $t('dashboard.schedule.next_class') }}</span>
                            </div>
                            <h2 class="text-3xl font-black text-gray-900 tracking-tight mb-2">
                                {{ nextClass.sessionName || $t('dashboard.schedule.untitled_class') }}
                            </h2>
                            <div class="flex items-center gap-4 text-gray-600 font-bold">
                                <div
                                    class="flex items-center gap-1.5 bg-white/60 px-3 py-1.5 rounded-xl border border-white">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-600" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    {{ nextClass.effectiveStartTime?.slice(0, 5) }} - {{
                                        nextClass.effectiveEndTime?.slice(0, 5) }}
                                </div>
                                <div v-if="nextClass.classroomName"
                                    class="flex items-center gap-1.5 bg-white/60 px-3 py-1.5 rounded-xl border border-white">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-amber-600" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    {{ nextClass.classroomName }}
                                </div>
                            </div>
                        </div>
                        <button @click="navigateToSession(nextClass.classSessionId)"
                            class="bg-gray-900 text-white px-6 py-4 rounded-2xl font-black flex items-center justify-center gap-2 hover:bg-gray-800 transition-all active:scale-95 shrink-0 shadow-lg">
                            {{ $t('dashboard.schedule.open_session') }}
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Today's Classes List -->
                <div class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-8">
                    <div class="flex items-center justify-between mb-8">
                        <div>
                            <h3 class="text-2xl font-black text-gray-900 tracking-tight">{{
                                $t('dashboard.schedule.title') }}</h3>
                            <p class="text-sm font-bold text-gray-400 italic">{{ $t('dashboard.schedule.subtitle') }}
                            </p>
                        </div>
                        <button @click="router.push({ name: 'classrooms' })"
                            class="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                            </svg>
                        </button>
                    </div>

                    <div v-if="loading" class="flex flex-col items-center py-12">
                        <svg class="animate-spin h-8 w-8 text-emerald-500 mb-4" xmlns="http://www.w3.org/2000/svg"
                            fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                    </div>

                    <div v-else-if="todayOccurrences.length === 0"
                        class="text-center py-12 bg-gray-50/50 rounded-3xl border border-dashed border-gray-200">
                        <h4 class="text-lg font-black text-gray-900 mb-1">{{ $t('dashboard.schedule.no_classes') }}</h4>
                        <p class="text-sm text-gray-400 font-medium italic">{{ $t('dashboard.schedule.no_classes_sub')
                            }}</p>
                    </div>

                    <div v-else class="space-y-3">
                        <div v-for="occ in todayOccurrences" :key="occ.id"
                            @click="navigateToSession(occ.classSessionId)"
                            class="flex items-center justify-between p-4 rounded-2xl border border-gray-100 hover:border-emerald-200 hover:shadow-md transition-all cursor-pointer group bg-white">
                            <div class="flex items-center gap-4">
                                <div class="w-1.5 h-12 rounded-full"
                                    :style="{ backgroundColor: occ.classroomColor || '#10b981' }"></div>
                                <div>
                                    <h4 class="font-black text-gray-900 group-hover:text-emerald-600 transition-colors">
                                        {{ occ.sessionName || $t('dashboard.schedule.untitled_class') }}
                                    </h4>
                                    <div class="flex items-center gap-3 text-xs font-bold text-gray-400 mt-1">
                                        <span>{{ occ.effectiveStartTime?.slice(0, 5) }} - {{
                                            occ.effectiveEndTime?.slice(0, 5) }}</span>
                                        <span v-if="occ.classroomName"
                                            class="text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">{{
                                            occ.classroomName }}</span>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-3">
                                <span :class="[
                                    'px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest',
                                    occ.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                                        occ.status === 'cancelled' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-600'
                                ]">
                                    {{ $t(`common.status.${occ.status}`) || occ.status }}
                                </span>
                                <svg xmlns="http://www.w3.org/2000/svg"
                                    class="h-5 w-5 text-gray-300 group-hover:text-emerald-500 transition-colors"
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M9 5l7 7-7 7" />
                                </svg>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- RIGHT COLUMN: Stats & Widgets -->
            <div class="lg:col-span-4 space-y-8">

                <!-- Mini Stats Grid -->
                <div class="grid grid-cols-2 gap-4">
                    <div
                        class="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                        <div
                            class="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 mb-3">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                        </div>
                        <p class="text-3xl font-black text-gray-900 tracking-tighter">{{ stats.totalStudents }}</p>
                        <h4 class="text-[11px] font-black text-gray-400 uppercase tracking-widest mt-1">{{
                            $t('dashboard.stats.total_students') }}</h4>
                    </div>

                    <div
                        class="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                        <div
                            class="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 mb-3">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                        </div>
                        <p class="text-3xl font-black text-gray-900 tracking-tighter">{{ stats.activeCourses }}</p>
                        <h4 class="text-[11px] font-black text-gray-400 uppercase tracking-widest mt-1">{{
                            $t('dashboard.stats.total_courses') }}</h4>
                    </div>

                    <div
                        class="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                        <div
                            class="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 mb-3">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <p class="text-3xl font-black text-gray-900 tracking-tighter">{{ stats.todayClasses }}</p>
                        <h4 class="text-[11px] font-black text-gray-400 uppercase tracking-widest mt-1">{{
                            $t('dashboard.stats.today_classes') }}</h4>
                    </div>

                    <div
                        class="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                        <div
                            class="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 mb-3">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                        </div>
                        <p class="text-3xl font-black text-gray-900 tracking-tighter">{{ pendingReports.length }}</p>
                        <h4 class="text-[11px] font-black text-gray-400 uppercase tracking-widest mt-1">{{
                            $t('dashboard.stats.pending_reports') }}</h4>
                    </div>
                </div>

                <!-- Pending Reports Widget -->
                <div v-if="pendingReports.length > 0"
                    class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm p-6">
                    <div class="flex items-center justify-between mb-6">
                        <h3 class="text-lg font-black text-gray-900 tracking-tight flex items-center gap-2">
                            <span class="flex h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                            {{ $t('dashboard.action_needed') }}
                        </h3>
                    </div>

                    <div class="space-y-3 mb-6">
                        <div v-for="report in pendingReports.slice(0, 3)" :key="report.id"
                            @click="openReport(report.enrollmentId)"
                            class="bg-gray-50/50 p-4 rounded-2xl border border-gray-100 hover:bg-white hover:shadow-md hover:border-amber-200 transition-all cursor-pointer group">
                            <div class="flex items-start justify-between">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-8 h-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center font-black text-xs shrink-0">
                                        {{ report.studentName.charAt(0) }}
                                    </div>
                                    <div class="min-w-0">
                                        <h4 class="font-black text-gray-900 text-sm truncate">{{ report.studentName }}
                                        </h4>
                                        <p class="text-[10px] font-bold text-gray-400 truncate">{{ report.className }}
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center justify-between mt-3">
                                <span class="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
                                    {{ report.isMissing ? $t('dashboard.missing') : $t('dashboard.incomplete') }}
                                </span>
                                <span class="text-[10px] font-black text-gray-400 uppercase">
                                    {{ new Date(report.date).toLocaleDateString(undefined, {
                                        month: 'short', day:
                                    'numeric' }) }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <button @click="navigateToGlobalIncomplete"
                        class="w-full py-3 bg-gray-50 text-gray-600 font-black rounded-xl hover:bg-gray-100 transition-colors text-sm flex items-center justify-center gap-2">
                        {{ $t('dashboard.view_all_reports_count', { count: pendingReports.length }) }}
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                    </button>
                </div>

            </div>
        </div>
    </div>
</template>
