<script setup lang="ts">
import { computed } from 'vue'




const props = defineProps<{
    modelValue: number // current page
    perPage: number
    totalItems: number
}>()

const emit = defineEmits<{
    (e: 'update:modelValue', page: number): void
    (e: 'update:perPage', size: number): void
}>()

const totalPages = computed(() => Math.ceil(props.totalItems / props.perPage))

const startItem = computed(() => {
    if (props.totalItems === 0) return 0
    return (props.modelValue - 1) * props.perPage + 1
})

const endItem = computed(() => {
    const end = props.modelValue * props.perPage
    return end > props.totalItems ? props.totalItems : end
})

function changePage(page: number) {
    if (page >= 1 && page <= totalPages.value) {
        emit('update:modelValue', page)
    }
}

function updatePerPage(event: Event) {
    const target = event.target as HTMLSelectElement
    emit('update:perPage', parseInt(target.value))
    emit('update:modelValue', 1) // Reset to page 1
}

// Visible Pages Logic (show max 5)
const visiblePages = computed(() => {
    const delta = 2
    const left = props.modelValue - delta
    const right = props.modelValue + delta + 1
    let range: number[] = []
    let pages: (number | string)[] = []
    let l: number | undefined

    for (let i = 1; i <= totalPages.value; i++) {
        if (i === 1 || i === totalPages.value || (i >= left && i < right)) {
            range.push(i)
        }
    }

    for (let i of range) {
        if (l) {
            if (i - l === 2) {
                pages.push(l + 1)
            } else if (i - l !== 1) {
                pages.push('...')
            }
        }
        pages.push(i)
        l = i
    }
    return pages
})
</script>

<template>
    <div class="flex flex-col sm:flex-row items-center justify-between gap-4 py-3 border-t border-gray-100">
        <!-- Info & Per Page -->
        <div class="flex items-center gap-4 text-sm text-gray-600">
            <span v-if="totalItems > 0">
                {{ $t('common.pagination.showing') }} <span class="font-medium">{{ startItem }}</span> {{
                    $t('common.pagination.to') }} <span class="font-medium">{{ endItem }}</span> {{
                    $t('common.pagination.of') }} <span class="font-medium">{{ totalItems }}</span> {{
                    $t('common.pagination.results') }}
            </span>
            <span v-else>{{ $t('common.pagination.no_results') }}</span>

            <div class="flex items-center gap-2">
                <span class="hidden sm:inline">{{ $t('common.pagination.show') }}</span>
                <select :value="perPage" @change="updatePerPage"
                    class="border-gray-200 rounded text-sm py-1 pl-2 pr-8 focus:ring-emerald-500 focus:border-emerald-500 cursor-pointer">
                    <option :value="10">10</option>
                    <option :value="20">20</option>
                    <option :value="50">50</option>
                    <option :value="100">100</option>
                </select>
            </div>
        </div>

        <!-- Pagination Controls -->
        <div v-if="totalPages > 1" class="flex items-center gap-1">
            <button @click="changePage(modelValue - 1)" :disabled="modelValue === 1"
                class="px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                </svg>
            </button>

            <template v-for="(p, index) in visiblePages" :key="index">
                <span v-if="p === '...'" class="px-2 text-gray-400">...</span>
                <button v-else @click="changePage(p as number)" class="px-3 py-1 text-sm rounded border transition"
                    :class="p === modelValue
                        ? 'bg-emerald-600 border-emerald-600 text-white font-medium'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-emerald-700'">
                    {{ p }}
                </button>
            </template>

            <button @click="changePage(modelValue + 1)" :disabled="modelValue === totalPages"
                class="px-2 py-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
            </button>
        </div>
    </div>
</template>
