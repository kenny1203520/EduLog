<template>
  <div class="report-editor bg-white rounded-lg shadow-sm p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold text-gray-800">
        {{ title || 'Class Report' }}
      </h3>
      
      <!-- Save Status Indicator -->
      <div class="flex items-center gap-2 text-sm">
        <span v-if="isSaving" class="text-blue-600 flex items-center gap-1">
          <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
          </svg>
          Saving...
        </span>
        <span v-else-if="lastSaved" class="text-gray-500">
          {{ getLastSavedString() }}
        </span>
        <span v-else-if="hasUnsavedChanges" class="text-amber-600">
          Unsaved changes
        </span>
        <span v-else class="text-green-600">
          All changes saved
        </span>
      </div>
    </div>

    <!-- Metadata Bar -->
    <div class="flex items-center gap-4 mb-4 text-sm text-gray-600">
      <span>Version: {{ version }}</span>
      <span v-if="wordCount > 0">Words: {{ wordCount }}</span>
      <span v-if="characterCount > 0">Characters: {{ characterCount }}</span>
    </div>

    <!-- Editor Textarea -->
    <div class="relative">
      <textarea
        v-model="localContent"
        @input="handleInput"
        :placeholder="placeholder"
        :disabled="disabled"
        class="w-full min-h-[400px] p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono text-sm"
        :class="{ 'bg-gray-50': disabled, 'opacity-50': disabled }"
      />
      
      <!-- Markdown Hint -->
      <div class="mt-2 text-xs text-gray-500">
        Supports Markdown formatting
      </div>
    </div>

    <!-- Error Display -->
    <div v-if="saveError" class="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
      <strong>Error:</strong> {{ saveError }}
    </div>

    <!-- Manual Save Button (Optional) -->
    <div v-if="showManualSave" class="mt-4">
      <button
        @click="saveNow"
        :disabled="isSaving || !hasUnsavedChanges"
        class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {{ isSaving ? 'Saving...' : 'Save Now' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useAutoSave } from '@/composables/useAutoSave'
import { OccurrenceReportService } from '@/services/OccurrenceReportService'

interface Props {
  reportId?: string
  initialContent?: string
  initialVersion?: number
  title?: string
  placeholder?: string
  disabled?: boolean
  showManualSave?: boolean
  debounceMs?: number
}

const props = withDefaults(defineProps<Props>(), {
  initialContent: '',
  initialVersion: 1,
  placeholder: 'Write your report here...',
  disabled: false,
  showManualSave: false,
  debounceMs: 2000
})

const emit = defineEmits<{
  'update:content': [content: string]
  'save-success': [version: number]
  'save-error': [error: string]
  'conflict': [serverContent: string]
}>()

// Local state
const localContent = ref(props.initialContent)
const version = ref(props.initialVersion)

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

    try {
      const result = await OccurrenceReportService.saveReport(
        props.reportId,
        content,
        version.value
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

// Watchers
watch(() => props.initialContent, (newContent) => {
  if (newContent !== localContent.value && !hasUnsavedChanges.value) {
    localContent.value = newContent
  }
})

watch(() => props.initialVersion, (newVersion) => {
  version.value = newVersion
})

// Methods
function handleInput() {
  emit('update:content', localContent.value)
  if (props.reportId) {
    triggerAutoSave(localContent.value)
  }
}

function saveNow() {
  if (props.reportId) {
    autoSaveNow(localContent.value)
  }
}

// Warn before leaving with unsaved changes
onBeforeUnmount(() => {
  if (hasUnsavedChanges.value) {
    const confirmLeave = confirm('You have unsaved changes. Are you sure you want to leave?')
    if (!confirmLeave) {
      // Note: Can't actually prevent unmount, but at least warn
      saveNow()
    }
  }
})
</script>

<style scoped>
.report-editor textarea:focus {
  outline: none;
}
</style>
