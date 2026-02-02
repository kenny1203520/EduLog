<template>
  <div class="report-editor bg-white rounded-lg shadow-sm p-6">
    <!-- Header -->
      <h3 class="text-lg font-semibold text-gray-800">
        {{ title || $t('report.editor.title') }}
      </h3>
      
      <div class="flex items-center gap-4">
        <!-- Templates Dropdown -->
        <div class="relative">
          <button 
            @click="showTemplates = !showTemplates"
            class="text-sm font-medium text-gray-600 hover:text-emerald-600 flex items-center gap-1 focus:outline-none"
            title="Manage Templates"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
            </svg>
            <span>{{ $t('report.editor.templates', 'Templates') }}</span>
          </button>

          <!-- Templates Menu -->
          <div v-if="showTemplates" class="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 z-50 p-4">
            <h4 class="font-bold text-gray-800 mb-3 text-sm flex justify-between items-center">
              {{ $t('report.editor.templates', 'Templates') }}
              <button @click="showTemplates = false" class="text-gray-400 hover:text-gray-600">&times;</button>
            </h4>
            
            <!-- Save New -->
            <div class="flex gap-2 mb-4">
              <input 
                v-model="newTemplateName"
                type="text"
                placeholder="New template name"
                class="flex-1 text-xs px-2 py-1.5 border border-gray-300 rounded focus:ring-1 focus:ring-emerald-500"
                @keyup.enter="saveTemplate"
              />
              <button 
                @click="saveTemplate"
                :disabled="!newTemplateName.trim() || !localContent"
                class="bg-emerald-600 text-white text-xs px-3 py-1.5 rounded hover:bg-emerald-700 disabled:opacity-50"
              >
                Save
              </button>
            </div>

            <!-- List -->
            <div class="max-h-60 overflow-y-auto space-y-2">
              <div v-if="savedTemplates.length === 0" class="text-xs text-gray-500 text-center py-2">
                No templates saved
              </div>
              <div 
                v-for="t in savedTemplates" 
                :key="t.id"
                class="group flex items-center justify-between p-2 hover:bg-gray-50 rounded border border-transparent hover:border-gray-200 transition-colors"
              >
                <button 
                  @click="applyTemplate(t)"
                  class="text-sm text-gray-700 hover:text-emerald-700 text-left truncate flex-1"
                  :title="t.content"
                >
                  {{ t.name }}
                </button>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button 
                    @click.stop="deleteTemplate(t.id)"
                    class="text-gray-400 hover:text-red-500 p-1 rounded"
                    title="Delete"
                  >
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Save Status Indicator -->
        <div class="flex items-center gap-2 text-sm">
        <span v-if="isSaving" class="text-blue-600 flex items-center gap-1">
          <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
          {{ $t('report.saving') }}
        </span>
        <span v-else-if="lastSaved" class="text-gray-500">
          {{ getLastSavedString() }}
        </span>
        <span v-else-if="hasUnsavedChanges" class="text-amber-600">
          {{ $t('report.editor.unsaved_changes') }}
        </span>
        <span v-else class="text-green-600">
          {{ $t('report.editor.all_saved') }}
        </span>
      </div>
    </div>

    <!-- Lesson Selection & Completion  -->
    <div class="grid grid-cols-1">
      <!-- Lesson Selection -->
      <div class="mb-6">
         <div class="flex items-center justify-between mb-2">
            <label class="block text-sm font-medium text-gray-700">
              {{ $t('report.editor.lesson_label') }}
            </label>
            <!-- Enrollment External Link Button -->
             <a v-if="initialEnrollmentExternalLink" 
               :href="initialEnrollmentExternalLink" 
               target="_blank"
               class="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-800 font-bold bg-blue-50 px-2 py-1 rounded-lg border border-blue-100 hover:border-blue-300 transition-colors"
             >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                {{ $t('report.editor.view_course_folder') || 'Course Folder' }}
             </a>
         </div>
        <select 
          v-model="selectedLessonId"
          class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          :class="{'opacity-50': disabled}"
          :disabled="disabled"
        >
          <option value="">{{ $t('report.editor.select_lesson') }}</option>
          <option v-for="lesson in availableLessons" :key="lesson.id" :value="lesson.id">
            Lesson {{ lesson.sequence }}: {{ lesson.title }}
          </option>
        </select>
      </div>
      
      <!-- Report External Link Input -->
      <div class="mb-4">
         <label class="block text-xs font-medium text-gray-600 mb-1">
            {{ $t('report.editor.report_link_label') || 'Report Link' }}
         </label>
         <div class="flex gap-2">
             <input 
               type="url" 
               v-model="reportExternalLink"
               placeholder="https://..."
               class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
             />
             <a v-if="reportExternalLink" 
               :href="reportExternalLink" 
               target="_blank"
               class="flex items-center justify-center w-10 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 text-gray-600"
             >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
             </a>
         </div>
      </div>
      <div class="flex items-end">
        <label class="flex items-center gap-2 cursor-pointer">
          <input 
            type="checkbox" 
            v-model="isCompleted"
            class="w-5 h-5 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
          />
          <span class="text-sm font-medium text-gray-700">{{ $t('report.editor.lesson_completed') }}</span>
        </label>
      </div>
    </div>

    <!-- Attendance Section -->
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
      <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
        <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
        </svg>
        {{ $t('report.editor.attendance_title') }}
      </h4>
      
      <div class="flex items-center gap-4 mb-3">
        <label class="flex items-center gap-2 cursor-pointer">
          <input 
            type="radio" 
            value="present" 
            v-model="attendanceStatus"
            class="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500"
          />
          <span class="text-sm font-medium text-gray-700">{{ $t('report.editor.present') }}</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input 
            type="radio" 
            value="absent" 
            v-model="attendanceStatus"
            class="w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500"
          />
          <span class="text-sm font-medium text-gray-700">{{ $t('report.editor.absent') }}</span>
        </label>
      </div>

      <!-- Absence Reason (conditional) -->
      <div v-if="attendanceStatus === 'absent'" class="mt-3">
        <label class="block text-sm font-medium text-gray-700 mb-2">
          {{ $t('report.editor.absence_reason_label') }} <span class="text-red-600">*</span>
        </label>
        <select 
          v-model="absenceReason"
          class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
          :class="showAbsenceError ? 'border-red-300 bg-red-50' : 'border-gray-300'"
        >
          <option value="">{{ $t('report.editor.select_reason') }}</option>
          <option :value="$t('report.editor.absence_reasons.busy_with_schoolwork')">{{ $t('report.editor.absence_reasons.busy_with_schoolwork') }}</option>
          <option :value="$t('report.editor.absence_reasons.school_event')">{{ $t('report.editor.absence_reasons.school_event') }}</option>
          <option :value="$t('report.editor.absence_reasons.family_matter')">{{ $t('report.editor.absence_reasons.family_matter') }}</option>
          <option :value="$t('report.editor.absence_reasons.sick_or_injured')">{{ $t('report.editor.absence_reasons.sick_or_injured') }}</option>
          <option :value="$t('report.editor.absence_reasons.reason_not_provided')">{{ $t('report.editor.absence_reasons.reason_not_provided') }}</option>
          <option :value="$t('report.editor.absence_reasons.travel_abroad')">{{ $t('report.editor.absence_reasons.travel_abroad') }}</option>
          <option :value="$t('report.editor.absence_reasons.family_ceremony')">{{ $t('report.editor.absence_reasons.family_ceremony') }}</option>
          <option :value="$t('report.editor.absence_reasons.school_activity')">{{ $t('report.editor.absence_reasons.school_activity') }}</option>
          <option :value="$t('report.editor.absence_reasons.other')">{{ $t('report.editor.absence_reasons.other') }}</option>
        </select>
        <p v-if="showAbsenceError" class="mt-1 text-sm text-red-600">{{ $t('report.editor.absence_reason_required') }}</p>
      </div>
    </div>

    <!-- Progress Letter (only when incomplete) -->
    <div v-if="!isCompleted" class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-3">
        {{ $t('report.editor.progress_label') }}
      </label>
      
      <div class="grid grid-cols-2 gap-4">
        <!-- Start Progress -->
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">
            {{ $t('report.editor.progress_start_label') }}
          </label>
          <select 
            v-model="progressStart"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          >
            <option value="">{{ $t('report.editor.select_progress') }}</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="E">E</option>
            <option value="F">F</option>
            <option value="G">G</option>
            <option value="H">H</option>
            <option value="I">I</option>
            <option value="J">J</option>
            <option value="K">K</option>
            <option value="L">L</option>
            <option value="M">M</option>
            <option value="N">N</option>
            <option value="O">O</option>
            <option value="P">P</option>
            <option value="Q">Q</option>
            <option value="R">R</option>
            <option value="S">S</option>
            <option value="T">T</option>
            <option value="U">U</option>
            <option value="V">V</option>
            <option value="W">W</option>
            <option value="X">X</option>
            <option value="Y">Y</option>
            <option value="Z">Z</option>
          </select>
        </div>
        
        <!-- End Progress -->
        <div>
          <label class="block text-xs font-medium text-gray-600 mb-1">
            {{ $t('report.editor.progress_end_label') }}
          </label>
          <select 
            v-model="progressEnd"
            class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
          >
            <option value="">{{ $t('report.editor.select_progress') }}</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="E">E</option>
            <option value="F">F</option>
            <option value="G">G</option>
            <option value="H">H</option>
            <option value="I">I</option>
            <option value="J">J</option>
            <option value="K">K</option>
            <option value="L">L</option>
            <option value="M">M</option>
            <option value="N">N</option>
            <option value="O">O</option>
            <option value="P">P</option>
            <option value="Q">Q</option>
            <option value="R">R</option>
            <option value="S">S</option>
            <option value="T">T</option>
            <option value="U">U</option>
            <option value="V">V</option>
            <option value="W">W</option>
            <option value="X">X</option>
            <option value="Y">Y</option>
            <option value="Z">Z</option>
          </select>
        </div>
      </div>
      
      <!-- Progress Display -->
      <div v-if="progressStart || progressEnd" class="mt-2 text-sm text-amber-700">
        <span v-if="progressStart && progressEnd">
          {{ $t('report.editor.progress_range_display', { start: progressStart, end: progressEnd }) }}
        </span>
        <span v-else-if="progressStart">
          {{ $t('report.editor.progress_from', { start: progressStart }) }}
        </span>
        <span v-else-if="progressEnd">
          {{ $t('report.editor.progress_to', { end: progressEnd }) }}
        </span>
      </div>
    </div>

    <!-- Evaluation Section -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">
          {{ $t('report.editor.class_participation_label') }}
        </label>
        <div class="flex items-center gap-2">
          <RatingInput
            v-model="classParticipation"
            :show-value="true"
          />
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">
          {{ $t('report.editor.classroom_behavior_label') }}
        </label>
        <div class="flex items-center gap-2">
          <RatingInput
            v-model="classroomBehavior"
            :show-value="true"
          />
        </div>
      </div>
    </div>

    <!-- Contact Notes -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
        <svg class="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
        </svg>
        {{ $t('report.editor.contact_notes_label') }}
      </label>
      <textarea
        v-model="contactNotes"
        rows="2"
        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
        :placeholder="$t('report.editor.contact_notes_placeholder')"
      ></textarea>
    </div>

    <!-- Class Notes -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-2">
        <svg class="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        {{ $t('report.editor.class_notes_label') }}
        <span class="text-xs text-gray-500 font-normal">{{ $t('report.editor.class_notes_subtitle') }}</span>
      </label>
      <textarea
        v-model="classNotes"
        rows="4"
        class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-y font-mono text-sm"
        :placeholder="$t('report.editor.class_notes_placeholder')"
      ></textarea>
    </div>

    <!-- Learning Report (Main Content) -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
        <span class="flex items-center gap-2">
          <svg class="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {{ $t('report.editor.learning_report_label') }}
          <span class="text-xs text-gray-500 font-normal">{{ $t('report.editor.learning_report_subtitle') }}</span>
        </span>
        <span v-if="wordCount > 0" class="text-xs text-gray-500">
          {{ wordCount }} {{ $t('report.editor.word_count') }} · {{ characterCount }} {{ $t('report.editor.character_count') }}
        </span>
      </label>
      <textarea
        v-model="localContent"
        @input="handleInput"
        :placeholder="placeholder || $t('report.editor.learning_report_placeholder')"
        :disabled="disabled"
        class="w-full min-h-[300px] p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-y font-mono text-sm"
        :class="{ 'bg-gray-50': disabled, 'opacity-50': disabled }"
      />
    </div>

    <!-- Error Display -->
    <div v-if="saveError" class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
      <strong>{{ $t('report.editor.error') }}:</strong> {{ saveError }}
    </div>

    <!-- Manual Save Button (Optional) -->
    <div v-if="showManualSave" class="mt-4">
      <button
        @click="saveNow"
        :disabled="isSaving || !hasUnsavedChanges || !canSave"
        class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {{ isSaving ? $t('report.saving') : $t('report.editor.save_now') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useAutoSave } from '@/composables/useAutoSave'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import { useAuthStore } from '@/stores/useAuthStore'
import RatingInput from '@/components/common/RatingInput.vue'

import type { Lesson } from '@/models/Course'

interface Template {
  id: string
  name: string
  content: string
}

// Templates State
const showTemplates = ref(false)
const savedTemplates = ref<Template[]>([])
const newTemplateName = ref('')

function loadTemplates() {
  const stored = localStorage.getItem('edulog_report_templates')
  if (stored) {
    try {
      savedTemplates.value = JSON.parse(stored)
    } catch (e) {
      console.error('Failed to parse templates', e)
    }
  }
}

function saveTemplate() {
  if (!newTemplateName.value.trim() || !localContent.value.trim()) return
  
  const newTemplate: Template = {
    id: Date.now().toString(),
    name: newTemplateName.value.trim(),
    content: localContent.value
  }
  
  savedTemplates.value.push(newTemplate)
  localStorage.setItem('edulog_report_templates', JSON.stringify(savedTemplates.value))
  newTemplateName.value = ''
}

function applyTemplate(template: Template) {
  if (localContent.value && !confirm('Replace current content with template?')) return
  
  localContent.value = template.content
  handleInput() // Update and save
  showTemplates.value = false
}

function deleteTemplate(id: string) {
  if (!confirm('Delete this template?')) return
  savedTemplates.value = savedTemplates.value.filter(t => t.id !== id)
  localStorage.setItem('edulog_report_templates', JSON.stringify(savedTemplates.value))
}

onMounted(() => {
  loadTemplates()
})

interface Props {
  reportId?: string
  initialContent?: string
  initialVersion?: number
  title?: string
  placeholder?: string
  disabled?: boolean
  showManualSave?: boolean
  debounceMs?: number
  availableLessons?: Lesson[]
  // Initial detailed data
  initialLessonId?: string
  initialIsCompleted?: boolean
  initialProgressStart?: string
  initialProgressEnd?: string
  initialAttendanceStatus?: 'present' | 'absent'
  initialAbsenceReason?: string
  initialClassParticipation?: number
  initialClassroomBehavior?: number
  initialContactNotes?: string
  initialClassNotes?: string
  initialReportExternalLink?: string
  initialEnrollmentExternalLink?: string
}

const props = withDefaults(defineProps<Props>(), {
  initialContent: '',
  initialVersion: 1,
  placeholder: 'Enter report content...',
  disabled: false,
  showManualSave: false,
  debounceMs: 2000,
  availableLessons: () => [],
  initialIsCompleted: true,
  initialAttendanceStatus: 'present',
  initialReportExternalLink: '',
  initialEnrollmentExternalLink: ''
})

const emit = defineEmits<{
  'update:content': [content: string]
  'save-success': [version: number]
  'update:report-external-link': [value: string]
  'save-error': [error: string]
  'conflict': [serverContent: string]
}>()

const authStore = useAuthStore()

// Local state
const localContent = ref(props.initialContent)
const version = ref(props.initialVersion)

// Detailed fields
const selectedLessonId = ref(props.initialLessonId || '')
const isCompleted = ref(props.initialIsCompleted)
const progressStart = ref(props.initialProgressStart || '')
const progressEnd = ref(props.initialProgressEnd || '')
const attendanceStatus = ref<'present' | 'absent'>(props.initialAttendanceStatus)
const absenceReason = ref(props.initialAbsenceReason || '')
const classParticipation = ref(props.initialClassParticipation ?? 0)
const classroomBehavior = ref(props.initialClassroomBehavior ?? 0)
const contactNotes = ref(props.initialContactNotes || '')
const classNotes = ref(props.initialClassNotes || '')
const reportExternalLink = ref(props.initialReportExternalLink || '') // New ref for external link

// Computed progress letter for backend (combining start-end range)
const progressLetter = computed(() => {
  if (progressStart.value && progressEnd.value) {
    return `${progressStart.value}-${progressEnd.value}`
  } else if (progressStart.value) {
    return progressStart.value
  } else if (progressEnd.value) {
    return progressEnd.value
  }
  return ''
})

// Validation
const showAbsenceError = computed(() => {
  return attendanceStatus.value === 'absent' && !absenceReason.value
})

const canSave = computed(() => {
  // Cannot save if absent without reason
  if (attendanceStatus.value === 'absent' && !absenceReason.value) {
    return false
  }
  return true
})

// Auto-save setup
const {
  isSaving,
  lastSaved,
  hasUnsavedChanges,
  saveError,
  saveNow: autoSaveNow,
  triggerAutoSave,
  getLastSavedString,
  reset
} = useAutoSave({
  debounceMs: props.debounceMs,
  onSave: async (content) => {
    if (!props.reportId) {
      return { success: false, message: 'No report ID provided' }
    }

    if (!canSave.value) {
      return { success: false, message: '請填寫必填欄位' }
    }

    try {
      const result = await OccurrenceReportService.saveReport(
        props.reportId,
        content,
        version.value,
        authStore.user?.id,
        {
          lessonId: selectedLessonId.value || undefined,
          isCompleted: isCompleted.value,
          progressLetter: progressLetter.value || undefined,
          attendanceStatus: attendanceStatus.value,
          absenceReason: absenceReason.value || undefined,
          classParticipation: classParticipation.value || undefined,
          classroomBehavior: classroomBehavior.value || undefined,
          contactNotes: contactNotes.value || undefined,
          classNotes: classNotes.value || undefined,
          externalLink: reportExternalLink.value || undefined
        }
      )

      if (result.conflict) {
        emit('conflict', result.serverContent || '')
        return result
      }

      if (result.success && result.newVersion) {
        version.value = result.newVersion
        emit('save-success', result.newVersion)
      }

      return result
    } catch (error: any) {
      const message = error.message || 'Failed to save report'
      emit('save-error', message)
      return { success: false, message }
    }
  },
  onConflict: (serverContent) => {
    emit('conflict', serverContent)
  },
  onSuccess: (newVersion) => {
    version.value = newVersion
    emit('save-success', newVersion)
  },
  onError: (message) => {
    emit('save-error', message)
  }
})

// Computed
const wordCount = computed(() => {
  if (!localContent.value) return 0
  return localContent.value.trim().split(/\s+/).filter(w => w.length > 0).length
})

const characterCount = computed(() => {
  return localContent.value.length
})

// Watchers to sync props to local state (important for Master-Detail views where component is reused)
watch(() => props.initialContent, (newContent) => {
  if (newContent !== localContent.value && !hasUnsavedChanges.value) {
    localContent.value = newContent
  }
})

watch(() => props.initialVersion, (newVersion) => {
  version.value = newVersion
})

watch(() => props.initialLessonId, (newVal) => {
  selectedLessonId.value = newVal || ''
})

watch(() => props.initialIsCompleted, (newVal) => {
  isCompleted.value = newVal ?? true
})

watch(() => props.initialProgressStart, (newVal) => {
  progressStart.value = newVal || ''
})

watch(() => props.initialProgressEnd, (newVal) => {
  progressEnd.value = newVal || ''
})

watch(() => props.initialAttendanceStatus, (newVal) => {
  attendanceStatus.value = newVal || 'present'
})

watch(() => props.initialAbsenceReason, (newVal) => {
  absenceReason.value = newVal || ''
})

watch(() => props.initialClassParticipation, (newVal) => {
  classParticipation.value = newVal ?? 0
})

watch(() => props.initialClassroomBehavior, (newVal) => {
  classroomBehavior.value = newVal ?? 0
})

watch(() => props.initialContactNotes, (newVal) => {
  contactNotes.value = newVal || ''
})

watch(() => props.initialClassNotes, (newVal) => {
  classNotes.value = newVal || ''
})

// Business rule: absent → incomplete
watch(attendanceStatus, (newStatus) => {
  if (newStatus === 'absent') {
    isCompleted.value = false
  }
})

// Business rule: completed → clear progress letters
watch(isCompleted, (newValue) => {
  if (newValue) {
    progressStart.value = ''
    progressEnd.value = ''
  }
})

// Watch for changes that should trigger auto-save
watch([
  selectedLessonId,
  isCompleted,
  progressStart,
  progressEnd,
  attendanceStatus,
  absenceReason,
  classParticipation,
  classroomBehavior,
  contactNotes,
  classNotes,
  reportExternalLink
], () => {
  if (isInitializing.value) return
  handleInput()
})

const isInitializing = ref(false)

// Reset auto-save state when switching reports
watch(() => props.reportId, () => {
  isInitializing.value = true
  reset()
  // Allow time for props to propagate to local state
  setTimeout(() => {
    isInitializing.value = false
  }, 500)
}, { immediate: true })

// Methods
function handleInput() {
  if (isInitializing.value) return
  
  // Trigger auto-save with all data
  // We need to pass the external link to the parent via emit or just trust the triggerAutoSave
  // triggerAutoSave calls saveFn with the CONTENT string usually. 
  // But we have extra fields.
  // The 'content' prop is usually just the text body.
  // We should probably emit the external link update separately or ensure the parent reads it from the reference?
  // Since we are using a custom autosave hook that likely calls a save function in the parent...
  // Let's assume the parent needs to know about the external link update immediately?
  // Or we can rely on `triggerAutoSave` triggering the save function which pulls from... wait.
  
  // In `SessionDetailsView.vue`, the `handleEditorUpdate` usually takes `content`.
  // We need to verify how `ReportEditor` communicates updates.
  // It emits `update:content`. 
  
  emit('update:content', localContent.value)
  emit('update:report-external-link', reportExternalLink.value)
  
  // Construct the full report data object for saving if needed, 
  // but `triggerAutoSave` takes `data: T` (generic). 
  // It seems `localContent` is passed to `triggerAutoSave`. 
  // If `localContent` is just the string, then `useAutoSave` calls `onSave(localContent)`.
  
  // We need to modify what we pass to triggerAutoSave if we want to save more than just content.
  // OR we emit the updates and the parent handles the saving orchestration.
  
  if (props.reportId) {
    triggerAutoSave(localContent.value)
  }
}


function saveNow() {
  if (props.reportId && canSave.value) {
    autoSaveNow(localContent.value)
  }
}

// Warn before leaving with unsaved changes
onBeforeUnmount(() => {
  if (hasUnsavedChanges.value) {
    saveNow()
  }
})
</script>

<style scoped>
.report-editor textarea:focus {
  outline: none;
}
</style>
