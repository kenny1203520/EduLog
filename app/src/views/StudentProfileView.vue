<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useStudentStore } from '@/stores/useStudentStore'
import StudentMainDetails from '@/components/StudentMainDetails.vue'
import StudentContacts from '@/components/StudentContacts.vue'
import StudentSchools from '@/components/StudentSchools.vue'
import StudentEnrollments from '@/components/StudentEnrollments.vue'
import StudentCredentials from '@/components/StudentCredentials.vue'

const route = useRoute()
const studentStore = useStudentStore()

const studentId = computed(() => route.params.id as string)

onMounted(async () => {
    if (studentId.value) {
        await studentStore.loadStudent(studentId.value)
    }
})

async function refreshData() {
    if (studentId.value) {
        await studentStore.loadStudent(studentId.value)
    }
}
</script>

<template>
    <div class="min-h-screen bg-white">
        <!-- Minimal Navigation Bar -->
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between border-b border-gray-50">
            <button @click="$router.push('/dashboard')"
                class="inline-flex items-center gap-2 text-gray-500 hover:text-gray-900 font-bold transition-colors cursor-pointer group">
                <div class="p-1.5 bg-gray-50 rounded-lg group-hover:bg-gray-100 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5"
                        stroke="currentColor" class="w-4 h-4">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                    </svg>
                </div>
                <span class="text-sm tracking-tight uppercase">{{ $t('common.back_to_dashboard') }}</span>
            </button>

            <button @click="refreshData" :disabled="studentStore.loading"
                class="p-2 text-gray-400 hover:text-emerald-600 rounded-lg hover:bg-emerald-50 transition-all cursor-pointer">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2"
                    stroke="currentColor" class="w-5 h-5" :class="{ 'animate-spin': studentStore.loading }">
                    <path stroke-linecap="round" stroke-linejoin="round"
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
            </button>
        </div>

        <!-- Centered Profile Hero Section -->
        <div v-if="studentStore.currentStudent && !studentStore.loading"
            class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-12 text-center animate-in fade-in slide-in-from-top-4 duration-1000">
            <h1 class="text-5xl font-black text-gray-900 tracking-tight mb-4">
                {{ studentStore.currentStudent.name }}
            </h1>
            <div class="flex items-center justify-center gap-3 text-gray-500 font-bold uppercase tracking-widest text-sm">
                <span>{{ studentStore.currentStudent.displayGrade || $t('student.management.no_grade') }}</span>
                <span class="text-gray-300">•</span>
                <span class="font-mono text-gray-400 tracking-tight">{{ studentStore.currentStudent.id }}</span>
            </div>
            <hr class="mt-12 border-gray-900 border-[0.5px]">
        </div>

        <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
            <Transition name="fade" mode="out-in">
                <div v-if="studentStore.loading" class="flex flex-col items-center justify-center py-32 space-y-4">
                    <div class="relative w-16 h-16">
                        <div class="absolute inset-0 border-4 border-emerald-100 rounded-full"></div>
                        <div
                            class="absolute inset-0 border-4 border-emerald-600 rounded-full border-t-transparent animate-spin">
                        </div>
                    </div>
                    <p class="text-sm font-bold text-gray-400 uppercase tracking-widest animate-pulse">{{
                        $t('common.loading') }}</p>
                </div>

                <div v-else-if="studentStore.currentStudent"
                    class="animate-in fade-in slide-in-from-bottom-4 duration-700">
                    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        <!-- Left Column: Main Details & Enrollments -->
                        <div class="lg:col-span-8 space-y-8">
                            <StudentMainDetails :student-id="studentId" />
                            <StudentEnrollments :student-id="studentId"
                                :enrollments="studentStore.currentStudent.enrollments || []" />
                        </div>

                        <!-- Right Column: Contacts, Schools, Credentials -->
                        <div class="lg:col-span-4 space-y-8">
                            <StudentContacts :student-id="studentId"
                                :contacts="studentStore.currentStudent.contacts || []" />
                            <StudentSchools :student-id="studentId"
                                :schools="studentStore.currentStudent.schools || []" />
                            <StudentCredentials :student-id="studentId"
                                :credentials="studentStore.currentStudent.credentials || []" />
                        </div>
                    </div>
                </div>

                <div v-else class="text-center py-32 bg-white rounded-[2.5rem] border border-dashed border-gray-200">
                    <div class="inline-flex p-6 bg-gray-50 rounded-full text-gray-400 mb-6">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5"
                            stroke="currentColor" class="w-12 h-12">
                            <path stroke-linecap="round" stroke-linejoin="round"
                                d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                        </svg>
                    </div>
                    <h3 class="text-xl font-bold text-gray-900 mb-2">{{ $t('student.not_found') }}</h3>
                    <p class="text-gray-500 mb-8">{{ $t('student.not_found_subtitle') }}</p>
                    <button @click="$router.push('/dashboard')"
                        class="px-8 py-3 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-95 shadow-xl shadow-gray-200">
                        {{ $t('common.back_to_dashboard') }}
                    </button>
                </div>
            </Transition>
        </main>
    </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
    transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

/* Custom scrollbar for better look */
.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e5e7eb;
    border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #d1d5db;
}
</style>
