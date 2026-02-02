<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { HolidayService } from '@/services/HolidayService'
import { CourseService } from '@/services/CourseService'
import { Holiday } from '@/models/Holiday'
import { useI18n } from 'vue-i18n'
import type { ClassroomDTO, ClassSessionDTO } from '@/models/Classroom'

const { t } = useI18n()
const holidays = ref<Holiday[]>([])
const classrooms = ref<ClassroomDTO[]>([])
const sessions = ref<ClassSessionDTO[]>([])
const loading = ref(true)
const isSaving = ref(false)
const isAddModalOpen = ref(false)
const editingId = ref<string | null>(null)

const scopeType = ref<'global' | 'classroom' | 'session'>('global')
const holidayForm = ref({
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    name: '',
    classroomId: '',
    classSessionId: ''
})

onMounted(async () => {
    await Promise.all([
        loadHolidays(),
        loadAuxData()
    ])
})

async function loadAuxData() {
    try {
        const [roomsRes, sessionsRes] = await Promise.all([
            CourseService.getClassrooms(1, 1000),
            CourseService.getClassSessions(1, 1000)
        ])
        classrooms.value = roomsRes.data
        sessions.value = sessionsRes.data
    } catch (e) {
        console.error('Failed to load classrooms/sessions:', e)
    }
}

