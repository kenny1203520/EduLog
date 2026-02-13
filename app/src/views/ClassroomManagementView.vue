<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CourseService } from '@/services/CourseService'
import { OccurrenceService } from '@/services/OccurrenceService'
import { Classroom, type ClassroomDTO, type ClassSessionDTO } from '@/models/Classroom'
import { Course } from '@/models/Course'
import { useI18n } from 'vue-i18n'
import { useToast } from 'vue-toastification'
import Pagination from '@/components/common/Pagination.vue'
import SearchableSelect from '@/components/common/SearchableSelect.vue'

import ConfirmModal from '../components/common/ConfirmModal.vue'

const { t } = useI18n()
const toast = useToast()
const router = useRouter()
const activeTab = ref<'rooms' | 'sessions'>('rooms')

// Generic Confirm Modal State
const genericConfirm = ref({
    isOpen: false,
    title: '',
    message: '',
    confirmText: '',
    isDangerous: false,
    action: null as (() => any) | null
})

function openConfirm(message: string, action: () => any, title?: string, isDangerous = false) {
    genericConfirm.value = {
        isOpen: true,
        title: title || t('common.confirm'),
        message,
        confirmText: t('common.confirm'),
        isDangerous,
        action
    }
}

async function handleGenericConfirm() {
    if (genericConfirm.value.action) {
        await genericConfirm.value.action()
    }
    genericConfirm.value.isOpen = false
}

// Data
const classrooms = ref<Classroom[]>([])
const sessions = ref<ClassSessionDTO[]>([])
const courses = ref<Course[]>([])
const loading = ref(true)
const searchQuery = ref('')
const allClassrooms = ref<Classroom[]>([]) // For Dropdown

// Pagination state
const roomsPagination = ref({ page: 1, perPage: 10, total: 0 })
const sessionsPagination = ref({ page: 1, perPage: 10, total: 0 })

// Modals
const isCreateRoomModalOpen = ref(false)
const isCreateSessionModalOpen = ref(false)

// Forms
const newClassroom = ref<Partial<ClassroomDTO>>({ name: '', address: '', phone: '', color: '#10b981', external_link: '' })
const editingClassroom = ref<Classroom | null>(null)

const newSession = ref<Partial<ClassSessionDTO>>({
    name: '',
    classroom_id: '',
    course_ids: [],
    day_of_week: 1,
    start_time: '10:00',
    end_time: '12:00',
    capacity: 10,
    lesson_number: 1
})
const editingSession = ref<ClassSessionDTO | null>(null)

const days = [
    { value: 0, label: 'Sun' },
    { value: 1, label: 'Mon' },
    { value: 2, label: 'Tue' },
    { value: 3, label: 'Wed' },
    { value: 4, label: 'Thu' },
    { value: 5, label: 'Fri' },
    { value: 6, label: 'Sat' },
]

onMounted(async () => {
    await loadData()
})

