<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { HolidayService } from '@/services/holiday/HolidayService'
import { ClassroomService } from '@/services/classroom/ClassroomService'
import { AggregateService } from '@/services/AggregateService'
import { SessionService } from '@/services/session/SessionService'
import { TeacherService, type TeacherDTO } from '@/services/teacher/TeacherService'
import { Holiday, type HolidayDTO } from '@/models/Holiday'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import { useFeedback } from '@/composables/useFeedback'
import type { ClassroomDTO, ClassSessionDTO } from '@/models/Classroom'

import ConfirmModal from '../components/common/ConfirmModal.vue'
import SearchableSelect from '@/components/common/SearchableSelect.vue'
import BasePageHeader from '@/components/common/BasePageHeader.vue'
import { usePreferencesStore } from '@/stores/usePreferencesStore'
import { DateUtils } from '@/utils/DateUtils'
import { formatClassSessionSchedule } from '@/utils/sessionSchedule'

type HolidayTab = 'closures' | 'teacherLeaves'
type HolidayStatus = 'active' | 'upcoming' | 'ended'

interface TeacherLeaveGroup {
    teacher: TeacherDTO | null
    teacherId: string
    records: Holiday[]
    count: number
    nearestDate: string
}

const { t } = useI18n()
const toast = useToast()
const { reportError } = useFeedback()
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
const activeTab = ref<HolidayTab>('closures')
const selectedTeacherId = ref<string | 'all'>('all')
const searchQuery = ref('')

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

const teacherOptions = computed(() => teachers.value
    .filter(teacher => Boolean(teacher.id))
    .map(teacher => ({
        label: teacher.name + (teacher.email ? ` (${teacher.email})` : ''),
        value: teacher.id!
    }))
)

const classroomOptions = computed(() => classrooms.value
    .filter(room => Boolean(room.id))
    .map(room => ({ label: room.name, value: room.id }))
)

const classroomFilterOptions = computed(() => [
    { label: t('classroom.all_rooms'), value: '' },
    ...classroomOptions.value
])

const normalizedSearchQuery = computed(() => searchQuery.value.trim().toLowerCase())

const closureHolidays = computed(() => holidays.value
    .filter(holiday => holiday.kind !== 'teacher_leave')
    .filter(holiday => matchesHolidaySearch(holiday))
)

const teacherLeaveHolidays = computed(() => holidays.value
    .filter(holiday => holiday.kind === 'teacher_leave')
    .filter(holiday => matchesHolidaySearch(holiday))
    .sort(compareHolidaysByDate)
)

const teacherLeaveGroups = computed<TeacherLeaveGroup[]>(() => {
    const groups = new Map<string, TeacherLeaveGroup>()

    teachers.value.forEach(teacher => {
        if (!teacher.id) return
        groups.set(teacher.id, {
            teacher,
            teacherId: teacher.id,
            records: [],
            count: 0,
            nearestDate: ''
        })
    })

    teacherLeaveHolidays.value.forEach(holiday => {
        holiday.teacherIds.forEach(teacherId => {
            const group = groups.get(teacherId) ?? {
                teacher: teachers.value.find(teacher => teacher.id === teacherId) ?? null,
                teacherId,
                records: [],
                count: 0,
                nearestDate: ''
            }
            group.records.push(holiday)
            groups.set(teacherId, group)
        })
    })

    return Array.from(groups.values())
        .map(group => ({
            ...group,
            records: group.records.sort(compareHolidaysByDate),
            count: group.records.length,
            nearestDate: getNearestDateLabel(group.records)
        }))
        .filter(group => group.count > 0 || !normalizedSearchQuery.value || matchesTeacherSearch(group.teacher))
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count
            return getTeacherDisplayName(a.teacher, a.teacherId).localeCompare(getTeacherDisplayName(b.teacher, b.teacherId))
        })
})

const selectedTeacherLeaveGroup = computed(() => {
    if (selectedTeacherId.value === 'all') return null
    return teacherLeaveGroups.value.find(group => group.teacherId === selectedTeacherId.value) ?? null
})

const filteredTeacherLeaveRecords = computed(() => {
    if (selectedTeacherId.value === 'all') return teacherLeaveHolidays.value
    return teacherLeaveHolidays.value.filter(holiday => holiday.teacherIds.includes(selectedTeacherId.value))
})

