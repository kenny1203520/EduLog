<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex relative">
      <template v-for="i in 5" :key="i">
        <div 
          class="relative w-7 h-7 cursor-pointer group"
          @mouseleave="hoverValue = null"
        >
          <!-- Base Star (Gray) -->
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            class="absolute inset-0 w-full h-full text-gray-200" 
            viewBox="0 0 24 24" 
            fill="currentColor"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>

          <!-- Left Half Active/Hover (Amber) -->
          <div class="absolute inset-0 w-[50%] overflow-hidden pointer-events-none z-10 transition-colors"
               :class="getStarClass(i - 0.5)">
             <svg 
              xmlns="http://www.w3.org/2000/svg" 
              class="w-7 h-7" 
              viewBox="0 0 24 24" 
              fill="currentColor"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>

          <!-- Right Half Active/Hover (Amber) -->
           <div class="absolute inset-0 w-full overflow-hidden pointer-events-none transition-colors"
               :class="getStarClass(i)">
             <svg 
              xmlns="http://www.w3.org/2000/svg" 
              class="w-full h-full" 
              viewBox="0 0 24 24" 
              fill="currentColor"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>

          <!-- Click Targets (Invisible) -->
          <button 
            type="button" 
            class="absolute top-0 left-0 z-20 h-full w-1/2 rounded-l focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
            @mouseenter="hoverValue = i - 0.5"
            @click="updateRating(i - 0.5)"
            :aria-label="t('report.editor.rate_half_star', { value: i - 0.5 })"
            :aria-pressed="modelValue === i - 0.5"
          ></button>
          
          <button 
            type="button" 
            class="absolute top-0 right-0 z-20 h-full w-1/2 rounded-r focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700"
            @mouseenter="hoverValue = i"
            @click="updateRating(i)"
            :aria-label="t('report.editor.rate_full_star', { value: i })"
            :aria-pressed="modelValue === i"
          ></button>
        </div>
      </template>
    </div>
    <span class="text-sm font-black text-gray-600 min-w-[3rem] text-center bg-gray-100 rounded-md px-1.5 py-1" v-if="showValue" aria-live="polite">
      {{ modelValue === null ? t('report.editor.unrated') : modelValue }}
    </span>
    <button v-if="clearable && modelValue !== null" type="button" class="min-h-8 rounded-md px-2 text-xs font-bold text-gray-600 underline decoration-gray-300 underline-offset-2 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700" @click="updateRating(null)">
      {{ t('report.editor.clear_rating') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps({
  modelValue: {
    type: Number as () => number | null,
    default: null
  },
  showValue: {
    type: Boolean,
    default: true
  },
  clearable: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:modelValue'])

const hoverValue = ref<number | null>(null)

function getStarClass(value: number) {
  const current = hoverValue.value !== null ? hoverValue.value : props.modelValue
  if (current !== null && current >= value) {
    return 'text-amber-400'
  }
  return 'text-gray-200'
}

function updateRating(value: number | null) {
  emit('update:modelValue', value)
}
</script>

<style scoped>
/* Ensure the SVGs align correctly */
svg {
  display: block;
}
</style>
