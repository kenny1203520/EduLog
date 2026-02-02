<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CourseService } from '@/services/CourseService'
import { OccurrenceService } from '@/services/OccurrenceService'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import type { Enrollment } from '@/models/Enrollment'
import RatingInput from '@/components/common/RatingInput.vue'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string
const todayOccurrence = ref<any>(null)
const reportMap = ref<Map<string, any>>(new Map()) // enrollmentId -> report
const savingMap = ref<Map<string, boolean>>(new Map()) // enrollmentId -> isSaving

const session = ref<any>(null)
const enrollments = ref<Enrollment[]>([])
const loading = ref(true)

onMounted(async () => {
    try {
        loading.value = true
        // 1. Get session details
        session.value = await CourseService.getSessionDetails(sessionId)
        
        // 2. Get all students enrolled in this session
        const { data: allEnrollments } = await CourseService.getEnrollmentsBySession(sessionId)
        enrollments.value = allEnrollments

        // 3. Find or Create Today's Occurrence
        const today = new Date()
        
        // Check if session runs today (day_of_week)
        if (session.value.day_of_week === today.getDay()) {
            const occurrences = await OccurrenceService.getOccurrencesByDateRange(today, today, [sessionId])
            if (occurrences.length > 0) {
                todayOccurrence.value = occurrences[0]
            } else {
                // Generate today's occurrence if it doesn't exist but is scheduled for today
                const generated = await OccurrenceService.generateOccurrences(sessionId, today, today)
                if (generated.length > 0) todayOccurrence.value = generated[0]
            }

            if (todayOccurrence.value) {
                // 4. Load/Create Reports for all enrollments for today
                for (const enr of enrollments.value) {
                    if (enr.id) {
                        // Only generate/fetch reports for active students
                        if (enr.status === 'active') {
                            const report = await OccurrenceReportService.getOrCreateReport(enr.id, todayOccurrence.value.id)
                            reportMap.value.set(enr.id, report)
                        } else {
                            // Valid logic: Should we load EXISTING reports for completed students?
                            // getOrCreateReport will CREATE if missing.
                            // If we want to view *past* reports, we usually look at past occurrences.
                            // This is *today's* occurrence. A completed student shouldn't have a report for today.
                            // So skipping is correct.
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
                absenceReason: isPresent ? undefined : '未告知原因'
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

async function updateRating(enrId: string, field: 'participation' | 'behavior', value: number) {
    const report = reportMap.value.get(enrId)
    if (!report) return

    savingMap.value.set(enrId, true)
    try {
        await OccurrenceReportService.saveReport(
            report.id,
            report.content || '',
            report.version,
            undefined,
            {
                [field === 'participation' ? 'classParticipation' : 'classroomBehavior']: value.toString()
            }
        )
        // Refresh local report state
        const updated = await OccurrenceReportService.getReportById(report.id)
        reportMap.value.set(enrId, updated)
    } catch (e) {
        console.error(`Failed to update ${field} rating:`, e)
    } finally {
        savingMap.value.delete(enrId)
    }
}
</script>

<template>
<div class="space-y-8 animate-in fade-in duration-500">
    <!-- Header -->
    <div class="flex items-center gap-4">
        <button 
            @click="router.back()" 
            class="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 hover:border-emerald-100 transition-all shadow-sm active:scale-90"
        >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" />
            </svg>
        </button>
        <div>
            <h1 class="text-3xl font-black text-gray-900 tracking-tight" v-if="session">{{ session.name }}</h1>
            <div class="flex items-center gap-3 mt-1 text-sm font-bold text-gray-400" v-if="session">
                <span class="flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    {{ session.classroom_name }}
                </span>
                <span class="w-1 h-1 bg-gray-300 rounded-full"></span>
                <span class="flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {{ session.start_time.slice(0,5) }} - {{ session.end_time.slice(0,5) }}
                </span>
            </div>
        </div>
    </div>

    <div v-if="loading" class="flex flex-col items-center justify-center py-32 bg-white rounded-3xl border border-gray-100 shadow-sm">
        <svg class="animate-spin h-10 w-10 text-emerald-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span class="text-gray-500 font-black italic tracking-widest">{{ $t('student.loading') }}</span>
    </div>

    <div v-else class="space-y-6">
        <!-- Stats Bar -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-emerald-100 flex items-center justify-between">
                <div>
                    <h4 class="text-[10px] font-black uppercase tracking-[0.2em] opacity-80 mb-2">{{ $t('classroom.total_students') }}</h4>
                    <p class="text-5xl font-black tracking-tighter">{{ enrollments.length }}</p>
                </div>
                <div class="bg-white/20 p-4 rounded-3xl">
                     <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                     </svg>
                </div>
            </div>
            <div class="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm col-span-2 flex items-center gap-12">
                 <div>
                    <h4 class="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">{{ $t('classroom.capacity_utilization') }}</h4>
                    <div class="flex items-end gap-3">
                        <p class="text-4xl font-black text-gray-900 tracking-tighter">{{ Math.round((enrollments.length / (session?.capacity || 1)) * 100) }}%</p>
                        <p class="text-sm font-bold text-gray-400 pb-1">/ {{ session?.capacity }} {{ $t('classroom.capacity') }}</p>
                    </div>
                 </div>
                 <div class="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div class="h-full bg-emerald-500 rounded-full transition-all duration-1000" :style="{ width: `${(enrollments.length / (session?.capacity || 1)) * 100}%` }"></div>
                 </div>
            </div>
        </div>

        <!-- Student List Table -->
        <div class="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr class="bg-gray-50/50">
                        <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center" v-if="todayOccurrence">{{ $t('classroom.attendance') }}</th>
                        <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ $t('classroom.student_name') }}</th>
                        <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ $t('classroom.enrollment_status') }}</th>
                        <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center" v-if="todayOccurrence">{{ $t('classroom.participation') }}</th>
                        <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center" v-if="todayOccurrence">{{ $t('classroom.behavior') }}</th>
                        <th class="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">{{ $t('classroom.actions') }}</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-50">
                    <tr v-for="e in enrollments" :key="e.id" class="hover:bg-emerald-50/20 transition-colors group">
                        <!-- Attendance Column -->
                        <td class="px-8 py-6 text-center" v-if="todayOccurrence">
                            <input 
                                type="checkbox" 
                                :checked="reportMap.get(e.id!)?.attendanceStatus === 'present'"
                                :disabled="savingMap.has(e.id!)"
                                @change="toggleAttendance(e.id!, $event)"
                                class="w-6 h-6 rounded-lg border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:opacity-50"
                            >
                        </td>

                        <td class="px-8 py-6">
                            <div class="flex items-center gap-4">
                                <div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-black text-xl">
                                    {{ e.studentName?.charAt(0) }}
                                </div>
                                <div>
                                    <div class="font-black text-gray-900 text-lg">{{ e.studentName }}</div>
                                    <div class="text-xs font-bold text-gray-400">{{ e.studentEmail || $t('classroom.no_email') }}</div>
                                </div>
                            </div>
                        </td>
                        <td class="px-8 py-6">
                            <span 
                                class="px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest border"
                                :class="e.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-gray-50 text-gray-400 border-gray-200'"
                            >
                                {{ $t('student.internal_courses.status_' + e.status) }}
                            </span>
                        </td>

                        <!-- Participation Rating -->
                        <td class="px-8 py-6 flex justify-center" v-if="todayOccurrence">
                            <RatingInput 
                                :model-value="parseFloat(reportMap.get(e.id!)?.classParticipation || '0')"
                                :show-value="false"
                                @update:model-value="updateRating(e.id!, 'participation', $event)"
                                class="scale-90"
                            />
                        </td>

                        <!-- Behavior Rating -->
                        <td class="px-8 py-6 flex justify-center" v-if="todayOccurrence">
                            <RatingInput 
                                :model-value="parseFloat(reportMap.get(e.id!)?.classroomBehavior || '0')"
                                :show-value="false"
                                @update:model-value="updateRating(e.id!, 'behavior', $event)"
                                class="scale-90"
                            />
                        </td>
                        <td class="px-8 py-6 text-right">
                            <div class="flex justify-end gap-2">
                                <button 
                                    @click="navigateToProfile(e.studentId)"
                                    class="p-3 rounded-2xl bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 border border-gray-100 hover:border-emerald-100 transition-all active:scale-90"
                                    :title="$t('classroom.view_profile')"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                </button>
                                <button 
                                    @click="navigateToReports(e.id!)"
                                    class="p-3 rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-90"
                                    :title="$t('classroom.view_reports')"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="enrollments.length === 0">
                        <td colspan="3" class="px-8 py-20 text-center font-black italic text-gray-300 tracking-widest">
                            No students enrolled yet.
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</div>
</template>
