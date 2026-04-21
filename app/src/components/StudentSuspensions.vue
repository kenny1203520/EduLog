<template>
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md"
        @click.self="$emit('close')">
        <div
            class="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in fade-in duration-300">
            <!-- Header -->
            <div class="flex items-center justify-between p-8 border-b border-gray-50 shrink-0">
                <h2 class="text-3xl font-black text-gray-900 tracking-tight">{{ $t('student.suspension.title') }}</h2>
                <button @click="$emit('close')"
                    class="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Body -->
            <div class="p-8 overflow-y-auto flex-1 custom-scrollbar">
                <!-- Add New Suspension -->
                <div class="mb-10 p-6 bg-gray-50 rounded-[2rem] border border-gray-100 shadow-sm">
                    <h3 class="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-6 ml-1">{{
                        $t('student.suspension.add_new') }}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="space-y-2">
                            <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                                {{ $t('student.suspension.start_date') }} <span class="text-red-500">*</span>
                            </label>
                            <input type="date" v-model="newSuspension.startDate"
                                class="w-full bg-white border-gray-100 rounded-2xl px-5 py-3 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-gray-700 shadow-sm">
                        </div>
                        <div class="space-y-2">
                            <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                                {{ $t('student.suspension.end_date') }}
                                <span class="text-[10px] lowercase italic lowercase">({{
                                    $t('student.suspension.indefinite_hint')
                                }})</span>
                            </label>
                            <input type="date" v-model="newSuspension.endDate"
                                class="w-full bg-white border-gray-100 rounded-2xl px-5 py-3 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-gray-700 shadow-sm">
                        </div>
                        <div class="md:col-span-2 space-y-2">
                            <label class="block text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">
                                {{ $t('student.suspension.reason') }}
                            </label>
                            <input type="text" v-model="newSuspension.reason"
                                :placeholder="$t('student.suspension.reason_placeholder')"
                                class="w-full bg-white border-gray-100 rounded-2xl px-5 py-3 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-gray-700 shadow-sm">
                        </div>
                    </div>
                    <div class="mt-8 flex justify-end">
                        <button @click="addSuspension" :disabled="!isValid || isAdding"
                            class="px-8 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 disabled:opacity-50 transition-all flex items-center gap-3 font-black shadow-xl shadow-emerald-100 active:scale-95">
                            <svg v-if="isAdding" class="animate-spin h-5 w-5 text-white"
                                xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                    stroke-width="4"></circle>
                                <path class="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                </path>
                            </svg>
                            {{ $t('common.add') }}
                        </button>
                    </div>
                </div>

                <!-- Existing Suspensions -->
                <div class="space-y-4">
                    <h3 class="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">{{
                        $t('student.suspension.history') }}</h3>
                    <div v-if="isLoading" class="flex flex-col items-center justify-center py-12">
                        <svg class="animate-spin h-10 w-10 text-emerald-500 mb-4" xmlns="http://www.w3.org/2000/svg"
                            fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                        <span class="text-xs font-bold text-gray-400 italic tracking-widest">{{ $t('common.loading')
                        }}</span>
                    </div>
                    <div v-else-if="suspensions.length === 0"
                        class="text-center py-12 bg-white rounded-[2rem] border border-dashed border-gray-100 text-gray-400 font-bold italic">
                        {{ $t('student.suspension.no_records') }}
                    </div>
                    <div v-else class="space-y-4">
                        <div v-for="suspension in suspensions" :key="suspension.id"
                            class="flex items-center justify-between p-6 bg-white border border-gray-100 rounded-[1.5rem] hover:shadow-lg transition-all relative group"
                            :class="{ 'border-l-8 border-l-rose-500 shadow-sm shadow-rose-50': suspension.isActive }">
                            <!-- Edit Mode -->
                            <div v-if="editingId === suspension.id" class="flex-1 flex flex-col gap-6">
                                <div class="grid grid-cols-2 gap-4">
                                    <div class="space-y-1.5">
                                        <label
                                            class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                                $t('student.suspension.end_date') }}</label>
                                        <input type="date" v-model="editForm.endDate"
                                            class="w-full text-sm font-bold bg-gray-50 border-gray-100 rounded-xl px-4 py-2 hover:bg-white transition-colors focus:ring-4 focus:ring-emerald-500/10 outline-none focus:border-emerald-500">
                                        <div class="mt-2 ml-1">
                                            <label
                                                class="inline-flex items-center text-[10px] font-black text-gray-400 hover:text-emerald-600 cursor-pointer transition-colors uppercase tracking-widest">
                                                <input type="checkbox" :checked="!editForm.endDate"
                                                    @change="(e) => editForm.endDate = ((e.target as HTMLInputElement).checked ? '' : (suspension.endDate || new Date().toISOString().split('T')[0])) as string"
                                                    class="rounded border-gray-300 w-3.5 h-3.5 text-emerald-600 focus:ring-0 mr-2">
                                                {{ $t('student.suspension.indefinite') }}
                                            </label>
                                        </div>
                                    </div>
                                    <div class="space-y-1.5">
                                        <label
                                            class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                                $t('student.suspension.reason') }}</label>
                                        <input type="text" v-model="editForm.reason"
                                            class="w-full text-sm font-bold bg-gray-50 border-gray-100 rounded-xl px-4 py-2 hover:bg-white transition-colors focus:ring-4 focus:ring-emerald-500/10 outline-none focus:border-emerald-500">
                                    </div>
                                </div>
                                <div class="flex justify-end gap-3 pt-4 border-t border-gray-50">
                                    <button @click="cancelEdit"
                                        class="px-4 py-2 text-sm font-black text-gray-400 hover:text-gray-600 transition-colors">
                                        {{ $t('common.cancel') }}
                                    </button>
                                    <button @click="saveEdit(suspension.id!)" :disabled="isSaving"
                                        class="px-6 py-2 bg-emerald-600 text-white rounded-xl text-sm font-black hover:bg-emerald-700 disabled:opacity-50 shadow-lg shadow-emerald-50 active:scale-95 transition-all">
                                        {{ isSaving ? $t('common.saving') : $t('common.save') }}
                                    </button>
                                </div>
                            </div>

                            <!-- View Mode -->
                            <div v-else class="flex-1">
                                <div class="flex items-center gap-3">
                                    <div
                                        class="w-10 h-10 rounded-xl bg-gray-50 text-gray-400 flex items-center justify-center shrink-0 border border-gray-50">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                            viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <div class="font-black text-gray-900 text-lg tracking-tight">
                                            {{ formatDate(suspension.startDate) }}
                                            <span class="mx-2 text-gray-300">→</span>
                                            <span :class="{ 'text-emerald-600': !suspension.endDate }">
                                                {{ suspension.endDate ? formatDate(suspension.endDate) :
                                                    $t('student.suspension.indefinite') }}
                                            </span>
                                        </div>
                                        <div class="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1"
                                            v-if="suspension.reason">
                                            {{ suspension.reason }}
                                        </div>
                                    </div>
                                </div>
                                <div class="mt-3 flex gap-2" v-if="suspension.isActive">
                                    <span
                                        class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-rose-50 text-rose-600 border border-rose-100">
                                        {{ $t('student.suspension.active') }}
                                    </span>
                                </div>
                            </div>

                            <!-- Actions (Only in View Mode) -->
                            <div v-if="editingId !== suspension.id"
                                class="flex items-center gap-1 ml-4 opacity-0 group-hover:opacity-100 transition-all">
                                <!-- End Indefinite Button (Quick Action) -->
                                <button v-if="suspension.isIndefinite && suspension.isActive"
                                    @click="endSuspensionNow(suspension)" :disabled="isEndingNowId === suspension.id"
                                    class="text-xs font-black text-emerald-600 hover:bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-100 shadow-sm transition-all active:scale-95 uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                                    <svg v-if="isEndingNowId === suspension.id"
                                        class="animate-spin h-3 w-3 text-emerald-600" viewBox="0 0 24 24">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor"
                                            stroke-width="4"></circle>
                                        <path class="opacity-75" fill="currentColor"
                                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                                        </path>
                                    </svg>
                                    {{ $t('student.suspension.end_now') }}
                                </button>

                                <button @click="startEdit(suspension)"
                                    class="p-3 text-gray-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                                    :title="$t('common.edit')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                </button>

                                <button @click="deleteSuspension(suspension.id!)"
                                    class="p-3 text-gray-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                                    :title="$t('common.delete')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        <ConfirmModal :is-open="genericConfirm.isOpen" :title="genericConfirm.title" :message="genericConfirm.message"
            :confirm-text="genericConfirm.confirmText" :is-dangerous="genericConfirm.isDangerous"
            :is-loading="genericConfirm.isLoading" @confirm="handleGenericConfirm"
            @close="genericConfirm.isOpen = false" />
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { SuspensionService } from '@/services/SuspensionService'
import type { Suspension } from '@/models/Suspension'
import { DateUtils } from '@/utils/DateUtils'
import ConfirmModal from './common/ConfirmModal.vue'

