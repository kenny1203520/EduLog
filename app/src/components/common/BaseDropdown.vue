<script setup lang="ts">
import { ref, computed } from 'vue'

interface Option {
    label: string
    value: any
}

const props = withDefaults(defineProps<{
    modelValue: any
    options: Option[]
    placeholder?: string
    theme?: 'indigo' | 'emerald' | 'amber' | 'gray' | 'red'
    align?: 'left' | 'right' | 'auto'
    widthClass?: string
    menuWidthClass?: string
    maxHeightClass?: string
    disabled?: boolean
}>(), {
    placeholder: 'Select option',
    theme: 'indigo',
    align: 'left',
    widthClass: 'w-full',
    menuWidthClass: 'w-full',
    maxHeightClass: 'max-h-60',
    disabled: false
})

const emit = defineEmits(['update:modelValue', 'change'])

const isOpen = ref(false)

const selectedOption = computed(() => {
    return props.options.find(opt => opt.value === props.modelValue)
})

const themeClasses = computed(() => {
    const themes = {
        indigo: {
            text: 'text-indigo-600',
            ring: 'focus:ring-indigo-500/10',
            bg: 'bg-indigo-50',
            border: 'border-indigo-50',
            hoverText: 'hover:text-indigo-600'
        },
        emerald: {
            text: 'text-emerald-600',
            ring: 'focus:ring-emerald-500/10',
            bg: 'bg-emerald-50',
            border: 'border-emerald-50',
            hoverText: 'hover:text-emerald-600'
        },
        amber: {
            text: 'text-amber-600',
            ring: 'focus:ring-amber-500/10',
            bg: 'bg-amber-50',
            border: 'border-amber-50',
            hoverText: 'hover:text-amber-600'
        },
        gray: {
            text: 'text-gray-900',
            ring: 'focus:ring-gray-500/10',
            bg: 'bg-gray-100',
            border: 'border-gray-100',
            hoverText: 'hover:text-gray-900'
        },
        red: {
            text: 'text-red-600',
            ring: 'focus:ring-red-500/10',
            bg: 'bg-red-50',
            border: 'border-red-50',
            hoverText: 'hover:text-red-600'
        }
    }
    return themes[props.theme]
})

function toggle() {
    isOpen.value = !isOpen.value
}

function close() {
    isOpen.value = false
}

function select(value: any) {
    emit('update:modelValue', value)
    emit('change', value)
    close()
}
</script>

<template>
    <div class="relative" :class="widthClass">
        <!-- Overlay to close when clicking outside -->
        <div v-if="isOpen" class="fixed inset-0 z-40" @click="close"></div>

        <button @click="toggle" type="button" :disabled="disabled"
            class="w-full flex items-center justify-between gap-2 text-xs font-bold border border-gray-100 rounded-xl px-3 py-2.5 bg-white hover:bg-gray-50 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50"
            :class="[themeClasses.ring, isOpen ? 'ring-4' : '']">
            <span class="truncate" :class="modelValue !== '' && modelValue !== null && !disabled ? themeClasses.text : 'text-gray-400'">
                {{ selectedOption ? selectedOption.label : placeholder }}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" 
                class="h-3.5 w-3.5 transition-transform duration-300 text-gray-400" 
                :class="[isOpen ? 'rotate-180' : '', modelValue !== '' && modelValue !== null ? themeClasses.text : '']" 
                fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
            </svg>
        </button>

        <transition
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="transform scale-95 opacity-0"
            enter-to-class="transform scale-100 opacity-100"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="transform scale-100 opacity-100"
            leave-to-class="transform scale-95 opacity-0"
        >
            <div v-if="isOpen" 
                class="absolute mt-2 p-1.5 bg-white/70 backdrop-blur-xl border rounded-2xl shadow-2xl z-50 overflow-y-auto no-scrollbar"
                :class="[
                    themeClasses.border,
                    menuWidthClass,
                    maxHeightClass,
                    align === 'right' ? 'right-0' : (align === 'auto' ? 'left-0 sm:left-auto sm:right-0' : 'left-0')
                ]">
                <div v-for="opt in options" :key="String(opt.value)" 
                    @click="select(opt.value)"
                    class="px-3 py-2.5 rounded-xl text-xs font-bold cursor-pointer transition-colors flex items-center justify-between group"
                    :class="modelValue === opt.value ? [themeClasses.bg, themeClasses.text] : ['text-gray-600', 'hover:bg-gray-50', themeClasses.hoverText]">
                    <span class="truncate">{{ opt.label }}</span>
                    <svg v-if="modelValue === opt.value" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                    </svg>
                </div>
            </div>
        </transition>
    </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
    display: none;
}
.no-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
}
</style>
