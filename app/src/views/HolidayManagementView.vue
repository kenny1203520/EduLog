<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { HolidayService } from '@/services/HolidayService'
import { CourseService } from '@/services/CourseService'
import { Holiday } from '@/models/Holiday'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import type { ClassroomDTO, ClassSessionDTO } from '@/models/Classroom'

const { t } = useI18n()
const toast = useToast()
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
    classroomIds: [] as string[],
    classSessionIds: [] as string[]
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

function getNamesForIds(type: 'classroom' | 'session', ids: string[]) {
    if (type === 'classroom') {
        return ids.map(id => classrooms.value.find(r => r.id === id)?.name).filter(Boolean).join(', ')
    } else {
        return ids.map(id => sessions.value.find(s => s.id === id)?.name).filter(Boolean).join(', ')
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
            classroom_ids: scopeType.value === 'classroom' ? holidayForm.value.classroomIds : [],
            class_session_ids: scopeType.value === 'session' ? holidayForm.value.classSessionIds : []
        }

        if (editingId.value) {
            await HolidayService.updateHoliday(editingId.value, payload as any)
        } else {
            await HolidayService.createHoliday({
                startDate: payload.start_date,
                endDate: payload.end_date,
                name: payload.name,
                classroomIds: payload.classroom_ids,
                classSessionIds: payload.class_session_ids
            })
        }
        await loadHolidays()
        closeModal()
        toast.success(t('holiday.save_success') || 'Holiday saved successfully')
    } catch (e: any) {
        toast.error(e.message || 'Failed to save holiday')
    } finally {
        isSaving.value = false
    }
}

async function handleDeleteHoliday(id: string) {
    if (!confirm(t('holiday.delete_confirm'))) return
    try {
        await HolidayService.deleteHoliday(id)
        await loadHolidays()
        toast.success(t('holiday.delete_success') || 'Holiday deleted successfully')
    } catch (e: any) {
        toast.error(e.message || 'Failed to delete holiday')
    }
}

function openAddModal() {
    editingId.value = null
    scopeType.value = 'global'
    holidayForm.value = {
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        name: '',
        classroomIds: [],
        classSessionIds: []
    }
    isAddModalOpen.value = true
}

