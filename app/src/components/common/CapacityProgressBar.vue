<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue'

const props = defineProps<{
    current: number
    capacity: number
    isLoading?: boolean
    label?: string
}>()

const progressWidth = ref(0)
const displayCount = ref(0)

const percentage = computed(() => {
    if (props.capacity <= 0) return 0
    return Math.min(Math.round((props.current / props.capacity) * 100), 100)
})

const isFull = computed(() => props.capacity > 0 && props.current >= props.capacity)

const statusColor = computed(() => {
    if (isFull.value) return 'bg-rose-500'
    if (percentage.value > 80) return 'bg-amber-500'
    return 'bg-emerald-500'
})

const statusBg = computed(() => {
    if (isFull.value) return 'bg-rose-50'
    if (percentage.value > 80) return 'bg-amber-50'
    return 'bg-emerald-50'
})

const statusText = computed(() => {
    if (isFull.value) return 'text-rose-700'
    if (percentage.value > 80) return 'text-amber-700'
    return 'text-emerald-700'
})

// Animation logic
function animate() {
    progressWidth.value = 0
    displayCount.value = 0
    
    // Smooth width growth
    setTimeout(() => {
        progressWidth.value = percentage.value
    }, 50)

    // Number counting effect
    const duration = 800
    const start = 0
    const end = props.current
    const startTime = performance.now()

    function updateNumber(now: number) {
        const elapsed = now - startTime
        const progress = Math.min(elapsed / duration, 1)
        displayCount.value = Math.floor(start + (end - start) * progress)
        
        if (progress < 1) {
            requestAnimationFrame(updateNumber)
        } else {
            displayCount.value = end
        }
    }
    requestAnimationFrame(updateNumber)
}

onMounted(() => {
    if (!props.isLoading) animate()
})

watch(() => props.current, () => {
    if (!props.isLoading) animate()
})

watch(() => props.isLoading, (loading) => {
    if (!loading) animate()
})
</script>

<template>
    <div class="space-y-3">
        <div class="flex items-center justify-between px-1">
            <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{ label || $t('student.enroll_modal.capacity') }}</span>
            <div v-if="!isLoading" class="flex items-center gap-1.5">
                <span class="text-sm font-black text-gray-900">{{ displayCount }}</span>
                <span class="text-[10px] font-bold text-gray-300">/</span>
                <span class="text-[10px] font-black text-gray-400">{{ capacity }}</span>
            </div>
            <div v-else class="flex items-center gap-2">
                <div class="w-3 h-3 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin"></div>
                <span class="text-[10px] font-bold text-emerald-600 uppercase tracking-widest animate-pulse">{{ $t('common.checking') || 'Checking...' }}</span>
            </div>
        </div>

        <div class="relative h-4 bg-gray-100 rounded-full overflow-hidden shadow-inner border border-gray-200/50">
            <!-- Background Pulse if Loading -->
            <div v-if="isLoading" class="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 to-transparent animate-shimmer"></div>
            
            <!-- Progress Bar -->
            <div 
                class="absolute top-0 left-0 h-full transition-all duration-1000 ease-out shadow-lg"
                :class="statusColor"
                :style="{ width: `${progressWidth}%` }"
            >
                <!-- Glossy effect -->
                <div class="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent"></div>
            </div>
        </div>

        <!-- Full Warning -->
        <div v-if="isFull && !isLoading" 
            class="flex items-center gap-2 px-4 py-2 rounded-xl animate-in slide-in-from-top-2"
            :class="[statusBg, statusText]"
        >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4">
                <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z" clip-rule="evenodd" />
            </svg>
            <span class="text-[10px] font-black uppercase tracking-widest">{{ $t('student.enroll_modal.full_warning') || 'Session is Full' }}</span>
        </div>
    </div>
</template>

<style scoped>
@keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
}
.animate-shimmer {
    animation: shimmer 2s infinite linear;
}
</style>
