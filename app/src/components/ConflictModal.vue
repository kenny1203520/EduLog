<template>
  <div 
    v-if="isOpen" 
    class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
    @click.self="close"
  >
    <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
      <!-- Header -->
      <div class="bg-red-50 border-b border-red-200 p-6">
        <div class="flex items-center gap-3">
          <svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <div>
            <h2 class="text-xl font-bold text-gray-900">Conflict Detected</h2>
            <p class="text-sm text-gray-600 mt-1">
              This report was modified by another user while you were editing.
            </p>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="p-6 overflow-y-auto" style="max-height: calc(90vh - 200px);">
        <!-- Strategy Selection -->
        <div class="mb-6">
          <label class="block text-sm font-medium text-gray-700 mb-3">
            Choose how to resolve:
          </label>
          <div class="space-y-2">
            <label 
              v-for="strategy in strategies" 
              :key="strategy.value"
              class="flex items-start p-4 border-2 rounded-lg cursor-pointer transition"
              :class="selectedStrategy === strategy.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'"
            >
              <input 
                type="radio" 
                :value="strategy.value" 
                v-model="selectedStrategy"
                class="mt-1 mr-3"
              />
              <div>
                <div class="font-medium text-gray-900">{{ strategy.label }}</div>
                <div class="text-sm text-gray-600">{{ strategy.description }}</div>
              </div>
            </label>
          </div>
        </div>

        <!-- Side-by-Side Comparison -->
        <div v-if="selectedStrategy === 'manual'" class="grid grid-cols-2 gap-4">
          <!-- Server Version -->
          <div>
            <h3 class="font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <svg class="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"/>
              </svg>
              Server Version
            </h3>
            <div class="p-4 bg-gray-50 border border-gray-200 rounded-lg h-64 overflow-y-auto font-mono text-sm whitespace-pre-wrap">
              {{ serverContent }}
            </div>
          </div>

          <!-- Local Version -->
          <div>
            <h3 class="font-semibold text-gray-800 mb-2 flex items-center gap-2">
              <svg class="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
              </svg>
              Your Local Version
            </h3>
            <div class="p-4 bg-gray-50 border border-gray-200 rounded-lg h-64 overflow-y-auto font-mono text-sm whitespace-pre-wrap">
              {{ localContent }}
            </div>
          </div>
        </div>

        <!-- Manual Merge Editor -->
        <div v-if="selectedStrategy === 'manual'" class="mt-4">
          <label class="block font-semibold text-gray-800 mb-2">
            Merged Content (edit as needed):
          </label>
          <textarea
            v-model="mergedContent"
            class="w-full h-64 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Edit the merged content here..."
          />
        </div>
      </div>

      <!-- Footer -->
      <div class="bg-gray-50 border-t border-gray-200 p-6 flex items-center justify-end gap-3">
        <button
          @click="close"
          class="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition"
        >
          Cancel
        </button>
        <button
          @click="resolve"
          :disabled="selectedStrategy === 'manual' && !mergedContent"
          class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          Resolve Conflict
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

interface Props {
  isOpen: boolean
  serverContent: string
  localContent: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'close': []
  'resolve': [resolvedContent: string, strategy: string]
}>()

// State
const selectedStrategy = ref<'keep-local' | 'keep-server' | 'manual'>('manual')
const mergedContent = ref('')

const strategies = [
  {
    value: 'keep-local',
    label: 'Keep My Version',
    description: 'Overwrite the server version with your local changes.'
  },
  {
    value: 'keep-server',
    label: 'Keep Server Version',
    description: 'Discard your local changes and use the server version.'
  },
  {
    value: 'manual',
    label: 'Manually Merge',
    description: 'Review both versions and create a merged version.'
  }
]

// Watchers
watch(() => props.isOpen, (isOpen) => {
  if (isOpen) {
    // Initialize merged content with local version by default
    mergedContent.value = props.localContent
    selectedStrategy.value = 'manual'
  }
})

watch(() => props.localContent, (newContent) => {
  if (selectedStrategy.value === 'manual') {
    mergedContent.value = newContent
  }
})

// Methods
function close() {
  emit('close')
}

function resolve() {
  let resolvedContent: string

  switch (selectedStrategy.value) {
    case 'keep-local':
      resolvedContent = props.localContent
      break
    case 'keep-server':
      resolvedContent = props.serverContent
      break
    case 'manual':
      resolvedContent = mergedContent.value
      break
    default:
      resolvedContent = props.localContent
  }

  emit('resolve', resolvedContent, selectedStrategy.value)
}
</script>
