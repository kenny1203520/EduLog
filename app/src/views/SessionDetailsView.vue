<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CourseService } from '@/services/CourseService'
import { OccurrenceService } from '@/services/OccurrenceService'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import type { Enrollment } from '@/models/Enrollment'

import ReportEditor from '@/components/ReportEditor.vue'
import ConflictModal from '@/components/ConflictModal.vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'

const { t } = useI18n()
const toast = useToast()

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string
const todayOccurrence = ref<any>(null)
const reportMap = ref<Map<string, any>>(new Map()) // enrollmentId -> report
const savingMap = ref<Map<string, boolean>>(new Map()) // enrollmentId -> isSaving
const selectedEnrollmentIds = ref<Set<string>>(new Set())
const isQuickAttendanceExpanded = ref(false)

// Split View State
const showSplitView = ref(false)
const selectedEnrollmentId = ref<string | null>(null)

// Conflict Resolution State
const showConflictModal = ref(false)
const conflictServerVersion = ref(0)
const conflictLocalVersion = ref(0)
const conflictReportId = ref<string | null>(null)
const conflictServerReport = ref<OccurrenceReportDTO | null>(null)
const conflictLocalReport = ref<OccurrenceReportDTO | null>(null)

const session = ref<any>(null)
const enrollments = ref<Enrollment[]>([])
const courseLessons = ref<any[]>([])
const loading = ref(true)

// Filtered Enrollments: Only show active students if they have a report
const visibleEnrollments = computed(() => {
    return enrollments.value.filter(e => {
        // Must have a valid report in the map to be visible
        // (Null means checked but no report exists)
        return reportMap.value.get(e.id!)
    })
})

async function loadData() {
    try {
        loading.value = true
        // Reset maps to avoid stale or merged data
        reportMap.value = new Map()

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
        todayOccurrence.value = null

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

            // Pre-populate map with ALL existing reports (Guests AND Active)
            occurrenceReports.forEach(r => {
                if (r.enrollmentId) {
                    reportMap.value.set(r.enrollmentId, r)
                }
            })

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
                        // Report is already in map from step 4a
                    }
                })
            }

            // 4d. Check for students WITHOUT reports
            for (const enr of enrollments.value) {
                if (enr.id) {
                    if (!reportMap.value.has(enr.id)) {
                        reportMap.value.set(enr.id, null)
                    }
                }
            }
        }
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
}

onMounted(() => {
    loadData()
})

function navigateToProfile(studentId: string) {
    router.push({ name: 'student-profile', params: { id: studentId } })
}

function navigateToReports(enrollmentId: string) {
    router.push({ name: 'lesson-reports', params: { enrollmentId } })
}

// Attendance & Rating Handlers
async function toggleAttendance(enrId: string) {
    const report = reportMap.value.get(enrId)
    if (!report) return

    // Cycle: Pending -> Present -> Absent -> Pending
    const currentStatus = report.attendanceStatus || 'pending'
    let newStatus: 'present' | 'absent' | 'pending' = 'pending'

    if (currentStatus === 'pending') {
        newStatus = 'present'
    } else if (currentStatus === 'present') {
        newStatus = 'absent'
    } else {
        newStatus = 'pending'
    }

    savingMap.value.set(enrId, true)
    try {
        await OccurrenceReportService.saveReport(
            report.id,
            report.version,
            undefined,
            {
                attendanceStatus: newStatus,
                absenceReason: newStatus === 'absent' ? t('report.editor.absence_reasons.reason_not_provided') : undefined,
                content: report.content || '',
            }
        )
        // Refresh local report state
        const updated = await OccurrenceReportService.getReportById(report.id)
        reportMap.value.set(enrId, updated)
    } catch (e) {
        console.error('Failed to toggle attendance:', e)
        toast.error(t('common.save_error') || 'Failed to save attendance')
    } finally {
        savingMap.value.delete(enrId)
    }
}

async function batchSetAttendance(status: 'present' | 'absent') {
    const ids = Array.from(selectedEnrollmentIds.value)
    if (ids.length === 0) return

    const promises = ids.map(async (enrId) => {
        const report = reportMap.value.get(enrId)
        if (!report) return

        savingMap.value.set(enrId, true)
        try {
            await OccurrenceReportService.saveReport(
                report.id,
                report.version,
                undefined,
                {
                    attendanceStatus: status,
                    absenceReason: status === 'absent' ? t('report.editor.absence_reasons.reason_not_provided') : undefined,
                    content: report.content || '',
                }
            )
            const updated = await OccurrenceReportService.getReportById(report.id)
            reportMap.value.set(enrId, updated)
        } catch (e) {
            console.error(`Failed to set attendance for ${enrId}:`, e)
        } finally {
            savingMap.value.delete(enrId)
        }
    })

    await Promise.all(promises)
    selectedEnrollmentIds.value.clear()
    toast.success(t('common.save_success'))
}

