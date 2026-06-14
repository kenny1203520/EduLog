<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { HolidayService } from '@/services/holiday/HolidayService'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { AggregateService } from '@/services/AggregateService'
import { SessionService } from '@/services/session/SessionService'
import { TeacherService, type TeacherDTO } from '@/services/teacher/TeacherService'
import { Holiday } from '@/models/Holiday'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import type { ClassroomDTO, ClassSessionDTO } from '@/models/Classroom'

import ConfirmModal from '../components/common/ConfirmModal.vue'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import BasePageHeader from '@/components/common/BasePageHeader.vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/DateUtils'

const { t } = useI18n()
const toast = useToast()
const preferences = usePreferencesStore()
const holidays = ref<Holiday[]>([])
const classrooms = ref<ClassroomDTO[]>([])
const sessions = ref<ClassSessionDTO[]>([])
const teachers = ref<TeacherDTO[]>([])
const loading = ref(true)
const isSaving = ref(false)
const isDeleting = ref(false)
const isAddModalOpen = ref(false)
const editingId = ref<string | null>(null)
const selectedSessionClassroomFilter = ref('')

// Confirm Modal State
const showDeleteConfirm = ref(false)
const deleteId = ref<string | null>(null)

const scopeType = ref<'global' | 'classroom' | 'session'>('global')
const holidayForm = ref({
    kind: 'closure' as 'closure' | 'teacher_leave',
    startDate: DateUtils.todayString(preferences.timeZone),
    endDate: DateUtils.todayString(preferences.timeZone),
    name: '',
    classroomIds: [] as string[],
    classSessionIds: [] as string[],
    teacherIds: [] as string[]
})

const teacherOptions = computed(() => teachers.value.map(t => ({
    label: t.name + (t.email ? ` (${t.email})` : ''),
    value: t.id
})))

const classroomOptions = computed(() => classrooms.value
    .filter(room => Boolean(room.id))
    .map(room => ({ label: room.name, value: room.id }))
)

const classroomFilterOptions = computed(() => [
    { label: t('classroom.all_rooms'), value: '' },
    ...classroomOptions.value
])

const filteredSessions = computed(() => {
    return sessions.value
        .filter(session => !selectedSessionClassroomFilter.value || session.classroom_id === selectedSessionClassroomFilter.value)
        .sort((a, b) => {
            const roomCompare = getRoomName(a.classroom_id).localeCompare(getRoomName(b.classroom_id))
            if (roomCompare !== 0) return roomCompare

            const dayA = a.day_of_week === 0 ? 7 : a.day_of_week
            const dayB = b.day_of_week === 0 ? 7 : b.day_of_week
            if (dayA !== dayB) return dayA - dayB

            const timeCompare = (a.start_time || '').localeCompare(b.start_time || '')
            if (timeCompare !== 0) return timeCompare

            return a.name.localeCompare(b.name)
        })
})

onMounted(async () => {
    await Promise.all([
        loadHolidays(),
        loadAuxData()
    ])
})

async function loadAuxData() {
    try {
        try {
            const [roomsRes, sessionsRes] = await Promise.all([
                AggregateService.getClassroomSessionManagerAggregate(1, 1000, ''),
                SessionService.getClassSessions(1, 1000)
            ])
            classrooms.value = (roomsRes.classrooms || []).map((d: any) => d)
            sessions.value = sessionsRes.data
            teachers.value = await TeacherService.getAllTeachers()
        } catch (e) {
            const [roomsRes, sessionsRes, teachersRes] = await Promise.all([
                ClassroomService.getClassrooms(1, 1000),
                SessionService.getClassSessions(1, 1000),
                TeacherService.getAllTeachers()
            ])
            classrooms.value = roomsRes.data
            sessions.value = sessionsRes.data
            teachers.value = teachersRes
        }
    } catch (e) {
        console.error('Failed to load classrooms/sessions:', e)
    }
}

