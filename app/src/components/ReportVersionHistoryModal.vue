<template>
    <div v-if="isOpen" class="fixed inset-0 z-[100] flex items-center justify-center p-8 sm:p-12">
        <!-- Backdrop -->
        <div class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm transition-opacity" @click="close"></div>

        <!-- Modal -->
        <div
            class="relative w-full max-w-4xl max-h-full bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <!-- Header -->
            <div class="px-6 py-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                <h3 class="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-emerald-600" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {{ $t('report.editor.version_history_title', '版本紀錄') }}
                </h3>
                <button @click="close"
                    class="text-gray-400 hover:text-gray-600 hover:bg-gray-100 p-2 rounded-xl transition-colors">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto p-6 bg-gray-50/30">
                <div v-if="isLoading" class="flex flex-col items-center justify-center py-12">
                    <svg class="animate-spin h-8 w-8 text-emerald-500 mb-4" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                        </circle>
                        <path class="opacity-75" fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                        </path>
                    </svg>
                    <span class="text-sm font-medium text-gray-500">{{ $t('report.editor.loading_versions',
                        '載入版本紀錄中...') }}</span>
                </div>

                <div v-else-if="versions.length === 0"
                    class="flex flex-col items-center justify-center py-12 text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mb-3 text-gray-300" fill="none"
                        viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p class="font-medium">{{ $t('report.editor.no_version_history', '尚無版本紀錄') }}</p>
                </div>

                <div v-else
                    class="relative space-y-8 before:absolute before:inset-0 before:ml-6 before:-translate-x-px before:h-full before:w-0.5 before:bg-gray-200/60">
                    <div v-for="(version, index) in versions" :key="version.id || index"
                        class="relative pl-14 group animate-in slide-in-from-bottom-4 duration-500"
                        :style="{ animationDelay: `${index * 50}ms` }">
                        <!-- Timeline Node -->
                        <div class="absolute left-0 w-12 h-12 flex items-center justify-center">
                            <div class="w-4 h-4 rounded-full border-4 border-white bg-gray-300 ring-1 ring-gray-200 z-10 transition-all duration-300 group-hover:bg-emerald-500 group-hover:ring-emerald-200 group-hover:scale-125"
                                :class="{ '!bg-emerald-600 !ring-emerald-100 ring-4': index === 0 }"></div>
                        </div>

                        <!-- Card -->
                        <div class="bg-white rounded-2xl border transition-all duration-300" :class="[
                            index === 0
                                ? 'border-emerald-200 shadow-lg ring-1 ring-emerald-50 bg-gradient-to-br from-white to-emerald-50/30'
                                : 'border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200'
                        ]">
                            <!-- Card Header -->
                            <div
                                class="px-5 py-4 border-b border-gray-50 flex flex-wrap items-center justify-between gap-4">
                                <div class="flex items-center gap-4">
                                    <div
                                        class="flex flex-col items-center justify-center w-10 h-10 rounded-xl bg-gray-900 text-white shadow-sm">
                                        <span class="text-[8px] font-black opacity-60 leading-none">VER</span>
                                        <span class="text-sm font-black leading-none mt-0.5">{{ version.version
                                        }}</span>
                                    </div>
                                    <div class="flex flex-col">
                                        <span class="text-sm font-bold text-gray-900">{{ version.createdAt ?
                                            version.createdAt.toLocaleString() : '-' }}</span>
                                        <span class="text-[10px] text-gray-500 font-medium flex items-center gap-1">
                                            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                            </svg>
                                            {{ version.editedBy || 'System' }}
                                        </span>
                                    </div>
                                </div>
                                <div v-if="index === 0"
                                    class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-wider">
                                    <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    {{ $t('report.editor.latest_version') }}
                                </div>
                            </div>

                            <!-- Card Body -->
                            <div class="p-6 space-y-6">
                                <!-- Metadata Grid -->
                                <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                                    <div class="flex flex-col gap-1">
                                        <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                            $t('report.editor.lesson_label') }}</span>
                                        <p class="text-xs font-bold text-gray-800 truncate">{{
                                            getLessonTitle(version.snapshot.lesson_id) }}</p>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                            $t('report.editor.attendance_title') }}</span>
                                        <div class="flex items-center gap-1.5">
                                            <span class="w-1.5 h-1.5 rounded-full"
                                                :class="version.snapshot.attendance_status === 'present' ? 'bg-emerald-500' : 'bg-rose-500'"></span>
                                            <p class="text-xs font-bold"
                                                :class="version.snapshot.attendance_status === 'present' ? 'text-emerald-600' : 'text-rose-500'">
                                                {{ version.snapshot.attendance_status === 'present' ?
                                                    $t('report.editor.present') : $t('report.editor.absent') +
                                                    `(${version.snapshot.absence_reason ? version.snapshot.absence_reason :
                                                        '-'})` }}
                                            </p>
                                        </div>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                            $t('report.editor.progress_label') }}</span>
                                        <p class="text-xs font-bold text-gray-800">
                                            {{ version.snapshot.is_completed ? $t('report.completed') :
                                                $t('report.incomplete') }}
                                        </p>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                            $t('report.editor.progress_label') }}</span>
                                        <p class="text-xs font-bold text-gray-800">
                                            {{ version.snapshot.progress_letter || '-' }}
                                        </p>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                            $t('report.participation') }}</span>
                                        <div class="flex items-center gap-0.5">
                                            <svg v-for="i in 5" :key="i" class="w-3 h-3"
                                                :class="i <= (version.snapshot.class_participation || 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'"
                                                viewBox="0 0 20 20" fill="currentColor">
                                                <path
                                                    d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                        </div>
                                    </div>
                                    <div class="flex flex-col gap-1">
                                        <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                            $t('report.behavior') }}</span>
                                        <div class="flex items-center gap-0.5">
                                            <svg v-for="i in 5" :key="i" class="w-3 h-3"
                                                :class="i <= (version.snapshot.classroom_behavior || 0) ? 'text-amber-400 fill-amber-400' : 'text-gray-200'"
                                                viewBox="0 0 20 20" fill="currentColor">
                                                <path
                                                    d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                            </svg>
                                        </div>
                                    </div>
                                </div>

                                <!-- Detailed Previews -->
                                <div class="space-y-4">
                                    <!-- Contact Notes -->
                                    <div v-if="version.id" class="bg-amber-50/50 rounded-xl p-4 border border-amber-100/50 transition-all duration-300 relative group"
                                         :class="shouldShowToggle(version.snapshot.contact_notes, 'notes') 
                                            ? (isExpanded(version.id, 'contact') ? 'pb-4' : 'max-h-[120px] overflow-hidden pb-12') 
                                            : 'pb-4'">
                                        <span class="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-2 block">{{ $t('report.editor.contact_notes_label') }}</span>
                                        <p class="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap"
                                           :class="(shouldShowToggle(version.snapshot.contact_notes, 'notes') && !isExpanded(version.id, 'contact')) ? 'line-clamp-3' : ''">
                                            {{ version.snapshot.contact_notes || $t('report.editor.empty_content') }}
                                        </p>
                                        <!-- Individual Toggle for Contact -->
                                        <div v-if="shouldShowToggle(version.snapshot.contact_notes, 'notes')"
                                             :class="isExpanded(version.id, 'contact') ? 'mt-4 flex justify-center' : 'absolute bottom-0 left-0 right-0 p-2 flex justify-center bg-gradient-to-t from-amber-50/95 to-transparent pt-8'">
                                            <button @click="toggleExpanded(version.id!, 'contact')" class="px-3 py-1 bg-white border border-amber-200 rounded-full text-[9px] font-black text-amber-700 hover:bg-amber-100 transition-all active:scale-95 flex items-center gap-1 shadow-sm">
                                                {{ isExpanded(version.id!, 'contact') ? $t('common.show_less') : $t('common.show_more') }}
                                                <svg class="w-2.5 h-2.5 transition-transform duration-300" :class="isExpanded(version.id!, 'contact') ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>

                                    <!-- Class Notes -->
                                    <div v-if="version.id" class="bg-blue-50/50 rounded-xl p-4 border border-blue-100/50 transition-all duration-300 relative group"
                                         :class="shouldShowToggle(version.snapshot.class_notes, 'notes')
                                            ? (isExpanded(version.id, 'class') ? 'pb-4' : 'max-h-[120px] overflow-hidden pb-12')
                                            : 'pb-4'">
                                        <span class="text-[9px] font-black text-blue-600 uppercase tracking-widest mb-2 block">{{ $t('report.editor.class_notes_label') }}</span>
                                        <p class="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap"
                                           :class="(shouldShowToggle(version.snapshot.class_notes, 'notes') && !isExpanded(version.id, 'class')) ? 'line-clamp-3' : ''">
                                            {{ version.snapshot.class_notes || $t('report.editor.empty_content') }}
                                        </p>
                                        <!-- Individual Toggle for Class -->
                                        <div v-if="shouldShowToggle(version.snapshot.class_notes, 'notes')"
                                             :class="isExpanded(version.id, 'class') ? 'mt-4 flex justify-center' : 'absolute bottom-0 left-0 right-0 p-2 flex justify-center bg-gradient-to-t from-blue-50/90 to-transparent pt-8'">
                                            <button @click="toggleExpanded(version.id!, 'class')" class="px-3 py-1 bg-white border border-blue-200 rounded-full text-[9px] font-black text-blue-700 hover:bg-blue-100 transition-all active:scale-95 flex items-center gap-1 shadow-sm">
                                                {{ isExpanded(version.id!, 'class') ? $t('common.show_less') : $t('common.show_more') }}
                                                <svg class="w-2.5 h-2.5 transition-transform duration-300" :class="isExpanded(version.id!, 'class') ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>

                                    <!-- Main Content -->
                                    <div v-if="version.id" class="bg-gray-50/80 rounded-xl p-4 border border-gray-100/50 transition-all duration-300 relative group"
                                         :class="shouldShowToggle(version.snapshot.content || version.content, 'content')
                                            ? (isExpanded(version.id, 'content') ? 'pb-4' : 'max-h-[180px] overflow-hidden pb-14')
                                            : 'pb-4'">
                                        <span class="text-[9px] font-black text-gray-400 uppercase tracking-widest mb-2 block">{{ $t('report.fields.content') }}</span>
                                        <p class="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-medium"
                                           :class="(shouldShowToggle(version.snapshot.content || version.content, 'content') && !isExpanded(version.id, 'content')) ? 'line-clamp-6' : ''">
                                            {{ (version.snapshot.content || version.content) || $t('report.editor.empty_content') }}
                                        </p>
                                        <!-- Individual Toggle for Content -->
                                        <div v-if="shouldShowToggle(version.snapshot.content || version.content, 'content')"
                                             :class="isExpanded(version.id, 'content') ? 'mt-4 flex justify-center' : 'absolute bottom-0 left-0 right-0 p-3 flex justify-center bg-gradient-to-t from-gray-50 to-transparent pt-10'">
                                            <button @click="toggleExpanded(version.id!, 'content')" class="px-4 py-1.5 bg-white border border-gray-200 rounded-full shadow-sm text-[10px] font-black text-gray-600 hover:bg-gray-50 transition-all active:scale-95 flex items-center gap-1.5">
                                                {{ isExpanded(version.id!, 'content') ? $t('common.show_less') : $t('common.show_more') }}
                                                <svg class="w-3 h-3 transition-transform duration-300" :class="isExpanded(version.id!, 'content') ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Card Footer -->
                            <div
                                class="px-6 py-4 bg-gray-50/40 border-t border-gray-50 flex justify-between items-center">
                                <span v-if="version.version === props.currentVersion"
                                    class="flex items-center gap-1.5 text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                            d="M5 13l4 4L19 7" />
                                    </svg>
                                    {{ $t('report.editor.current_version') }}
                                </span>
                                <div v-else></div>

                                <button v-if="version.version !== props.currentVersion"
                                    @click="handleRestoreClick(version)"
                                    class="flex items-center gap-2 text-[11px] font-black px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-all active:scale-95 shadow-sm group/btn">
                                    <svg class="w-3.5 h-3.5 transition-transform group-hover/btn:-rotate-180 duration-500"
                                        fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    {{ $t('report.editor.restore_version') }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                <button @click="close"
                    class="px-4 py-2 bg-white border border-gray-200 rounded-xl text-gray-600 font-bold text-sm hover:bg-gray-50 transition-colors">
                    {{ $t('common.close') }}
                </button>
            </div>
        </div>

        <!-- Confirm Restore Modal -->
        <ConfirmModal :is-open="confirmState.isOpen" :title="confirmState.title" :message="confirmState.message"
            :confirm-text="$t('report.editor.confirm_restore', '確認回檔')" :is-dangerous="true"
            :is-loading="confirmState.isLoading" @confirm="executeRestore" @close="confirmState.isOpen = false" />
    </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useAuthStore } from '@/stores/useAuthStore'
