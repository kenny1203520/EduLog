<template>
  <div class="flex items-center gap-1.5">
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
            class="absolute top-0 left-0 w-1/2 h-full z-20 focus:outline-none"
            @mouseenter="hoverValue = i - 0.5"
            @click="updateRating(i - 0.5)"
            aria-label="Half star"
          ></button>
          
          <button 
            type="button" 
            class="absolute top-0 right-0 w-1/2 h-full z-20 focus:outline-none"
            @mouseenter="hoverValue = i"
            @click="updateRating(i)"
            aria-label="Full star"
          ></button>
        </div>
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
