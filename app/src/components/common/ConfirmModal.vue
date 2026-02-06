<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = defineProps<{
    isOpen: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    isDangerous?: boolean
}>()

const emit = defineEmits<{
    (e: 'confirm'): void
    (e: 'close'): void
}>()

// Prevent scrolling when modal is open
onMounted(() => {
    if (props.isOpen) {
        document.body.style.overflow = 'hidden'
    }
})

onUnmounted(() => {
    document.body.style.overflow = ''
})
</script>

<template>
    <div v-if="isOpen" class="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" @click="$emit('close')"></div>

        <!-- Modal -->
        <div
            class="bg-white rounded-[2rem] shadow-2xl w-full max-w-md relative z-10 overflow-hidden animate-in zoom-in fade-in duration-200">
            <div class="p-8 text-center space-y-6">
                <!-- Icon -->
                <div class="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-4"
                    :class="isDangerous ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'">
                    <svg v-if="isDangerous" xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>

                <!-- Text -->
                <div class="space-y-2">
                    <h3 class="text-2xl font-black text-gray-900 leading-tight">
                        {{ title }}
                    </h3>
                    <p class="text-gray-500 font-medium">
                        {{ message }}
                    </p>
                </div>

                <!-- Actions -->
                <div class="flex gap-3 pt-2">
                    <button @click="$emit('close')"
                        class="flex-1 px-6 py-3.5 text-gray-500 hover:text-gray-700 font-bold bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">
                        {{ cancelText || 'Cancel' }}
                    </button>
                    <button @click="$emit('confirm')"
                        class="flex-1 px-6 py-3.5 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95 flex items-center justify-center gap-2"
                        :class="isDangerous ? 'bg-red-500 hover:bg-red-600 shadow-red-200' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'">
                        {{ confirmText || 'Confirm' }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
