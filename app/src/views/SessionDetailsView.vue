<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CourseService } from '@/services/CourseService'
import { OccurrenceService } from '@/services/OccurrenceService'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import type { Enrollment } from '@/models/Enrollment'

import ReportEditor from '@/components/ReportEditor.vue'
import ConflictModal from '@/components/ConflictModal.vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string
const todayOccurrence = ref<any>(null)
const reportMap = ref<Map<string, any>>(new Map()) // enrollmentId -> report
const savingMap = ref<Map<string, boolean>>(new Map()) // enrollmentId -> isSaving

// Split View State
const showSplitView = ref(false)
const selectedEnrollmentId = ref<string | null>(null)

// Conflict Resolution State
const showConflictModal = ref(false)
const conflictServerContent = ref('')
const conflictLocalContent = ref('')
const conflictReportId = ref<string | null>(null)

const session = ref<any>(null)
const enrollments = ref<Enrollment[]>([])
const courseLessons = ref<any[]>([])
const loading = ref(true)

onMounted(async () => {
    try {
        loading.value = true
        // 1. Get session details
        session.value = await CourseService.getSessionDetails(sessionId)

        // 2. Get all students enrolled in this session
        const { data: allEnrollments } = await CourseService.getEnrollmentsBySession(sessionId)
        enrollments.value = allEnrollments

        // 2.5 Load lessons for this course (needed for editor)
        if (allEnrollments.length > 0 && allEnrollments[0]?.courseId) {
            const lessons = await CourseService.getLessonsByCourse(allEnrollments[0].courseId)
            courseLessons.value = lessons
        }

        // 3. Find or Create Today's Occurrence
        const today = new Date()

        // Check if session runs today (day_of_week)
        if (session.value && session.value.day_of_week === today.getDay()) {
            const occurrences = await OccurrenceService.getOccurrencesByDateRange(today, today, [sessionId])
            if (occurrences.length > 0) {
                todayOccurrence.value = occurrences[0]
            } else {
                // Generate today's occurrence if it doesn't exist but is scheduled for today
                const generated = await OccurrenceService.generateOccurrences(sessionId, today, today)
                if (generated.length > 0) todayOccurrence.value = generated[0]
            }
        }

        // If NO occurrence found for today (or not scheduled today), try to find the LATEST past occurrence
        if (!todayOccurrence.value) {
            const ninetyDaysAgo = new Date()
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

            const recent = await OccurrenceService.getOccurrencesByDateRange(
                ninetyDaysAgo,
                today,
                [sessionId]
            )

            if (recent && recent.length > 0) {
                // Sort desc and take first
                recent.sort((a, b) => new Date(b.occurrenceDate).getTime() - new Date(a.occurrenceDate).getTime())
                todayOccurrence.value = recent[0]
            }
        }

        if (todayOccurrence.value) {
            // 4. Load/Create Reports for all permanent enrollments
            // AND Detect Guest Students (Rescheduled into this class)

            // 4a. Get ALL reports for this occurrence first
            const occurrenceReports = await OccurrenceReportService.getReportsByOccurrence(todayOccurrence.value.id)
            const reportEnrollmentIds = new Set(occurrenceReports.map(r => r.enrollmentId))

            // 4b. Identify Guests (Have report but not in permanent list)
            const currentEnrollmentIds = new Set(enrollments.value.map(e => e.id))
            const guestEnrollmentIds = [...reportEnrollmentIds].filter(id => id && !currentEnrollmentIds.has(id))

            // 4c. Load Guest Enrollments
            if (guestEnrollmentIds.length > 0) {
                const guestPromises = guestEnrollmentIds.map(id => CourseService.getEnrollmentById(id!))
                const guests = await Promise.all(guestPromises)

                guests.forEach(guest => {
                    if (guest) {
                        // Mark as guest for UI
                        (guest as any).isGuest = true
                        enrollments.value.push(guest)

                        // Populate report map immediately since we already fetched it
                        const existingReport = occurrenceReports.find(r => r.enrollmentId === guest.id)
                        if (existingReport) {
                            reportMap.value.set(guest.id!, existingReport)
                        }
                    }
                })
            }

            // 4d. Ensure reports exist for permanent students
            for (const enr of enrollments.value) {
                if (enr.id) {
                    // Start report loading for everyone (guests already handled, but check is fast)
                    if (!reportMap.value.has(enr.id)) {
                        if (enr.status === 'active') {
                            const report = await OccurrenceReportService.getOrCreateReport(enr.id, todayOccurrence.value.id)
                            reportMap.value.set(enr.id, report)
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
})

function navigateToProfile(studentId: string) {
    router.push({ name: 'student-profile', params: { id: studentId } })
}

function navigateToReports(enrollmentId: string) {
    router.push({ name: 'lesson-reports', params: { enrollmentId } })
}

// Attendance & Rating Handlers
async function toggleAttendance(enrId: string, event: any) {
    const report = reportMap.value.get(enrId)
    if (!report) return

    const isPresent = event.target.checked
    const newStatus = isPresent ? 'present' : 'absent'

    savingMap.value.set(enrId, true)
    try {
        await OccurrenceReportService.saveReport(
            report.id,
            report.content || '',
            report.version,
            undefined,
            {
                attendanceStatus: newStatus,
                absenceReason: isPresent ? undefined : t('report.editor.absence_reasons.reason_not_provided')
            }
        )
        // Refresh local report state
        const updated = await OccurrenceReportService.getReportById(report.id)
        reportMap.value.set(enrId, updated)
    } catch (e) {
        console.error('Failed to toggle attendance:', e)
        event.target.checked = !isPresent // Revert UI
    } finally {
        savingMap.value.delete(enrId)
    }
}



async function refreshSchedule() {
    if (!confirm(t('classroom.refresh_confirm'))) return
    try {
        await OccurrenceService.syncSessionOccurrences(sessionId)
        alert(t('classroom.refresh_success'))
        window.location.reload()
    } catch (e) {
        console.error(e)
        alert('Failed to refresh schedule')
    }
}

async function toggleClassStatus(event: any) {
    if (!todayOccurrence.value) return
    const isHeld = event.target.checked

    try {
        const updated = await OccurrenceService.updateOccurrence(todayOccurrence.value.id, {
            is_conducted: isHeld
        })
        todayOccurrence.value.isConducted = updated.isConducted
    } catch (e) {
        console.error('Failed to update class status:', e)
        event.target.checked = !isHeld
    }
}

const lessonsCache = new Map<string, any[]>()

async function toggleSplitView(enrollmentId: string) {
    if (selectedEnrollmentId.value === enrollmentId && showSplitView.value) {
        showSplitView.value = false
        selectedEnrollmentId.value = null
    } else {
        // finding the enrollment to get the courseId
        const enrollment = enrollments.value.find(e => e.id === enrollmentId)
        if (enrollment?.courseId) {
            // Check cache first
            if (lessonsCache.has(enrollment.courseId)) {
                courseLessons.value = lessonsCache.get(enrollment.courseId)!
            } else {
                try {
                    const lessons = await CourseService.getLessonsByCourse(enrollment.courseId)
                    lessonsCache.set(enrollment.courseId, lessons)
                    courseLessons.value = lessons
                } catch (e) {
                    console.error('Failed to load lessons for course', enrollment.courseId, e)
                }
            }
        }

        selectedEnrollmentId.value = enrollmentId
        showSplitView.value = true
    }
}

function handleEditorUpdate(content: string, enrollmentId: string) {
    const report = reportMap.value.get(enrollmentId)
    if (report) {
        report.content = content
    }
}

function handleReportExternalLinkUpdate(link: string, enrollmentId: string) {
    const report = reportMap.value.get(enrollmentId)
    if (report) {
        report.externalLink = link
    }
}

function handleSaveSuccess(version: number, enrollmentId: string) {
    const report = reportMap.value.get(enrollmentId)
    if (report) {
        report.version = version
    }
}

function handleSaveError(error: string) {
    alert(`Failed to save report: ${error}`)
}

function handleConflict(serverContent: string, enrollmentId: string) {
    conflictServerContent.value = serverContent
    const report = reportMap.value.get(enrollmentId)
    conflictLocalContent.value = report?.content || ''
    conflictReportId.value = report?.id || null
    showConflictModal.value = true
}

function closeConflictModal() {
    showConflictModal.value = false
    conflictReportId.value = null
}

async function resolveConflict(resolvedContent: string) {
    if (!conflictReportId.value) return

    try {
        const report = await OccurrenceReportService.resolveConflict(
            conflictReportId.value,
            resolvedContent
        )

        // Update local state
        // Find which enrollment this belongs to
        for (const [enrId, r] of reportMap.value.entries()) {
            if (r.id === report.id) {
                reportMap.value.set(enrId, report)
                break
            }
        }

        showConflictModal.value = false
        conflictReportId.value = null
        alert(t('report.save_success'))
    } catch (error) {
        console.error('Failed to resolve conflict:', error)
        alert('Failed to resolve conflict')
    }
}
</script>

<template>
    <div class="space-y-8 animate-in fade-in duration-500">
        <!-- Header -->
        <div class="flex items-center gap-4">
            <button @click="router.back()"
                class="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-100 transition-all shadow-sm active:scale-90">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
                </svg>
            </button>
            <div class="flex-1">
                <h1 class="text-3xl font-black text-gray-900 tracking-tight" v-if="session">{{ session.name }}</h1>
                <div class="flex items-center gap-3 mt-1 text-sm font-bold text-gray-400" v-if="session">
                    <span class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        {{ session.classroom_name }}
                    </span>
                    <span class="w-1 h-1 bg-gray-300 rounded-full"></span>
                    <span class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {{ session.start_time.slice(0, 5) }} - {{ session.end_time.slice(0, 5) }}
                    </span>
                </div>
            </div>

            <!-- Refresh Schedule Button -->
            <button @click="refreshSchedule"
                class="p-3 rounded-2xl bg-white border border-gray-100 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-100 transition-all shadow-sm active:scale-90"
                :title="$t('classroom.refresh_schedule')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
            </button>

            <!-- Toggle Split View Action (Global or just keeps context context) -->
            <button v-if="showSplitView" @click="showSplitView = false"
                class="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition font-bold text-sm">
                {{ $t('common.close_split_view') || 'Close Editor' }}
            </button>
        </div>

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

        <div v-else class="grid gap-6 transition-all duration-500 ease-in-out"
            :class="showSplitView ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'">

            <!-- LEFT COLUMN: Student List & Stats -->
            <div class="space-y-6">
                <!-- Class Status Toggle (New) -->
                <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex items-center justify-between"
                    v-if="todayOccurrence">
                    <div>
                        <h3 class="font-black text-gray-900">{{ $t('classroom.class_held_title') || 'Class Status' }}
                        </h3>
                        <p class="text-xs font-bold text-gray-400">
                            {{ $t('classroom.class_held_subtitle') || 'Mark if the class was conducted today' }}
                        </p>
                    </div>

                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" :checked="todayOccurrence.isConducted"
                            @change="toggleClassStatus($event)" class="sr-only peer">
                        <div
                            class="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500">
                        </div>
                    </label>
                </div>

                <!-- Stats Bar (Conditional or Compact in Split View?) -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6" v-if="!showSplitView">
                    <div
                        class="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-emerald-100 flex items-center justify-between">
                        <div>
                            <h4 class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-2">{{
                                $t('classroom.total_students') }}</h4>
                            <p class="text-5xl font-black tracking-tighter">{{ enrollments.length }}</p>
                        </div>
                        <div class="bg-white/20 p-4 rounded-3xl">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
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
                                    Math.round((enrollments.length / (session?.capacity || 1)) * 100) }}%</p>
                                <p class="text-xs font-bold text-gray-400 pb-1">/ {{ session?.capacity }} {{
                                    $t('classroom.capacity') }}</p>
                            </div>
                        </div>
                        <div class="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div class="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                                :style="{ width: `${(enrollments.length / (session?.capacity || 1)) * 100}%` }"></div>
                        </div>
                    </div>
                </div>

                <!-- Student List Table -->
                <div class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-gray-50/50">
                                <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center"
                                    v-if="todayOccurrence">{{ $t('attendance.status') }}</th>
                                <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                    $t('classroom.student_name') }}</th>
                                <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                    $t('classroom.enrollment_status') }}</th>
                                <th
                                    class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">
                                    {{ $t('classroom.actions') }}</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-50">
                            <tr v-for="e in enrollments" :key="e.id"
                                class="hover:bg-emerald-50/20 transition-colors group">
                                <!-- Attendance Column -->
                                <td class="px-8 py-6 text-center" v-if="todayOccurrence">
                                    <input type="checkbox"
                                        :checked="reportMap.get(e.id!)?.attendanceStatus === 'present'"
                                        :disabled="savingMap.has(e.id!)" @change="toggleAttendance(e.id!, $event)"
                                        class="w-6 h-6 rounded-lg border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-50">
                                </td>

                                <td class="px-8 py-6">
                                    <div class="flex items-center gap-4">
                                        <div
                                            class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black text-xl">
                                            {{ e.studentName?.charAt(0) }}
                                        </div>
                                        <div>
                                            <div class="font-black text-gray-900 text-lg">{{ e.studentName }}</div>
                                            <div class="text-xs font-bold text-gray-400">{{ e.studentEmail ||
                                                $t('classroom.no_email') }}</div>
                                        </div>
                                    </div>
                                </td>
                                <td class="px-8 py-6">
                                    <span v-if="(e as any).isGuest"
                                        class="px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest border bg-purple-50 text-purple-700 border-purple-100 mr-2">
                                        {{ $t('common.rescheduled') || 'Rescheduled' }}
                                    </span>
                                    <span
                                        class="px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest border"
                                        :class="e.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-400 border-gray-200'">
                                        {{ $t('student.internal_courses.status_' + e.status) }}
                                    </span>
                                </td>
                                <td class="px-8 py-6 text-right">
                                    <div class="flex justify-end gap-2">
                                        <button @click="navigateToProfile(e.studentId)"
                                            class="p-3 rounded-2xl bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 border border-gray-100 hover:border-emerald-100 transition-all active:scale-90"
                                            :title="$t('classroom.view_profile')">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                        </button>
                                        <button @click="navigateToReports(e.id!)"
                                            class="p-3 rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-90"
                                            :title="$t('classroom.view_reports')">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                        </button>
                                        <button @click="toggleSplitView(e.id!)"
                                            class="p-3 rounded-2xl border border-gray-100 shadow-sm transition-all active:scale-90"
                                            :class="selectedEnrollmentId === e.id && showSplitView ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white text-gray-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100'"
                                            :title="$t('classroom.quick_edit') || 'Quick Edit'">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                                viewBox="0 0 24 24" stroke="currentColor">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                            </svg>
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            <tr v-if="enrollments.length === 0">
                                <td colspan="3"
                                    class="px-8 py-20 text-center font-black italic text-gray-300 tracking-widest">
                                    No students enrolled yet.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- RIGHT COLUMN: Report Editor -->
            <div v-if="showSplitView && selectedEnrollmentId" class="animate-in slide-in-from-right-4 duration-500">
                <div
                    class="sticky top-6 bg-white rounded-[2.5rem] border border-emerald-100 shadow-xl shadow-emerald-50/50 p-6 overflow-hidden">
                    <div class="flex items-center justify-between mb-6">
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-black">
                                {{enrollments.find(e => e.id === selectedEnrollmentId)?.studentName?.charAt(0)}}
                            </div>
                            <div>
                                <h3 class="font-black text-gray-900">{{enrollments.find(e => e.id ===
                                    selectedEnrollmentId)?.studentName}}</h3>
                                <p class="text-xs font-bold text-gray-400">{{ todayOccurrence?.occurrenceDate ? new
                                    Date(todayOccurrence?.occurrenceDate).toLocaleDateString() : 'Today' }}</p>
                            </div>
                        </div>
                        <button @click="showSplitView = false" class="p-2 hover:bg-gray-100 rounded-full">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400" viewBox="0 0 20 20"
                                fill="currentColor">
                                <path fill-rule="evenodd"
                                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                    clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>

                    <ReportEditor v-if="reportMap.get(selectedEnrollmentId)" :key="selectedEnrollmentId"
                        :report-id="reportMap.get(selectedEnrollmentId)?.id"
                        :initial-content="reportMap.get(selectedEnrollmentId)?.content"
                        :initial-version="reportMap.get(selectedEnrollmentId)?.version"
                        :initial-lesson-id="reportMap.get(selectedEnrollmentId)?.lessonId"
                        :initial-enrollment-external-link="enrollments.find(e => e.id === selectedEnrollmentId)?.externalLink"
                        :initial-report-external-link="reportMap.get(selectedEnrollmentId)?.externalLink"
                        :initial-is-completed="reportMap.get(selectedEnrollmentId)?.isCompleted"
                        :initial-progress-start="reportMap.get(selectedEnrollmentId)?.progressStart"
                        :initial-progress-end="reportMap.get(selectedEnrollmentId)?.progressEnd"
                        :initial-attendance-status="reportMap.get(selectedEnrollmentId)?.attendanceStatus"
                        :initial-absence-reason="reportMap.get(selectedEnrollmentId)?.absenceReason"
                        :initial-class-participation="parseFloat(reportMap.get(selectedEnrollmentId)?.classParticipation || '0')"
                        :initial-classroom-behavior="parseFloat(reportMap.get(selectedEnrollmentId)?.classroomBehavior || '0')"
                        :initial-contact-notes="reportMap.get(selectedEnrollmentId)?.contactNotes"
                        :initial-class-notes="reportMap.get(selectedEnrollmentId)?.classNotes"
                        :initial-student-id="enrollments.find(e => e.id === selectedEnrollmentId)?.studentId"
                        :course-name="session?.name" :available-lessons="courseLessons" :show-manual-save="true"
                        :loading="savingMap.get(selectedEnrollmentId!)"
                        @update:content="handleEditorUpdate($event, selectedEnrollmentId!)"
                        @update:report-external-link="handleReportExternalLinkUpdate($event, selectedEnrollmentId!)"
                        @save-success="handleSaveSuccess($event, selectedEnrollmentId!)" @save-error="handleSaveError"
                        @conflict="handleConflict($event, selectedEnrollmentId!)"
                        class="h-full border-none shadow-none rounded-none" />

                    <div v-else class="flex flex-col items-center justify-center py-20 text-gray-400">
                        <p class="font-bold">{{ $t('report.no_report_today') }}</p>
                        <p class="text-xs mt-1">{{ $t('report.is_student_active_hint') }}</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Conflict Resolution Modal -->
        <ConflictModal :is-open="showConflictModal" :server-content="conflictServerContent"
            :local-content="conflictLocalContent" @close="closeConflictModal" @resolve="resolveConflict" />

    </div>
</template>
