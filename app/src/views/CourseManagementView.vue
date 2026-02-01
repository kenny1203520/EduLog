<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue' // Added watch
import { CourseService } from '@/services/CourseService'
import { Course, Lesson, type CourseDTO } from '@/models/Course'
import { useI18n } from 'vue-i18n'
import Pagination from '@/components/common/Pagination.vue'

const { t } = useI18n()
const courses = ref<Course[]>([])
const loading = ref(true)
const iscreateModalOpen = ref(false)
const editingCourse = ref<Course | null>(null)

// Form for new/edit course
const courseForm = ref<Partial<CourseDTO>>({
  subject: '',
  stage: '',
  display_name: '',
  description: ''
})

const pagination = ref({ page: 1, perPage: 12, total: 0 })

// ... (existing form and state)

// Expanded state for courses to show lessons
const expandedCourseIds = ref<Set<string>>(new Set())

const toggleExpand = (id: string) => {
  if (expandedCourseIds.value.has(id)) {
    expandedCourseIds.value.delete(id)
  } else {
    expandedCourseIds.value.add(id)
  }
}

const groupedCourses = computed(() => {
  const groups: Record<string, Course[]> = {}
  courses.value.forEach(c => {
    if (!groups[c.subject]) {
      groups[c.subject] = []
    }
    groups[c.subject]!.push(c)
  })
  return groups
})

onMounted(async () => {
  await fetchCourses()
})

