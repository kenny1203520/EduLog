<template>
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
        @click.self="close">
        <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <!-- Header -->
            <div class="bg-amber-50 border-b border-amber-200 p-6">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-600">
                        <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-2xl font-black text-gray-900 tracking-tight">{{ $t('report.conflict.title') }}
                        </h2>
                        <p class="text-sm font-bold text-amber-700/70 mt-0.5">
                            {{ $t('report.conflict.description') }}
                        </p>
                    </div>
                </div>
            </div>

            <!-- Content -->
            <div class="p-8 overflow-y-auto" style="max-height: calc(90vh - 200px);">
                <!-- Strategy Selection -->
                <div class="mb-8">
                    <label class="block text-xs font-black text-gray-400 uppercase tracking-widest mb-4">
                        {{ $t('report.conflict.strategies_label') || 'Resolution Strategy' }}
                    </label>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label v-for="strategy in strategyOptions" :key="strategy.value"
                            class="relative flex flex-col p-5 border-2 rounded-2xl cursor-pointer transition-all duration-200 group"
                            :class="selectedStrategy === strategy.value
                                ? 'border-indigo-600 bg-indigo-50/50 ring-4 ring-indigo-50'
                                : 'border-gray-100 bg-white hover:border-gray-200'">
                            <input type="radio" :value="strategy.value" v-model="selectedStrategy"
                                class="absolute top-4 right-4 text-indigo-600 focus:ring-indigo-500 w-5 h-5 border-gray-300" />
                            <div class="pr-8">
                                <div
                                    class="font-black text-gray-900 mb-1 group-hover:text-indigo-600 transition-colors">
                                    {{ strategy.label }}</div>
                                <div class="text-xs font-bold text-gray-400 leading-relaxed">{{ strategy.description }}
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- Comparison Section -->
                <div v-if="selectedStrategy === 'manual'" class="space-y-6">
                    <div class="grid grid-cols-2 gap-6">
                        <!-- Server Version -->
                        <div class="flex flex-col">
                            <h3
                                class="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
                                <span class="w-2 h-2 rounded-full bg-rose-500"></span>
                                {{ $t('report.conflict.server_version') }}
                            </h3>
                            <div
                                class="p-5 bg-gray-50 border border-gray-100 rounded-2xl h-80 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner">
                                {{ serverContent }}
                            </div>
                        </div>

                        <!-- Local Version -->
                        <div class="flex flex-col">
                            <h3
                                class="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
                                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                                {{ $t('report.conflict.local_version') }}
                            </h3>
                            <div
                                class="p-5 bg-gray-50 border border-gray-100 rounded-2xl h-80 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner">
                                {{ localContent }}
                            </div>
                        </div>
                    </div>

                    <!-- Manual Merge Editor -->
                    <div class="flex flex-col">
                        <label
                            class="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">
                            {{ $t('report.conflict.merged_content') }}
                        </label>
                        <textarea v-model="mergedContent"
                            class="w-full h-80 p-6 bg-white border-2 border-indigo-100 rounded-3xl font-mono text-sm leading-relaxed focus:ring-4 focus:ring-indigo-50 focus:border-indigo-600 transition-all outline-none text-gray-900"
                            :placeholder="$t('report.conflict.merge_placeholder') || 'Edit the final merged content...'" />
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="bg-gray-50 border-t border-gray-100 p-8 flex items-center justify-end gap-4">
                <button @click="close"
                    class="px-6 py-3 text-sm font-black text-gray-500 hover:text-gray-900 transition-colors uppercase tracking-widest">
                    {{ $t('report.conflict.cancel_button') }}
                </button>
                <button @click="resolve" :disabled="selectedStrategy === 'manual' && !mergedContent"
                    class="px-8 py-4 bg-indigo-600 text-white text-sm font-black rounded-2xl shadow-xl shadow-indigo-100 hover:bg-indigo-700 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all uppercase tracking-widest">
                    {{ $t('report.conflict.resolve_button') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'

interface Props {
    isOpen: boolean
    serverContent: string
    localContent: string
}

const props = defineProps<Props>()
const { t } = useI18n()

const emit = defineEmits<{
    'close': []
    'resolve': [resolvedContent: string, strategy: string]
}>()

// State
const selectedStrategy = ref<'keep-local' | 'keep-server' | 'manual'>('manual')
const mergedContent = ref('')

const strategyOptions = computed(() => [
    {
        value: 'keep-local',
        label: t('report.conflict.strategies.keep_local'),
        description: t('report.conflict.strategies.keep_local_desc')
    },
    {
        value: 'keep-server',
        label: t('report.conflict.strategies.keep_server'),
        description: t('report.conflict.strategies.keep_server_desc')
    },
    {
        value: 'manual',
        label: t('report.conflict.strategies.manual'),
        description: t('report.conflict.strategies.manual_desc')
    }
])

// Watchers
watch(() => props.isOpen, (isOpen) => {
    if (isOpen) {
        // Initialize merged content with local version by default
        mergedContent.value = props.localContent
        selectedStrategy.value = 'manual'
    }
})

watch(() => props.localContent, (newContent) => {
    if (selectedStrategy.value === 'manual') {
        mergedContent.value = newContent
    }
})

// Methods
function close() {
    emit('close')
}

function resolve() {
    let resolvedContent: string

    switch (selectedStrategy.value) {
        case 'keep-local':
            resolvedContent = props.localContent
            break
        case 'keep-server':
            resolvedContent = props.serverContent
            break
        case 'manual':
            resolvedContent = mergedContent.value
            break
        default:
            resolvedContent = props.localContent
    }

    emit('resolve', resolvedContent, selectedStrategy.value)
}
</script>
