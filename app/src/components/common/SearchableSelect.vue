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
    remoteSearch?: boolean
    loading?: boolean
    noResultsText?: string
    loadingText?: string
    descriptionPlacement?: 'inline' | 'below'
    showSelectedDescription?: boolean
}>(), {
    placeholder: '',
    fontSizeClass: 'text-sm',
    multiple: false,
    disabled: false,
    ariaLabel: '',
    remoteSearch: false,
    loading: false,
    noResultsText: '',
    loadingText: '',
    descriptionPlacement: 'inline',
    showSelectedDescription: false
})

const emit = defineEmits<{
    (e: 'update:modelValue', value: any): void
    (e: 'search', query: string): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const containerRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)
const activeIndex = ref(0)
const selectedOptionCache = ref<Option | null>(null)
const listId = `searchable-select-${Math.random().toString(36).slice(2)}`
const menuStyle = ref<Record<string, string>>({})
const listMaxHeight = ref('15rem')

const selectedLabel = computed(() => {
    if (props.multiple) {
        if (!Array.isArray(props.modelValue) || props.modelValue.length === 0) return ''
        return props.modelValue.map((val: any) => props.options.find(o => o.value === val)?.label).filter(Boolean).join(', ')
    } else {
        const opt = props.options.find(o => o.value === props.modelValue)
            ?? (selectedOptionCache.value?.value === props.modelValue ? selectedOptionCache.value : null)
        return opt ? opt.label : ''
    }
})

const selectedTitle = computed(() => {
    const optionText = (option?: Option) => option ? [option.label, option.description].filter(Boolean).join(' — ') : ''
    if (props.multiple) {
        if (!Array.isArray(props.modelValue)) return ''
        return props.modelValue.map((value: any) => optionText(props.options.find(option => option.value === value))).filter(Boolean).join(', ')
    }
    const option = props.options.find(item => item.value === props.modelValue)
        ?? (selectedOptionCache.value?.value === props.modelValue ? selectedOptionCache.value : null)
    return optionText(option ?? undefined)
})

const selectedDescription = computed(() => {
    if (props.multiple) return ''
    const option = props.options.find(item => item.value === props.modelValue)
        ?? (selectedOptionCache.value?.value === props.modelValue ? selectedOptionCache.value : null)
    return option?.description ?? ''
})

const filteredOptions = computed(() => {
    if (props.remoteSearch) return props.options
    if (!searchQuery.value) return props.options
    const q = searchQuery.value.toLowerCase()
    return props.options.filter(o => `${o.label} ${o.searchText ?? ''}`.toLowerCase().includes(q))
})

const activeOptionId = computed(() => filteredOptions.value[activeIndex.value]
    ? `${listId}-option-${activeIndex.value}`
    : undefined)

watch(filteredOptions, () => { activeIndex.value = Math.min(activeIndex.value, Math.max(filteredOptions.value.length - 1, 0)) })
watch(searchQuery, query => {
    if (props.remoteSearch) emit('search', query)
})
watch(() => props.options, options => {
    const selected = options.find(option => option.value === props.modelValue)
    if (selected) selectedOptionCache.value = selected
}, { immediate: true, deep: true })

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
        selectedOptionCache.value = option
        emit('update:modelValue', option.value)
        isOpen.value = false
        searchQuery.value = ''
    }
}

function closeDropdown(returnFocus = false) {
    isOpen.value = false
    stopPositionTracking()
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

function updateMenuPosition() {
    const trigger = triggerRef.value
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const margin = 8
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth
    const viewportHeight = window.innerHeight
    const width = Math.max(0, Math.min(rect.width, viewportWidth - margin * 2))
    const left = Math.min(Math.max(rect.left, margin), viewportWidth - width - margin)
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - margin)
    const spaceAbove = Math.max(0, rect.top - margin)
    const openAbove = spaceBelow < Math.min(240, spaceAbove)
    const availableHeight = openAbove ? spaceAbove : spaceBelow
    const maxHeight = Math.max(96, Math.min(300, availableHeight))

    menuStyle.value = {
        position: 'fixed',
        top: openAbove ? 'auto' : `${rect.bottom + 4}px`,
        bottom: openAbove ? `${viewportHeight - rect.top + 4}px` : 'auto',
        left: `${left}px`,
        width: `${width}px`,
        maxHeight: `${maxHeight}px`,
        zIndex: '10050'
    }
    listMaxHeight.value = `${Math.max(48, maxHeight - 52)}px`
}

function startPositionTracking() {
    window.addEventListener('scroll', updateMenuPosition, true)
    window.addEventListener('resize', updateMenuPosition)
    window.visualViewport?.addEventListener('resize', updateMenuPosition)
    window.visualViewport?.addEventListener('scroll', updateMenuPosition)
}

