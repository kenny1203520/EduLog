<template>
  <div class="report-editor bg-white rounded-lg shadow-sm p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-gray-800">
        {{ title || $t('report.editor.title') }}
      </h3>
      
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
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">
          {{ $t('report.editor.lesson_selector_label') }}
        </label>
        <select 
          v-model="selectedLessonId"
          class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
        >
          <option value="">{{ $t('report.editor.select_lesson') }}</option>
          <option v-for="lesson in availableLessons" :key="lesson.id" :value="lesson.id">
            {{ lesson.displayName }}
          </option>
        </select>
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
        <textarea
          v-model="classParticipation"
          rows="3"
          class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-y"
          :placeholder="$t('report.editor.class_participation_placeholder')"
        ></textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">
          {{ $t('report.editor.classroom_behavior_label') }}
        </label>
        <textarea
          v-model="classroomBehavior"
          rows="3"
          class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-y"
          :placeholder="$t('report.editor.classroom_behavior_placeholder')"
        ></textarea>
      </div>
    </div>

    <!-- Contact Notes -->
    <div class="mb-6">
      <label class="block text-sm font-medium text-gray-700 mb-2">
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
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useAutoSave } from '@/composables/useAutoSave'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'
import { useAuthStore } from '@/stores/useAuthStore'

interface Lesson {
  id: string
  displayName: string
}

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
  initialClassParticipation?: string
  initialClassroomBehavior?: string
  initialContactNotes?: string
  initialClassNotes?: string
}

const props = withDefaults(defineProps<Props>(), {
  initialContent: '',
  initialVersion: 1,
  placeholder: '',
  disabled: false,
  showManualSave: false,
  debounceMs: 2000,
  availableLessons: () => [],
  initialIsCompleted: true,
  initialAttendanceStatus: 'present'
})

const emit = defineEmits<{
  'update:content': [content: string]
  'save-success': [version: number]
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
const classParticipation = ref(props.initialClassParticipation || '')
const classroomBehavior = ref(props.initialClassroomBehavior || '')
const contactNotes = ref(props.initialContactNotes || '')
const classNotes = ref(props.initialClassNotes || '')

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
  getLastSavedString
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
          classNotes: classNotes.value || undefined
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
  classParticipation.value = newVal || ''
})

watch(() => props.initialClassroomBehavior, (newVal) => {
  classroomBehavior.value = newVal || ''
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

// Methods
function handleInput() {
  emit('update:content', localContent.value)
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