const props = defineProps<{
    enrollmentId: string
}>()

const { t } = useI18n()
const toast = useToast()
const emit = defineEmits(['close'])

const suspensions = ref<Suspension[]>([])
const isLoading = ref(true)
const isAdding = ref(false)
const isSaving = ref(false)
const isEndingNowId = ref<string | null>(null)

const editingId = ref<string | null>(null)
const editForm = ref({
    endDate: '',
    reason: ''
})

const newSuspension = ref({
    startDate: new Date().toISOString().split('T')[0],
    endDate: '', // Empty string for indefinite
    reason: ''
})

// Generic Confirm Modal State
const genericConfirm = ref({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDangerous: false,
    isLoading: false,
    action: null as (() => any) | null
})

function openConfirm(message: string, action: () => any, title?: string, isDangerous = false) {
    genericConfirm.value = {
        isOpen: true,
        title: title || t('common.confirm'),
        message,
        confirmText: t('common.confirm'),
        isDangerous,
        isLoading: false,
        action
    }
}

async function handleGenericConfirm() {
    if (genericConfirm.value.action) {
        try {
            genericConfirm.value.isLoading = true
            await genericConfirm.value.action()
            genericConfirm.value.isOpen = false
        } catch (e) {
            console.error(e)
        } finally {
            genericConfirm.value.isLoading = false
        }
    } else {
        genericConfirm.value.isOpen = false
    }
}