function stopPositionTracking() {
    window.removeEventListener('scroll', updateMenuPosition, true)
    window.removeEventListener('resize', updateMenuPosition)
    window.visualViewport?.removeEventListener('resize', updateMenuPosition)
    window.visualViewport?.removeEventListener('scroll', updateMenuPosition)
}

watch(isOpen, async open => {
    stopPositionTracking()
    if (!open) return

    startPositionTracking()
    await nextTick()
    updateMenuPosition()
})

// Click outside to close
function handleClickOutside(event: MouseEvent) {
    const target = event.target
    if (!(target instanceof Node)) return
    if (containerRef.value?.contains(target) || menuRef.value?.contains(target)) return
    closeDropdown()
}

onMounted(() => {
    document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
    document.removeEventListener('click', handleClickOutside)
    stopPositionTracking()
})

</script>

<template>
    <div ref="containerRef" class="relative">
        <!-- Trigger/Input -->
        <button ref="triggerRef" type="button" role="button" :disabled="disabled" @click="openDropdown" @keydown="onTriggerKeydown"
            :aria-disabled="disabled" :aria-haspopup="'listbox'" :aria-expanded="isOpen" :aria-label="ariaLabel || undefined"
            :title="selectedTitle || placeholder || $t('common.select_placeholder')"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-emerald-500 cursor-pointer flex items-center justify-between gap-2 text-left"
            :class="[fontSizeClass, disabled ? 'cursor-not-allowed bg-gray-100 opacity-60' : '']">
            <span v-if="showSelectedDescription && selectedDescription" class="min-w-0 flex-1">
                <span class="block break-words text-gray-700">{{ selectedLabel }}</span>
                <span class="mt-0.5 block whitespace-normal break-words text-xs leading-4 text-gray-500">{{ selectedDescription }}</span>
            </span>
            <span v-else class="min-w-0 flex-1 truncate" :class="!selectedLabel ? 'text-gray-400' : 'text-gray-700'">{{ selectedLabel || (placeholder || $t('common.select_placeholder')) }}</span>

            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 shrink-0 transition-transform"
                :class="isOpen ? 'rotate-180' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
        </button>

        <!-- Teleport avoids clipping by responsive cards and scroll containers. -->
        <Teleport to="body">
        <div v-if="isOpen" ref="menuRef" :style="menuStyle"
            class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
            <input v-model="searchQuery" ref="searchInput" role="combobox" aria-autocomplete="list" :aria-expanded="true" :aria-controls="listId" :aria-activedescendant="activeOptionId"
                class="w-full border-b border-gray-100 px-3 py-2 outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500"
                :placeholder="placeholder || $t('common.select_placeholder')" :aria-label="ariaLabel || placeholder || $t('common.select_placeholder')" @keydown="onSearchKeydown" />
            <ul :id="listId" role="listbox" :aria-multiselectable="multiple" :style="{ maxHeight: listMaxHeight }" class="overflow-y-auto py-1">
                <li v-for="(opt, index) in filteredOptions" :id="`${listId}-option-${index}`" :key="opt.value" role="option" :aria-selected="isSelected(opt)" :title="[opt.label, opt.description].filter(Boolean).join(' — ')" @mouseenter="activeIndex = index" @click.stop="selectOption(opt)"
                    class="flex cursor-pointer justify-between gap-2 px-3 py-2 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700"
                    :class="[isSelected(opt) || activeIndex === index ? 'bg-emerald-50 text-emerald-700' : '', descriptionPlacement === 'below' ? 'items-start' : 'items-center', fontSizeClass]">
                    <span v-if="descriptionPlacement === 'below' && opt.description" class="min-w-0 flex-1 text-left">
                        <span class="block whitespace-normal break-words">{{ opt.label }}</span>
                        <span class="mt-0.5 block whitespace-normal break-words text-xs leading-4 text-gray-500">{{ opt.description }}</span>
                    </span>
                    <span v-else class="min-w-0 flex-1 truncate text-left">{{ opt.label }}<span v-if="opt.description" class="ml-2 text-xs text-gray-400">{{ opt.description }}</span></span>
                    <svg v-if="isSelected(opt) && multiple" xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-emerald-600 shrink-0 ml-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                    </svg>
                </li>
                <li v-if="!filteredOptions.length" role="presentation" class="px-3 py-2 text-sm text-gray-500">
                    <span role="status" aria-live="polite">{{ loading ? (loadingText || $t('common.loading')) : (noResultsText || $t('common.no_results')) }}</span>
                </li>
            </ul>
        </div>
        </Teleport>
    </div>
</template>

