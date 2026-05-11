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
}>(), {
    placeholder: '',
    fontSizeClass: 'text-sm'
})

const emit = defineEmits<{
    (e: 'update:modelValue', value: any): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const containerRef = ref<HTMLElement | null>(null)

const selectedOption = computed(() => {
    return props.options.find(o => o.value === props.modelValue)
})

const filteredOptions = computed(() => {
    if (!searchQuery.value) return props.options
    const q = searchQuery.value.toLowerCase()
    return props.options.filter(o => o.label.toLowerCase().includes(q))
})

// Handle select
function selectOption(option: Option) {
    emit('update:modelValue', option.value)
    isOpen.value = false
    searchQuery.value = ''
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
            class="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-emerald-500 cursor-pointer flex items-center justify-between"
            :class="fontSizeClass">
            <input v-if="isOpen" v-model="searchQuery" ref="searchInput"
                class="w-full outline-none bg-transparent placeholder-gray-400"
                :placeholder="selectedOption ? selectedOption.label : (placeholder || $t('common.select_placeholder'))" @click.stop
                auto-focus />
            <span v-else class="truncate w-full" :class="!selectedOption ? 'text-gray-400' : 'text-gray-700'">
                {{ selectedOption ? selectedOption.label : (placeholder || $t('common.select_placeholder')) }}
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
                <li v-for="opt in filteredOptions" :key="opt.value" @click="selectOption(opt)"
                    class="px-3 py-2 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer truncate"
                    :class="[
                        modelValue === opt.value ? 'bg-emerald-50 text-emerald-700 font-medium' : '',
                        fontSizeClass
                    ]">
                    {{ opt.label }}
                </li>
            </ul>
            <div v-else class="px-3 py-2 text-sm text-gray-400 italic">
                {{ $t('common.no_results') }}
            </div>
        </div>
    </div>
</template>