import { OccurrenceReportService } from '@/services/occurrence/OccurrenceReportService'
import type { ReportVersion, OccurrenceReportDTO } from '@/models/OccurrenceReport'
import ConfirmModal from '@/components/common/ConfirmModal.vue'

const props = defineProps<{
    isOpen: boolean
    reportId: string
    currentVersion: number
    availableLessons?: any[]
}>()

const emit = defineEmits<{
    (e: 'update:isOpen', value: boolean): void
    (e: 'restored', report: OccurrenceReportDTO): void
}>()

const { t } = useI18n()
const toast = useToast()
const authStore = useAuthStore()

const versions = ref<ReportVersion[]>([])
const isLoading = ref(false)
const isRestoring = ref(false)
const selectedVersion = ref<ReportVersion | null>(null)

const expandedStates = ref<Record<string, boolean>>({})
const confirmState = ref({
    isOpen: false,
    title: '',
    message: '',
    isLoading: false
})

function toggleExpanded(versionId: string, field: string = 'all') {
    const key = `${versionId}-${field}`
    expandedStates.value[key] = !expandedStates.value[key]
}

function isExpanded(versionId: string, field: string = 'all') {
    return expandedStates.value[`${versionId}-${field}`] || false
}

function shouldShowToggle(content: string | null | undefined, type: 'notes' | 'content'): boolean {
    if (!content) return false
    
    const lines = content.split('\n').length
    // 判斷行數
    if (type === 'notes' && lines > 3) return true
    if (type === 'content' && lines > 6) return true
    
    // 判斷概略長度 (聯絡欄容器較窄，閾值設低一點；主內容較寬，設高一點)
    if (type === 'notes' && content.length > 100) return true
    if (type === 'content' && content.length > 250) return true
    
    return false
}

