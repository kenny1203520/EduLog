<template>
    <div class="student-all-reports-view p-6 max-w-7xl mx-auto">
        <!-- Header -->
        <div class="mb-6">
            <button @click="router.back()"
                class="mb-4 text-gray-600 hover:text-emerald-600 font-medium flex items-center gap-2 transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
                {{ $t('common.back') }}
            </button>
            <h1 class="text-3xl font-black text-gray-900 tracking-tight">{{ student?.name }} - {{
                $t('report.list_title') }}</h1>
            <p class="text-gray-500 mt-1">{{ $t('report.select_course_to_view') }}</p>
        </div>

        <!-- Loading State -->
        <div v-if="loading"
            class="flex flex-col items-center justify-center py-20 text-gray-500 bg-white rounded-2xl shadow-sm border border-gray-100">
            <svg class="animate-spin h-10 w-10 mb-4 text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <p class="font-medium">{{ $t('report.loading_full') }}</p>
        </div>

        <!-- Enrollment List -->
        <div v-else class="space-y-4">
            <div v-if="enrollments.length === 0"
                class="text-center py-20 bg-gray-50 rounded-3xl border border-dashed border-gray-200">
                <div
                    class="w-20 h-20 bg-white rounded-full flex items-center justify-center mb-6 shadow-sm ring-1 ring-gray-100 mx-auto">
                    <svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                </div>
                <h3 class="text-xl font-bold text-gray-800 mb-2">{{ $t('student.internal_courses.no_enrollments') }}
                </h3>
                <p class="text-gray-500">{{ $t('student.internal_courses.add_enrollment_hint') }}</p>
            </div>

            <!-- Enrollment Cards -->
            <router-link v-for="enrollment in enrollments" :key="enrollment.id"
                :to="{ name: 'lesson-reports', params: { enrollmentId: enrollment.id! } }"
                class="block bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-xl hover:border-emerald-300 transition-all cursor-pointer group">
                <div class="flex items-start justify-between">
                    <div class="flex-1">
                        <h3 class="text-xl font-bold text-gray-900 group-hover:text-emerald-700 transition mb-2">
                            {{ enrollment.courseSubject }}<span class="text-gray-500 font-normal">_{{
                                enrollment.courseStage }}</span>
                        </h3>
                        <div class="flex items-center gap-4 text-sm text-gray-600">
                            <span v-if="enrollment.classroomName"
                                class="px-3 py-1 bg-gray-100 rounded-lg text-gray-700 font-medium">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                                {{ enrollment.classroomName }}
                            </span>
                            <span class="capitalize font-semibold" :class="{
                                'text-emerald-600': enrollment.status === 'regular',
                                'text-amber-600': enrollment.status === 'trial',
                                'text-gray-400': enrollment.status !== 'regular' && enrollment.status !== 'trial'
                            }">
                                {{ $t('student.internal_courses.status_' + enrollment.status) }}
                            </span>
                        </div>
                    </div>
                    <div
                        class="flex items-center gap-2 text-emerald-600 group-hover:translate-x-2 transition-transform">
                        <span class="text-sm font-bold">{{ $t('common.view') }}</span>
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>
            </router-link>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Enrollment } from '@/models/Enrollment'
import { PageApiService } from '@/services/api/PageApiService'

const route = useRoute()
const router = useRouter()

const loading = ref(true)
const student = ref<{ id: string; name: string } | null>(null)
const enrollments = ref<Enrollment[]>([])

onMounted(async () => {
    await loadData()
})

async function loadData() {
    try {
        loading.value = true
        const studentId = route.params.id as string
        if (!studentId) return

        const response = await PageApiService.getStudentReports(studentId, { limit: 100, offset: 0, sort: '-start_date' })
        student.value = response.data.student
        enrollments.value = response.data.enrollments.map(enrollment => new Enrollment(enrollment))
    } catch (error) {
        console.error('Failed to load student data:', error)
    } finally {
        loading.value = false
    }
}

</script>
