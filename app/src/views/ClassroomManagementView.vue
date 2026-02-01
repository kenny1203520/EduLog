<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { CourseService } from '@/services/CourseService'
import { OccurrenceService } from '@/services/OccurrenceService'
import { Classroom, type ClassroomDTO, type ClassSessionDTO } from '@/models/Classroom'
import { Course } from '@/models/Course'
import { useI18n } from 'vue-i18n'
import Pagination from '@/components/common/Pagination.vue'
import SearchableSelect from '@/components/common/SearchableSelect.vue'

const { t } = useI18n()
const activeTab = ref<'rooms' | 'sessions'>('rooms')

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
const newClassroom = ref<Partial<ClassroomDTO>>({ name: '', address: '', phone: '', color: '#10b981' })
const newSession = ref<Partial<ClassSessionDTO>>({
    name: '',
    classroom_id: '',
    course_ids: [],
    day_of_week: 1,
    start_time: '10:00',
    end_time: '12:00',
    capacity: 10
})

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

const filteredSessions = computed(() => {
    if (!searchQuery.value.trim()) return sessions.value
    const q = searchQuery.value.toLowerCase()
    return sessions.value.filter(s => {
        const roomName = getRoomName(s.classroom_id).toLowerCase()
        const courseNames = s.course_ids?.map(cid => {
            const c = courses.value.find(c => c.id === cid)
            return `${c?.subject} ${c?.stage} ${c?.displayNameValue || ''}`.toLowerCase()
        }).join(' ') || ''
        
        return s.name.toLowerCase().includes(q) || roomName.includes(q) || courseNames.includes(q)
    })
})

const roomOptions = computed(() => allClassrooms.value.map(c => ({
    label: c.name + (c.address ? ` (${c.address})` : ''),
    value: c.id
})))

// Actions
async function createClassroom() {
    if (!newClassroom.value.name) return
    try {
        await CourseService.createClassroom(newClassroom.value)
        await Promise.all([loadRooms(), loadAllRooms()])
        isCreateRoomModalOpen.value = false
        newClassroom.value = { name: '', address: '', phone: '', color: '#10b981' }
    } catch (e) {
        alert(e)
    }
}

async function deleteClassroom(id: string) {
    if (!confirm(t('common.confirm_delete'))) return
    try {
        await CourseService.deleteClassroom(id)
        await Promise.all([loadRooms(), loadAllRooms()])
    } catch (e) {
        alert(e)
    }
}

async function createSession() {
    if (!newSession.value.name) return
    try {
        const session = await CourseService.createClassSession(newSession.value)
        
        // Automatically generate occurrences for the next 3 months
        const startDate = new Date()
        const endDate = new Date()
        endDate.setMonth(endDate.getMonth() + 3)
        await OccurrenceService.generateOccurrences(session.id!, startDate, endDate)
        
        await loadSessions()
        isCreateSessionModalOpen.value = false
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
    } catch (e) {
        alert(e)
    }
}

async function deleteSession(id: string) {
    if (!confirm(t('common.confirm_delete'))) return
    try {
        await CourseService.deleteClassSession(id)
        await loadSessions()
    } catch (e) {
        alert(e)
    }
}

// Helpers
function getDayLabel(day: number) {
    return days.find(d => d.value === day)?.label || day
}