function toggleEnrollmentSelection(enrId: string) {
    if (selectedEnrollmentIds.value.has(enrId)) {
        selectedEnrollmentIds.value.delete(enrId)
    } else {
        selectedEnrollmentIds.value.add(enrId)
    }
}

function toggleSelectAll() {
    if (selectedEnrollmentIds.value.size === visibleEnrollments.value.length) {
        selectedEnrollmentIds.value.clear()
    } else {
        selectedEnrollmentIds.value = new Set(visibleEnrollments.value.map(e => e.id!))
    }
}

async function copyAttendanceInfo() {
    if (!todayOccurrence.value || !session.value) return

    const date = new Date(todayOccurrence.value.occurrenceDate).toLocaleDateString()
    const startTime = todayOccurrence.value.originalStartTime?.substring(0, 5) || ''
    const endTime = todayOccurrence.value.originalEndTime?.substring(0, 5) || ''
    const time = `${startTime}-${endTime}`

    // Helper to format list
    const formatList = (status: 'present' | 'absent' | 'pending') => {
        const list = visibleEnrollments.value
            .filter(e => {
                const report = reportMap.value.get(e.id!)
                const s = report?.attendanceStatus || 'pending' // Default to pending if missing
                return s === status
            })
            .map(e => e.studentName)
            .join(', ')
        return list || t('common.none')
    }

    const presentList = formatList('present')
    const absentList = formatList('absent')
    const pendingList = formatList('pending')

    const text = `${t('classroom.class_info_title')}\n` +
        `${session.value.name} (${date} ${time})\n\n` +
        `${t('classroom.present_list')}: ${presentList}\n` +
        `${t('classroom.absent_list')}: ${absentList}\n` +
        `${t('classroom.pending_list')}: ${pendingList}`

    try {
        await navigator.clipboard.writeText(text)
        toast.success(t('classroom.copy_success'))
    } catch (err) {
        console.error('Failed to copy: ', err)
        toast.error('Failed to copy to clipboard')
    }
}

// Refresh Schedule Logic
const showRefreshConfirm = ref(false)

function requestRefreshSchedule() {
    showRefreshConfirm.value = true
}