async function loadHolidays() {
    try {
        loading.value = true
        try {
            const agg = await AggregateService.getHolidaysAggregate(true)
            holidays.value = (agg || []).map((d: any) => new Holiday({
                id: d.id,
                start_date: d.start_date,
                end_date: d.end_date,
                time_zone: d.time_zone,
                name: d.name,
                kind: d.kind,
                classroom_ids: d.classroom_ids || [],
                class_session_ids: d.class_session_ids || [],
                teacher_ids: d.teacher_ids || []
            }))
        } catch (e) {
            holidays.value = await HolidayService.listHolidays()
        }
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

function getTeacherNames(ids: string[]) {
    return ids.map(id => teachers.value.find(teacher => teacher.id === id)?.name).filter(Boolean).join(', ')
}

function getRoomName(id?: string | null) {
    return classrooms.value.find(room => room.id === id)?.name || t('common.unknown_room')
}

function getDayLabel(day: number) {
    return t(`classroom.days.${day}`)
}

function formatSessionTime(time?: string) {
    return time ? time.slice(0, 5) : '--:--'
}

function formatSessionSchedule(session: ClassSessionDTO) {
    return `${getDayLabel(session.day_of_week)} ${formatSessionTime(session.start_time)}-${formatSessionTime(session.end_time)}`
}

function getSessionsForIds(ids: string[]) {
    return ids
        .map(id => sessions.value.find(session => session.id === id))
        .filter((session): session is ClassSessionDTO => Boolean(session))
}

async function handleSaveHoliday() {
    if (!holidayForm.value.startDate || !holidayForm.value.endDate) return
    try {
        isSaving.value = true

        const payload = {
            start_date: holidayForm.value.startDate,
            end_date: holidayForm.value.endDate,
            time_zone: preferences.timeZone,
            name: holidayForm.value.name,
            kind: holidayForm.value.kind,
            classroom_ids: scopeType.value === 'classroom' ? holidayForm.value.classroomIds : [],
            class_session_ids: scopeType.value === 'session' ? holidayForm.value.classSessionIds : [],
            teacher_ids: holidayForm.value.kind === 'teacher_leave' ? holidayForm.value.teacherIds : []
        }

        if (payload.kind === 'teacher_leave' && payload.teacher_ids.length === 0) {
            toast.error(t('holiday.teacher_required'))
            return
        }

        if (editingId.value) {
            await HolidayService.updateHoliday(editingId.value, payload as any)
        } else {
            await HolidayService.createHoliday({
                startDate: payload.start_date,
                endDate: payload.end_date,
                timeZone: payload.time_zone,
                name: payload.name,
                kind: payload.kind,
                classroomIds: payload.classroom_ids,
                classSessionIds: payload.class_session_ids,
                teacherIds: payload.teacher_ids
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

function handleDeleteHoliday(id: string) {
    deleteId.value = id
    showDeleteConfirm.value = true
}

async function confirmDelete() {
    if (!deleteId.value) return
    try {
        isDeleting.value = true
        await HolidayService.deleteHoliday(deleteId.value)
        await loadHolidays()
        toast.success(t('holiday.delete_success') || 'Holiday deleted successfully')
    } catch (e: any) {
        toast.error(e.message || 'Failed to delete holiday')
    } finally {
        isDeleting.value = false
        showDeleteConfirm.value = false
        deleteId.value = null
    }
}

function openAddModal() {
    editingId.value = null
    scopeType.value = 'global'
    selectedSessionClassroomFilter.value = ''
    holidayForm.value = {
        kind: 'closure',
        startDate: DateUtils.todayString(preferences.timeZone),
        endDate: DateUtils.todayString(preferences.timeZone),
        name: '',
        classroomIds: [],
        classSessionIds: [],
        teacherIds: []
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
        kind: holiday.kind,
        startDate: holiday.startDate,
        endDate: holiday.endDate,
        name: holiday.name || '',
        classroomIds: holiday.classroomIds ? [...holiday.classroomIds] : [],
        classSessionIds: holiday.classSessionIds ? [...holiday.classSessionIds] : [],
        teacherIds: holiday.teacherIds ? [...holiday.teacherIds] : []
    }
    isAddModalOpen.value = true
}

function closeModal() {
    isAddModalOpen.value = false
    editingId.value = null
    selectedSessionClassroomFilter.value = ''
}
</script>

<template>
    <div class="space-y-6">
        <BasePageHeader :overline="t('nav.holidays')" :title="t('holiday.title')"
            :subtitle="t('nav.description.holidays')">
            <template #icon>
                <div
                    class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 shadow-inner">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                </div>
            </template>
            <template #actions>
                <button @click="openAddModal"
                    class="bg-emerald-600 text-white px-6 py-3 rounded-2xl hover:bg-emerald-700 transition flex items-center gap-2 shadow-lg shadow-emerald-200 font-bold active:scale-95">
                    <span class="text-xl leading-none">+</span> {{ t('holiday.add_holiday') }}
                </button>
            </template>
        </BasePageHeader>

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
                            <span v-if="holiday.kind === 'teacher_leave'"
                                class="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-[12px] font-black uppercase tracking-widest border border-amber-100">
                                {{ $t('holiday.kind_teacher_leave') }}
                            </span>
                            <span v-else-if="holiday.classSessionIds.length > 0"
                                class="px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-[12px] font-black uppercase tracking-widest border border-purple-100">
                                {{ $t('holiday.scope_session') }}
                            </span>
                            <span v-else-if="holiday.classroomIds.length > 0"
                                class="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-[12px] font-black uppercase tracking-widest border border-blue-100">
                                {{ $t('holiday.scope_classroom') }}
                            </span>
                            <span v-else
                                class="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[12px] font-black uppercase tracking-widest border border-emerald-100">
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
                            <p class="text-[12px] font-black text-gray-400 uppercase tracking-widest">{{
                                $t('holiday.date_label') }}</p>
                            <p class="text-sm font-bold text-gray-700">{{ holiday.formattedRange }}</p>
                            <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{{ holiday.timeZone }}</p>
                        </div>
                    </div>

                    <!-- Target Detail -->
                    <div v-if="holiday.kind === 'teacher_leave'"
                        class="pt-3 border-t border-gray-50">
                        <p class="text-[12px] font-black text-gray-400 uppercase tracking-widest mb-2">
                            {{ $t('holiday.teacher_leave_teachers') }}</p>
                        <p class="text-xs font-medium text-gray-600 line-clamp-2 italic">
                            {{ getTeacherNames(holiday.teacherIds) || '-' }}
                        </p>
                    </div>

                    <div v-if="holiday.classroomIds.length > 0 || holiday.classSessionIds.length > 0"
                        class="pt-3 border-t border-gray-50">
                        <p class="text-[12px] font-black text-gray-400 uppercase tracking-widest mb-2">{{
                            $t('holiday.scope_label') }} Detail</p>
                        <div v-if="holiday.classSessionIds.length > 0" class="space-y-2">
                            <div v-for="session in getSessionsForIds(holiday.classSessionIds)" :key="session.id"
                                class="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0">
                                        <p class="text-xs font-black text-gray-800 break-words">{{ session.name }}</p>
                                        <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider break-words mt-1">
                                            {{ getRoomName(session.classroom_id) }}
                                        </p>
                                    </div>
                                    <span
                                        class="shrink-0 text-[10px] font-black text-purple-700 bg-purple-50 border border-purple-100 rounded-lg px-2 py-1 whitespace-nowrap">
                                        {{ formatSessionSchedule(session) }}
                                    </span>
                                </div>
                            </div>
                            <p v-if="getSessionsForIds(holiday.classSessionIds).length === 0"
                                class="text-xs font-medium text-gray-600 line-clamp-2 italic">
                                {{ getNamesForIds('session', holiday.classSessionIds) }}
                            </p>
                        </div>
                        <p v-else class="text-xs font-medium text-gray-600 line-clamp-2 italic">
                            {{ getNamesForIds('classroom', holiday.classroomIds) }}
                        </p>
                    </div>
                </div>

                <!-- Card Bottom Accent -->
                <div class="absolute bottom-0 left-0 right-0 h-1.5" :class="[
                    holiday.kind === 'teacher_leave' ? 'bg-amber-500/20' :
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
                    <div class="space-y-3">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                            $t('holiday.kind_label') }}</label>
                        <div class="grid grid-cols-2 gap-1 bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
                            <button @click="holidayForm.kind = 'closure'"
                                class="px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                :class="holidayForm.kind === 'closure' ? 'bg-white text-emerald-600 shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'">
                                {{ $t('holiday.kind_closure') }}
                            </button>
                            <button @click="holidayForm.kind = 'teacher_leave'"
                                class="px-4 py-2.5 rounded-xl text-xs font-bold transition-all"
                                :class="holidayForm.kind === 'teacher_leave' ? 'bg-white text-amber-600 shadow-sm border border-gray-100' : 'text-gray-400 hover:text-gray-600'">
                                {{ $t('holiday.kind_teacher_leave') }}
                            </button>
                        </div>
                    </div>

                    <div v-if="holidayForm.kind === 'teacher_leave'"
                        class="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <label class="block text-[10px] font-black text-amber-600 uppercase tracking-widest ml-1">{{
                            $t('holiday.teacher_leave_teachers') }}</label>
                        
                        <SearchableSelect 
                            v-model="holidayForm.teacherIds" 
                            :options="teacherOptions" 
                            :multiple="true" 
                            :placeholder="$t('holiday.teacher_leave_teachers')" 
                            font-size-class="text-sm font-bold text-gray-700"
                        />

                        <p class="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mt-2">
                            {{ $t('holiday.teacher_leave_hint') }}
                        </p>
                    </div>

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
                        <SearchableSelect 
                            v-model="holidayForm.classroomIds" 
                            :options="classroomOptions" 
                            :multiple="true" 
                            :placeholder="$t('holiday.scope_classroom')" 
                            font-size-class="text-sm font-bold text-gray-700"
                        />
                    </div>

                    <div v-if="scopeType === 'session'" class="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">{{
                                    $t('holiday.scope_session') }}</label>
                                <p class="mt-1 text-[11px] font-bold text-gray-400">{{ $t('holiday.session_schedule_hint') }}</p>
                            </div>
                            <div class="w-full sm:w-56">
                                <label
                                    class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">
                                    {{ $t('holiday.filter_by_classroom') }}
                                </label>
                                <SearchableSelect v-model="selectedSessionClassroomFilter" :options="classroomFilterOptions"
                                    :placeholder="$t('classroom.all_rooms')" font-size-class="text-sm font-bold text-gray-700" />
                            </div>
                        </div>
                        <div
                            class="grid grid-cols-1 gap-1 max-h-60 overflow-y-auto p-3 border border-gray-100 rounded-2xl bg-gray-50 custom-scrollbar">
                            <label v-for="s in filteredSessions" :key="s.id"
                                class="flex items-start gap-4 p-3 hover:bg-white rounded-xl cursor-pointer transition-all border border-transparent hover:border-emerald-100 select-none"
                                :class="holidayForm.classSessionIds.includes(s.id!) ? 'bg-white border-emerald-100 ring-1 ring-emerald-50' : ''">
                                <input type="checkbox" :value="s.id" v-model="holidayForm.classSessionIds"
                                    class="mt-1 w-5 h-5 rounded text-emerald-600 focus:ring-emerald-500 border-gray-300">
                                <div class="flex flex-col min-w-0 flex-1">
                                    <div class="flex items-start justify-between gap-2">
                                        <span class="text-sm font-black text-gray-900 break-words">{{ s.name }}</span>
                                        <span
                                            class="shrink-0 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1 whitespace-nowrap mt-0.5">
                                            {{ formatSessionSchedule(s) }}
                                        </span>
                                    </div>
                                    <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider break-words mt-1">
                                        {{ getRoomName(s.classroom_id) }} · {{ s.time_zone || preferences.timeZone }}
                                    </span>
                                </div>
                            </label>
                            <div v-if="filteredSessions.length === 0"
                                class="py-8 text-center text-xs font-bold text-gray-400">
                                {{ $t('holiday.no_sessions_for_classroom') }}
                            </div>
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
        <ConfirmModal :is-open="showDeleteConfirm" :title="$t('common.delete')" :message="$t('holiday.delete_confirm')"
            :confirm-text="$t('common.delete')" :is-dangerous="true" :is-loading="isDeleting" @confirm="confirmDelete"
            @close="showDeleteConfirm = false" />
    </div>
</template>
