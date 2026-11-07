<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TeacherDirectoryItem } from '@/services/teacher/TeacherDirectoryService'

/**
 * Teacher directory list: a table from md up, stacked rows on phones. Rows
 * are buttons that select the teacher; checkboxes are only shown when bulk
 * actions are allowed.
 */
const props = defineProps<{
    items: TeacherDirectoryItem[]
    selectedId: string | null
    checkedIds: Set<string>
    selectable: boolean
}>()

const emit = defineEmits<{
    (e: 'select', teacher: TeacherDirectoryItem): void
    (e: 'toggle', id: string, checked: boolean): void
    (e: 'toggle-page', checked: boolean): void
}>()

const { t } = useI18n()

const allChecked = computed(() => props.items.length > 0 && props.items.every(item => props.checkedIds.has(item.id)))
const someChecked = computed(() => !allChecked.value && props.items.some(item => props.checkedIds.has(item.id)))

function initial(name: string) {
    return name.trim().charAt(0).toUpperCase() || '?'
}

function contact(teacher: TeacherDirectoryItem) {
    return [teacher.email, teacher.phone].filter(Boolean).join(' · ')
}
</script>

<template>
    <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <!-- md+: table -->
        <table class="hidden w-full table-fixed text-left text-sm md:table">
            <caption class="sr-only">{{ t('teacher.management_title') }}</caption>
            <thead class="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                    <th v-if="selectable" scope="col" class="w-12 px-3 py-3">
                        <input type="checkbox" class="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-600"
                            :checked="allChecked" :indeterminate="someChecked" :aria-label="t('teacher.directory.select_all_page')"
                            @change="emit('toggle-page', ($event.target as HTMLInputElement).checked)" />
                    </th>
                    <th scope="col" class="px-3 py-3">{{ t('teacher.directory.column_teacher') }}</th>
                    <th scope="col" class="hidden px-3 py-3 xl:table-cell">{{ t('teacher.directory.column_contact') }}</th>
                    <th scope="col" class="w-36 px-3 py-3">{{ t('teacher.directory.column_account') }}</th>
                    <th scope="col" class="w-28 px-3 py-3 text-right">{{ t('teacher.directory.column_classes') }}</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr v-for="teacher in items" :key="teacher.id"
                    class="cursor-pointer transition-colors duration-150 hover:bg-emerald-50/50"
                    :class="selectedId === teacher.id ? 'bg-emerald-50' : ''"
                    @click="emit('select', teacher)">
                    <td v-if="selectable" class="px-3 py-3" @click.stop>
                        <input type="checkbox" class="h-4 w-4 cursor-pointer rounded border-slate-300 accent-emerald-600"
                            :checked="checkedIds.has(teacher.id)" :aria-label="t('teacher.directory.select_teacher', { name: teacher.name })"
                            @change="emit('toggle', teacher.id, ($event.target as HTMLInputElement).checked)" />
                    </td>
                    <td class="px-3 py-3">
                        <button type="button" class="flex w-full min-w-0 items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                            :aria-current="selectedId === teacher.id ? 'true' : undefined" @click.stop="emit('select', teacher)">
                            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-black"
                                :class="teacher.archived_at ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'" aria-hidden="true">{{ initial(teacher.name) }}</span>
                            <span class="min-w-0">
                                <span class="block truncate font-bold text-slate-900">{{ teacher.name }}</span>
                                <span v-if="teacher.archived_at" class="mt-0.5 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{{ t('teacher.directory.archived_badge') }}</span>
                                <span v-else-if="contact(teacher)" class="block truncate text-xs text-slate-500 xl:hidden">{{ contact(teacher) }}</span>
                            </span>
                        </button>
                    </td>
                    <td class="hidden px-3 py-3 text-slate-600 xl:table-cell">
                        <span class="block truncate">{{ teacher.email || '—' }}</span>
                        <span v-if="teacher.phone" class="block truncate text-xs text-slate-500">{{ teacher.phone }}</span>
                    </td>
                    <td class="px-3 py-3">
                        <span class="inline-flex items-center gap-1.5 text-xs font-bold" :class="teacher.user_id ? 'text-emerald-700' : 'text-slate-500'">
                            <span class="h-2 w-2 rounded-full" :class="teacher.user_id ? 'bg-emerald-500' : 'bg-slate-300'" aria-hidden="true"></span>
                            {{ teacher.user_id ? t('teacher.directory.linked') : t('teacher.directory.unlinked') }}
                        </span>
                    </td>
                    <td class="px-3 py-3 text-right tabular-nums">
                        <span v-if="teacher.class_count > 0" class="font-bold text-slate-800">{{ teacher.class_count }}</span>
                        <span v-else class="text-xs text-amber-700">{{ t('teacher.directory.no_classes') }}</span>
                    </td>
                </tr>
            </tbody>
        </table>

        <!-- phones: stacked rows -->
        <ul class="divide-y divide-slate-100 md:hidden">
            <li v-for="teacher in items" :key="teacher.id" class="flex items-center gap-2 px-3"
                :class="selectedId === teacher.id ? 'bg-emerald-50' : ''">
                <input v-if="selectable" type="checkbox" class="h-5 w-5 shrink-0 cursor-pointer rounded border-slate-300 accent-emerald-600"
                    :checked="checkedIds.has(teacher.id)" :aria-label="t('teacher.directory.select_teacher', { name: teacher.name })"
                    @change="emit('toggle', teacher.id, ($event.target as HTMLInputElement).checked)" />
                <button type="button" class="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
                    @click="emit('select', teacher)">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-black"
                        :class="teacher.archived_at ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'" aria-hidden="true">{{ initial(teacher.name) }}</span>
                    <span class="min-w-0 flex-1">
                        <span class="block truncate font-bold text-slate-900">{{ teacher.name }}</span>
                        <span class="block truncate text-xs text-slate-500">
                            {{ teacher.archived_at ? t('teacher.directory.archived_badge') : (teacher.class_count > 0 ? t('teacher.directory.class_count', { n: teacher.class_count }) : t('teacher.directory.no_classes')) }}
                            · {{ teacher.user_id ? t('teacher.directory.linked') : t('teacher.directory.unlinked') }}
                        </span>
                    </span>
                    <svg class="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.17 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" /></svg>
                </button>
            </li>
        </ul>
    </div>
</template>