async function handleConfirmRefresh() {
    try {
        await OccurrenceService.syncSessionOccurrences(sessionId)
        toast.success(t('classroom.refresh_success'))
        showRefreshConfirm.value = false
        await loadData()
    } catch (e) {
        console.error(e)
        // @ts-ignore
        toast.error(t('classroom.refresh_failed') || 'Failed to refresh schedule')
        showRefreshConfirm.value = false
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

        // Fetch latest report content to ensure sync with server (fixes stale data issues)
        if (todayOccurrence.value?.id) {
            savingMap.value.set(enrollmentId, true)
            OccurrenceReportService.getReport(enrollmentId, todayOccurrence.value.id)
                .then(report => {
                    reportMap.value.set(enrollmentId, report)
                })
                .catch(e => {
                    console.error('Failed to sync report on quick edit open', e)
                })
                .finally(() => {
                    savingMap.value.delete(enrollmentId)
                })
        }
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
    toast.error(`Failed to save report: ${error}`)
}

function handleConflict(serverReport: OccurrenceReportDTO, localReport: OccurrenceReportDTO) {
    conflictReportId.value = serverReport.id || null
    conflictServerVersion.value = serverReport.version
    conflictLocalVersion.value = localReport.version
    conflictServerReport.value = serverReport
    conflictLocalReport.value = localReport
    showConflictModal.value = true
}

function closeConflictModal() {
    showConflictModal.value = false
    conflictReportId.value = null
}

async function resolveConflict(resolvedReport: OccurrenceReportDTO) {
    if (!conflictReportId.value) return

    try {
        const report = await OccurrenceReportService.resolveConflict(
            conflictReportId.value,
            resolvedReport
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
        toast.success(t('report.save_success'))
    } catch (error) {
        console.error('Failed to resolve conflict:', error)
        toast.error(t('report.resolve_conflict_error') || 'Failed to resolve conflict')
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
            <button @click="requestRefreshSchedule"
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
            <div class="space-y-6" :class="{ 'hidden lg:block': showSplitView }">
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

                    <div class="flex items-center gap-4">
                        <button @click="copyAttendanceInfo"
                            class="p-2 rounded-full bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                            :title="$t('classroom.copy_attendance')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                            </svg>
                        </button>

                        <label class="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" :checked="todayOccurrence.isConducted"
                                @change="toggleClassStatus($event)" class="sr-only peer">
                            <div
                                class="w-14 h-7 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500">
                            </div>
                        </label>
                    </div>
                </div>

                <!-- Quick Attendance Block (Refined & Collapsible) -->
                <div class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden"
                    v-if="todayOccurrence">
                    <!-- Header (Always Visible) -->
                    <div class="p-6 md:p-8 flex items-center justify-between cursor-pointer hover:bg-gray-50/50 transition-colors"
                        @click="isQuickAttendanceExpanded = !isQuickAttendanceExpanded">
                        <div class="flex items-center gap-4">
                            <div class="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            </div>
                            <div>
                                <h3 class="font-black text-xl text-gray-900">{{ $t('classroom.quick_attendance_title')
                                    }}</h3>
                                <p class="text-xs font-bold text-gray-400">
                                    {{ $t('classroom.quick_attendance_subtitle') }}
                                </p>
                            </div>
                        </div>
                        <div class="flex items-center gap-4">
                            <span v-if="selectedEnrollmentIds.size > 0"
                                class="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-wider">
                                {{ selectedEnrollmentIds.size }} {{ $t('common.selected') || 'Selected' }}
                            </span>
                            <div class="p-2 rounded-xl bg-gray-50 text-gray-400 transition-transform duration-300"
                                :class="{ 'rotate-180': isQuickAttendanceExpanded }">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                        d="M19 9l-7 7-7-7" />
                                </svg>
                            </div>
                        </div>
                    </div>

                    <!-- Expandable Content -->
                    <div v-show="isQuickAttendanceExpanded"
                        class="px-6 md:px-8 pb-8 pt-2 space-y-8 border-t border-gray-50">
                        <!-- Batch Action Buttons -->
                        <div class="flex items-center gap-3">
                            <button @click="batchSetAttendance('present')" :disabled="selectedEnrollmentIds.size === 0"
                                class="flex-1 px-6 py-4 bg-emerald-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 transition-all active:scale-95 shadow-lg shadow-emerald-100/50">
                                {{ $t('attendance.present') }}
                            </button>
                            <button @click="batchSetAttendance('absent')" :disabled="selectedEnrollmentIds.size === 0"
                                class="flex-1 px-6 py-4 bg-red-600 text-white rounded-2xl text-sm font-black uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 transition-all active:scale-95 shadow-lg shadow-red-100/50">
                                {{ $t('attendance.absent') }}
                            </button>
                        </div>

                        <div class="space-y-4">
                            <!-- Select All Toggle -->
                            <div class="flex items-center justify-between">
                                <button @click="toggleSelectAll"
                                    class="px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest border transition-all active:scale-95"
                                    :class="selectedEnrollmentIds.size === visibleEnrollments.length && visibleEnrollments.length > 0
                                        ? 'bg-gray-900 text-white border-gray-900 shadow-lg shadow-gray-200'
                                        : 'bg-white text-gray-400 border-gray-100 hover:bg-gray-50'">
                                    {{ selectedEnrollmentIds.size === visibleEnrollments.length &&
                                        visibleEnrollments.length > 0 ? $t('common.deselect_all') : $t('common.select_all')
                                    }}
                                </button>
                                <span class="text-[10px] font-black text-gray-300 uppercase tracking-widest">{{
                                    visibleEnrollments.length }} {{ $t('common.total') }}</span>
                            </div>

                            <!-- Student Grid (Optimized for Visibility) -->
                            <div
                                class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                                <button v-for="e in visibleEnrollments" :key="e.id"
                                    @click="toggleEnrollmentSelection(e.id!)"
                                    class="px-5 py-4 rounded-2xl border transition-all active:scale-95 flex items-center justify-between gap-3 group ring-offset-2 relative overflow-hidden"
                                    :class="[
                                        selectedEnrollmentIds.has(e.id!)
                                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xl shadow-emerald-100 ring-2 ring-emerald-500'
                                            : 'bg-white text-gray-700 border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/20'
                                    ]">
                                    <div class="flex items-center gap-3 min-w-0 z-10">
                                        <!-- Status Indicator Dot -->
                                        <div class="w-3 h-3 rounded-full shrink-0 shadow-sm border-2 border-white"
                                            :class="{
                                                'bg-emerald-400': reportMap.get(e.id!)?.attendanceStatus === 'present',
                                                'bg-red-400': reportMap.get(e.id!)?.attendanceStatus === 'absent',
                                                'bg-gray-300': !reportMap.get(e.id!)?.attendanceStatus || reportMap.get(e.id!)?.attendanceStatus === 'pending'
                                            }"></div>

                                        <span class="font-black text-base truncate">{{ e.studentName }}</span>
                                    </div>

                                    <!-- Checkmark for selection -->
                                    <div class="shrink-0 z-10 transition-all duration-300 transform"
                                        :class="selectedEnrollmentIds.has(e.id!) ? 'scale-100 opacity-100' : 'scale-50 opacity-0'">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-emerald-100"
                                            viewBox="0 0 20 20" fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                clip-rule="evenodd" />
                                        </svg>
                                    </div>

                                    <!-- Subtle Background Pattern for Selected -->
                                    <div v-if="selectedEnrollmentIds.has(e.id!)"
                                        class="absolute -right-4 -bottom-4 text-white/5 transform rotate-12">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-20 w-20" fill="currentColor"
                                            viewBox="0 0 24 24">
                                            <path
                                                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                                        </svg>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Stats Bar (Conditional or Compact in Split View?) -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6" v-if="!showSplitView">
                    <div
                        class="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-emerald-100 flex items-center justify-between">
                        <div>
                            <h4 class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-2">{{
                                $t('classroom.total_students') }}</h4>
                            <p class="text-5xl font-black tracking-tighter">{{ visibleEnrollments.length }}</p>
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
                                    Math.round((visibleEnrollments.length / (session?.capacity || 1)) * 100) }}%</p>
                                <p class="text-xs font-bold text-gray-400 pb-1">/ {{ session?.capacity }} {{
                                    $t('classroom.capacity') }}</p>
                            </div>
                        </div>
                        <div class="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                            <div class="h-full bg-emerald-500 rounded-full transition-all duration-1000"
                                :style="{ width: `${(visibleEnrollments.length / (session?.capacity || 1)) * 100}%` }">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Mobile Card List (Visible on < MD) -->
                <div class="grid grid-cols-1 gap-4 md:hidden">
                    <div v-for="e in visibleEnrollments" :key="e.id"
                        class="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm space-y-4">
                        <!-- Header: Info & Status -->
                        <div class="flex items-start justify-between">
                            <div class="flex items-center gap-3">
                                <div
                                    class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black text-xl shrink-0">
                                    {{ e.studentName?.charAt(0) }}
                                </div>
                                <div>
                                    <div class="font-black text-gray-900 text-lg leading-tight">{{ e.studentName }}
                                    </div>
                                    <div class="text-xs font-bold text-gray-400 mt-0.5">{{ e.studentEmail ||
                                        $t('classroom.no_email') }}</div>
                                </div>
                            </div>
                            <!-- Status Badges (Stacked) -->
                            <div class="flex flex-col items-end gap-2 shrink-0">
                                <span v-if="(e as any).isGuest"
                                    class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border bg-purple-50 text-purple-700 border-purple-100">
                                    {{ $t('common.rescheduled') || 'Guest' }}
                                </span>
                                <span
                                    class="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border"
                                    :class="e.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-400 border-gray-200'">
                                    {{ $t('student.internal_courses.status_' + e.status) }}
                                </span>
                            </div>
                        </div>

                        <hr class="border-gray-50">

                        <!-- Attendance Row -->
                        <div class="flex items-center justify-between" v-if="todayOccurrence">
                            <span class="text-xs font-bold text-gray-400 uppercase tracking-widest">{{
                                $t('attendance.status') }}</span>
                            <div class="flex items-center gap-3">
                                <span class="text-sm font-bold transition-colors"
                                    :class="reportMap.get(e.id!)?.attendanceStatus === 'present' ? 'text-emerald-600' : 'text-gray-400'">
                                    {{ reportMap.get(e.id!)?.attendanceStatus ? $t('attendance.' +
                                        reportMap.get(e.id!)?.attendanceStatus) : $t('attendance.pending') }}
                                </span>
                                <button type="button" @click="toggleAttendance(e.id!)"
                                    class="p-2 rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 flex items-center justify-center"
                                    :class="{
                                        'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 focus:ring-emerald-500': reportMap.get(e.id!)?.attendanceStatus === 'present',
                                        'bg-red-100 text-red-800 hover:bg-red-200 focus:ring-red-500': reportMap.get(e.id!)?.attendanceStatus === 'absent',
                                        'bg-gray-100 text-gray-400 hover:bg-gray-200 focus:ring-gray-300': !reportMap.get(e.id!)?.attendanceStatus || reportMap.get(e.id!)?.attendanceStatus === 'pending'
                                    }" :title="$t('attendance.status')" :disabled="savingMap.has(e.id!)">
                                    <!-- Present Icon (Check) -->
                                    <svg v-if="reportMap.get(e.id!)?.attendanceStatus === 'present'"
                                        xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20"
                                        fill="currentColor">
                                        <path fill-rule="evenodd"
                                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                            clip-rule="evenodd" />
                                    </svg>

                                    <!-- Absent Icon (X) -->
                                    <svg v-else-if="reportMap.get(e.id!)?.attendanceStatus === 'absent'"
                                        xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20"
                                        fill="currentColor">
                                        <path fill-rule="evenodd"
                                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                            clip-rule="evenodd" />
                                    </svg>

                                    <!-- Pending Icon (Circle/Question) -->
                                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- Actions Grid -->
                        <div class="grid grid-cols-3 gap-3 pt-2">
                            <button @click.stop="navigateToProfile(e.studentId)"
                                class="flex flex-col items-center justify-center gap-1 p-3 rounded-2xl bg-gray-50 text-gray-400 border border-gray-100 active:scale-95 transition-all">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                </svg>
                                <span class="text-[10px] font-bold">{{ $t('common.profile') }}</span>
                            </button>

                            <button @click.stop="navigateToReports(e.id!)"
                                class="flex flex-col items-center justify-center gap-1 p-3 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 active:scale-95 transition-all">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <span class="text-[10px] font-bold">{{ $t('common.reports') }}</span>
                            </button>

                            <button @click.stop="toggleSplitView(e.id!)"
                                class="flex flex-col items-center justify-center gap-1 p-3 rounded-2xl border active:scale-95 transition-all"
                                :class="selectedEnrollmentId === e.id && showSplitView ? 'bg-blue-600 text-white shadow-blue-200' : 'bg-white text-blue-600 border-blue-100 bg-blue-50'">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                                <span class="text-[10px] font-bold">{{ $t('common.edit') }}</span>
                            </button>
                        </div>
                    </div>

                    <!-- Empty State Mobile -->
                    <div v-if="visibleEnrollments.length === 0"
                        class="flex flex-col items-center justify-center py-12 text-gray-300">
                        <span class="font-black italic tracking-widest">No students enrolled</span>
                    </div>
                </div>

                <!-- Desktop Table List (Hidden on Mobile) -->
                <div class="hidden md:block bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-gray-50/50">
                                <th class="px-4 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center"
                                    v-if="todayOccurrence">{{ $t('attendance.status') }}</th>
                                <th class="px-4 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                    $t('classroom.student_name') }}</th>
                                <th class="px-4 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                    $t('classroom.enrollment_status') }}</th>
                                <th
                                    class="px-4 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">
                                    {{ $t('classroom.actions') }}</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-50">
                            <tr v-for="e in visibleEnrollments" :key="e.id"
                                class="hover:bg-emerald-50/20 transition-colors group">
                                <!-- Attendance Column -->
                                <td class="px-4 py-6 text-center" v-if="todayOccurrence">
                                    <button type="button" @click="toggleAttendance(e.id!)"
                                        class="p-2 rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 flex items-center justify-center mx-auto"
                                        :class="{
                                            'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 focus:ring-emerald-500': reportMap.get(e.id!)?.attendanceStatus === 'present',
                                            'bg-red-100 text-red-800 hover:bg-red-200 focus:ring-red-500': reportMap.get(e.id!)?.attendanceStatus === 'absent',
                                            'bg-gray-100 text-gray-400 hover:bg-gray-200 focus:ring-gray-300': !reportMap.get(e.id!)?.attendanceStatus || reportMap.get(e.id!)?.attendanceStatus === 'pending'
                                        }"
                                        :title="$t('attendance.status') + ': ' + (reportMap.get(e.id!)?.attendanceStatus ? $t('attendance.' + reportMap.get(e.id!)?.attendanceStatus) : $t('attendance.pending'))"
                                        :disabled="savingMap.has(e.id!)">
                                        <!-- Present Icon (Check) -->
                                        <svg v-if="reportMap.get(e.id!)?.attendanceStatus === 'present'"
                                            xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20"
                                            fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                clip-rule="evenodd" />
                                        </svg>

                                        <!-- Absent Icon (X) -->
                                        <svg v-else-if="reportMap.get(e.id!)?.attendanceStatus === 'absent'"
                                            xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20"
                                            fill="currentColor">
                                            <path fill-rule="evenodd"
                                                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                                                clip-rule="evenodd" />
                                        </svg>

                                        <!-- Pending Icon (Circle/Question) -->
                                        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </button>
                                </td>

                                <td class="px-4 py-6">
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
                                <td class="px-4 py-6">
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
                                <td class="px-4 py-6 text-right">
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
                            <tr v-if="visibleEnrollments.length === 0">
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
                            <!-- Mobile Back Button -->
                            <button @click="showSplitView = false"
                                class="lg:hidden p-2 -ml-2 text-gray-400 hover:text-gray-600 rounded-full">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                                    stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M15 19l-7-7 7-7" />
                                </svg>
                            </button>
                            <div
                                class="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center font-black">
                                {{enrollments.find(e => e.id === selectedEnrollmentId)?.studentName?.charAt(0)}}
                            </div>
                            <div>
                                <h3 class="font-black text-gray-900">{{enrollments.find(e => e.id ===
                                    selectedEnrollmentId)?.studentName}}</h3>
                                <p class="text-xs font-bold text-gray-400">
                                    {{ todayOccurrence?.occurrenceDate ? new
                                        Date(todayOccurrence?.occurrenceDate).toLocaleDateString() : 'Today' }}
                                    <span v-if="todayOccurrence?.effectiveStartTime" class="ml-1 text-emerald-600">
                                        {{ todayOccurrence.effectiveStartTime.slice(0, 5) }}
                                    </span>
                                </p>
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
                        :initial-version="reportMap.get(selectedEnrollmentId)?.version"
                        :loading="savingMap.get(selectedEnrollmentId!)" :show-manual-save="true"
                        :title="todayOccurrence ? `${new Date(todayOccurrence.occurrenceDate).toLocaleDateString()} ${todayOccurrence.effectiveStartTime?.slice(0, 5) || ''}` : undefined"
                        :course-name="enrollments.find(e => e.id === selectedEnrollmentId)?.courseSubject + ' ' + enrollments.find(e => e.id === selectedEnrollmentId)?.courseStage"
                        :course-display-name="enrollments.find(e => e.id === selectedEnrollmentId)?.courseDisplayName"
                        :initial-student-id="enrollments.find(e => e.id === selectedEnrollmentId)?.studentId"
                        :initial-lesson-id="reportMap.get(selectedEnrollmentId)?.lessonId"
                        :available-lessons="courseLessons"
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
                        :initial-content="reportMap.get(selectedEnrollmentId)?.content"
                        :initial-enrollment-external-link="enrollments.find(e => e.id === selectedEnrollmentId)?.externalLink"
                        @update:content="handleEditorUpdate($event, selectedEnrollmentId!)"
                        @update:report-external-link="handleReportExternalLinkUpdate($event, selectedEnrollmentId!)"
                        @save-success="handleSaveSuccess($event, selectedEnrollmentId!)" @save-error="handleSaveError"
                        @conflict="handleConflict" class="h-full border-none shadow-none rounded-none" />

                    <div v-else class="flex flex-col items-center justify-center py-20 text-gray-400">
                        <p class="font-bold">{{ $t('report.no_report_today') }}</p>
                        <p class="text-xs mt-1">{{ $t('report.is_student_active_hint') }}</p>
                    </div>
                </div>
            </div>
        </div>

        <!-- Conflict Resolution Modal -->
        <ConflictModal v-if="showConflictModal" :is-open="showConflictModal" :serverVersion="conflictServerVersion"
            :localVersion="conflictLocalVersion" :server-report="conflictServerReport!"
            :local-report="conflictLocalReport!" :available-lessons="courseLessons" @close="closeConflictModal"
            @resolve="resolveConflict" />

        <ConfirmModal v-if="showRefreshConfirm" :is-open="showRefreshConfirm" :title="$t('classroom.refresh_schedule')"
            :message="$t('classroom.refresh_confirm')" :confirm-text="$t('common.refresh')" confirm-type="warning"
            @confirm="handleConfirmRefresh" @close="showRefreshConfirm = false" />

    </div>
</template>