async function loadHolidays() {
    try {
        loading.value = true
        holidays.value = await HolidayService.listHolidays()
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
}

async function handleSaveHoliday() {
    if (!holidayForm.value.startDate || !holidayForm.value.endDate) return
    try {
        isSaving.value = true

        const payload = {
            start_date: holidayForm.value.startDate,
            end_date: holidayForm.value.endDate,
            name: holidayForm.value.name,
            classroom_id: scopeType.value === 'classroom' ? holidayForm.value.classroomId : null,
            class_session_id: scopeType.value === 'session' ? holidayForm.value.classSessionId : null
        }

        if (editingId.value) {
            await HolidayService.updateHoliday(editingId.value, payload as any)
        } else {
            await HolidayService.createHoliday({
                startDate: payload.start_date,
                endDate: payload.end_date,
                name: payload.name,
                classroomId: payload.classroom_id || undefined,
                classSessionId: payload.class_session_id || undefined
            })
        }
        await loadHolidays()
        closeModal()
    } catch (e: any) {
        alert(e.message)
    } finally {
        isSaving.value = false
    }
}

async function handleDeleteHoliday(id: string) {
    if (!confirm(t('holiday.delete_confirm'))) return
    try {
        await HolidayService.deleteHoliday(id)
        await loadHolidays()
    } catch (e: any) {
        alert(e.message)
    }
}

function openAddModal() {
    editingId.value = null
    scopeType.value = 'global'
    holidayForm.value = {
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        name: '',
        classroomId: '',
        classSessionId: ''
    }
    isAddModalOpen.value = true
}

function openEditModal(holiday: Holiday) {
    editingId.value = holiday.id || null
    if (holiday.classSessionId) {
        scopeType.value = 'session'
    } else if (holiday.classroomId) {
        scopeType.value = 'classroom'
    } else {
        scopeType.value = 'global'
    }

    holidayForm.value = {
        startDate: holiday.startDate,
        endDate: holiday.endDate,
        name: holiday.name || '',
        classroomId: holiday.classroomId || '',
        classSessionId: holiday.classSessionId || ''
    }
    isAddModalOpen.value = true
}

function closeModal() {
    isAddModalOpen.value = false
    editingId.value = null
}
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <h1 class="text-2xl font-bold text-gray-800">{{ $t('holiday.title') }}</h1>
            <button @click="openAddModal"
                class="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm font-medium">
                <span>+</span> {{ $t('holiday.add_holiday') }}
            </button>
        </div>

        <!-- System Message -->
        <div class="bg-blue-50 border-l-4 border-blue-400 p-4 rounded-r-lg">
            <div class="flex">
                <div class="flex-shrink-0">
                    <svg class="h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"
                        fill="currentColor">
                        <path fill-rule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                            clip-rule="evenodd" />
                    </svg>
                </div>
                <div class="ml-3">
                    <p class="text-sm text-blue-700">
                        {{ $t('holiday.marking_status') }}
                    </p>
                </div>
            </div>
        </div>

        <div v-if="loading" class="text-center text-gray-400 py-10">
            <svg class="animate-spin h-8 w-8 mx-auto mb-3 text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                </path>
            </svg>
            {{ $t('common.loading', 'Loading...') }}
        </div>

        <div v-else class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{
                            $t('holiday.date_label') }}</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{
                            $t('holiday.scope_label') }}</th>
                        <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{{
                            $t('holiday.name_label') }}</th>
                        <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{{
                            $t('common.actions', 'Actions') }}</th>
                    </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                    <tr v-for="holiday in holidays" :key="holiday.id" class="hover:bg-gray-50 transition">
                        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {{ holiday.formattedRange }}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            <span v-if="holiday.sessionName"
                                class="px-2 py-0.5 bg-purple-50 text-purple-700 rounded text-xs font-medium border border-purple-100">
                                {{ $t('holiday.scope_session') }}: {{ holiday.sessionName }}
                            </span>
                            <span v-else-if="holiday.classroomName"
                                class="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-100">
                                {{ $t('holiday.scope_classroom') }}: {{ holiday.classroomName }}
                            </span>
                            <span v-else
                                class="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-medium border border-emerald-100">
                                {{ $t('holiday.scope_global') }}
                            </span>
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {{ holiday.name || '-' }}
                        </td>
                        <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <div class="flex justify-end gap-2">
                                <button @click="openEditModal(holiday)"
                                    class="text-emerald-600 hover:text-emerald-900 transition p-2 hover:bg-emerald-50 rounded-lg"
                                    :title="$t('common.edit')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20"
                                        fill="currentColor">
                                        <path
                                            d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                    </svg>
                                </button>
                                <button @click="handleDeleteHoliday(holiday.id!)"
                                    class="text-red-600 hover:text-red-900 transition p-2 hover:bg-red-50 rounded-lg"
                                    :title="$t('common.delete')">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20"
                                        fill="currentColor">
                                        <path fill-rule="evenodd"
                                            d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                            clip-rule="evenodd" />
                                    </svg>
                                </button>
                            </div>
                        </td>
                    </tr>
                    <tr v-if="holidays.length === 0">
                        <td colspan="4" class="px-6 py-10 text-center text-gray-400 italic">
                            {{ $t('holiday.no_holidays') }}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Add/Edit Holiday Modal -->
        <div v-if="isAddModalOpen"
            class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
                <h3 class="text-xl font-bold mb-6 text-gray-800">{{ editingId ? $t('common.edit') :
                    $t('holiday.add_holiday') }}</h3>
                <div class="space-y-4">
                    <!-- Scope Selection -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-2">{{ $t('holiday.scope_label')
                            }}</label>
                        <div class="flex bg-gray-100 p-1 rounded-lg gap-1">
                            <button @click="scopeType = 'global'"
                                class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                                :class="scopeType === 'global' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                                {{ $t('holiday.scope_global') }}
                            </button>
                            <button @click="scopeType = 'classroom'"
                                class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                                :class="scopeType === 'classroom' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                                {{ $t('holiday.scope_classroom') }}
                            </button>
                            <button @click="scopeType = 'session'"
                                class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                                :class="scopeType === 'session' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'">
                                {{ $t('holiday.scope_session') }}
                            </button>
                        </div>
                    </div>

                    <!-- Scope Targets -->
                    <div v-if="scopeType === 'classroom'">
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{
                            $t('holiday.scope_classroom') }}</label>
                        <select v-model="holidayForm.classroomId"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                            <option value="">{{ $t('common.select', 'Select...') }}</option>
                            <option v-for="room in classrooms" :key="room.id" :value="room.id">{{ room.name }}</option>
                        </select>
                    </div>
                    <div v-if="scopeType === 'session'">
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{
                            $t('holiday.scope_session') }}</label>
                        <select v-model="holidayForm.classSessionId"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                            <option value="">{{ $t('common.select', 'Select...') }}</option>
                            <option v-for="s in sessions" :key="s.id" :value="s.id">{{ s.name }} ({{
                                classrooms.find(r => r.id === s.classroom_id)?.name}})</option>
                        </select>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('holiday.date_label')
                            }} ({{ $t('common.start') }})</label>
                            <input type="date" v-model="holidayForm.startDate"
                                class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('common.end')
                            }}</label>
                            <input type="date" v-model="holidayForm.endDate"
                                class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                        </div>
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('holiday.name_label')
                        }}</label>
                        <input v-model="holidayForm.name" :placeholder="$t('holiday.holiday_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>
                </div>
                <div class="flex justify-end gap-3 mt-8">
                    <button @click="closeModal" :disabled="isSaving"
                        class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors disabled:opacity-50">
                        {{ $t('common.cancel') }}
                    </button>
                    <button @click="handleSaveHoliday" :disabled="isSaving"
                        class="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2">
                        <svg v-if="isSaving" class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4">
                            </circle>
                            <path class="opacity-75" fill="currentColor"
                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                            </path>
                        </svg>
                        {{ editingId ? $t('common.save') : $t('common.add') }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
