<template>
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
        @click.self="close">
        <div
            class="bg-white rounded-[2.5rem] shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden animate-in zoom-in fade-in duration-300 flex flex-col mx-4">
            <!-- Header -->
            <div class="bg-amber-50 border-b border-amber-100 p-10">
                <div class="flex items-center gap-6">
                    <div
                        class="w-16 h-16 rounded-[1.5rem] bg-amber-100 flex items-center justify-center text-amber-600 shadow-inner">
                        <svg class="w-9 h-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div>
                        <h2 class="text-3xl font-black text-gray-900 tracking-tight">{{ $t('report.conflict.title') }}
                        </h2>
                        <p class="text-sm font-bold text-amber-700/60 mt-1 uppercase tracking-widest">
                            {{ $t('report.conflict.description') }}
                        </p>
                    </div>
                </div>
            </div>

            <!-- Content -->
            <div class="p-10 overflow-y-auto flex-1 custom-scrollbar">
                <!-- Strategy Selection -->
                <div class="mb-10">
                    <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 ml-1">
                        {{ $t('report.conflict.strategies_label') || 'Resolution Strategy' }}
                    </label>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label v-for="strategy in strategyOptions" :key="strategy.value"
                            class="relative flex flex-col p-6 border-2 rounded-[1.5rem] cursor-pointer transition-all duration-300 group select-none"
                            :class="selectedStrategy === strategy.value
                                ? 'border-emerald-500 bg-emerald-50/30 ring-4 ring-emerald-500/5'
                                : 'border-gray-50 bg-gray-50/50 hover:bg-white hover:border-emerald-100'">
                            <input type="radio" :value="strategy.value" v-model="selectedStrategy"
                                class="absolute top-6 right-6 text-emerald-600 focus:ring-0 w-5 h-5 border-gray-200" />
                            <div class="pr-8">
                                <div
                                    class="font-black text-gray-900 mb-2 group-hover:text-emerald-700 transition-colors uppercase tracking-tight">
                                    {{ strategy.label }}</div>
                                <div class="text-xs font-bold text-gray-400 leading-relaxed">{{ strategy.description }}
                                </div>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- Comparison Section -->
                <div v-if="selectedStrategy === 'manual'" class="space-y-10 animate-in fade-in slide-in-from-top-4">
                    <div class="grid grid-cols-2 gap-8">
                        <!-- Server Version -->
                        <div class="flex flex-col">
                            <h3
                                class="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 ml-1">
                                <span class="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-200"></span>
                                {{ $t('report.conflict.server_version') }}
                            </h3>
                            <div
                                class="p-6 bg-gray-50 border border-gray-100 rounded-[2rem] h-80 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner custom-scrollbar">
                                {{ serverContent }}
                            </div>
                        </div>

                        <!-- Local Version -->
                        <div class="flex flex-col">
                            <h3
                                class="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 ml-1">
                                <span
                                    class="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-200"></span>
                                {{ $t('report.conflict.local_version') }}
                            </h3>
                            <div
                                class="p-6 bg-gray-50 border border-gray-100 rounded-[2rem] h-80 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner custom-scrollbar">
                                {{ localContent }}
                            </div>
                        </div>
                    </div>

                    <!-- Manual Merge Editor -->
                    <div class="flex flex-col">
                        <label
                            class="flex items-center gap-2 text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-4 ml-1">
                            {{ $t('report.conflict.merged_content') }}
                        </label>
                        <textarea v-model="mergedContent"
                            class="w-full h-80 p-8 bg-white border-2 border-emerald-100 rounded-[2.5rem] font-mono text-sm leading-relaxed focus:ring-8 focus:ring-emerald-500/5 focus:border-emerald-500 transition-all outline-none text-gray-900 shadow-sm"
                            :placeholder="$t('report.conflict.merge_placeholder') || 'Edit the final merged content...'" />
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="bg-gray-50/50 border-t border-gray-100 p-10 flex items-center justify-end gap-6">
                <button @click="close"
                    class="px-8 py-4 text-sm font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest">
                    {{ $t('report.conflict.cancel_button') }}
                </button>
                <button @click="resolve" :disabled="selectedStrategy === 'manual' && !mergedContent"
                    class="px-10 py-5 bg-emerald-600 text-white text-sm font-black rounded-2xl shadow-2xl shadow-emerald-100 hover:bg-emerald-700 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all uppercase tracking-widest">
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

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e2e8f0;
    border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #cbd5e1;
}
</style>
