<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface Option {
    label: string
    value: any
}

const props = withDefaults(defineProps<{
    modelValue: any
    options: Option[]
    placeholder?: string
    fontSizeClass?: string
    multiple?: boolean
    disabled?: boolean
}>(), {
    placeholder: '',
    fontSizeClass: 'text-sm',
    multiple: false,
    disabled: false
})

const emit = defineEmits<{
    (e: 'update:modelValue', value: any): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const containerRef = ref<HTMLElement | null>(null)

const selectedLabel = computed(() => {
    if (props.multiple) {
        if (!Array.isArray(props.modelValue) || props.modelValue.length === 0) return ''
        return props.modelValue.map((val: any) => props.options.find(o => o.value === val)?.label).filter(Boolean).join(', ')
    } else {
        const opt = props.options.find(o => o.value === props.modelValue)
        return opt ? opt.label : ''
    }
})

const filteredOptions = computed(() => {
    if (!searchQuery.value) return props.options
    const q = searchQuery.value.toLowerCase()
    return props.options.filter(o => o.label.toLowerCase().includes(q))
})

function isSelected(opt: Option) {
    if (props.multiple) {
        return Array.isArray(props.modelValue) && props.modelValue.includes(opt.value)
    }
    return props.modelValue === opt.value
}

// Handle select
function selectOption(option: Option) {
    if (props.multiple) {
        const current = Array.isArray(props.modelValue) ? [...props.modelValue] : []
        const idx = current.indexOf(option.value)
        if (idx >= 0) {
            current.splice(idx, 1)
        } else {
            current.push(option.value)
        }
        emit('update:modelValue', current)
    } else {
        emit('update:modelValue', option.value)
        isOpen.value = false
        searchQuery.value = ''
    }
}

// Click outside to close
function handleClickOutside(event: MouseEvent) {
    if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
        isOpen.value = false
        searchQuery.value = ''
    }
}

onMounted(() => {
    document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside)
})

function toggleDropdown() {
    if (props.disabled) return
    if (isOpen.value) {
        isOpen.value = false
        searchQuery.value = ''
    } else {
        isOpen.value = true
        // Optional: auto-focus input
    }
}
</script>

<template>
    <div ref="containerRef" class="relative">
        <!-- Trigger/Input -->
        <div @click="toggleDropdown"
            role="button" :aria-disabled="disabled"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-emerald-500 cursor-pointer flex items-center justify-between"
            :class="[fontSizeClass, disabled ? 'cursor-not-allowed bg-gray-100 opacity-60' : '']">
            <input v-if="isOpen" v-model="searchQuery" ref="searchInput"
                class="w-full outline-none bg-transparent placeholder-gray-400"
                :placeholder="selectedLabel || (placeholder || $t('common.select_placeholder'))" @click.stop
                auto-focus />
            <span v-else class="truncate w-full" :class="!selectedLabel ? 'text-gray-400' : 'text-gray-700'">
                {{ selectedLabel || (placeholder || $t('common.select_placeholder')) }}
            </span>

            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 shrink-0 transition-transform"
                :class="isOpen ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
        </div>

        <!-- Dropdown -->
        <div v-if="isOpen"
            class="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            <ul v-if="filteredOptions.length > 0" class="py-1">
                <li v-for="opt in filteredOptions" :key="opt.value" @click.stop="selectOption(opt)"
                    class="px-3 py-2 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer truncate flex justify-between items-center"
                    :class="[
                        isSelected(opt) ? 'bg-emerald-50 text-emerald-700 font-medium' : '',
                        fontSizeClass
                    ]">
                    <span class="truncate">{{ opt.label }}</span>
                    <svg v-if="isSelected(opt) && multiple" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-600 shrink-0 ml-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                </li>
            </ul>
            <div v-else class="px-3 py-2 text-sm text-gray-400 italic">
                {{ $t('common.no_results') }}
            </div>
        </div>
    </div>
</template>

