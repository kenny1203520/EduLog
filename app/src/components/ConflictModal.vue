<template>
    <div v-if="isOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
        @click.self="close">
        <div
            class="bg-white rounded-[2.5rem] shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden animate-in zoom-in fade-in duration-300 flex flex-col mx-4">
            <!-- Header -->
            <div class="bg-amber-50 border-b border-amber-100 p-6 md:p-10">
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
            <div class="p-6 md:p-10 overflow-y-auto flex-1 custom-scrollbar">
                <!-- Strategy Selection -->
                <div class="mb-10">
                    <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6 ml-1">
                        {{ $t('report.conflict.strategies_label') }}
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
                <!-- Field Difference Table -->
                <div v-if="hasFieldDifferences" class="mb-10">
                    <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4 ml-1">
                        {{ $t('report.conflict.field_differences') }}
                    </label>
                    <div class="bg-gray-50 border border-gray-100 rounded-[1.5rem] overflow-hidden">
                        <table class="w-full text-left text-sm">
                            <thead
                                class="bg-gray-100/50 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                <tr>
                                    <th class="px-6 py-4">{{ $t('report.conflict.field') }}</th>
                                    <th class="px-6 py-4 text-rose-500">{{ $t('report.conflict.server_value') }}</th>
                                    <th class="px-6 py-4 text-emerald-600">{{ $t('report.conflict.local_value') }}</th>
                                    <th v-if="selectedStrategy === 'manual'" class="px-6 py-4">{{
                                        $t('report.conflict.merged_content') }}</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-100">
                                <tr v-for="diff in fieldDifferences" :key="diff.field"
                                    class="hover:bg-white transition-colors">
                                    <td class="px-6 py-4 font-bold text-gray-700">{{ diff.label }}</td>
                                    <td :class="[
                                        (selectedStrategy === 'keep-server') || (selectedStrategy === 'manual' && (mergedReport as any)[diff.field] === (serverReport as any)[diff.field])
                                            ? 'bg-emerald-50' : 'bg-rose-50'
                                    ]" class="px-6 py-4 text-gray-600 font-mono text-xs">
                                        {{diff.field == 'lesson_id' ? "Lesson " + availableLessons?.find((l: any) =>
                                            l.id === diff.serverRaw)?.sequence + " " + availableLessons?.find((l: any) =>
                                                l.id === diff.serverRaw)?.title : diff.server}}
                                        <button v-if="selectedStrategy === 'manual'"
                                            @click="setMergedValue(diff.field, diff.serverRaw)"
                                            class="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
                                            {{ $t('report.conflict.use_this') || 'Use This' }}
                                        </button>
                                    </td>
                                    <td :class="[
                                        (selectedStrategy === 'keep-local') || (selectedStrategy === 'manual' && (mergedReport as any)[diff.field] === (localReport as any)[diff.field])
                                            ? 'bg-emerald-50' : 'bg-rose-50'
                                    ]" class="px-6 py-4 text-gray-600 font-mono text-xs">
                                        {{diff.field == 'lesson_id' ? "Lesson " + availableLessons?.find((l: any) =>
                                            l.id === diff.localRaw)?.sequence + " " + availableLessons?.find((l: any) =>
                                                l.id === diff.localRaw)?.title : diff.local
                                        }}
                                        <button v-if="selectedStrategy === 'manual'"
                                            @click="setMergedValue(diff.field, diff.localRaw)"
                                            class="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
                                            {{ $t('report.conflict.use_this') || 'Use This' }}
                                        </button>
                                    </td>
                                    <td v-if="selectedStrategy === 'manual'" class="px-6 py-4">
                                        {{diff.field == 'lesson_id' ? "Lesson " + availableLessons?.find((l: any) =>
                                            l.id === mergedReport.lesson_id)?.sequence + " " + availableLessons?.find((l:
                                                any) => l.id === mergedReport.lesson_id)?.title : getMergedValue(diff.field)
                                        }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- MERGE SECTIONS -->

                <!-- 1. Contact Notes -->
                <div v-if="(serverReport?.contact_notes || localReport?.contact_notes) && (serverReport?.contact_notes != localReport?.contact_notes)"
                    class="flex flex-col">
                    <h3 class="flex items-center gap-2 text-sm font-black text-gray-900 uppercase tracking-widest mb-6">
                        <span class="w-2 h-8 bg-blue-500 rounded-full"></span>
                        {{ $t('report.fields.contact_notes') }}
                    </h3>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-6">
                        <!-- Server Contact Notes -->
                        <div class="flex flex-col">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-[10px] font-black text-rose-500 uppercase tracking-widest ml-1">{{
                                    $t('report.conflict.server_version') }}</span>
                                <button
                                    @click="mergedReport.contact_notes = serverReport?.contact_notes || ''; selectedStrategy = 'manual'"
                                    class="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
                                    {{ $t('report.conflict.use_this') || 'Use This' }}
                                </button>
                            </div>
                            <div :class="[
                                (selectedStrategy === 'keep-server' || (selectedStrategy === 'manual' && mergedReport.contact_notes === serverReport?.contact_notes))
                                    ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
                            ]"
                                class="p-6 border rounded-[2rem] h-40 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner custom-scrollbar relative">
                                <div v-if="serverReport?.contact_notes !== localReport?.contact_notes"
                                    class="absolute top-4 right-4 w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
                                <div class="whitespace-pre-wrap">
                                    <template v-for="(chunk, idx) in contactNotesDiff" :key="idx">
                                        <span v-if="chunk.type !== 'added'"
                                            :class="chunk.type === 'removed' ? 'bg-rose-100 text-rose-900 line-through' : ''">
                                            {{ chunk.value }}
                                        </span>
                                    </template>
                                    <span v-if="!serverReport?.contact_notes" class="text-gray-400 italic">{{
                                        $t('report.conflict.empty') }}</span>
                                </div>
                            </div>
                        </div>
                        <!-- Local Contact Notes -->
                        <div class="flex flex-col">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                    $t('report.conflict.local_version') }}</span>
                                <button
                                    @click="mergedReport.contact_notes = localReport?.contact_notes || ''; selectedStrategy = 'manual'"
                                    class="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
                                    {{ $t('report.conflict.use_this') || 'Use This' }}
                                </button>
                            </div>
                            <div :class="[
                                (selectedStrategy === 'keep-local' || (selectedStrategy === 'manual' && mergedReport.contact_notes === localReport?.contact_notes))
                                    ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
                            ]"
                                class="p-6 border rounded-[2rem] h-40 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner custom-scrollbar">
                                <div class="whitespace-pre-wrap">
                                    <template v-for="(chunk, idx) in contactNotesDiff" :key="idx">
                                        <span v-if="chunk.type !== 'removed'"
                                            :class="chunk.type === 'added' ? 'bg-emerald-100 text-emerald-900' : ''">
                                            {{ chunk.value }}
                                        </span>
                                    </template>
                                    <span v-if="!localReport?.contact_notes" class="text-gray-400 italic">{{
                                        $t('report.conflict.empty') }}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <label v-if="selectedStrategy === 'manual'"
                        class="flex items-center gap-2 text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-4 ml-1">
                        {{ $t('report.conflict.merged_content') }}
                    </label>
                    <textarea v-if="selectedStrategy === 'manual'" v-model="mergedReport.contact_notes"
                        class="w-full h-40 p-6 md:p-8 bg-white border-2 border-emerald-100 rounded-[2.5rem] font-mono text-sm leading-relaxed focus:ring-8 focus:ring-emerald-500/5 focus:border-emerald-500 transition-all outline-none text-gray-900 shadow-sm resize-none" />
                </div>

                <hr v-if="(serverReport?.class_notes || localReport?.class_notes) && (serverReport?.class_notes != localReport?.class_notes)"
                    class="border-gray-100 my-12 md:my-16" />

                <!-- 2. Class Notes -->
                <div v-if="(serverReport?.class_notes || localReport?.class_notes) && (serverReport?.class_notes != localReport?.class_notes)"
                    class="flex flex-col">
                    <h3 class="flex items-center gap-2 text-sm font-black text-gray-900 uppercase tracking-widest mb-6">
                        <span class="w-2 h-8 bg-purple-500 rounded-full"></span>
                        {{ $t('report.fields.class_notes') }}
                    </h3>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-6">
                        <!-- Server Class Notes -->
                        <div class="flex flex-col">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-[10px] font-black text-rose-500 uppercase tracking-widest ml-1">{{
                                    $t('report.conflict.server_version') }}</span>
                                <button
                                    @click="mergedReport.class_notes = serverReport?.class_notes || ''; selectedStrategy = 'manual'"
                                    class="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
                                    {{ $t('report.conflict.use_this') || 'Use This' }}
                                </button>
                            </div>
                            <div :class="[
                                (selectedStrategy === 'keep-server' || (selectedStrategy === 'manual' && mergedReport.class_notes === serverReport?.class_notes))
                                    ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
                            ]"
                                class="p-6 border rounded-[2rem] h-40 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner custom-scrollbar relative">
                                <div v-if="serverReport?.class_notes !== localReport?.class_notes"
                                    class="absolute top-4 right-4 w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
                                <div class="whitespace-pre-wrap">
                                    <template v-for="(chunk, idx) in classNotesDiff" :key="idx">
                                        <span v-if="chunk.type !== 'added'"
                                            :class="chunk.type === 'removed' ? 'bg-rose-100 text-rose-900 line-through' : ''">
                                            {{ chunk.value }}
                                        </span>
                                    </template>
                                    <span v-if="!serverReport?.class_notes" class="text-gray-400 italic">{{
                                        $t('report.conflict.empty') }}</span>
                                </div>
                            </div>
                        </div>
                        <!-- Local Class Notes -->
                        <div class="flex flex-col">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                    $t('report.conflict.local_version') }}</span>
                                <button
                                    @click="mergedReport.class_notes = localReport?.class_notes || ''; selectedStrategy = 'manual'"
                                    class="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
                                    {{ $t('report.conflict.use_this') || 'Use This' }}
                                </button>
                            </div>
                            <div :class="[
                                (selectedStrategy === 'keep-local' || (selectedStrategy === 'manual' && mergedReport.class_notes === localReport?.class_notes))
                                    ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
                            ]"
                                class="p-6 border rounded-[2rem] h-40 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner custom-scrollbar">
                                <div class="whitespace-pre-wrap">
                                    <template v-for="(chunk, idx) in classNotesDiff" :key="idx">
                                        <span v-if="chunk.type !== 'removed'"
                                            :class="chunk.type === 'added' ? 'bg-emerald-100 text-emerald-900' : ''">
                                            {{ chunk.value }}
                                        </span>
                                    </template>
                                    <span v-if="!localReport?.class_notes" class="text-gray-400 italic">{{
                                        $t('report.conflict.empty') }}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <label v-if="selectedStrategy === 'manual'"
                        class="flex items-center gap-2 text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-4 ml-1">
                        {{ $t('report.conflict.merged_content') }}
                    </label>
                    <textarea v-if="selectedStrategy === 'manual'" v-model="mergedReport.class_notes"
                        class="w-full h-40 p-6 md:p-8 bg-white border-2 border-emerald-100 rounded-[2.5rem] font-mono text-sm leading-relaxed focus:ring-8 focus:ring-emerald-500/5 focus:border-emerald-500 transition-all outline-none text-gray-900 shadow-sm resize-none" />
                </div>

                <hr v-if="(serverReport?.content || localReport?.content) && (serverReport?.content != localReport?.content)"
                    class="border-gray-100 my-12 md:my-16" />

                <!-- 3. Learning Report (Content) -->
                <div v-if="(serverReport?.content || localReport?.content) && (serverReport?.content != localReport?.content)"
                    class="flex flex-col mt-8 md:mt-12">
                    <h3 class="flex items-center gap-2 text-sm font-black text-gray-900 uppercase tracking-widest mb-6">
                        <span class="w-2 h-8 bg-emerald-500 rounded-full"></span>
                        {{ $t('report.fields.content') || 'Learning Report' }}
                    </h3>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 mb-6">
                        <!-- Server Content -->
                        <div class="flex flex-col">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-[10px] font-black text-rose-500 uppercase tracking-widest ml-1">{{
                                    $t('report.conflict.server_version') }}</span>
                                <button
                                    @click="mergedReport.content = serverReport?.content || ''; selectedStrategy = 'manual'"
                                    class="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
                                    {{ $t('report.conflict.use_this') || 'Use This' }}
                                </button>
                            </div>
                            <div :class="[
                                (selectedStrategy === 'keep-server' || (selectedStrategy === 'manual' && mergedReport.content === serverReport?.content))
                                    ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
                            ]"
                                class="p-6 border rounded-[2rem] h-60 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner custom-scrollbar relative group">
                                <div v-if="serverReport?.version !== localReport?.version"
                                    class="absolute top-4 right-4 w-2 h-2 rounded-full bg-rose-500 animate-pulse"></div>
                                <div class="whitespace-pre-wrap">
                                    <template v-for="(chunk, idx) in contentDiff" :key="idx">
                                        <span v-if="chunk.type !== 'added'"
                                            :class="chunk.type === 'removed' ? 'bg-rose-100 text-rose-900 line-through' : ''">
                                            {{ chunk.value }}
                                        </span>
                                    </template>
                                    <span v-if="!serverReport?.content" class="text-gray-400 italic">{{
                                        $t('report.conflict.empty') }}</span>
                                </div>
                            </div>
                        </div>
                        <!-- Local Content -->
                        <div class="flex flex-col">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                    $t('report.conflict.local_version') }}</span>
                                <button
                                    @click="mergedReport.content = localReport?.content || ''; selectedStrategy = 'manual'"
                                    class="text-[10px] font-bold text-emerald-600 hover:text-emerald-700 uppercase tracking-widest bg-emerald-50 px-3 py-1 rounded-lg hover:bg-emerald-100 transition-colors">
                                    {{ $t('report.conflict.use_this') || 'Use This' }}
                                </button>
                            </div>
                            <div :class="[
                                (selectedStrategy === 'keep-local' || (selectedStrategy === 'manual' && mergedReport.content === localReport?.content))
                                    ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-100'
                            ]"
                                class="p-6 border rounded-[2rem] h-60 overflow-y-auto font-mono text-sm leading-relaxed text-gray-600 shadow-inner custom-scrollbar">
                                <div class="whitespace-pre-wrap">
                                    <template v-for="(chunk, idx) in contentDiff" :key="idx">
                                        <span v-if="chunk.type !== 'removed'"
                                            :class="chunk.type === 'added' ? 'bg-emerald-100 text-emerald-900' : ''">
                                            {{ chunk.value }}
                                        </span>
                                    </template>
                                    <span v-if="!localReport?.content" class="text-gray-400 italic">{{
                                        $t('report.conflict.empty') }}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <label v-if="selectedStrategy === 'manual'"
                        class="flex items-center gap-2 text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-4 ml-1">
                        {{ $t('report.conflict.merged_content') }}
                    </label>
                    <textarea v-if="selectedStrategy === 'manual'" v-model="mergedReport.content"
                        class="w-full h-60 p-6 md:p-8 bg-white border-2 border-emerald-100 rounded-[2.5rem] font-mono text-sm leading-relaxed focus:ring-8 focus:ring-emerald-500/5 focus:border-emerald-500 transition-all outline-none text-gray-900 shadow-sm resize-none"
                        :placeholder="$t('report.conflict.merge_placeholder')" />
                </div>
            </div>

            <!-- Footer -->
            <div
                class="bg-gray-50/50 border-t border-gray-100 p-6 md:p-10 shrink-0 flex items-center justify-end gap-4 md:gap-6">
                <button @click="close"
                    class="px-6 md:px-8 py-4 text-sm font-black text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest">
                    {{ $t('report.conflict.cancel_button') }}
                </button>
                <button @click="resolve"
                    class="px-8 md:px-10 py-5 bg-emerald-600 text-white text-sm font-black rounded-2xl shadow-2xl shadow-emerald-100 hover:bg-emerald-700 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all uppercase tracking-widest">
                    {{ $t('report.conflict.resolve_button') }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OccurrenceReportDTO } from '@/models/OccurrenceReport'