watch(() => props.isOpen, async (newVal) => {
    if (newVal && props.reportId) {
        await loadVersions()
    } else {
        versions.value = []
    }
})

async function loadVersions() {
    try {
        isLoading.value = true
        versions.value = await OccurrenceReportService.getReportVersions(props.reportId)
    } catch (error) {
        console.error('Failed to load version history:', error)
        toast.error(t('report.editor.load_history_failed'))
    } finally {
        isLoading.value = false
    }
}

function getLessonTitle(lessonId: string | null) {
    if (!lessonId) return '-'
    const lesson = props.availableLessons?.find(l => l.id === lessonId)
    if (!lesson) return lessonId.slice(0, 8)

    const orderPrefix = lesson.sequence ? `L${lesson.sequence}` : ''
    return orderPrefix ? `${orderPrefix} ${lesson.title}` : lesson.title
}

function close() {
    emit('update:isOpen', false)
}

function handleRestoreClick(version: ReportVersion) {
    selectedVersion.value = version
    confirmState.value = {
        isOpen: true,
        title: t('report.editor.confirm_restore_title'),
        message: t('report.editor.confirm_restore_message', { version: version.version }),
        isLoading: false
    }
}

async function executeRestore() {
    if (!selectedVersion.value?.id || !props.reportId) return

    try {
        confirmState.value.isLoading = true
        isRestoring.value = true

        const restoredReport = await OccurrenceReportService.restoreReportVersion(
            props.reportId,
            selectedVersion.value.id,
            authStore.user?.id,
            props.currentVersion
        )

        toast.success(t('report.editor.restore_success'))
        emit('restored', restoredReport.toDTO())
        confirmState.value.isOpen = false
        close()
    } catch (error: any) {
        console.error('Failed to restore version:', error)
        if (error?.message?.includes('Conflict') || error?.message?.includes('modified by another user')) {
            toast.error(t('report.editor.restore_conflict_error'))
        } else {
            toast.error(t('report.editor.restore_failed'))
        }
    } finally {
        confirmState.value.isLoading = false
        isRestoring.value = false
        selectedVersion.value = null
    }
}
</script>
