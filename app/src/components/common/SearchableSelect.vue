<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'

interface Option {
    label: string
    value: any
    searchText?: string
    description?: string
}

const props = withDefaults(defineProps<{
    modelValue: any
    options: Option[]
    placeholder?: string
    fontSizeClass?: string
    multiple?: boolean
    disabled?: boolean
    ariaLabel?: string
}>(), {
    placeholder: '',
    fontSizeClass: 'text-sm',
    multiple: false,
    disabled: false,
    ariaLabel: ''
})

const emit = defineEmits<{
    (e: 'update:modelValue', value: any): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const activeIndex = ref(0)
const listId = `searchable-select-${Math.random().toString(36).slice(2)}`

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
    return props.options.filter(o => `${o.label} ${o.searchText ?? ''}`.toLowerCase().includes(q))
})

const activeOptionId = computed(() => filteredOptions.value[activeIndex.value]
    ? `${listId}-option-${activeIndex.value}`
    : undefined)

watch(filteredOptions, () => { activeIndex.value = Math.min(activeIndex.value, Math.max(filteredOptions.value.length - 1, 0)) })

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

function closeDropdown(returnFocus = false) {
    isOpen.value = false
    searchQuery.value = ''
    activeIndex.value = 0
    if (returnFocus) void nextTick(() => triggerRef.value?.focus())
}

function openDropdown() {
    if (props.disabled || isOpen.value) return
    isOpen.value = true
    activeIndex.value = Math.max(0, filteredOptions.value.findIndex(option => isSelected(option)))
    void nextTick(() => searchInput.value?.focus())
}

function onTriggerKeydown(event: KeyboardEvent) {
    if (props.disabled) return
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault()
        openDropdown()
    }
}

function onSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
        event.preventDefault()
        closeDropdown(true)
    } else if (event.key === 'ArrowDown' && filteredOptions.value.length) {
        event.preventDefault()
        activeIndex.value = (activeIndex.value + 1) % filteredOptions.value.length
    } else if (event.key === 'ArrowUp' && filteredOptions.value.length) {
        event.preventDefault()
        activeIndex.value = (activeIndex.value - 1 + filteredOptions.value.length) % filteredOptions.value.length
    } else if (event.key === 'Enter' && filteredOptions.value[activeIndex.value]) {
        event.preventDefault()
        const option = filteredOptions.value[activeIndex.value]
        selectOption(option)
        if (!props.multiple) closeDropdown(true)
    }
}

// Click outside to close
function handleClickOutside(event: MouseEvent) {
    if (containerRef.value && !containerRef.value.contains(event.target as Node)) {
        closeDropdown()
    }
}

onMounted(() => {
    document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside)
})

</script>

<template>
    <div ref="containerRef" class="relative">
        <!-- Trigger/Input -->
        <button ref="triggerRef" type="button" :disabled="disabled" @click="openDropdown" @keydown="onTriggerKeydown"
            role="button" :aria-disabled="disabled" :aria-haspopup="'listbox'" :aria-expanded="isOpen" :aria-label="ariaLabel || undefined"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-emerald-500 cursor-pointer flex items-center justify-between"
            :class="[fontSizeClass, disabled ? 'cursor-not-allowed bg-gray-100 opacity-60' : '']">
            <span class="truncate w-full text-left" :class="!selectedLabel ? 'text-gray-400' : 'text-gray-700'">{{ selectedLabel || (placeholder || $t('common.select_placeholder')) }}</span>

            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 shrink-0 transition-transform"
                :class="isOpen ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
        </button>

        <!-- Dropdown -->
        <div v-if="isOpen"
            class="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <input v-model="searchQuery" ref="searchInput" role="combobox" aria-autocomplete="list" :aria-expanded="true" :aria-controls="listId" :aria-activedescendant="activeOptionId"
                class="w-full border-b border-gray-100 px-3 py-2 outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
                :placeholder="placeholder || $t('common.select_placeholder')" :aria-label="ariaLabel || placeholder || $t('common.select_placeholder')" @keydown="onSearchKeydown" />
            <ul v-if="filteredOptions.length > 0" :id="listId" role="listbox" :aria-multiselectable="multiple" class="max-h-60 overflow-y-auto py-1">
                <li v-for="(opt, index) in filteredOptions" :id="`${listId}-option-${index}`" :key="opt.value" role="option" :aria-selected="isSelected(opt)" @mouseenter="activeIndex = index" @click.stop="selectOption(opt)"
                    class="flex cursor-pointer items-center justify-between px-3 py-2 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700"
                    :class="[isSelected(opt) || activeIndex === index ? 'bg-emerald-50 text-emerald-700' : '', fontSizeClass]">
                    <span class="min-w-0 truncate">{{ opt.label }}<span v-if="opt.description" class="ml-2 text-xs text-gray-400">{{ opt.description }}</span></span>
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

