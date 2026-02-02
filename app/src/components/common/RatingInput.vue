<template>
  <div class="flex items-center gap-1.5">
    <div class="flex">
      <template v-for="i in 5" :key="i">
        <button 
          type="button"
          class="relative focus:outline-none group"
          @mouseenter="hoverValue = i - 0.5"
          @mouseleave="hoverValue = null"
          @click="updateRating(i - 0.5)"
        >
          <!-- Left half of star -->
          <div class="absolute inset-0 w-1/2 overflow-hidden pointer-events-auto">
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              class="h-6 w-6" 
              :class="getStarClass(i - 0.5)"
              viewBox="0 0 24 24" 
              fill="currentColor"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
          
          <!-- Full star (for hover/click area) -->
          <button
            type="button"
            class="pointer-events-auto"
            @mouseenter="hoverValue = i"
            @click="updateRating(i)"
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              class="h-6 w-6" 
              :class="getStarClass(i)"
              viewBox="0 0 24 24" 
              fill="currentColor"
            >
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </button>
        </button>
      </template>
    </div>
    <span class="text-sm font-black text-gray-500 min-w-[2rem] text-center bg-gray-100 rounded-md px-1.5 py-0.5" v-if="showValue">
      {{ modelValue }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: Number,
    default: 0
  },
  showValue: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:modelValue'])

const hoverValue = ref<number | null>(null)

function getStarClass(value: number) {
  const current = hoverValue.value !== null ? hoverValue.value : props.modelValue
  if (current >= value) {
    return 'text-amber-400'
  }
  return 'text-gray-200'
}

function updateRating(value: number) {
  emit('update:modelValue', value)
}
</script>

<style scoped>
/* Ensure the SVGs align correctly */
svg {
  display: block;
}
</style>