const isValid = computed(() => {
    if (!newSuspension.value.startDate) return false
    if (newSuspension.value.endDate && newSuspension.value.endDate < newSuspension.value.startDate) return false
    return true
})

onMounted(() => {
    loadSuspensions()
})

async function loadSuspensions() {
    isLoading.value = true
    try {
        suspensions.value = await SuspensionService.getSuspensions(props.enrollmentId)
    } catch (e) {
        console.error(e)
    } finally {
        isLoading.value = false
    }
}

async function addSuspension() {
    if (!isValid.value) return

    isAdding.value = true
    try {
        await SuspensionService.createSuspension(
            props.enrollmentId,
            newSuspension.value.startDate as string,
            newSuspension.value.endDate || null,
            newSuspension.value.reason
        )
        // Reset form
        newSuspension.value = {
            startDate: new Date().toISOString().split('T')[0],
            endDate: '',
            reason: ''
        }
        await loadSuspensions()
        toast.success(t('common.success') || 'Suspension added successfully')
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || 'Failed to create suspension')
    } finally {
        isAdding.value = false
    }
}

async function deleteSuspension(id: string) {
    openConfirm('Are you sure you want to delete this suspension record? Reports marked as suspension might need manual review.', async () => {
        try {
            await SuspensionService.deleteSuspension(id)
            await loadSuspensions()
            toast.success(t('common.deleted') || 'Suspension deleted successfully')
        } catch (e: any) {
            console.error(e)
            toast.error(e.message || 'Failed to delete suspension')
        }
    }, t('common.delete'), true)
}


function startEdit(suspension: Suspension) {
    editingId.value = suspension.id || null
    editForm.value = {
        endDate: suspension.endDate || '',
        reason: suspension.reason || ''
    }
}

function cancelEdit() {
    editingId.value = null
    editForm.value = { endDate: '', reason: '' }
}

async function saveEdit(id: string) {
    if (!id) return
    isSaving.value = true
    try {
        await SuspensionService.updateSuspension(id, {
            end_date: editForm.value.endDate || null,
            reason: editForm.value.reason || undefined
        })
        await loadSuspensions()
        editingId.value = null
        toast.success(t('common.success') || 'Suspension updated successfully')
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || 'Failed to update suspension')
    } finally {
        isSaving.value = false
    }
}

async function endSuspensionNow(suspension: Suspension) {
    if (!suspension.id) return
    const today = new Date().toISOString().split('T')[0]

    // If start date is in future, today is invalid end date (before start). 
    // But button only shows if active, meaning start <= today.

    try {
        isEndingNowId.value = suspension.id
        // Use the general update method which handles syncing
        await SuspensionService.updateSuspension(suspension.id, {
            end_date: today
        })
        await loadSuspensions()
        toast.success(t('common.success') || 'Suspension ended successfully')
    } catch (e: any) {
        console.error(e)
        toast.error(e.message || 'Failed to update suspension')
    } finally {
        isEndingNowId.value = null
    }
}

function formatDate(date: string) {
    return DateUtils.displayDate(date)
}
</script>
