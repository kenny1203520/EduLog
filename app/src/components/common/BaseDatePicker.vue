<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseCalendar from '@/components/common/BaseCalendar.vue'
import { DateUtils } from '@/utils/DateUtils'

const props = withDefaults(defineProps<{
    modelValue: string
    id?: string
    placeholder?: string
    theme?: 'amber' | 'emerald' | 'indigo' | 'gray'
    disabled?: boolean
}>(), {
    placeholder: '',
    theme: 'amber',
    disabled: false
})

const emit = defineEmits<{
    'update:modelValue': [value: string]
}>()

const { locale } = useI18n()

const isOpen = ref(false)
const containerRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const placement = ref<'bottom' | 'top'>('bottom')

const selectedDate = computed(() => DateUtils.parseLocalDate(props.modelValue))

const displayText = computed(() => {
    if (!selectedDate.value) return props.placeholder
    return DateUtils.displayDate(props.modelValue, locale.value)
})

const themeClasses = computed(() => {
    const themes = {
        amber: {
            text: 'text-amber-700',
            ring: 'focus:ring-amber-500/10',
            border: 'focus:border-amber-500'
        },
        emerald: {
            text: 'text-emerald-700',
            ring: 'focus:ring-emerald-500/10',
            border: 'focus:border-emerald-500'
        },
        indigo: {
            text: 'text-indigo-700',
            ring: 'focus:ring-indigo-500/10',
            border: 'focus:border-indigo-500'
        },
        gray: {
            text: 'text-gray-700',
            ring: 'focus:ring-gray-500/10',
            border: 'focus:border-gray-500'
        }
    }
    return themes[props.theme]
})

function updatePosition() {
    if (!containerRef.value) return

    const rect = containerRef.value.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    placement.value = spaceBelow < 360 ? 'top' : 'bottom'

    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 32)
    const left = Math.min(Math.max(rect.left, 16), window.innerWidth - width - 16)

    menuStyle.value = {
        position: 'fixed',
        top: placement.value === 'bottom' ? `${rect.bottom + 8}px` : 'auto',
        bottom: placement.value === 'top' ? `${window.innerHeight - rect.top + 8}px` : 'auto',
        left: `${left}px`,
        width: `${width}px`,
        zIndex: '9999'
    }
}

function cleanup() {
    window.removeEventListener('scroll', updatePosition, true)
    window.removeEventListener('resize', updatePosition)
}

function close() {
    cleanup()
    isOpen.value = false
}

function toggle() {
    if (props.disabled) return

    if (isOpen.value) {
        close()
        return
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    isOpen.value = true
}

function handleSelect(date: Date) {
    emit('update:modelValue', DateUtils.formatLocalDate(date))
    close()
}

onUnmounted(() => {
    cleanup()
})
</script>

<template>
    <div ref="containerRef" class="relative">
        <button :id="id" type="button" :disabled="disabled" @click="toggle"
            class="w-full bg-gray-50 border border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 transition-all text-lg font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between gap-3"
            :class="[themeClasses.ring, themeClasses.border]">
            <span class="truncate" :class="selectedDate ? themeClasses.text : 'text-gray-400'">
                {{ displayText || placeholder || $t('common.select_placeholder') }}
            </span>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0 text-gray-400" fill="none"
                viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                    d="M8 7V3m8 4V3M5 11h14M7 21h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" />
            </svg>
        </button>

        <Teleport to="body">
            <div v-if="isOpen" class="fixed inset-0 z-[9998]" @click="close"></div>

            <transition
                enter-active-class="transition duration-200 ease-out"
                :enter-from-class="placement === 'bottom' ? 'transform scale-95 -translate-y-2 opacity-0' : 'transform scale-95 translate-y-2 opacity-0'"
                enter-to-class="transform scale-100 translate-y-0 opacity-100"
                leave-active-class="transition duration-150 ease-in"
                leave-from-class="transform scale-100 translate-y-0 opacity-100"
                :leave-to-class="placement === 'bottom' ? 'transform scale-95 -translate-y-2 opacity-0' : 'transform scale-95 translate-y-2 opacity-0'"
            >
                <div v-if="isOpen" class="rounded-2xl border border-amber-100 bg-white p-2 shadow-2xl"
                    :style="menuStyle">
                    <BaseCalendar compact :model-value="modelValue" :initial-month="modelValue"
                        @select-date="handleSelect" />
                </div>
            </transition>
        </Teleport>
    </div>
</template>
