<script setup lang="ts">
import { ref } from 'vue'

const splitPercent = ref(50)
const isResizing = ref(false)
const containerRef = ref<HTMLElement | null>(null)

function startResize() {
  isResizing.value = true
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', stopResize)
  // Disable selection during resize
  document.body.style.userSelect = 'none'
}

function stopResize() {
  isResizing.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', stopResize)
  document.body.style.userSelect = ''
}

function handleMouseMove(e: MouseEvent) {
  if (!isResizing.value || !containerRef.value) return
  
  const containerRect = containerRef.value.getBoundingClientRect()
  const newPercent = ((e.clientX - containerRect.left) / containerRect.width) * 100
  
  // Limit existing range (e.g., 20% to 80%)
  if (newPercent > 20 && newPercent < 80) {
    splitPercent.value = newPercent
  }
}
</script>

<template>
  <div ref="containerRef" class="flex h-full w-full overflow-hidden border rounded-lg bg-white shadow-sm">
    <!-- Left Pane -->
    <div :style="{ width: `${splitPercent}%` }" class="h-full overflow-auto relative">
      <slot name="left"></slot>
    </div>

    <!-- Resizer Handle -->
    <div 
      class="w-2 h-full cursor-col-resize bg-gray-200 hover:bg-emerald-400 active:bg-emerald-600 transition-colors flex flex-col justify-center items-center z-10"
      @mousedown="startResize"
    >
      <div class="w-1 h-8 bg-gray-400 rounded-full"></div>
    </div>

    <!-- Right Pane -->
    <div :style="{ width: `${100 - splitPercent}%` }" class="h-full overflow-auto bg-gray-50">
      <slot name="right"></slot>
    </div>
  </div>
</template>
