<template>
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="$emit('close')">
        <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
            <!-- Header -->
            <div class="flex items-center justify-between p-6 border-b shrink-0">
                <h2 class="text-xl font-semibold text-gray-900">{{ $t('student.suspension.title') }}</h2>
                <button @click="$emit('close')" class="text-gray-400 hover:text-gray-500">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Body -->
            <div class="p-6 overflow-y-auto flex-1">
                <!-- Add New Suspension -->
                <div class="mb-8 p-4 bg-gray-50 rounded-lg border">
                    <h3 class="text-sm font-medium text-gray-900 mb-4">{{ $t('student.suspension.add_new') }}</h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">
                                {{ $t('student.suspension.start_date') }} <span class="text-red-500">*</span>
                            </label>
                            <input type="date" v-model="newSuspension.startDate"
                                class="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-1">
                                {{ $t('student.suspension.end_date') }}
                                <span class="text-xs text-gray-500">({{ $t('student.suspension.indefinite_hint')
                                    }})</span>
                            </label>
                            <input type="date" v-model="newSuspension.endDate"
                                class="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                        </div>
                        <div class="md:col-span-2">
                            <label class="block text-sm font-medium text-gray-700 mb-1">
                                {{ $t('student.suspension.reason') }}
                            </label>
                            <input type="text" v-model="newSuspension.reason"
                                :placeholder="$t('student.suspension.reason_placeholder')"
                                class="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                        </div>
                    </div>
                    <div class="mt-4 flex justify-end">
                        <button @click="addSuspension" :disabled="!isValid || isAdding"
                            class="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center">
                            <svg v-if="isAdding" class="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
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
                <div>
                    <h3 class="text-sm font-medium text-gray-900 mb-4">{{ $t('student.suspension.history') }}</h3>
                    <div v-if="isLoading" class="flex justify-center py-8">
                        <svg class="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none"
                            viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                    </div>
                    <div v-else-if="suspensions.length === 0" class="text-center py-8 text-gray-500">
                        {{ $t('student.suspension.no_records') }}
                    </div>
                    <div v-else class="space-y-3">
                        <div v-for="suspension in suspensions" :key="suspension.id"
                            class="flex items-center justify-between p-4 bg-white border rounded-lg hover:bg-gray-50 relative group"
                            :class="{ 'border-l-4 border-l-red-500': suspension.isActive }">
                            <div>
                                <div class="font-medium text-gray-900">
                                    {{ formatDate(suspension.startDate) }}
                                    <span class="mx-2 text-gray-400">→</span>
                                    <span :class="{ 'text-indigo-600 font-semibold': !suspension.endDate }">
                                        {{ suspension.endDate ? formatDate(suspension.endDate) :
                                            $t('student.suspension.indefinite') }}
                                    </span>
                                </div>
                                <div class="text-sm text-gray-500 mt-1" v-if="suspension.reason">
                                    {{ suspension.reason }}
                                </div>
                                <div class="mt-1" v-if="suspension.isActive">
                                    <span
                                        class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                        {{ $t('student.suspension.active') }}
                                    </span>
                                </div>
                            </div>
                            <div class="flex items-center space-x-2">
                                <!-- End Indefinite Button -->
                                <button v-if="suspension.isIndefinite && suspension.isActive"
                                    @click="endSuspensionNow(suspension)"
                                    class="text-sm text-indigo-600 hover:text-indigo-800 px-2 py-1 rounded hover:bg-indigo-50">
                                    {{ $t('student.suspension.end_now') }}
                                </button>

                                <button @click="deleteSuspension(suspension.id!)"
                                    class="p-1 text-gray-400 hover:text-red-600 rounded-full hover:bg-red-50"
                                    :title="$t('common.delete')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { SuspensionService } from '@/services/SuspensionService'
import type { Suspension } from '@/models/Suspension'
import { DateUtils } from '@/utils/DateUtils'

const props = defineProps<{
    enrollmentId: string
}>()

const emit = defineEmits(['close'])

const suspensions = ref<Suspension[]>([])
const isLoading = ref(true)
const isAdding = ref(false)

const newSuspension = ref({
    startDate: new Date().toISOString().split('T')[0],
    endDate: '', // Empty string for indefinite
    reason: ''
})

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
    } catch (e) {
        console.error(e)
        alert('Failed to create suspension')
    } finally {
        isAdding.value = false
    }
}

async function deleteSuspension(id: string) {
    if (!confirm('Are you sure you want to delete this suspension record? Reports marked as suspension might need manual review.')) return

    try {
        await SuspensionService.deleteSuspension(id)
        await loadSuspensions()
    } catch (e) {
        console.error(e)
        alert('Failed to delete suspension')
    }
}

async function endSuspensionNow(suspension: Suspension) {
    if (!suspension.id) return
    const today = new Date().toISOString().split('T')[0]

    // If start date is in future, today is invalid end date (before start). 
    // But button only shows if active, meaning start <= today.

    try {
        await SuspensionService.updateSuspension(suspension.id, {
            end_date: today
        })
        await loadSuspensions()
    } catch (e) {
        console.error(e)
        alert('Failed to update suspension')
    }
}

function formatDate(date: string) {
    return DateUtils.displayDate(date)
}
</script>