import type { Lesson } from '@/models/Course'

interface Props {
    isOpen: boolean
    serverReport: OccurrenceReportDTO
    localReport: OccurrenceReportDTO
    availableLessons?: Lesson[]
}

const props = defineProps<Props>()
const { t } = useI18n()

const emit = defineEmits<{
    'close': []
    'resolve': [resolvedReport: OccurrenceReportDTO, strategy: string]
}>()

// State
const selectedStrategy = ref<'keep-local' | 'keep-server' | 'manual'>('manual')
const mergedReport = ref<OccurrenceReportDTO>({ ...props.localReport });

const getMergedValue = (field: keyof OccurrenceReportDTO) => {
    const val = (mergedReport.value as any)[field]
    if (field === 'lesson_id') {
        const lesson = props.availableLessons?.find((l: any) => l.id === val)
        return `Lesson ${lesson?.sequence} ${lesson?.title}`
    }
    if (typeof val === 'boolean') return val ? t('report.conflict.is_completed.yes') : t('report.conflict.is_completed.no')
    if (val === null || val === undefined) return t('report.conflict.empty')
    return val
}

const setMergedValue = (field: keyof OccurrenceReportDTO, value: any) => {
    if (field === 'lesson_id') {
        const lesson = props.availableLessons?.find((l: any) => l.id === value)
        mergedReport.value.lesson_id = lesson?.id
    }
    (mergedReport.value as any)[field] = value
}

