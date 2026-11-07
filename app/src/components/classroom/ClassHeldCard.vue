<script setup lang="ts">
defineProps<{
    isConducted: boolean
    isHoliday: boolean
}>()

const emit = defineEmits<{
    'copy-attendance': []
    'edit-template': []
    'toggle-conducted': [event: Event]
}>()
</script>

<template>
    <div class="bg-white p-6 rounded-[2.5rem] border border-gray-100 shadow-sm flex items-center justify-between">
        <div>
            <h3 class="font-black text-gray-900">{{ $t('classroom.class_held_title') }}
            </h3>
            <p class="text-xs font-bold text-gray-400">
                {{ $t('classroom.class_held_subtitle') }}
            </p>
        </div>

        <div class="flex items-center gap-4">
            <button @click="emit('copy-attendance')"
                class="p-2 rounded-full bg-gray-50 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                :title="$t('classroom.copy_attendance')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
            </button>

            <button @click="emit('edit-template')"
                class="p-2 rounded-full bg-gray-50 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                :title="$t('classroom.copy_template_settings')">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24"
                    stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                        d="M11.983 5.5l1.165-2.09a1 1 0 011.733 0l1.165 2.09 2.34.414a1 1 0 01.557 1.69l-1.6 1.641.294 2.303a1 1 0 01-1.414 1.04L14 11.61l-2.223.978a1 1 0 01-1.414-1.04l.294-2.303-1.6-1.64a1 1 0 01.557-1.691l2.369-.414zM5 15h14M7 19h10" />
                </svg>
            </button>

            <label class="relative inline-flex items-center cursor-pointer"
                :title="isHoliday ? $t('report.error.cannot_set_conducted_during_holiday') : $t('classroom.class_held')"
                :class="{ 'opacity-50 cursor-not-allowed': isHoliday }">
                <span class="sr-only">{{ $t('classroom.class_held') }}</span>
                <input type="checkbox" :checked="isConducted"
                    :disabled="isHoliday" @change="emit('toggle-conducted', $event)"
                    :aria-label="$t('classroom.class_held')" class="sr-only peer">
                <div :class="isHoliday ? 'bg-red-100' : 'bg-gray-200'"
                    class="w-14 h-7 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[4px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-500">
                </div>
            </label>
        </div>
    </div>
</template>