const holidayStats = computed(() => {
    const today = DateUtils.todayString(preferences.timeZone)
    const monthPrefix = today.slice(0, 7)
    const leaveRecords = teacherLeaveHolidays.value
    const teacherIds = new Set<string>()

    leaveRecords.forEach(holiday => {
        holiday.teacherIds.forEach(teacherId => teacherIds.add(teacherId))
    })

    return {
        teacherCount: teacherIds.size,
        recordCount: leaveRecords.length,
        activeOrUpcomingCount: leaveRecords.filter(holiday => getHolidayStatus(holiday, today) !== 'ended').length,
        thisMonthCount: leaveRecords.filter(holiday =>
            holiday.startDate.slice(0, 7) <= monthPrefix && holiday.endDate.slice(0, 7) >= monthPrefix
        ).length
    }
})

const filteredSessions = computed(() => {
    return sessions.value
        .filter(session => !selectedSessionClassroomFilter.value || session.classroom_id === selectedSessionClassroomFilter.value)
        .sort((a, b) => {
            const roomCompare = getRoomName(a.classroom_id).localeCompare(getRoomName(b.classroom_id))
            if (roomCompare !== 0) return roomCompare

            const rawDayA = a.schedule_rules?.[0]?.day_of_week ?? a.day_of_week ?? 7
            const rawDayB = b.schedule_rules?.[0]?.day_of_week ?? b.day_of_week ?? 7
            const dayA = rawDayA === 0 ? 7 : rawDayA
            const dayB = rawDayB === 0 ? 7 : rawDayB
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
                AggregateService.getAllClassroomsOverview(''),
                SessionService.getAllClassSessions()
            ])
            classrooms.value = (roomsRes.classrooms || []).map((d: any) => d)
            sessions.value = sessionsRes.data
            teachers.value = await TeacherService.getAllTeachers()
        } catch (e) {
            const [roomsRes, sessionsRes, teachersRes] = await Promise.all([
                ClassroomService.getAllClassrooms(),
                SessionService.getAllClassSessions(),
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
            const rows = Array.isArray(agg) ? agg : []
            if (rows.length > 0 && rows.some((row: any) => !hasHolidayKindFields(row))) {
                holidays.value = await HolidayService.listHolidays()
            } else {
                holidays.value = rows.map((d: any) => new Holiday(normalizeHolidayDTO(d)))
            }
        } catch (e) {
            holidays.value = await HolidayService.listHolidays()
        }
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
}

function hasHolidayKindFields(row: any) {
    return Object.prototype.hasOwnProperty.call(row, 'kind')
        && Object.prototype.hasOwnProperty.call(row, 'teacher_ids')
}

function normalizeHolidayDTO(row: any): HolidayDTO {
    return {
        id: row.id,
        start_date: row.start_date ?? row.startDate,
        end_date: row.end_date ?? row.endDate,
        time_zone: row.time_zone ?? row.timeZone,
        name: row.name,
        kind: row.kind,
        classroom_ids: row.classroom_ids ?? row.classroomIds ?? [],
        class_session_ids: row.class_session_ids ?? row.classSessionIds ?? [],
        teacher_ids: row.teacher_ids ?? row.teacherIds ?? [],
        created_at: row.created_at ?? row.createdAt,
        updated_at: row.updated_at ?? row.updatedAt
    }
}

function compareHolidaysByDate(a: Holiday, b: Holiday) {
    const startCompare = a.startDate.localeCompare(b.startDate)
    if (startCompare !== 0) return startCompare
    return (a.name || '').localeCompare(b.name || '')
}

function matchesHolidaySearch(holiday: Holiday) {
    const query = normalizedSearchQuery.value
    if (!query) return true

    return [
        holiday.name || '',
        holiday.formattedRange,
        getTeacherNames(holiday.teacherIds),
        getNamesForIds('classroom', holiday.classroomIds),
        getNamesForIds('session', holiday.classSessionIds),
        getSessionsForIds(holiday.classSessionIds).map(session => `${session.name} ${getRoomName(session.classroom_id)} ${formatSessionSchedule(session)}`).join(' ')
    ].some(value => value.toLowerCase().includes(query))
}

function matchesTeacherSearch(teacher: TeacherDTO | null) {
    const query = normalizedSearchQuery.value
    if (!query) return true
    if (!teacher) return false
    return `${teacher.name} ${teacher.email || ''}`.toLowerCase().includes(query)
}

function getNamesForIds(type: 'classroom' | 'session', ids: string[]) {
    if (type === 'classroom') {
        return ids.map(id => classrooms.value.find(r => r.id === id)?.name).filter(Boolean).join(', ')
    } else {
        return ids.map(id => sessions.value.find(s => s.id === id)?.name).filter(Boolean).join(', ')
    }
}

function getTeacherNames(ids: string[]) {
    return ids.map(id => teachers.value.find(teacher => teacher.id === id)?.name || id).filter(Boolean).join(', ')
}

function getOtherTeacherNames(holiday: Holiday, teacherId: string | 'all') {
    const ids = teacherId === 'all' ? holiday.teacherIds : holiday.teacherIds.filter(id => id !== teacherId)
    return getTeacherNames(ids)
}

function getTeacherDisplayName(teacher: TeacherDTO | null, teacherId: string) {
    return teacher?.name || teacherId || '-'
}

function getRoomName(id?: string | null) {
    return classrooms.value.find(room => room.id === id)?.name || t('common.unknown_room')
}

function formatSessionSchedule(session: ClassSessionDTO) {
    return formatClassSessionSchedule(session, preferences.locale, t)
}

function getSessionsForIds(ids: string[]) {
    return ids
        .map(id => sessions.value.find(session => session.id === id))
        .filter((session): session is ClassSessionDTO => Boolean(session))
}

function getNearestDateLabel(records: Holiday[]) {
    if (records.length === 0) return '-'
    const today = DateUtils.todayString(preferences.timeZone)
    const nextRecord = records.find(record => record.endDate >= today) ?? records[records.length - 1]
    return nextRecord?.formattedRange ?? '-'
}

function getHolidayStatus(holiday: Holiday, today = DateUtils.todayString(preferences.timeZone)): HolidayStatus {
    if (holiday.startDate > today) return 'upcoming'
    if (holiday.endDate < today) return 'ended'
    return 'active'
}

function getStatusLabel(holiday: Holiday) {
    return t(`holiday.status_${getHolidayStatus(holiday)}`)
}

function getStatusClass(holiday: Holiday) {
    const status = getHolidayStatus(holiday)
    if (status === 'active') return 'bg-emerald-50 text-emerald-700 border-emerald-100'
    if (status === 'upcoming') return 'bg-blue-50 text-blue-700 border-blue-100'
    return 'bg-gray-50 text-gray-500 border-gray-100'
}

function getScopeBadgeLabel(holiday: Holiday) {
    if (holiday.classSessionIds.length > 0) return t('holiday.scope_session')
    if (holiday.classroomIds.length > 0) return t('holiday.scope_classroom')
    return t('holiday.scope_global')
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

        activeTab.value = payload.kind === 'teacher_leave' ? 'teacherLeaves' : 'closures'
        await loadHolidays()
        closeModal()
        toast.success(t('holiday.save_success') || 'Holiday saved successfully')
    } catch (e: any) {
        console.error(e)
        reportError(e)
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
        console.error(e)
        reportError(e)
    } finally {
        isDeleting.value = false
        showDeleteConfirm.value = false
        deleteId.value = null
    }
}

function openAddModal(kind: 'closure' | 'teacher_leave' = activeTab.value === 'teacherLeaves' ? 'teacher_leave' : 'closure') {
    editingId.value = null
    scopeType.value = 'global'
    selectedSessionClassroomFilter.value = ''
    holidayForm.value = {
        kind,
        startDate: DateUtils.todayString(preferences.timeZone),
        endDate: DateUtils.todayString(preferences.timeZone),
        name: '',
        classroomIds: [],
        classSessionIds: [],
        teacherIds: kind === 'teacher_leave' && selectedTeacherId.value !== 'all' ? [selectedTeacherId.value] : []
    }
    isAddModalOpen.value = true
}

function openEditModal(holiday: Holiday) {
    editingId.value = holiday.id || null
    activeTab.value = holiday.kind === 'teacher_leave' ? 'teacherLeaves' : 'closures'
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
                <div class="flex flex-col lg:flex-row flex-1 items-stretch lg:items-center gap-4 w-full max-w-4xl">
                    <div
                        class="w-full flex-1 flex items-center gap-3 bg-white/70 p-1.5 rounded-2xl border border-gray-100 shadow-sm focus-within:border-emerald-200 focus-within:ring-4 focus-within:ring-emerald-500/5 transition-all">
                        <div class="pl-3 text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input v-model="searchQuery" type="text" :placeholder="t('holiday.search_placeholder')"
                            class="flex-1 bg-transparent border-none outline-none text-sm font-bold text-gray-700 placeholder:text-gray-300 py-2 min-w-0" />
                        <button v-if="searchQuery" @click="searchQuery = ''"
                            class="p-2 text-gray-300 hover:text-gray-500 transition-colors">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div
                        class="flex bg-gray-100/80 p-1 rounded-2xl border border-gray-100 shadow-inner w-full lg:w-auto overflow-x-auto shrink-0">
                        <button @click="activeTab = 'closures'"
                            class="flex-1 lg:flex-none px-4 sm:px-5 py-2 rounded-xl text-[10px] sm:text-xs font-black transition-all uppercase tracking-widest whitespace-nowrap"
                            :class="activeTab === 'closures' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'">
                            {{ t('holiday.tab_closures') }}
                        </button>
                        <button @click="activeTab = 'teacherLeaves'"
                            class="flex-1 lg:flex-none px-4 sm:px-5 py-2 rounded-xl text-[10px] sm:text-xs font-black transition-all uppercase tracking-widest whitespace-nowrap"
                            :class="activeTab === 'teacherLeaves' ? 'bg-white text-amber-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'">
                            {{ t('holiday.tab_teacher_leaves') }}
                        </button>
                    </div>
                </div>

                <button @click="openAddModal()"
                    class="bg-emerald-600 text-white px-6 py-3 rounded-2xl hover:bg-emerald-700 transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-200 font-bold active:scale-95 w-full lg:w-auto shrink-0">
                    <span class="text-xl leading-none">+</span>
                    {{ activeTab === 'teacherLeaves' ? t('holiday.add_teacher_leave') : t('holiday.add_closure') }}
                </button>
            </template>
        </BasePageHeader>

        <!-- System Message -->
        <div class="p-4 rounded-r-lg border-l-4"
            :class="activeTab === 'teacherLeaves' ? 'bg-amber-50 border-amber-400' : 'bg-blue-50 border-blue-400'">
            <div class="flex">
                <div class="flex-shrink-0">
                    <svg class="h-5 w-5" :class="activeTab === 'teacherLeaves' ? 'text-amber-500' : 'text-blue-400'"
                        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                            clip-rule="evenodd" />
                    </svg>
                </div>
                <div class="ml-3">
                    <p class="text-sm"
                        :class="activeTab === 'teacherLeaves' ? 'text-amber-800' : 'text-blue-700'">
                        {{ activeTab === 'teacherLeaves' ? $t('holiday.teacher_leave_marking_status') :
                            $t('holiday.closure_marking_status') }}
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

        <!-- CLOSURES TAB -->
        <template v-else-if="activeTab === 'closures'">
            <div v-if="closureHolidays.length > 0"
                class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div v-for="holiday in closureHolidays" :key="holiday.id"
                    class="bg-white rounded-[2rem] border border-gray-100 p-6 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all group relative overflow-hidden">
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2 mb-1">
                                <span v-if="holiday.classSessionIds.length > 0"
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
                                {{ holiday.name || $t('holiday.untitled_holiday') }}
                            </h3>
                        </div>

                        <div class="flex gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all">
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

                    <div class="space-y-4">
                        <div class="flex items-center gap-3">
                            <div
                                class="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center text-emerald-600 border border-gray-100 shrink-0">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                        d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                            </div>
                            <div>
                                <p class="text-[12px] font-black text-gray-400 uppercase tracking-widest">
                                    {{ $t('holiday.date_label') }}</p>
                                <p class="text-sm font-bold text-gray-700">{{ holiday.formattedRange }}</p>
                                <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                    {{ holiday.timeZone }}</p>
                            </div>
                        </div>

                        <div v-if="holiday.classroomIds.length > 0 || holiday.classSessionIds.length > 0"
                            class="pt-3 border-t border-gray-50">
                            <p class="text-[12px] font-black text-gray-400 uppercase tracking-widest mb-2">
                                {{ $t('holiday.scope_detail') }}</p>
                            <div v-if="holiday.classSessionIds.length > 0" class="space-y-2">
                                <div v-for="session in getSessionsForIds(holiday.classSessionIds)" :key="session.id"
                                    class="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="min-w-0">
                                            <p class="text-xs font-black text-gray-800 break-words">{{ session.name }}
                                            </p>
                                            <p
                                                class="text-[10px] font-bold text-gray-400 uppercase tracking-wider break-words mt-1">
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

                    <div class="absolute bottom-0 left-0 right-0 h-1.5" :class="[
                        holiday.classSessionIds.length > 0 ? 'bg-purple-500/20' :
                            holiday.classroomIds.length > 0 ? 'bg-blue-500/20' : 'bg-emerald-500/20'
                    ]"></div>
                </div>
            </div>

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
                <h3 class="text-2xl font-black text-gray-900 mb-2">{{ $t('holiday.no_closures') }}</h3>
            </div>
        </template>

        <!-- TEACHER LEAVE TAB -->
        <template v-else>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div class="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        {{ $t('holiday.leave_teacher_count') }}</p>
                    <p class="mt-2 text-2xl font-black text-gray-900">{{ holidayStats.teacherCount }}</p>
                </div>
                <div class="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        {{ $t('holiday.leave_record_count') }}</p>
                    <p class="mt-2 text-2xl font-black text-gray-900">{{ holidayStats.recordCount }}</p>
                </div>
                <div class="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        {{ $t('holiday.leave_active_upcoming_count') }}</p>
                    <p class="mt-2 text-2xl font-black text-amber-700">{{ holidayStats.activeOrUpcomingCount }}</p>
                </div>
                <div class="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        {{ $t('holiday.leave_this_month_count') }}</p>
                    <p class="mt-2 text-2xl font-black text-emerald-700">{{ holidayStats.thisMonthCount }}</p>
                </div>
            </div>

            <div class="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
                <aside class="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-3 h-fit xl:sticky xl:top-4">
                    <button @click="selectedTeacherId = 'all'"
                        class="w-full text-left rounded-2xl p-4 transition-all border mb-2"
                        :class="selectedTeacherId === 'all' ? 'bg-amber-50 border-amber-100 text-amber-800' : 'border-transparent hover:bg-gray-50 text-gray-700'">
                        <div class="flex items-center justify-between gap-3">
                            <div>
                                <p class="text-sm font-black">{{ $t('holiday.all_teachers') }}</p>
                                <p class="text-[11px] font-bold text-gray-400 mt-1">
                                    {{ $t('holiday.leave_record_count') }}
                                </p>
                            </div>
                            <span
                                class="shrink-0 px-2.5 py-1 rounded-full text-xs font-black bg-white border border-amber-100 text-amber-700">
                                {{ teacherLeaveHolidays.length }}
                            </span>
                        </div>
                    </button>

                    <div class="max-h-[520px] overflow-y-auto custom-scrollbar space-y-2 pr-1">
                        <button v-for="group in teacherLeaveGroups" :key="group.teacherId"
                            @click="selectedTeacherId = group.teacherId"
                            class="w-full text-left rounded-2xl p-4 transition-all border"
                            :class="selectedTeacherId === group.teacherId ? 'bg-amber-50 border-amber-100 text-amber-800' : 'border-transparent hover:bg-gray-50 text-gray-700'">
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0">
                                    <p class="text-sm font-black truncate">
                                        {{ getTeacherDisplayName(group.teacher, group.teacherId) }}
                                    </p>
                                    <p class="text-[11px] font-bold text-gray-400 truncate mt-1">
                                        {{ group.teacher?.email || '-' }}
                                    </p>
                                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-3">
                                        {{ group.nearestDate }}
                                    </p>
                                </div>
                                <span
                                    class="shrink-0 px-2.5 py-1 rounded-full text-xs font-black bg-white border border-gray-100"
                                    :class="selectedTeacherId === group.teacherId ? 'text-amber-700' : 'text-gray-500'">
                                    {{ group.count }}
                                </span>
                            </div>
                        </button>
                    </div>
                </aside>

                <section class="min-w-0">
                    <div class="bg-white rounded-[2rem] border border-gray-100 shadow-sm p-5 mb-4">
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                                <p class="text-[10px] font-black text-amber-600 uppercase tracking-widest">
                                    {{ $t('holiday.teacher_leave_records') }}</p>
                                <h3 class="text-xl font-black text-gray-900 mt-1">
                                    {{ selectedTeacherLeaveGroup
                                        ? getTeacherDisplayName(selectedTeacherLeaveGroup.teacher, selectedTeacherLeaveGroup.teacherId)
                                        : $t('holiday.all_teachers') }}
                                </h3>
                            </div>
                            <span
                                class="self-start sm:self-auto px-3 py-1.5 rounded-full bg-gray-50 border border-gray-100 text-xs font-black text-gray-500">
                                {{ filteredTeacherLeaveRecords.length }} {{ $t('holiday.records_unit') }}
                            </span>
                        </div>
                    </div>

                    <div v-if="filteredTeacherLeaveRecords.length > 0" class="space-y-4">
                        <article v-for="holiday in filteredTeacherLeaveRecords" :key="holiday.id"
                            class="bg-white rounded-[2rem] border border-gray-100 p-5 shadow-sm hover:shadow-lg transition-all group">
                            <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                                <div class="min-w-0">
                                    <div class="flex flex-wrap items-center gap-2 mb-2">
                                        <span class="px-3 py-1 rounded-full text-[11px] font-black border"
                                            :class="getStatusClass(holiday)">
                                            {{ getStatusLabel(holiday) }}
                                        </span>
                                        <span
                                            class="px-3 py-1 bg-amber-50 text-amber-700 rounded-full text-[11px] font-black border border-amber-100">
                                            {{ getScopeBadgeLabel(holiday) }}
                                        </span>
                                        <span v-if="holiday.teacherIds.length > 1"
                                            class="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-[11px] font-black border border-indigo-100">
                                            {{ $t('holiday.shared_leave') }}
                                        </span>
                                    </div>
                                    <h4 class="text-lg font-black text-gray-900 break-words">
                                        {{ holiday.name || $t('holiday.untitled_teacher_leave') }}
                                    </h4>
                                    <p class="mt-1 text-sm font-bold text-gray-500">{{ holiday.formattedRange }}</p>
                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                        {{ holiday.timeZone }}</p>
                                </div>

                                <div class="flex gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-all">
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

                            <div class="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4 pt-4 border-t border-gray-50">
                                <div>
                                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                                        {{ $t('holiday.teacher_leave_teachers') }}</p>
                                    <p class="text-sm font-bold text-gray-700">
                                        {{ getTeacherNames(holiday.teacherIds) || '-' }}
                                    </p>
                                    <p v-if="selectedTeacherId !== 'all' && holiday.teacherIds.length > 1"
                                        class="mt-1 text-xs font-bold text-indigo-600">
                                        {{ $t('holiday.other_teachers') }}: {{ getOtherTeacherNames(holiday, selectedTeacherId) }}
                                    </p>
                                </div>

                                <div>
                                    <p class="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">
                                        {{ $t('holiday.scope_detail') }}</p>
                                    <div v-if="holiday.classSessionIds.length > 0" class="space-y-2">
                                        <div v-for="session in getSessionsForIds(holiday.classSessionIds)"
                                            :key="session.id"
                                            class="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                                            <div class="flex items-start justify-between gap-2">
                                                <div class="min-w-0">
                                                    <p class="text-xs font-black text-gray-800 break-words">
                                                        {{ session.name }}</p>
                                                    <p
                                                        class="text-[10px] font-bold text-gray-400 uppercase tracking-wider break-words mt-1">
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
                                    <p v-else-if="holiday.classroomIds.length > 0"
                                        class="text-sm font-bold text-gray-700">
                                        {{ getNamesForIds('classroom', holiday.classroomIds) }}
                                    </p>
                                    <p v-else class="text-sm font-bold text-gray-700">
                                        {{ $t('holiday.scope_global') }}
                                    </p>
                                </div>
                            </div>
                        </article>
                    </div>

                    <div v-else
                        class="text-center py-24 bg-white rounded-[3rem] border border-dashed border-gray-200 shadow-sm flex flex-col items-center animate-in fade-in duration-1000">
                        <div
                            class="w-20 h-20 bg-amber-50 rounded-[2rem] flex items-center justify-center mb-6 shadow-inner">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-amber-400" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                                    d="M8 7V3m8 4V3m-9 8h10M7 21h10a2 2 0 002-2V7H5v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <h3 class="text-2xl font-black text-gray-900 mb-2">
                            {{ selectedTeacherId === 'all' ? $t('holiday.no_teacher_leaves') :
                                $t('holiday.no_teacher_leave_for_teacher') }}
                        </h3>
                    </div>
                </section>
            </div>
        </template>

        <!-- Add/Edit Modal -->
        <div v-if="isAddModalOpen"
            class="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <div
                class="bg-white p-10 rounded-[2.5rem] w-full max-w-lg shadow-2xl animate-in zoom-in fade-in duration-300 overflow-y-auto max-h-[90vh]">
                <h3 class="text-3xl font-black text-gray-900 mb-8 tracking-tight">
                    {{ editingId ? $t('common.edit') :
                        (holidayForm.kind === 'teacher_leave' ? $t('holiday.add_teacher_leave') : $t('holiday.add_closure')) }}
                </h3>

                <div class="space-y-8">
                    <div class="space-y-3">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">
                            {{ $t('holiday.kind_label') }}</label>
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
                        <label class="block text-[10px] font-black text-amber-600 uppercase tracking-widest ml-1">
                            {{ $t('holiday.teacher_leave_teachers') }}</label>

                        <SearchableSelect v-model="holidayForm.teacherIds" :options="teacherOptions" :multiple="true"
                            :placeholder="$t('holiday.teacher_leave_teachers')"
                            font-size-class="text-sm font-bold text-gray-700" />

                        <p
                            class="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mt-2">
                            {{ $t('holiday.teacher_leave_hint') }}
                        </p>
                    </div>

                    <div class="space-y-3">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">
                            {{ $t('holiday.scope_label') }}</label>
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

                    <div v-if="scopeType === 'classroom'" class="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">
                            {{ $t('holiday.scope_classroom') }}</label>
                        <SearchableSelect v-model="holidayForm.classroomIds" :options="classroomOptions" :multiple="true"
                            :placeholder="$t('holiday.scope_classroom')"
                            font-size-class="text-sm font-bold text-gray-700" />
                    </div>

                    <div v-if="scopeType === 'session'" class="space-y-3 animate-in fade-in slide-in-from-top-2">
                        <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">
                                    {{ $t('holiday.scope_session') }}</label>
                                <p class="mt-1 text-[11px] font-bold text-gray-400">
                                    {{ $t('holiday.session_schedule_hint') }}</p>
                            </div>
                            <div class="w-full sm:w-56">
                                <label
                                    class="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1 ml-1">
                                    {{ $t('holiday.filter_by_classroom') }}
                                </label>
                                <SearchableSelect v-model="selectedSessionClassroomFilter"
                                    :options="classroomFilterOptions" :placeholder="$t('classroom.all_rooms')"
                                    font-size-class="text-sm font-bold text-gray-700" />
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
                                    <span
                                        class="text-[10px] font-bold text-gray-400 uppercase tracking-wider break-words mt-1">
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
                                class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">
                                {{ $t('holiday.date_label') }} ({{ $t('common.start') }})</label>
                            <input type="date" v-model="holidayForm.startDate"
                                class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-gray-700">
                        </div>
                        <div class="space-y-2">
                            <label
                                class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">
                                {{ $t('common.end') }}</label>
                            <input type="date" v-model="holidayForm.endDate"
                                class="w-full bg-gray-50 border-gray-100 rounded-2xl px-5 py-4 outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all font-bold text-gray-700">
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="block text-[10px] font-black text-emerald-600 uppercase tracking-widest ml-1">
                            {{ $t('holiday.name_label') }}</label>
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