// Diff Utility
type DiffChunk = { value: string, type: 'added' | 'removed' | 'unchanged' }
function computeDiff(oldText: string = '', newText: string = ''): DiffChunk[] {
    const s1 = (oldText || '').split(/(\s+)/).filter(x => x.length > 0);
    const s2 = (newText || '').split(/(\s+)/).filter(x => x.length > 0);
    const n = s1.length;
    const m = s2.length;
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

    for (let i = 1; i <= n; i++) {
        const row = dp[i]!;
        const prevRow = dp[i - 1]!;
        for (let j = 1; j <= m; j++) {
            if (s1[i - 1] === s2[j - 1]) {
                row[j] = prevRow[j - 1]! + 1;
            } else {
                row[j] = Math.max(prevRow[j]!, row[j - 1]!);
            }
        }
    }

    const result: DiffChunk[] = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && s1[i - 1] === s2[j - 1]) {
            result.unshift({ value: s1[i - 1]!, type: 'unchanged' });
            i--; j--;
        } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
            result.unshift({ value: s2[j - 1]!, type: 'added' });
            j--;
        } else if (i > 0) {
            result.unshift({ value: s1[i - 1]!, type: 'removed' });
            i--;
        } else {
            break;
        }
    }
    return result;
}

const contactNotesDiff = computed(() => computeDiff(props.serverReport?.contact_notes, props.localReport?.contact_notes))
const classNotesDiff = computed(() => computeDiff(props.serverReport?.class_notes, props.localReport?.class_notes))
const contentDiff = computed(() => computeDiff(props.serverReport?.content, props.localReport?.content))

