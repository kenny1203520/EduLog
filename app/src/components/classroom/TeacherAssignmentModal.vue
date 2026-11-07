<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { roleDisplayName } from '@/utils/roleDisplay'
import type { SessionTeacherAssignmentDTO } from '@/services/teacher/TeacherService'
import type { TeacherOverviewDTO } from '@/services/api/PageApiService'

defineProps<{
    open: boolean
    sessionId: string
    dateLabel: string
    assignments: SessionTeacherAssignmentDTO[]
    teachers: TeacherOverviewDTO[]
}>()

const emit = defineEmits<{
    close: []
    add: [teacher: TeacherOverviewDTO]
    remove: [teacherId: string, effectiveFrom: string]
}>()

const searchQuery = defineModel<string>('searchQuery', { required: true })

const { t } = useI18n()
</script>

<template>
    <Transition name="fade">
        <div v-if="open" class="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div class="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" @click="emit('close')">
            </div>

            <div
                class="relative bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                <!-- Header -->
                <div class="p-8 border-b border-gray-50 flex items-center justify-between shrink-0">
                    <div>
                        <h2 class="text-2xl font-black text-gray-900 tracking-tight">{{ $t('classroom.manage_teachers') }}</h2>
                        <p class="text-sm font-bold text-gray-400 mt-1">{{ dateLabel }}</p>
                    </div>
                    <button @click="emit('close')"
                        class="p-3 rounded-2xl bg-gray-50 text-gray-400 hover:text-gray-900 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24"
                            stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <!-- Current Schedule Section -->
                <div class="px-6 py-4 border-b border-gray-50 bg-emerald-50/30">
                    <h4
                        class="text-xs font-black text-emerald-800 uppercase tracking-widest mb-3 flex items-center justify-between">
                        {{ $t('classroom.teaching_schedule') }}
                        <router-link :to="{ name: 'classrooms', query: { edit: sessionId } }"
                            class="text-[10px] font-bold text-emerald-600 hover:underline">
                            {{ $t('classroom.master_schedule_link') }}
                        </router-link>
                    </h4>
                    <div class="space-y-2">
                        <div v-for="st in assignments" :key="st.id + st.effective_from"
                            class="flex items-center justify-between p-3 rounded-xl bg-white border border-emerald-100 shadow-sm">
                            <div class="flex items-center gap-3">
                                <div
                                    class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-xs">
                                    {{ st.name.charAt(0) }}
                                </div>
                                <div>
                                    <div class="text-sm font-black text-gray-900">{{ st.name }}</div>
                                    <div v-if="st.role?.name" class="mt-0.5 text-[10px] font-black tracking-wide text-emerald-600">{{ roleDisplayName(st.role, t) }}</div>
                                    <div class="text-[10px] font-bold text-gray-400">
                                        {{ st.effective_to ? `${st.effective_from} ~ ${st.effective_to}` :
                                            `${st.effective_from} ~ ${$t('classroom.default_teacher')}` }}
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-1">
                                <router-link to="/dashboard/teachers"
                                    :aria-label="$t('classroom.manage_teachers')"
                                    class="relative p-2 text-gray-300 hover:text-emerald-500 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                                    </svg>
                                </router-link>
                                <button @click="st.id && emit('remove', st.id, st.effective_from)"
                                    class="p-2 text-gray-300 hover:text-rose-500 transition-colors">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none"
                                        viewBox="0 0 24 24" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                        <div v-if="assignments.length === 0" class="text-center py-4 text-xs font-bold text-gray-400 italic">
                            {{ $t('classroom.no_teachers_assigned') }}
                        </div>
                    </div>
                </div>

                <!-- Search Bar -->
                <div class="p-6 bg-gray-50/50 border-b border-gray-50">
                    <h4 class="text-xs font-black text-gray-400 uppercase tracking-widest mb-3">
                        {{ $t('classroom.one_day_assignment') }}
                    </h4>
                    <div
                        class="flex items-center gap-4 bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm focus-within:border-emerald-200 focus-within:ring-4 focus-within:ring-emerald-500/5 transition-all">
                        <div class="pl-3 text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                                stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                        </div>
                        <input v-model="searchQuery" type="text" :placeholder="$t('common.search_teacher')"
                            class="flex-1 bg-transparent border-none outline-none text-sm font-bold text-gray-700 placeholder:text-gray-300 py-2"  :aria-label="$t('common.search_teacher')"/>
                    </div>
                </div>

                <!-- Teacher List -->
                <div class="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar min-h-[300px]">
                    <div v-for="teacher in teachers" :key="teacher.id" @click="emit('add', teacher)"
                        class="flex items-center justify-between p-4 rounded-2xl border bg-white border-gray-100 hover:border-emerald-100 hover:bg-emerald-50/10 transition-all cursor-pointer group">

                        <div class="flex items-center gap-4">
                            <div
                                class="w-12 h-12 rounded-2xl bg-gray-100 text-gray-400 flex items-center justify-center font-black text-lg transition-transform group-hover:scale-110 group-hover:bg-emerald-100 group-hover:text-emerald-700">
                                {{ teacher.name.charAt(0) }}
                            </div>
                            <div>
                                <div class="font-black text-gray-900">{{ teacher.name }}</div>
                                <div class="text-xs font-bold text-gray-400">{{ teacher.email || teacher.phone ||
                                    'No contact info' }}</div>
                            </div>
                        </div>

                        <div
                            class="w-8 h-8 rounded-full border-2 border-gray-200 text-transparent flex items-center justify-center transition-all group-hover:border-emerald-500 group-hover:bg-emerald-500 group-hover:text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20"
                                fill="currentColor">
                                <path fill-rule="evenodd"
                                    d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                                    clip-rule="evenodd" />
                            </svg>
                        </div>
                    </div>

                    <div v-if="teachers.length === 0" class="text-center py-12 text-gray-400">
                        <p class="font-bold italic">{{ $t('common.no_results') }}</p>
                    </div>
                </div>

                <!-- Footer -->
                <div class="p-8 border-t border-gray-50 flex items-center gap-4 shrink-0">
                    <button @click="emit('close')"
                        class="flex-1 px-6 py-4 rounded-2xl bg-gray-50 text-gray-500 font-black uppercase tracking-widest text-sm hover:bg-gray-100 transition-all active:scale-95">
                        {{ $t('common.close') }}
                    </button>
                </div>
            </div>
        </div>
    </Transition>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
    width: 6px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background: #e2e8f0;
    border-radius: 10px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #cbd5e1;
}

.custom-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: #e2e8f0 transparent;
}
</style>