function openEditModal(holiday: Holiday) {
    editingId.value = holiday.id || null
    if (holiday.classSessionIds && holiday.classSessionIds.length > 0) {
        scopeType.value = 'session'
    } else if (holiday.classroomIds && holiday.classroomIds.length > 0) {
        scopeType.value = 'classroom'
    } else {
        scopeType.value = 'global'
    }

    holidayForm.value = {
        startDate: holiday.startDate,
        endDate: holiday.endDate,
        name: holiday.name || '',
        classroomIds: holiday.classroomIds ? [...holiday.classroomIds] : [],
        classSessionIds: holiday.classSessionIds ? [...holiday.classSessionIds] : []
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

        <div v-if="loading"
            class="flex flex-col items-center justify-center py-20 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm">
            <svg class="animate-spin h-10 w-10 mb-4 text-emerald-500" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                </path>
            </svg>
            <p class="text-gray-400 font-bold italic tracking-widest">{{ $t('common.loading') }}</p>
        </div>

        <div v-else-if="holidays.length > 0"
            class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div v-for="holiday in holidays" :key="holiday.id"
                class="bg-white rounded-[2rem] border border-gray-100 p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group relative overflow-hidden">
                <!-- Card Header: Title & Actions -->
                <div class="flex justify-between items-start mb-4">
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                            <span v-if="holiday.classSessionIds.length > 0"
                                class="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-purple-100">
                                {{ $t('holiday.scope_session') }}
                            </span>
                            <span v-else-if="holiday.classroomIds.length > 0"
                                class="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-100">
                                {{ $t('holiday.scope_classroom') }}
                            </span>
                            <span v-else
                                class="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-100">
                                {{ $t('holiday.scope_global') }}
                            </span>
                        </div>
                        <h3 class="text-xl font-black text-gray-900 truncate leading-tight">
                            {{ holiday.name || 'Untitled Holiday' }}
                        </h3>
                    </div>

                    <div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button @click="openEditModal(holiday)"
                            class="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                            :title="$t('common.edit')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20"
                                fill="currentColor">
                                <path
                                    d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                            </svg>
                        </button>
                        <button @click="handleDeleteHoliday(holiday.id!)"
                            class="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                            :title="$t('common.delete')">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20"
                                fill="currentColor">
                                <path fill-rule="evenodd"
                                    d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                                    clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Card Content -->
                <div class="space-y-4">
                    <!-- Date Range -->
                    <div class="flex items-center gap-3">
                        <div
                            class="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-emerald-600 border border-gray-100 shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <div>
                            <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">{{
                                $t('holiday.date_label') }}</p>
                            <p class="text-sm font-bold text-gray-700">{{ holiday.formattedRange }}</p>
                        </div>
                    </div>

                    <!-- Target Detail -->
                    <div v-if="holiday.classroomIds.length > 0 || holiday.classSessionIds.length > 0"
                        class="pt-3 border-t border-gray-50">
                        <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">{{
                            $t('holiday.scope_label') }} Detail</p>
                        <p class="text-xs font-medium text-gray-600 line-clamp-2 italic">
                            {{ holiday.classSessionIds.length > 0 ? getNamesForIds('session', holiday.classSessionIds) :
                                getNamesForIds('classroom', holiday.classroomIds) }}
                        </p>
                    </div>
                </div>

                <!-- Card Bottom Accent -->
                <div class="absolute bottom-0 left-0 right-0 h-1.5" :class="[
                    holiday.classSessionIds.length > 0 ? 'bg-purple-500/20' :
                        holiday.classroomIds.length > 0 ? 'bg-blue-500/20' : 'bg-emerald-500/20'
                ]"></div>
            </div>
        </div>

        <!-- Empty State -->
        <div v-else
            class="text-center py-32 bg-white rounded-[3rem] border border-dashed border-gray-200 shadow-sm flex flex-col items-center animate-in fade-in duration-1000">
            <div
                class="w-24 h-24 bg-emerald-50 rounded-[2rem] flex items-center justify-center mb-8 shadow-inner transform -rotate-12">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-emerald-400" fill="none"
                    viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
            </div>
            <h3 class="text-2xl font-black text-gray-900 mb-2">{{ $t('holiday.no_holidays') }}</h3>
        </div>

        <!-- Add/Edit Modal -->
        <div v-if="isAddModalOpen"
            class="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div
                class="bg-white p-10 rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in fade-in duration-300 overflow-y-auto max-h-[90vh]">
                <h3 class="text-3xl font-black text-gray-900 mb-8 tracking-tight">{{ editingId ? $t('common.edit') :
                    $t('holiday.add_holiday') }}</h3>

                <div class="space-y-8">
                    <!-- Scope Selection -->
                    <div class="space-y-3">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                            $t('holiday.scope_label') }}</label>
                        <div class="flex bg-gray-50 p-1.5 rounded-2xl border border-gray-100 gap-1">
                            <button @click="scopeType = 'global'"
                                class="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                :class="scopeType === 'global' ? 'bg-white text-emerald-600 shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'">
                                {{ $t('holiday.scope_global') }}
                            </button>
                            <button @click="scopeType = 'classroom'"
                                class="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                :class="scopeType === 'classroom' ? 'bg-white text-emerald-600 shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'">
                                {{ $t('holiday.scope_classroom') }}
                            </button>
                            <button @click="scopeType = 'session'"
                                class="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                :class="scopeType === 'session' ? 'bg-white text-emerald-600 shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'">
                                {{ $t('holiday.scope_session') }}
                            </button>
                        </div>
                    </div>

                    <!-- Scope Targets -->
                    <div v-if="scopeType === 'classroom'" class="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                            $t('holiday.scope_classroom') }}</label>
                        <div
                            class="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-3 border border-gray-100 rounded-2xl bg-gray-50 custom-scrollbar">
                            <label v-for="room in classrooms" :key="room.id"
                                class="flex items-center gap-3 p-3 hover:bg-white rounded-xl cursor-pointer transition-all border border-transparent hover:border-emerald-100 select-none"
                                :class="holidayForm.classroomIds.includes(room.id!) ? 'bg-white border-emerald-100 ring-1 ring-emerald-50' : ''">
                                <input type="checkbox" :value="room.id" v-model="holidayForm.classroomIds"
                                    class="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300">
                                <span class="text-sm font-bold text-gray-700 truncate">{{ room.name }}</span>
                            </label>
                        </div>
                    </div>

                    <div v-if="scopeType === 'session'" class="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                            $t('holiday.scope_session') }}</label>
                        <div
                            class="grid grid-cols-1 gap-1 max-h-60 overflow-y-auto p-3 border border-gray-100 rounded-2xl bg-gray-50 custom-scrollbar">
                            <label v-for="s in sessions" :key="s.id"
                                class="flex items-center gap-4 p-3 hover:bg-white rounded-xl cursor-pointer transition-all border border-transparent hover:border-emerald-100 select-none"
                                :class="holidayForm.classSessionIds.includes(s.id!) ? 'bg-white border-emerald-100 ring-1 ring-emerald-50' : ''">
                                <input type="checkbox" :value="s.id" v-model="holidayForm.classSessionIds"
                                    class="w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300">
                                <div class="flex flex-col min-w-0">
                                    <span class="text-sm font-black text-gray-900 truncate">{{ s.name }}</span>
                                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate">
                                        {{classrooms.find(r => r.id === s.classroom_id)?.name}}
                                    </span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-6">
                        <div class="space-y-2">
                            <label
                                class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                    $t('holiday.date_label') }} ({{ $t('common.start') }})</label>
                            <input type="date" v-model="holidayForm.startDate"
                                class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-gray-700">
                        </div>
                        <div class="space-y-2">
                            <label
                                class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                    $t('common.end') }}</label>
                            <input type="date" v-model="holidayForm.endDate"
                                class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-gray-700">
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                            $t('holiday.name_label') }}</label>
                        <input v-model="holidayForm.name" :placeholder="$t('holiday.holiday_placeholder')"
                            class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-gray-700 placeholder:text-gray-300">
                    </div>
                </div>

                <div class="flex gap-4 pt-8 mt-4 border-t border-gray-50">
                    <button @click="closeModal" :disabled="isSaving"
                        class="flex-1 px-8 py-4 text-gray-400 hover:text-gray-600 font-black transition-colors disabled:opacity-50">
                        {{ $t('common.cancel') }}
                    </button>
                    <button @click="handleSaveHoliday" :disabled="isSaving"
                        class="flex-1 px-8 py-4 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-100 disabled:opacity-50 font-black flex items-center justify-center gap-3 active:scale-95">
                        <svg v-if="isSaving" class="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
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