async function loadData() {
    try {
        loading.value = true
        await Promise.all([
            loadRooms(),
            loadSessions(),
            loadAllRooms(),
            CourseService.getCourses().then(res => { courses.value = res.data })
        ])
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
}

async function loadRooms() {
    const res = await CourseService.getClassrooms(roomsPagination.value.page, roomsPagination.value.perPage, searchQuery.value)
    classrooms.value = res.data
    roomsPagination.value.total = res.count
}

async function loadSessions() {
    const res = await CourseService.getClassSessions(sessionsPagination.value.page, sessionsPagination.value.perPage, searchQuery.value)
    sessions.value = res.data
    sessionsPagination.value.total = res.count
}

async function loadAllRooms() {
    const res = await CourseService.getClassrooms(1, 1000)
    allClassrooms.value = res.data
}

watch(() => roomsPagination.value.page, loadRooms)
watch(() => roomsPagination.value.perPage, () => { roomsPagination.value.page = 1; loadRooms() })
watch(() => sessionsPagination.value.page, loadSessions)
watch(() => sessionsPagination.value.perPage, () => { sessionsPagination.value.page = 1; loadSessions() })
watch(searchQuery, () => {
    if (activeTab.value === 'rooms') {
        roomsPagination.value.page = 1
        loadRooms()
    } else if (activeTab.value === 'sessions') {
        sessionsPagination.value.page = 1
        loadSessions()
    }
})

// Computed
const filteredClassrooms = computed(() => classrooms.value) // Now handled server-side

const dayColorMap: Record<number, string> = {
    1: '#3b82f6', // Mon: Blue
    2: '#8b5cf6', // Tue: Violet
    3: '#ec4899', // Wed: Pink
    4: '#f59e0b', // Thu: Amber
    5: '#06b6d4', // Fri: Cyan
    6: '#10b981', // Sat: Emerald
    0: '#ef4444'  // Sun: Red
}

function getDayColor(day: number) {
    return dayColorMap[day] || '#10b981'
}

const filteredSessions = computed(() => {
    let result = [...sessions.value]

    if (searchQuery.value.trim()) {
        const q = searchQuery.value.toLowerCase()
        result = result.filter(s => {
            const roomName = getRoomName(s.classroom_id!).toLowerCase()
            const courseNames = s.course_ids?.map(cid => {
                const c = courses.value.find(c => c.id === cid)
                return `${c?.subject} ${c?.stage} ${c?.displayNameValue || ''}`.toLowerCase()
            }).join(' ') || ''

            return s.name.toLowerCase().includes(q) || roomName.includes(q) || courseNames.includes(q)
        })
    }

    // Three-level sorting: Classroom -> Day -> Time
    return result.sort((a, b) => {
        // 1. Classroom
        const roomA = getRoomName(a.classroom_id!)
        const roomB = getRoomName(b.classroom_id!)
        const roomCompare = roomA.localeCompare(roomB)
        if (roomCompare !== 0) return roomCompare

        // 2. Day of Week (1-6, then 0 for Sunday)
        const dayA = a.day_of_week === 0 ? 7 : a.day_of_week
        const dayB = b.day_of_week === 0 ? 7 : b.day_of_week
        if (dayA !== dayB) return dayA - dayB

        // 3. Start Time
        return a.start_time.localeCompare(b.start_time)
    })
})

const roomOptions = computed(() => allClassrooms.value.map(c => ({
    label: c.name + (c.address ? ` (${c.address})` : ''),
    value: c.id
})))

// Actions
async function saveClassroom() {
    if (!newClassroom.value.name) return
    try {
        if (editingClassroom.value?.id) {
            await CourseService.updateClassroom(editingClassroom.value.id, newClassroom.value)
        } else {
            await CourseService.createClassroom(newClassroom.value)
        }
        await Promise.all([loadRooms(), loadAllRooms()])
        closeRoomModal()
        toast.success(t('classroom.room_save_success') || 'Room saved successfully')
    } catch (e) {
        toast.error(e as string)
    }
}

function openEditRoom(room: Classroom) {
    editingClassroom.value = room
    newClassroom.value = {
        name: room.name,
        address: room.address,
        phone: room.phone,
        color: room.color || '#10b981',
        external_link: room.external_link || ''
    }
    isCreateRoomModalOpen.value = true
}

function closeRoomModal() {
    isCreateRoomModalOpen.value = false
    editingClassroom.value = null
    newClassroom.value = { name: '', address: '', phone: '', color: '#10b981', external_link: '' }
}

async function deleteClassroom(id: string) {
    openConfirm(t('classroom.confirm_delete_room'), async () => {
        try {
            await CourseService.deleteClassroom(id)
            await Promise.all([loadRooms(), loadAllRooms()])
            toast.success(t('classroom.room_delete_success') || 'Room deleted successfully')
        } catch (e) {
            toast.error(e as string)
        }
    }, t('common.delete'), true)
}

async function saveSession() {
    if (!newSession.value.name) return
    const payload = { ...newSession.value }
    if (!payload.classroom_id) {
        payload.classroom_id = null
    }

    try {
        if (editingSession.value?.id) {
            await CourseService.updateClassSession(editingSession.value.id, payload)
            // Sync occurrences if the schedule might have changed
            await OccurrenceService.syncSessionOccurrences(editingSession.value.id).catch(console.error)
        } else {
            const session = await CourseService.createClassSession(payload)
            // Generate occurrences for new sessions
            const startDate = new Date()
            const endDate = new Date()
            endDate.setMonth(endDate.getMonth() + 3)
            await OccurrenceService.generateOccurrences(session.id!, startDate, endDate)
        }

        await loadSessions()
        closeSessionModal()
        toast.success(t('classroom.session_save_success') || 'Session saved successfully')
    } catch (e) {
        toast.error(e as string)
    }
}

function openEditSession(session: ClassSessionDTO) {
    editingSession.value = session
    newSession.value = { ...session }
    isCreateSessionModalOpen.value = true
}

function closeSessionModal() {
    isCreateSessionModalOpen.value = false
    editingSession.value = null
    newSession.value = {
        name: '',
        classroom_id: '',
        course_ids: [],
        day_of_week: 1,
        start_time: '10:00',
        end_time: '12:00',
        capacity: 10,
        lesson_number: 1
    }
}

function navigateToSession(id: string) {
    router.push({ name: 'session-details', params: { id } })
}

async function deleteSession(id: string) {
    openConfirm(t('classroom.confirm_delete_session'), async () => {
        try {
            await CourseService.deleteClassSession(id)
            await loadSessions()
            toast.success(t('classroom.session_delete_success') || 'Session deleted successfully')
        } catch (e) {
            toast.error(e as string)
        }
    }, t('common.delete'), true)
}

// Helpers
function getDayLabel(day: number) {
    return t(`classroom.days.${day}`) || day
}

function getRoomName(id?: string) {
    return allClassrooms.value.find(c => c.id === id)?.name || t('common.unknown_room', 'Unknown Room')
}

function toggleCourseSelection(courseId: string) {
    const list = newSession.value.course_ids || []
    if (list.includes(courseId)) {
        newSession.value.course_ids = list.filter(id => id !== courseId)
    } else {
        newSession.value.course_ids = [...list, courseId]
    }
}
</script>

<template>
    <div class="space-y-6">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-5">
            <h1 class="text-2xl font-black text-gray-900 tracking-tight">{{ $t('classroom.title') }}</h1>

            <div class="flex flex-col sm:flex-row flex-1 items-center gap-4 w-full max-w-2xl">
                <!-- Search Bar -->
                <div
                    class="w-full flex-1 flex items-center gap-4 bg-white/50 p-1.5 rounded-2xl border border-gray-100 shadow-sm group focus-within:border-emerald-200 focus-within:ring-4 focus-within:ring-emerald-500/5 transition-all">
                    <div class="pl-3 text-gray-400">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <input v-model="searchQuery" type="text" :placeholder="$t('common.search', 'Search...')"
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

                <!-- Tab Switcher -->
                <div
                    class="flex bg-gray-100/80 p-1 rounded-2xl border border-gray-100 shadow-inner w-full sm:w-auto overflow-x-auto shrink-0">
                    <button @click="activeTab = 'rooms'"
                        class="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-xl text-[10px] sm:text-xs font-black transition-all uppercase tracking-widest whitespace-nowrap"
                        :class="activeTab === 'rooms' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'">
                        {{ $t('classroom.rooms_tab') }}
                    </button>
                    <button @click="activeTab = 'sessions'"
                        class="flex-1 sm:flex-none px-4 sm:px-5 py-2 rounded-xl text-[10px] sm:text-xs font-black transition-all uppercase tracking-widest whitespace-nowrap"
                        :class="activeTab === 'sessions' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'">
                        {{ $t('classroom.sessions_tab') }}
                    </button>
                </div>
            </div>

            <!-- Primary Action Button -->
            <button v-if="activeTab === 'rooms'" @click="isCreateRoomModalOpen = true"
                class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-2xl transition-all shadow-lg shadow-emerald-200 font-black flex items-center justify-center gap-2 active:scale-95 text-sm uppercase tracking-widest w-full md:w-auto">
                <span class="text-xl leading-none">+</span> {{ $t('classroom.add_room') }}
            </button>
            <button v-else @click="isCreateSessionModalOpen = true"
                class="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-2xl transition-all shadow-lg shadow-emerald-200 font-black flex items-center justify-center gap-2 active:scale-95 text-sm uppercase tracking-widest w-full md:w-auto">
                <span class="text-xl leading-none">+</span> {{ $t('classroom.add_session') }}
            </button>
        </div>

        <div v-if="loading" class="text-center text-gray-500 py-10">
            <svg class="animate-spin h-8 w-8 mx-auto mb-3 text-emerald-500" xmlns="http://www.w3.org/2000/svg"
                fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z">
                </path>
            </svg>
            {{ $t('student.loading') }}
        </div>

        <!-- ROOMS TAB -->
        <div v-else-if="activeTab === 'rooms'">

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div v-for="room in filteredClassrooms" :key="room.id"
                    class="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group overflow-hidden flex flex-col h-full">

                    <!-- Card Header -->
                    <div class="p-5 pb-3 flex items-start justify-between">
                        <div class="flex items-center gap-4">
                            <!-- Room Indicator Icon -->
                            <div class="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black uppercase shrink-0 group-hover:scale-110 transition-transform shadow-inner"
                                :style="{ backgroundColor: `${room.color}15`, color: room.color }">
                                {{ room.name.charAt(0) }}
                            </div>
                            <!-- Room Name & Info -->
                            <div class="min-w-0 flex-1">
                                <h3
                                    class="font-black text-xl text-gray-900 break-words group-hover:text-emerald-700 transition leading-tight">
                                    {{ room.name }}
                                </h3>
                                <p class="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                                    {{ $t('classroom.rooms_tab') }}
                                </p>
                            </div>
                        </div>

                        <!-- Quick Actions (Mobile Always Visible, Desktop Hover) -->
                        <div
                            class="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                            <button @click="openEditRoom(room)"
                                class="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                                :title="$t('common.edit')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20"
                                    fill="currentColor">
                                    <path
                                        d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                            </button>
                            <button @click="deleteClassroom(room.id!)"
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

                    <!-- Card Body -->
                    <div class="px-5 py-3 flex-1 space-y-3">
                        <div v-if="room.address" class="flex items-start gap-2.5 text-gray-500">
                            <div class="p-1.5 bg-gray-50 rounded-lg text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </div>
                            <span class="text-sm font-medium leading-tight pt-1">{{ room.address }}</span>
                        </div>
                        <div v-if="room.phone" class="flex items-center gap-2.5 text-gray-500">
                            <div class="p-1.5 bg-gray-50 rounded-lg text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                            </div>
                            <span class="text-sm font-medium pt-0.5">{{ room.phone }}</span>
                        </div>
                        <div v-if="room.external_link" class="flex items-center gap-2.5 text-gray-500">
                            <div class="p-1.5 bg-gray-50 rounded-lg text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                </svg>
                            </div>
                            <a :href="room.external_link" target="_blank"
                                class="text-sm font-medium pt-0.5 text-emerald-600 hover:underline break-all">{{
                                    room.external_link }}</a>
                        </div>
                    </div>

                    <!-- Card Footer -->
                    <div class="px-5 py-4 bg-gray-50/30 border-t border-gray-50 flex items-center justify-end">
                        <div class="w-3 h-3 rounded-full shadow-inner" :style="{ backgroundColor: room.color }"></div>
                    </div>
                </div>

                <div v-if="filteredClassrooms.length === 0"
                    class="col-span-full text-center py-16 bg-white rounded-xl border border-dashed border-gray-300 text-gray-400">
                    {{ $t('classroom.no_rooms') }} <span v-if="searchQuery">{{ $t('common.matching') }} "{{ searchQuery
                        }}"</span>
                </div>
            </div>

            <div v-if="roomsPagination.total > 0" class="mt-4">
                <Pagination v-model="roomsPagination.page" v-model:perPage="roomsPagination.perPage"
                    :totalItems="roomsPagination.total" />
            </div>
        </div>

        <!-- SESSIONS TAB -->
        <div v-else-if="activeTab === 'sessions'">

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div v-for="session in filteredSessions" :key="session.id"
                    class="bg-white rounded-2xl shadow-sm border border-gray-100 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 group overflow-hidden flex flex-col h-full">

                    <!-- Card Header -->
                    <div class="p-5 pb-3 flex items-start justify-between">
                        <div class="flex items-center gap-4">
                            <!-- Session Indicator Icon -->
                            <div class="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black uppercase shrink-0 group-hover:scale-110 transition-transform shadow-inner"
                                :style="{ backgroundColor: `${getDayColor(session.day_of_week)}15`, color: getDayColor(session.day_of_week) }">
                                {{ session.name.charAt(0) }}
                            </div>
                            <!-- Session Name & Info -->
                            <div class="min-w-0 flex-1">
                                <h3
                                    class="font-black text-xl text-gray-900 break-words group-hover:text-emerald-700 transition leading-tight">
                                    {{ session.name }}
                                </h3>
                                <div class="flex items-center gap-2 mt-0.5">
                                    <span
                                        class="text-[10px] font-black px-2 py-0.5 rounded-lg border uppercase tracking-widest"
                                        :style="{ backgroundColor: `${getDayColor(session.day_of_week)}10`, color: getDayColor(session.day_of_week), borderColor: `${getDayColor(session.day_of_week)}30` }">
                                        {{ getDayLabel(session.day_of_week) }}
                                    </span>
                                    <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                        {{ session.start_time.slice(0, 5) }}-{{ session.end_time.slice(0, 5) }}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- Quick Actions (Mobile Always Visible, Desktop Hover) -->
                        <div
                            class="flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                            <button @click="openEditSession(session)"
                                class="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-all"
                                :title="$t('common.edit')">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20"
                                    fill="currentColor">
                                    <path
                                        d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                </svg>
                            </button>
                            <button @click="deleteSession(session.id!)"
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

                    <!-- Card Body -->
                    <div class="px-5 py-2 flex-1 space-y-3">
                        <!-- Room Info -->
                        <div class="flex items-center gap-2.5 text-gray-500">
                            <div class="p-1.5 bg-gray-50 rounded-lg text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                </svg>
                            </div>
                            <span class="text-sm font-bold text-gray-700">{{ getRoomName(session.classroom_id!)
                            }}</span>
                        </div>

                        <!-- Capacity Info -->
                        <div class="flex items-center gap-2.5 text-gray-500">
                            <div class="p-1.5 bg-gray-50 rounded-lg text-gray-400">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none"
                                    viewBox="0 0 24 24" stroke="currentColor">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                            </div>
                            <span class="text-xs font-bold text-gray-400 uppercase tracking-widest">{{
                                $t('classroom.capacity_short') }}: {{ session.capacity }}</span>
                        </div>

                        <!-- Courses Tags -->
                        <div v-if="session.course_ids?.length" class="flex flex-wrap gap-1.5 pt-1">
                            <span v-for="cid in session.course_ids" :key="cid"
                                class="px-2 py-0.5 bg-gray-50 border border-gray-100 rounded-lg text-[10px] font-black text-gray-400 uppercase tracking-tight truncate max-w-[120px]">
                                {{courses.find(c => c.id === cid)?.subject}}
                            </span>
                        </div>
                    </div>

                    <!-- Card Actions -->
                    <div class="px-5 py-4 flex gap-2">
                        <button @click="navigateToSession(session.id!)"
                            class="flex-1 py-2.5 rounded-xl text-sm font-black transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-white"
                            :style="{ backgroundColor: getDayColor(session.day_of_week) }">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3"
                                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                            {{ $t('classroom.view_students', 'Students') }}
                        </button>
                    </div>

                    <!-- Card Footer -->
                    <div
                        class="px-5 py-3 bg-gray-50/50 border-t border-gray-50 flex items-center justify-between text-[10px] font-black text-gray-300 tracking-widest uppercase">
                        <span>#{{ session.id?.slice(0, 8) }}</span>
                        <span>{{ session.lesson_number }} Lessons</span>
                    </div>
                </div>
            </div>

            <div v-if="sessionsPagination.total > 0" class="mt-4">
                <Pagination v-model="sessionsPagination.page" v-model:perPage="sessionsPagination.perPage"
                    :totalItems="sessionsPagination.total" />
            </div>
        </div>

        <!-- Create Room Modal -->
        <div v-if="isCreateRoomModalOpen"
            class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div class="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in duration-200">
                <h3 class="text-xl font-bold mb-6 text-gray-800">{{ $t('classroom.add_room') }}</h3>
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.room_name')
                        }}</label>
                        <input v-model="newClassroom.name" :placeholder="$t('classroom.room_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.address')
                        }}</label>
                        <input v-model="newClassroom.address" :placeholder="$t('classroom.address')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.phone')
                        }}</label>
                        <input v-model="newClassroom.phone" :placeholder="$t('classroom.phone')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.external_link')
                        }}</label>
                        <input v-model="newClassroom.external_link" :placeholder="$t('classroom.external_link_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.color_label')
                        }}</label>
                        <input type="color" v-model="newClassroom.color"
                            class="w-full h-10 border-gray-300 rounded-lg cursor-pointer bg-white p-1">
                    </div>
                </div>
                <div class="flex justify-end gap-3 mt-8">
                    <button @click="closeRoomModal"
                        class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">{{
                            $t('common.cancel', 'Cancel') }}</button>
                    <button @click="saveClassroom"
                        class="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm font-bold transition-all">
                        {{ editingClassroom ? $t('common.save', 'Save') : $t('common.add', 'Add') }}
                    </button>
                </div>
            </div>
        </div>

        <!-- Create Session Modal -->
        <div v-if="isCreateSessionModalOpen"
            class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div
                class="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl m-4 animate-in fade-in zoom-in duration-200 overflow-y-auto max-h-[90vh]">
                <h3 class="text-xl font-bold mb-6 text-gray-800">{{ $t('classroom.add_session') }}</h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div class="md:col-span-2">
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.session_name')
                        }}</label>
                        <input v-model="newSession.name" :placeholder="$t('classroom.session_placeholder')"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>

                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{
                            $t('student.internal_courses.classroom') }}</label>
                        <SearchableSelect v-model="newSession.classroom_id" :options="roomOptions"
                            :placeholder="$t('student.internal_courses.session_select_placeholder')" />
                    </div>

                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{ $t('classroom.capacity')
                        }}</label>
                        <input type="number" v-model="newSession.capacity"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                    </div>

                    <div>
                        <label class="block text-sm font-semibold text-gray-700 mb-1.5">{{
                            $t('student.internal_courses.lesson_number') }}</label>
                        <input type="number" v-model.number="newSession.lesson_number"
                            class="w-full border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500"
                            placeholder="1">
                    </div>

                    <div class="md:col-span-2">
                        <label class="block text-sm font-semibold text-gray-700 mb-2">{{ $t('classroom.schedule')
                        }}</label>
                        <div class="flex flex-wrap gap-2">
                            <select v-model="newSession.day_of_week"
                                class="border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 bg-white">
                                <option v-for="d in days" :key="d.value" :value="d.value">{{
                                    $t(`classroom.days.${d.value}`) }}</option>
                            </select>
                            <div class="flex items-center gap-2">
                                <input type="time" v-model="newSession.start_time"
                                    class="border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                                <span class="text-gray-400 font-bold">-</span>
                                <input type="time" v-model="newSession.end_time"
                                    class="border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500">
                            </div>
                        </div>
                    </div>

                    <div class="md:col-span-2">
                        <label class="block text-sm font-medium text-gray-700 mb-2">{{
                            $t('student.internal_courses.course') }}</label>
                        <div class="h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-1">
                            <div v-for="c in courses" :key="c.id" @click="toggleCourseSelection(c.id!)"
                                class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-white select-none transition"
                                :class="newSession.course_ids?.includes(c.id!) ? 'bg-white shadow-sm ring-1 ring-emerald-500' : ''">
                                <div class="w-4 h-4 rounded border flex items-center justify-center transition-colors"
                                    :class="newSession.course_ids?.includes(c.id!) ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 bg-white'">
                                    <svg v-if="newSession.course_ids?.includes(c.id!)"
                                        xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-white"
                                        viewBox="0 0 20 20" fill="currentColor">
                                        <path fill-rule="evenodd"
                                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                            clip-rule="evenodd" />
                                    </svg>
                                </div>
                                <span class="text-sm text-gray-700">{{ c.subject }} <span class="text-gray-400">- {{
                                    c.stage }}{{ c.displayNameValue ? ` (${c.displayNameValue})` : ''
                                        }}</span></span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="flex justify-end gap-3 mt-8 pt-4 border-t border-gray-50">
                    <button @click="closeSessionModal"
                        class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">{{
                            $t('common.cancel') }}</button>
                    <button @click="saveSession"
                        class="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 shadow-sm font-bold transition-all">
                        {{ editingSession ? $t('common.save') : $t('common.add') }}
                    </button>
                </div>
            </div>
        </div>
        <ConfirmModal :is-open="genericConfirm.isOpen" :title="genericConfirm.title" :message="genericConfirm.message"
            :confirm-text="genericConfirm.confirmText" :is-dangerous="genericConfirm.isDangerous"
            @confirm="handleGenericConfirm" @close="genericConfirm.isOpen = false" />
    </div>
</template>
