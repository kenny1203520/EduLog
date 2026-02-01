<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { CourseService } from '@/services/CourseService'
import { Classroom, type ClassroomDTO, type ClassSessionDTO } from '@/models/Classroom'
import { Course } from '@/models/Course'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const activeTab = ref<'rooms' | 'sessions'>('rooms')

// Data
const classrooms = ref<Classroom[]>([])
const sessions = ref<ClassSessionDTO[]>([])
const courses = ref<Course[]>([])
const loading = ref(true)

// Modals
const isCreateRoomModalOpen = ref(false)
const isCreateSessionModalOpen = ref(false)

// Forms
const newClassroom = ref<Partial<ClassroomDTO>>({ name: '', address: '', color: '#10b981' })
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
        const [roomsData, sessionsData, coursesData] = await Promise.all([
            CourseService.getClassrooms(),
            CourseService.getClassSessions(),
            CourseService.getCourses()
        ])
        classrooms.value = roomsData
        sessions.value = sessionsData
        courses.value = coursesData
    } catch (e) {
        console.error(e)
    } finally {
        loading.value = false
    }
}

// --- Classroom Actions ---
async function createClassroom() {
    if (!newClassroom.value.name) return
    try {
        await CourseService.createClassroom(newClassroom.value)
        classrooms.value = await CourseService.getClassrooms()
        isCreateRoomModalOpen.value = false
        newClassroom.value = { name: '', address: '', color: '#10b981' }
    } catch (e) {
        alert(e)
    }
}

async function deleteClassroom(id: string) {
    if (!confirm(t('common.confirm_delete'))) return
    try {
        await CourseService.deleteClassroom(id)
        classrooms.value = await CourseService.getClassrooms()
    } catch (e) {
        alert(e)
    }
}

// --- Session Actions ---
async function createSession() {
    if (!newSession.value.name) return
    try {
        await CourseService.createClassSession(newSession.value)
        sessions.value = await CourseService.getClassSessions()
        isCreateSessionModalOpen.value = false
        // Reset form
        newSession.value = {
            name: '',
            classroom_id: classrooms.value.length > 0 ? classrooms.value[0].id : '',
            course_ids: [],
            day_of_week: 1,
            start_time: '10:00',
            end_time: '12:00',
            capacity: 10
        }
    } catch (e) {
        alert(e)
    }
}

async function deleteSession(id: string) {
    if (!confirm(t('common.confirm_delete'))) return
    try {
        await CourseService.deleteClassSession(id)
        sessions.value = await CourseService.getClassSessions()
    } catch (e) {
        alert(e)
    }
}

// Helpers
function getDayLabel(day: number) {
    return days.find(d => d.value === day)?.label || day
}

function getRoomName(id?: string) {
    return classrooms.value.find(c => c.id === id)?.name || 'Unknown Room'
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
    <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gray-800">{{ $t('nav.classrooms') }}</h1>
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
            <div v-for="room in classrooms" :key="room.id" class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden group hover:shadow-md transition">
                <div class="p-4 border-b border-gray-100 flex justify-between items-center" :style="{ borderTop: `4px solid ${room.color}` }">
                    <h3 class="font-bold text-lg text-gray-800">{{ room.name }}</h3>
                    <button @click="deleteClassroom(room.id!)" class="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
                <div class="p-4 text-gray-600 text-sm">
                    <div class="flex items-start gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                           <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span>{{ room.address || 'No address' }}</span>
                    </div>
                </div>
            </div>
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
             <div v-for="session in sessions" :key="session.id" class="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md transition">
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
                    <select v-model="newSession.classroom_id" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
                        <option v-for="r in classrooms" :key="r.id" :value="r.id">{{ r.name }}</option>
                    </select>
                </div>

                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
                    <input type="number" v-model="newSession.capacity" class="w-full border-gray-300 rounded-lg focus:ring-emerald-500">
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
                    <label class="block text-sm font-medium text-gray-700 mb-2">Included Courses</label>
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
                            <span class="text-sm text-gray-700">{{ c.subject }} <span class="text-gray-400">- {{ c.stage }}</span></span>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="flex justify-end gap-3 mt-6">
                <button @click="isCreateSessionModalOpen = false" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button @click="createSession" class="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Create Session</button>
            </div>
        </div>
    </div>
</div>
</template>