function getRoomName(id?: string) {
    return allClassrooms.value.find(c => c.id === id)?.name || 'Unknown Room'
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
    <div class="flex items-center justify-between flex-wrap gap-4">
        <h1 class="text-2xl font-bold text-gray-800">{{ $t('nav.classrooms') }}</h1>
        <div class="flex items-center gap-4">
            <input 
                v-model="searchQuery" 
                :placeholder="$t('common.search', 'Search...')"
                class="border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-emerald-500 w-64"
            >
            
            <div class="flex bg-gray-100 p-1 rounded-lg">
                <button 
                    @click="activeTab = 'rooms'"
                    class="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
                    :class="activeTab === 'rooms' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
                >
                    Start Rooms
                </button>
                <button 
                    @click="activeTab = 'sessions'"
                    class="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
                    :class="activeTab === 'sessions' ? 'bg-white text-emerald-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'"
                >
                    Class Sessions
                </button>
            </div>
        </div>
    </div>

    <div v-if="loading" class="text-center text-gray-500 py-10">Loading...</div>

    <!-- ROOMS TAB -->
    <div v-else-if="activeTab === 'rooms'">
        <div class="flex justify-end mb-4">
            <button 
                @click="isCreateRoomModalOpen = true"
                class="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition flex items-center gap-2"
            >
                <span>+</span> Add Room
            </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div v-for="room in filteredClassrooms" :key="room.id" class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden group hover:shadow-md transition">
                <div class="p-4 border-b border-gray-100 flex justify-between items-center" :style="{ borderTop: `4px solid ${room.color}` }">
                    <h3 class="font-bold text-lg text-gray-800">{{ room.name }}</h3>
                    <button @click="deleteClassroom(room.id!)" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
                <div class="p-4 text-gray-600 text-sm space-y-2">
                    <div class="flex items-start gap-2" v-if="room.address">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span>{{ room.address }}</span>
                    </div>
                    <div class="flex items-start gap-2" v-if="room.phone">
                         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                         </svg>
                         <span>{{ room.phone }}</span>
                    </div>
                </div>
            </div>
            
            <div v-if="filteredClassrooms.length === 0" class="col-span-full text-center py-10 text-gray-400">
                No rooms found matching "{{ searchQuery }}"
            </div>
        </div>

        <div v-if="roomsPagination.total > 0" class="mt-4">
             <Pagination 
                v-model="roomsPagination.page" 
                v-model:perPage="roomsPagination.perPage" 
                :totalItems="roomsPagination.total" 
            />
        </div>
    </div>

    <!-- SESSIONS TAB -->
    <div v-else-if="activeTab === 'sessions'">
        <div class="flex justify-end mb-4">
             <button 
                @click="isCreateSessionModalOpen = true"
                class="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition flex items-center gap-2"
            >
                <span>+</span> Add Session
            </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
             <div v-for="session in filteredSessions" :key="session.id" class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition">
                 <div class="flex justify-between items-start mb-2">
                     <h3 class="font-bold text-lg text-gray-800">{{ session.name }}</h3>
                     <span class="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600 font-medium">
                        {{ getDayLabel(session.day_of_week) }} {{ session.start_time.slice(0,5) }}-{{ session.end_time.slice(0,5) }}
                     </span>
                 </div>
                 
                 <div class="text-sm text-gray-600 mb-3 flex items-center gap-2">
                     <span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs font-bold border border-emerald-100">
                         {{ getRoomName(session.classroom_id) }}
                     </span>
                     <span class="text-gray-400 text-xs flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        Cap: {{ session.capacity }}
                     </span>
                 </div>
                 
                 <div class="text-xs text-gray-500">
                    <div class="font-medium mb-1">Courses:</div>
                    <div class="flex flex-wrap gap-1">
                        <span v-for="cid in session.course_ids" :key="cid" class="px-1.5 py-0.5 bg-gray-100 border border-gray-200 rounded text-gray-600 truncate max-w-[150px]">
                            {{ courses.find(c => c.id === cid)?.subject }} - {{ courses.find(c => c.id === cid)?.stage }}
                        </span>
                        <span v-if="!session.course_ids || session.course_ids.length === 0" class="italic text-gray-300">None</span>
                    </div>
                 </div>

                 <div class="mt-4 pt-3 border-t border-gray-50 flex justify-end">
                     <button @click="deleteSession(session.id!)" class="text-xs text-red-400 hover:text-red-600 hover:underline">Delete</button>
                 </div>
             </div>
        </div>

         <div v-if="sessionsPagination.total > 0" class="mt-4">
             <Pagination 
                v-model="sessionsPagination.page" 
                v-model:perPage="sessionsPagination.perPage" 
                :totalItems="sessionsPagination.total" 
            />
        </div>
    </div>

    <!-- Create Room Modal -->
    <div v-if="isCreateRoomModalOpen" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 class="text-xl font-bold mb-4">Add Classroom</h3>
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>
                    <input v-model="newClassroom.name" placeholder="e.g. Room 101" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Address</label>
                    <input v-model="newClassroom.address" placeholder="Location/Address" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input v-model="newClassroom.phone" placeholder="Contact Number" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Color Label</label>
                    <input type="color" v-model="newClassroom.color" class="w-full h-10 border-gray-300 rounded-lg cursor-pointer">
                </div>
            </div>
            <div class="flex justify-end gap-3 mt-6">
                <button @click="isCreateRoomModalOpen = false" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button @click="createClassroom" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Create</button>
            </div>
        </div>
    </div>

    <!-- Create Session Modal -->
    <div v-if="isCreateSessionModalOpen" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div class="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl m-4">
            <h3 class="text-xl font-bold mb-4">New Class Session</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Session Name</label>
                    <input v-model="newSession.name" placeholder="e.g. Tuesday Python Lab" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                </div>
                
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Classroom</label>
                    <SearchableSelect
                        v-model="newSession.classroom_id"
                        :options="roomOptions"
                        placeholder="Select Classroom..."
                    />
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                    <input type="number" v-model="newSession.capacity" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">{{ $t('student.internal_courses.lesson_number') }}</label>
                    <input type="number" v-model.number="newSession.lesson_number" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500" placeholder="1">
                </div>
                
                <div class="md:col-span-2">
                     <label class="block text-sm font-medium text-gray-700 mb-1">Schedule</label>
                     <div class="flex gap-2">
                        <select v-model="newSession.day_of_week" class="border-gray-300 rounded-lg">
                            <option v-for="d in days" :key="d.value" :value="d.value">{{ d.label }}</option>
                        </select>
                        <input type="time" v-model="newSession.start_time" class="border-gray-300 rounded-lg">
                        <span class="self-center">-</span>
                        <input type="time" v-model="newSession.end_time" class="border-gray-300 rounded-lg">
                     </div>
                </div>

                <div class="md:col-span-2">
                    <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('student.internal_courses.course') }}</label>
                    <div class="h-40 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50 space-y-1">
                        <div 
                            v-for="c in courses" 
                            :key="c.id" 
                            @click="toggleCourseSelection(c.id!)"
                            class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-white select-none transition"
                            :class="newSession.course_ids?.includes(c.id!) ? 'bg-white shadow-sm ring-1 ring-emerald-500' : ''"
                        >
                            <div class="w-4 h-4 rounded border flex items-center justify-center transition-colors"
                                 :class="newSession.course_ids?.includes(c.id!) ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 bg-white'"
                            >
                                <svg v-if="newSession.course_ids?.includes(c.id!)" xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-white" viewBox="0 0 20 20" fill="currentColor">
                                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                                </svg>
                            </div>
                            <span class="text-sm text-gray-700">{{ c.subject }} <span class="text-gray-400">- {{ c.stage }}{{ c.displayNameValue ? ` (${c.displayNameValue})` : '' }}</span></span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="flex justify-end gap-3 mt-6">
                <button @click="isCreateSessionModalOpen = false" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">{{ $t('student.cancel') }}</button>
                <button @click="createSession" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">{{ $t('student.create') }}</button>
            </div>
        </div>
    </div>
</div>
</template>