// Computed field differences
const fieldDifferences = computed(() => {
    if (!props.serverReport || !props.localReport) return []

    // We focus on fields OTHER than the big text blocks now
    const fields: { key: keyof OccurrenceReportDTO; label: string }[] = [
        { key: 'lesson_id', label: t('report.fields.lesson_name') },
        { key: 'external_link', label: t('report.fields.external_link') },
        { key: 'is_completed', label: t('report.fields.is_completed') },
        { key: 'progress_letter', label: t('report.fields.progress_letter') },
        { key: 'attendance_status', label: t('report.fields.attendance_status') },
        { key: 'class_participation', label: t('report.fields.class_participation') },
        { key: 'classroom_behavior', label: t('report.fields.classroom_behavior') },
        // Notes are now handled in main UI
    ]

    const diffs: { field: keyof OccurrenceReportDTO; label: string; server: any; local: any; serverRaw: any; localRaw: any }[] = []

    // Helper to normalize values for comparison
    const normalize = (val: any) => {
        if (val === null || val === undefined) return ''
        if (typeof val === 'boolean') return val ? t('report.conflict.is_completed.yes') : t('report.conflict.is_completed.no')
        return String(val)
    }

    fields.forEach(f => {
        if (!props.serverReport || !props.localReport) return

        // Get values using the correct key (snake_case for server, camelCase for local)
        let serverVal = props.serverReport[f.key]
        let localVal = props.localReport[f.key]

        // Fallback for camelCase keys in local object
        if (localVal === undefined && props.localReport) {
            const camelKey: string = f.key.replace(/_([a-z])/g, (g: string) => g[1]?.toUpperCase() || '')

            if (camelKey && (props.localReport as any)[camelKey] !== undefined) {
                localVal = (props.localReport as any)[camelKey]
            }
        }

        // Normalize
        const s = normalize(serverVal)
        const l = normalize(localVal)

        if (s !== l) {
            diffs.push({
                field: f.key,
                label: f.label,
                server: s || t('report.conflict.empty'),
                local: l || t('report.conflict.empty'),
                serverRaw: serverVal,
                localRaw: localVal
            })
        }
    })

    return diffs
})

const hasFieldDifferences = computed(() => fieldDifferences.value.length > 0)

const strategyOptions = computed(() => [
    {
        value: 'keep-server',
        label: t('report.conflict.strategies.keep_server'),
        description: t('report.conflict.strategies.keep_server_desc')
    },
    {
        value: 'keep-local',
        label: t('report.conflict.strategies.keep_local'),
        description: t('report.conflict.strategies.keep_local_desc')
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
        mergedReport.value = { ...props.localReport }
        selectedStrategy.value = 'manual'
    }
})

watch(() => props.localReport, (newReport) => {
    if (selectedStrategy.value === 'manual' || selectedStrategy.value === 'keep-local') {
        mergedReport.value = { ...newReport }
    }
})

// Methods
function close() {
    emit('close')
}

function resolve() {
    let finalUpdates: OccurrenceReportDTO;

    if (selectedStrategy.value === 'keep-local') {
        finalUpdates = props.localReport;
    } else if (selectedStrategy.value === 'keep-server') {
        finalUpdates = props.serverReport
    } else {
        finalUpdates = mergedReport.value
    }

    emit('resolve', finalUpdates, selectedStrategy.value)
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
