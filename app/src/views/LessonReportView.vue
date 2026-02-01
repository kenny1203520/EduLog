<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { CourseService } from '@/services/CourseService'
import { Course } from '@/models/Course'
import { Enrollment } from '@/models/Enrollment'

// Simple debounce
const debounce = (fn: Function, ms = 1000) => {
  let timeoutId: ReturnType<typeof setTimeout>
  return function (this: any, ...args: any[]) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => fn.apply(this, args), ms)
  }
}

const route = useRoute()
const enrollmentId = route.params.enrollmentId as string

const loading = ref(true)
const currentEnrollment = ref<Enrollment | null>(null)
const course = ref<Course | null>(null)
const selectedLessonId = ref<string | null>(null)
const reportContent = ref('')
const reportVersion = ref(0)
const isSaving = ref(false)
const lastSavedContent = ref('')

const lessons = computed(() => course.value?.lessons || [])

onMounted(async () => {
  await loadData()
})

async function loadData() {
    try {
        loading.value = true
        currentEnrollment.value = await CourseService.getEnrollmentById(enrollmentId)
        if (!currentEnrollment.value) throw new Error('Enrollment not found')
        
        // 2. Fetch Course & Lessons
        const allCourses = await CourseService.getCourses()
        const cId = currentEnrollment.value.courseId
        if (!cId) throw new Error('Course ID missing')
        
        course.value = allCourses.find(c => c.id === cId) || null
        
        if (course.value && course.value.lessons.length > 0) {
            selectLesson(course.value.lessons[0].id!)
        }
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
}

async function selectLesson(lessonId: string) {
    if (selectedLessonId.value === lessonId) return
    
    // Save previous if dirty? auto-save handles it.
    
    selectedLessonId.value = lessonId
    reportContent.value = ''
    reportVersion.value = 0
    lastSavedContent.value = ''
    
    // Fetch Report
    try {
        const report = await CourseService.getLessonReport(enrollmentId, lessonId)
        if (report) {
            reportContent.value = report.content
            lastSavedContent.value = report.content
            reportVersion.value = report.version
        }
    } catch (e) {
        console.error(e)
    }
}

const saveReport = debounce(async () => {
    if (!selectedLessonId.value || reportContent.value === lastSavedContent.value) return
    
    isSaving.value = true
    try {
        const data = await CourseService.upsertLessonReport({
            enrollment_id: enrollmentId,
            lesson_id: selectedLessonId.value,
            content: reportContent.value,
            version: reportVersion.value + 1 // Increment version
        })
        lastSavedContent.value = data.content
        reportVersion.value = data.version
    } catch (e) {
        console.error('Auto-save failed', e)
    } finally {
        isSaving.value = false
    }
}, 2000)

watch(reportContent, () => {
    if (reportContent.value !== lastSavedContent.value) {
        saveReport()
    }
})

</script>

<template>
<div class="h-[calc(100vh-6rem)] flex flex-col">
    <div v-if="loading" class="flex-1 flex justify-center items-center">
        Loading...
    </div>
    
    <div v-else class="flex flex-1 overflow-hidden bg-white rounded-xl shadow-sm border border-gray-200">
        <!-- Sidebar: Lessons -->
        <aside class="w-64 border-r border-gray-200 overflow-y-auto bg-gray-50 flex flex-col">
            <div class="p-4 border-b border-gray-200 bg-white sticky top-0 z-10">
                <h2 class="font-bold text-gray-800">{{ currentEnrollment?.courseSubject }}</h2>
                <div class="text-xs text-gray-500">{{ currentEnrollment?.courseStage }}</div>
                <div v-if="currentEnrollment?.classroomName" class="mt-1 inline-block px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">
                    {{ currentEnrollment?.classroomName }}
                </div>
            </div>
            
            <nav class="flex-1 p-2 space-y-1">
                <button 
                    v-for="lesson in lessons" 
                    :key="lesson.id"
                    @click="selectLesson(lesson.id!)"
                    class="w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-between group"
                    :class="selectedLessonId === lesson.id ? 'bg-emerald-50 text-emerald-700 font-medium ring-1 ring-emerald-200' : 'text-gray-600 hover:bg-white hover:shadow-sm'"
                >
                    <span class="truncate">
                        <span class="text-gray-400 mr-2 opacity-70">#{{ lesson.sequence }}</span>
                        {{ lesson.title }}
                    </span>
                    <!-- Indicator if has content? (Future feature) -->
                </button>
            </nav>
        </aside>
        
        <!-- Main: Editor -->
        <main class="flex-1 flex flex-col bg-white min-w-0">
            <header class="h-14 border-b border-gray-100 flex items-center justify-between px-6 bg-white shrink-0">
                <div class="flex items-center gap-3">
                    <span v-if="isSaving" class="text-xs text-emerald-600 flex items-center gap-1 animate-pulse">
                        <svg class="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Saving...
                    </span>
                    <span v-else-if="reportContent && reportContent === lastSavedContent" class="text-xs text-gray-400 flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                        </svg>
                        Saved
                    </span>
                    <span v-if="reportVersion > 1" class="text-[10px] text-gray-300 border border-gray-100 px-1.5 rounded">v{{ reportVersion }}</span>
                </div>
            </header>
            
            <div class="flex-1 p-6 overflow-y-auto">
                 <div v-if="!selectedLessonId" class="h-full flex flex-col items-center justify-center text-gray-400">
                    <p>Select a lesson to start writing.</p>
                 </div>
                 <div v-else class="max-w-3xl mx-auto h-full flex flex-col">
                    <h1 class="text-2xl font-bold text-gray-800 mb-6">{{ lessons.find(l => l.id === selectedLessonId)?.title }}</h1>
                    
                    <textarea 
                        v-model="reportContent"
                        class="flex-1 w-full p-4 border-0 focus:ring-0 text-gray-700 text-lg leading-relaxed placeholder-gray-300 resize-none outline-none"
                        placeholder="Write your lesson report here..."
                    ></textarea>
                 </div>
            </div>
        </main>
    </div>
</div>
</template>