async function fetchCourses() {
  try {
    loading.value = true
    const res = await CourseService.getCourses(pagination.value.page, pagination.value.perPage)
    courses.value = res.data
    pagination.value.total = res.count
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

watch(() => pagination.value.page, fetchCourses)
watch(() => pagination.value.perPage, () => { pagination.value.page = 1; fetchCourses() })

// ... (rest of functions)

function openCreateModal() {
  courseForm.value = { subject: '', stage: '', display_name: '', description: '' }
  editingCourse.value = null
  iscreateModalOpen.value = true
}

function openEditModal(course: Course) {
  editingCourse.value = course
  courseForm.value = {
    subject: course.subject,
    stage: course.stage,
    display_name: course.displayNameValue,
    description: course.description
  }
  iscreateModalOpen.value = true
}

async function saveCourse() {
  try {
    if (editingCourse.value && editingCourse.value.id) {
      // Update
      await CourseService.updateCourse(editingCourse.value.id, courseForm.value)
    } else {
      // Create
      await CourseService.createCourse(courseForm.value)
    }
    await fetchCourses()
    iscreateModalOpen.value = false
  } catch (e) {
    alert('Error saving course: ' + e)
  }
}

// Lesson Management
const editingLessonId = ref<string | null>(null)
const lessonForm = ref({
    title: '',
    sequence: 1
})
const addingLessonToCourseId = ref<string | null>(null)

function startAddLesson(course: Course) {
  addingLessonToCourseId.value = course.id!
  lessonForm.value = {
      title: '',
      sequence: course.lessons.length + 1
  }
}

function editLesson(lesson: Lesson) {
    editingLessonId.value = lesson.id!
    lessonForm.value = {
        title: lesson.title,
        sequence: lesson.sequence
    }
}

async function saveLesson(courseId: string) {
  if (!lessonForm.value.title.trim()) return
  
  try {
    if (editingLessonId.value) {
        // Update
        await CourseService.updateLesson(editingLessonId.value, {
            title: lessonForm.value.title,
            sequence: lessonForm.value.sequence
        })
        editingLessonId.value = null
    } else {
        // Create
        await CourseService.createLesson({
            course_id: courseId,
            title: lessonForm.value.title,
            sequence: lessonForm.value.sequence
        })
        addingLessonToCourseId.value = null
    }
    
    await fetchCourses()
  } catch (e) {
    console.error(e)
    alert('Error saving lesson: ' + e)
  }
}

function cancelLessonEdit() {
    editingLessonId.value = null
    addingLessonToCourseId.value = null
}

async function deleteCourse(id: string) {
    if(!confirm(t('common.confirm_delete'))) return
    try {
        await CourseService.deleteCourse(id)
        await fetchCourses()
    } catch (e) {
        alert(e)
    }
}

async function deleteLesson(id: string) {
    if(!confirm(t('common.confirm_delete'))) return
    try {
        await CourseService.deleteLesson(id)
        await fetchCourses()
    } catch (e) {
        alert(e)
    }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-800">{{ $t('nav.courses') }}</h1>
      <button 
        @click="openCreateModal"
        class="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition flex items-center gap-2"
      >
        <span>+</span> {{ $t('common.add') }}
      </button>
    </div>

    <div v-if="loading" class="text-center text-gray-500 py-10">
        <svg class="animate-spin h-8 w-8 mx-auto mb-3 text-emerald-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        {{ $t('student.loading') }}
    </div>

    <div v-else class="space-y-8">
      <div v-for="(group, subject) in groupedCourses" :key="subject">
        <h2 class="text-xl font-bold text-gray-700 mb-4 border-l-4 border-emerald-500 pl-3">{{ subject }}</h2>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div 
            v-for="course in group" 
            :key="course.id" 
            class="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition overflow-hidden"
          >
            <!-- Card Header -->
            <div class="p-5 border-b border-gray-100 bg-gray-50 flex justify-between items-start">
                <div class="flex-1 min-w-0" @click="openEditModal(course)">
                    <h3 class="font-bold text-lg text-gray-800 truncate" :title="course.displayName">
                        {{ course.displayName }}
                    </h3>
                    <p v-if="course.displayNameValue" class="text-xs text-gray-400 font-mono truncate">
                        {{ course.subject }} {{ course.stage }}
                    </p>
                    <p class="text-sm text-gray-500 mt-1 line-clamp-2 italic">{{ course.description || $t('common.no_description', 'No description') }}</p>
                </div>
                <button @click="deleteCourse(course.id!)" class="text-gray-400 hover:text-red-500 transition ml-2 flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                    </svg>
                </button>
            </div>

            <!-- Lessons List -->
            <div class="p-4 bg-white">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider">{{ $t('course.lessons_count', { count: course.lessons.length }) }}</span>
                    <button 
                        @click="toggleExpand(course.id!)" 
                        class="text-emerald-600 text-sm font-medium hover:text-emerald-700 transition"
                    >
                        {{ expandedCourseIds.has(course.id!) ? $t('course.hide_lessons') : $t('course.show_lessons') }}
                    </button>
                </div>

                <div v-if="expandedCourseIds.has(course.id!)" class="space-y-2 mt-3">
                    <ul class="space-y-1">
                        <li v-for="lesson in course.lessons" :key="lesson.id" class="flex items-center justify-between group p-2 rounded hover:bg-gray-50 text-sm">
                            <!-- Helper: Is Editing? -->
                            <div v-if="editingLessonId === lesson.id" class="flex-1 flex gap-2 items-center">
                                <input v-model.number="lessonForm.sequence" type="number" class="w-12 text-center border-gray-300 rounded focus:ring-emerald-500 py-1 text-xs">
                                <input v-model="lessonForm.title" class="flex-1 border-gray-300 rounded focus:ring-emerald-500 py-1 text-xs" @keyup.enter="saveLesson(course.id!)">
                                <button @click="saveLesson(course.id!)" class="text-emerald-600 font-bold text-xs">{{ $t('common.save') }}</button>
                                <button @click="cancelLessonEdit" class="text-gray-400 text-xs">{{ $t('common.cancel') }}</button>
                            </div>

                            <!-- Display Mode -->
                            <div v-else class="flex-1 flex items-center justify-between">
                                <span class="text-gray-700 font-medium">
                                    <span class="text-gray-400 mr-2">#{{ lesson.sequence }}</span>
                                    {{ lesson.title }}
                                </span>
                                <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition">
                                    <button @click="editLesson(lesson)" class="text-blue-500 hover:text-blue-700 text-xs">
                                        {{ $t('common.edit') }}
                                    </button>
                                    <button @click="deleteLesson(lesson.id!)" class="text-gray-300 hover:text-red-500">
                                        &times;
                                    </button>
                                </div>
                            </div>
                        </li>
                    </ul>

                    <!-- Add Lesson Input -->
                    <div class="mt-3 pt-2 border-t border-gray-100">
                        <div v-if="addingLessonToCourseId === course.id" class="flex gap-2 items-center">
                            <input 
                                v-model.number="lessonForm.sequence" 
                                type="number" 
                                class="w-12 text-center border-gray-300 rounded focus:ring-emerald-500 py-1 text-xs"
                                placeholder="#"
                            >
                            <input 
                                v-model="lessonForm.title" 
                                :placeholder="$t('course.lesson_title')" 
                                class="flex-1 text-sm border-gray-300 rounded focus:ring-emerald-500 focus:border-emerald-500 py-1"
                                @keyup.enter="saveLesson(course.id!)"
                            >
                            <button @click="saveLesson(course.id!)" class="text-emerald-600 font-bold text-sm">{{ $t('common.save') }}</button>
                            <button @click="cancelLessonEdit" class="text-gray-400 text-sm">{{ $t('common.cancel') }}</button>
                        </div>
                        <button 
                            v-else 
                            @click="startAddLesson(course)"
                            class="w-full py-1.5 text-xs font-medium text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-emerald-500 hover:text-emerald-600 transition text-center bg-gray-50/50"
                        >
                            + {{ $t('course.add_lesson') }}
                        </button>
                    </div>
                </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Empty State -->
      <div v-if="Object.keys(groupedCourses).length === 0" class="text-center py-20 bg-white rounded-2xl border border-dashed border-gray-300 shadow-sm flex flex-col items-center">
        <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
        </div>
        <p class="text-gray-500 font-medium pb-2 text-lg">{{ $t('course.no_courses') }}</p>
      </div>

      <div v-if="pagination.total > 0" class="mt-8">
        <Pagination 
            v-model="pagination.page" 
            v-model:perPage="pagination.perPage" 
            :totalItems="pagination.total" 
        />
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <div v-if="iscreateModalOpen" class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div class="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in duration-200">
            <h3 class="text-xl font-bold mb-6 text-gray-800">{{ editingCourse ? $t('course.edit_course') : $t('course.add_course') }}</h3>
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('course.subject') }}</label>
                    <input v-model="courseForm.subject" placeholder="e.g. 菁英, 程式, 數學" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('course.stage') }}</label>
                    <input v-model="courseForm.stage" placeholder="e.g. Level 1, Advanced" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1.5">
                      {{ $t('course.display_name') }}
                      <span class="text-xs text-gray-400 block font-normal mt-0.5">{{ $t('course.display_name_hint') }}</span>
                    </label>
                    <input v-model="courseForm.display_name" placeholder="e.g. Python 程式進階班" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('course.description') }}</label>
                    <textarea v-model="courseForm.description" rows="3" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500"></textarea>
                </div>
            </div>
            <div class="flex justify-end gap-3 mt-8 pt-4 border-t border-gray-50">
                <button @click="iscreateModalOpen = false" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">{{ $t('common.cancel') }}</button>
                <button @click="saveCourse" class="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm font-bold transition-all">
                    {{ editingCourse ? $t('course.save_changes') : $t('common.add') }}
                </button>
            </div>
        </div>
    </div>

  </div>
</template>
